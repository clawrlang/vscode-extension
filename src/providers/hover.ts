import * as vscode from 'vscode'
import * as clawr from '../../clawr-main/dist/src/index'
import { SemanticScope } from '../../clawr-main/dist/src/semantic-model/semantic-scope'
import { TypedScopeVariable } from '../../clawr-main/dist/src/semantic-model/scope-variable'

type HoverMatch = {
    signature: string
    detail?: string
    span: clawr.SourceCodeSpan
}

type ClawrPosition = {
    line: number
    column: number
}

type CallableOwner = {
    ownerName?: string
    detailPrefix?: string
}

const silentErrorReporter: clawr.ErrorReporter = {
    reportFatalError(message: string): never {
        throw new Error(message)
    },
    reportWarning(): void {},
    reportError(): void {},
}

/**
 * Provides hover information for Clawr source code
 */
export class HoverProvider implements vscode.HoverProvider {
    /**
     * Provide hover information at the given position
     */
    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
    ): Promise<vscode.Hover | null> {
        try {
            const source = document.getText()
            const parsingContext: clawr.ParsingContext = {
                stream: clawr.TokenStream.read(source, silentErrorReporter),
                errorReporter: silentErrorReporter,
            }
            const module = new clawr.ModuleParser(parsingContext).parse()
            const inferenceContext: clawr.InferenceContext = {
                scope: SemanticScope.createRoot(),
                errorReporter: silentErrorReporter,
            }
            prepareModuleScope(module, inferenceContext.scope)

            const match = findHoverInModule(
                module,
                toClawrPosition(position),
                inferenceContext,
            )
            if (!match) {
                return null
            }

            return createHover(match)
        } catch {
            return null
        }
    }
}

function createHover(match: HoverMatch): vscode.Hover {
    const markdown = new vscode.MarkdownString()
    markdown.appendCodeblock(match.signature, 'clawr')
    if (match.detail) {
        markdown.appendMarkdown(`\n${match.detail}`)
    }

    return new vscode.Hover(markdown, spanToRange(match.span))
}

function findHoverInModule(
    module: any,
    position: ClawrPosition,
    context: clawr.InferenceContext,
): HoverMatch | null {
    for (const variableDeclaration of module.variables) {
        const match = findHoverInVariableDeclaration(
            variableDeclaration,
            position,
            context,
        )
        if (match) return match
    }

    for (const typeDeclaration of module.types) {
        const match = findHoverInTypeDeclaration(
            typeDeclaration,
            position,
            context,
        )
        if (match) return match
    }

    for (const companionDeclaration of module.companions) {
        const match = findHoverInCompanionDeclaration(
            companionDeclaration,
            position,
            context,
        )
        if (match) return match
    }

    for (const functionDeclaration of module.functions) {
        const match = findHoverInCallable(
            functionDeclaration,
            position,
            createCallableContext(context, undefined, functionDeclaration),
            {},
        )
        if (match) return match
    }

    return null
}

function findHoverInVariableDeclaration(
    variableDeclaration: any,
    position: ClawrPosition,
    context: clawr.InferenceContext,
): HoverMatch | null {
    if (containsPosition(variableDeclaration.nameLocation, position)) {
        return variableHover(
            variableDeclaration.name,
            variableDeclaration.semantics.type,
            variableDeclaration.inferredValueSet(context)?.type ??
                variableDeclaration.valueSet?.type,
            variableDeclaration.nameLocation,
        )
    }

    if (
        variableDeclaration.valueSet &&
        containsPosition(variableDeclaration.valueSet.location, position)
    ) {
        return typeHoverByName(
            variableDeclaration.valueSet.type,
            variableDeclaration.valueSet.location,
            context,
        )
    }

    if (variableDeclaration.value) {
        return findHoverInExpression(
            variableDeclaration.value,
            position,
            context,
        )
    }

    return null
}

function findHoverInTypeDeclaration(
    typeDeclaration: any,
    position: ClawrPosition,
    context: clawr.InferenceContext,
): HoverMatch | null {
    if (containsPosition(typeDeclaration.nameLocation, position)) {
        return typeDeclarationHover(typeDeclaration)
    }

    for (const field of typeDeclaration.fields ?? []) {
        const fieldMatch = findHoverInFieldDeclaration(field, position, context)
        if (fieldMatch) return fieldMatch
    }

    if (
        typeDeclaration.kind === 'object-decl' ||
        typeDeclaration.kind === 'service-decl'
    ) {
        for (const readonlyMethod of typeDeclaration.readonly ?? []) {
            const match = findHoverInCallable(
                readonlyMethod,
                position,
                createCallableContext(context, typeDeclaration, readonlyMethod),
                {
                    ownerName: typeDeclaration.name,
                    detailPrefix:
                        typeDeclaration.kind === 'service-decl'
                            ? 'Readonly service method'
                            : 'Readonly method',
                },
            )
            if (match) return match
        }

        for (const mutatingMethod of typeDeclaration.mutating ?? []) {
            const match = findHoverInCallable(
                mutatingMethod,
                position,
                createCallableContext(context, typeDeclaration, mutatingMethod),
                {
                    ownerName: typeDeclaration.name,
                    detailPrefix:
                        typeDeclaration.kind === 'service-decl'
                            ? 'Mutating service method'
                            : 'Mutating method',
                },
            )
            if (match) return match
        }

        for (const initializer of typeDeclaration.inheritance ?? []) {
            const match = findHoverInCallable(
                initializer,
                position,
                createCallableContext(context, typeDeclaration, initializer),
                {
                    ownerName: typeDeclaration.name,
                    detailPrefix: 'Inheritance initializer',
                },
            )
            if (match) return match
        }
    }

    return null
}

function findHoverInFieldDeclaration(
    fieldDeclaration: any,
    position: ClawrPosition,
    context: clawr.InferenceContext,
): HoverMatch | null {
    if (containsPosition(fieldDeclaration.nameLocation, position)) {
        return fieldHover(
            fieldDeclaration,
            fieldDeclaration.inferredValueSet(context)?.type ??
                fieldDeclaration.valueSet?.type,
        )
    }

    if (
        fieldDeclaration.valueSet &&
        containsPosition(fieldDeclaration.valueSet.location, position)
    ) {
        return typeHoverByName(
            fieldDeclaration.valueSet.type,
            fieldDeclaration.valueSet.location,
            context,
        )
    }

    if (fieldDeclaration.value) {
        return findHoverInExpression(fieldDeclaration.value, position, context)
    }

    return null
}

function findHoverInCompanionDeclaration(
    companionDeclaration: any,
    position: ClawrPosition,
    context: clawr.InferenceContext,
): HoverMatch | null {
    if (containsPosition(companionDeclaration.nameLocation, position)) {
        return {
            signature: `companion ${companionDeclaration.name}`,
            detail: `Static methods for ${companionDeclaration.name}`,
            span: companionDeclaration.nameLocation,
        }
    }

    for (const method of companionDeclaration.methods) {
        const match = findHoverInCallable(
            method,
            position,
            createCallableContext(context, undefined, method),
            {
                ownerName: companionDeclaration.name,
                detailPrefix: 'Companion method',
            },
        )
        if (match) return match
    }

    return null
}

function findHoverInCallable(
    callable: any,
    position: ClawrPosition,
    context: clawr.InferenceContext,
    owner: CallableOwner,
): HoverMatch | null {
    if (containsPosition(callable.nameLocation, position)) {
        return callableHover(callable, owner)
    }

    for (const parameter of callable.parameters ?? []) {
        if (containsPosition(parameter.varNameLocation, position)) {
            return parameterHover(parameter)
        }

        if (
            parameter.labelLocation &&
            parameter.label &&
            containsPosition(parameter.labelLocation, position)
        ) {
            return {
                signature: `${parameter.label}: ${parameter.valueSet.type}`,
                detail: 'Argument label',
                span: parameter.labelLocation,
            }
        }

        if (containsPosition(parameter.valueSet.location, position)) {
            return typeHoverByName(
                parameter.valueSet.type,
                parameter.valueSet.location,
                context,
            )
        }
    }

    if (
        callable.returnValueSet &&
        containsPosition(callable.returnValueSet.location, position)
    ) {
        return typeHoverByName(
            callable.returnValueSet.type,
            callable.returnValueSet.location,
            context,
        )
    }

    return findHoverInCallableBody(callable.body, position, context)
}

function findHoverInCallableBody(
    body: any,
    position: ClawrPosition,
    context: clawr.InferenceContext,
): HoverMatch | null {
    if (!body) return null

    if (body.kind === 'expression') {
        return findHoverInExpression(body.expression, position, context)
    }

    if (body.kind === 'block') {
        for (const statement of body.statements ?? []) {
            const match = findHoverInStatement(statement, position, context)
            if (match) return match
            if (
                statement.kind === 'variable-declaration' &&
                !context.scope.hasOwnVariable(statement.name)
            ) {
                context.scope.declareVariable(statement.toScopeVariable())
            }
        }
    }

    return null
}

function findHoverInStatement(
    statement: any,
    position: ClawrPosition,
    context: clawr.InferenceContext,
): HoverMatch | null {
    switch (statement.kind) {
        case 'variable-declaration':
            return findHoverInVariableDeclaration(statement, position, context)
        case 'return-statement':
            return statement.expression
                ? findHoverInExpression(statement.expression, position, context)
                : null
        case 'assignment-statement': {
            const targetMatch = findHoverInExpression(
                statement.target,
                position,
                context,
            )
            if (targetMatch) return targetMatch
            return findHoverInExpression(statement.value, position, context)
        }
        case 'call-statement':
            return findHoverInExpression(
                statement.expression,
                position,
                context,
            )
        default:
            return null
    }
}

function findHoverInExpression(
    expression: any,
    position: ClawrPosition,
    context: clawr.InferenceContext,
): HoverMatch | null {
    switch (expression.kind) {
        case 'variable-reference':
            return containsPosition(expression.location, position)
                ? variableReferenceHover(
                      expression.name,
                      expression.location,
                      context,
                  )
                : null
        case 'member-access-expression': {
            if (containsPosition(expression.memberLocation, position)) {
                return memberAccessHover(expression, context)
            }
            return findHoverInExpression(expression.object, position, context)
        }
        case 'call-expression': {
            const calleeMatch = findHoverInExpression(
                expression.callee,
                position,
                context,
            )
            if (calleeMatch) return calleeMatch
            for (const argument of expression.args ?? []) {
                const argumentMatch = findHoverInExpression(
                    argument.value,
                    position,
                    context,
                )
                if (argumentMatch) return argumentMatch
            }
            return null
        }
        case 'data-literal': {
            for (const field of expression.fields ?? []) {
                if (containsPosition(field.nameLocation, position)) {
                    const literalType =
                        expression.inferredValueSet(context)?.type
                    return fieldHoverFromType(
                        literalType,
                        field.name,
                        field.nameLocation,
                        context,
                    )
                }
                const fieldMatch = findHoverInExpression(
                    field.value,
                    position,
                    context,
                )
                if (fieldMatch) return fieldMatch
            }
            for (const initializer of expression.initializers ?? []) {
                const initializerMatch = findHoverInExpression(
                    initializer.value,
                    position,
                    context,
                )
                if (initializerMatch) return initializerMatch
            }
            return null
        }
        case 'addition-expression':
        case 'subtraction-expression':
        case 'multiplication-expression':
        case 'division-expression':
        case 'and-expression':
        case 'or-expression':
        case 'comparison-expression':
        case 'equality-expression': {
            const leftMatch = findHoverInExpression(
                expression.left,
                position,
                context,
            )
            if (leftMatch) return leftMatch
            return findHoverInExpression(expression.right, position, context)
        }
        case 'negation-expression':
        case 'bitwise-negation-expression':
        case 'not-expression':
            return findHoverInExpression(expression.operand, position, context)
        default:
            return null
    }
}

function memberAccessHover(
    expression: any,
    context: clawr.InferenceContext,
): HoverMatch | null {
    const objectValueSet = expression.object.inferredValueSet(context)
    if (!objectValueSet) return null

    const typeDeclaration = context.scope.getType(objectValueSet.type)
    if (!typeDeclaration) return null

    if ('isTypeReference' in objectValueSet && objectValueSet.isTypeReference) {
        if (
            typeDeclaration.kind === 'object-decl' ||
            typeDeclaration.kind === 'service-decl'
        ) {
            const initializer = typeDeclaration.inheritance.find(
                (candidate: any) => candidate.name === expression.member,
            )
            if (initializer) {
                return callableHover(initializer, {
                    ownerName: typeDeclaration.name,
                    detailPrefix: 'Inheritance initializer',
                })
            }
        }

        const companion = context.scope.getCompanion(typeDeclaration.name)
        const companionMethod = companion?.methods.find(
            (candidate: any) => candidate.name === expression.member,
        )
        if (companionMethod) {
            return callableHover(companionMethod, {
                ownerName: typeDeclaration.name,
                detailPrefix: 'Companion method',
            })
        }
        return null
    }

    const field = typeDeclaration.fields?.find(
        (candidate: any) => candidate.name === expression.member,
    )
    if (field) {
        return fieldHover(
            field,
            field.inferredValueSet(context)?.type ?? field.valueSet?.type,
        )
    }

    if (
        typeDeclaration.kind !== 'object-decl' &&
        typeDeclaration.kind !== 'service-decl'
    ) {
        return null
    }

    const readonlyMethod = typeDeclaration.readonly.find(
        (candidate: any) => candidate.name === expression.member,
    )
    if (readonlyMethod) {
        return callableHover(readonlyMethod, {
            ownerName: typeDeclaration.name,
            detailPrefix:
                typeDeclaration.kind === 'service-decl'
                    ? 'Readonly service method'
                    : 'Readonly method',
        })
    }

    const mutatingMethod = typeDeclaration.mutating.find(
        (candidate: any) => candidate.name === expression.member,
    )
    if (mutatingMethod) {
        return callableHover(mutatingMethod, {
            ownerName: typeDeclaration.name,
            detailPrefix:
                typeDeclaration.kind === 'service-decl'
                    ? 'Mutating service method'
                    : 'Mutating method',
        })
    }

    return null
}

function variableReferenceHover(
    name: string,
    span: clawr.SourceCodeSpan,
    context: clawr.InferenceContext,
): HoverMatch | null {
    const variable = context.scope.getVariable(name)
    if (variable) {
        return variableHover(
            name,
            variable.semanticsType,
            variable.inferredValueSet(context)?.type,
            span,
        )
    }

    const functions = context.scope.getFunctions(name)
    if (functions.length > 0) {
        const detail =
            functions.length === 1
                ? 'Function'
                : `Function overloads (${functions.length})`
        return {
            signature: functions
                .map((callable: any) => formatCallable(callable, context))
                .join('\n'),
            detail,
            span,
        }
    }

    return typeHoverByName(name, span, context)
}

function variableHover(
    name: string,
    semanticsType: string | undefined,
    typeName: string | undefined,
    span: clawr.SourceCodeSpan,
): HoverMatch {
    const prefix = semanticsType ? `${semanticsType} ` : ''
    return {
        signature: `${prefix}${name}: ${typeName ?? 'unknown'}`,
        detail: 'Variable',
        span,
    }
}

function fieldHover(
    fieldDeclaration: any,
    typeName: string | undefined,
): HoverMatch {
    const prefix = fieldDeclaration.semantics?.type
        ? `${fieldDeclaration.semantics.type} `
        : ''
    return {
        signature: `${prefix}${fieldDeclaration.name}: ${typeName ?? 'unknown'}`,
        detail: 'Field',
        span: fieldDeclaration.nameLocation,
    }
}

function fieldHoverFromType(
    typeName: string | undefined,
    fieldName: string,
    span: clawr.SourceCodeSpan,
    context: clawr.InferenceContext,
): HoverMatch | null {
    if (!typeName) return null
    const typeDeclaration = context.scope.getType(typeName)
    const fieldDeclaration = typeDeclaration?.fields?.find(
        (candidate: any) => candidate.name === fieldName,
    )
    if (!fieldDeclaration) {
        return {
            signature: `${fieldName}: unknown`,
            detail: `Field on ${typeName}`,
            span,
        }
    }

    return {
        ...fieldHover(
            fieldDeclaration,
            fieldDeclaration.inferredValueSet(context)?.type ??
                fieldDeclaration.valueSet?.type,
        ),
        span,
    }
}

function parameterHover(parameter: any): HoverMatch {
    return {
        signature: `${formatParameter(parameter)}`,
        detail: 'Parameter',
        span: parameter.varNameLocation,
    }
}

function callableHover(callable: any, owner: CallableOwner): HoverMatch {
    return {
        signature: formatCallable(callable),
        detail: owner.ownerName
            ? `${owner.detailPrefix ?? 'Method'} on ${owner.ownerName}`
            : 'Function',
        span: callable.nameLocation,
    }
}

function typeDeclarationHover(typeDeclaration: any): HoverMatch {
    const signature =
        typeDeclaration.kind === 'data-decl'
            ? `data ${typeDeclaration.name}`
            : typeDeclaration.kind === 'service-decl'
              ? `service ${typeDeclaration.name}`
              : `object ${typeDeclaration.name}${typeDeclaration.superType ? `: ${typeDeclaration.superType}` : ''}`

    const fieldCount = typeDeclaration.fields?.length ?? 0
    return {
        signature,
        detail:
            typeDeclaration.kind === 'data-decl'
                ? `${fieldCount} field${fieldCount === 1 ? '' : 's'}`
                : `${fieldCount} field${fieldCount === 1 ? '' : 's'}`,
        span: typeDeclaration.nameLocation,
    }
}

function typeHoverByName(
    typeName: string,
    span: clawr.SourceCodeSpan,
    context: clawr.InferenceContext,
): HoverMatch {
    const typeDeclaration = context.scope.getType(typeName)
    if (!typeDeclaration) {
        return {
            signature: `type ${typeName}`,
            detail: 'Type annotation',
            span,
        }
    }

    return {
        ...typeDeclarationHover(typeDeclaration),
        span,
    }
}

function formatCallable(
    callable: any,
    context?: clawr.InferenceContext,
): string {
    const helperPrefix = callable.isHelper ? 'helper ' : ''
    const parameters = (callable.parameters ?? [])
        .map(formatParameter)
        .join(', ')
    const returnType =
        callable.returnValueSet?.type ??
        callable.inferredValueSet?.(
            context ?? {
                scope: SemanticScope.createRoot(),
                errorReporter: silentErrorReporter,
            },
        )?.type
    return `${helperPrefix}func ${callable.name}(${parameters})${returnType ? ` -> ${returnType}` : ''}`
}

function formatParameter(parameter: any): string {
    if (parameter.label === undefined && parameter.varName) {
        return `_ ${parameter.varName}: ${parameter.valueSet.type}`
    }

    if (parameter.label === parameter.varName || !parameter.varName) {
        return `${parameter.varName ?? parameter.name}: ${parameter.valueSet.type}`
    }

    return `${parameter.label} ${parameter.varName}: ${parameter.valueSet.type}`
}

function createCallableContext(
    parentContext: clawr.InferenceContext,
    ownerType: any,
    callable: any,
): clawr.InferenceContext {
    const scope = ownerType
        ? parentContext.scope.createObjectScope(ownerType)
        : parentContext.scope.createChildScope()

    for (const parameter of callable.parameters ?? []) {
        if (!scope.hasOwnVariable(parameter.varName)) {
            scope.declareVariable(
                TypedScopeVariable.create({
                    name: parameter.varName,
                    valueSet: {
                        type: parameter.valueSet.type,
                        location: parameter.valueSet.location,
                    },
                    location: parameter.location,
                    nameLocation: parameter.varNameLocation,
                }),
            )
        }
    }

    return {
        ...parentContext,
        scope,
        declaredType: ownerType?.name ?? parentContext.declaredType,
        isInitializer:
            callable.kind === 'inheritance-initializer-decl' ||
            parentContext.isInitializer,
    }
}

function prepareModuleScope(module: any, scope: SemanticScope): void {
    for (const variableDeclaration of module.variables ?? []) {
        if (!scope.hasOwnVariable(variableDeclaration.name)) {
            scope.declareVariable(variableDeclaration.toScopeVariable())
        }
    }

    for (const typeDeclaration of module.types ?? []) {
        scope.declareType(typeDeclaration)
    }

    for (const companionDeclaration of module.companions ?? []) {
        scope.declareCompanion(companionDeclaration)
    }

    for (const functionDeclaration of module.functions ?? []) {
        scope.declareFunction(functionDeclaration)
    }
}

function toClawrPosition(position: vscode.Position): ClawrPosition {
    return {
        line: position.line + 1,
        column: position.character + 1,
    }
}

function containsPosition(
    span: clawr.SourceCodeSpan,
    position: ClawrPosition,
): boolean {
    if (position.line < span.start.line || position.line > span.end.line) {
        return false
    }

    if (span.start.line === span.end.line) {
        return (
            position.column >= span.start.column &&
            position.column < span.end.column
        )
    }

    if (position.line === span.start.line) {
        return position.column >= span.start.column
    }

    if (position.line === span.end.line) {
        return position.column < span.end.column
    }

    return true
}

function spanToRange(span: clawr.SourceCodeSpan): vscode.Range {
    return new vscode.Range(
        new vscode.Position(span.start.line - 1, span.start.column - 1),
        new vscode.Position(span.end.line - 1, span.end.column - 1),
    )
}
