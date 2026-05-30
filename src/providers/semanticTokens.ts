import * as vscode from 'vscode'
import * as clawr from '../../clawr-main/dist/src/index'
import { DiagnosticCollector } from '../utils'

// Token types and modifiers must match the legend declared in package.json
const TOKEN_TYPES = [
    'function',
    'variable',
    'parameter',
    'type',
    'property',
] as const
const TOKEN_MODIFIERS = ['declaration', 'readonly'] as const

export const semanticTokensLegend = new vscode.SemanticTokensLegend(
    [...TOKEN_TYPES],
    [...TOKEN_MODIFIERS],
)

type TokenType = (typeof TOKEN_TYPES)[number]
type TokenModifier = (typeof TOKEN_MODIFIERS)[number]

type NameRegistry = {
    functionNames: Set<string>
    typeNames: Set<string>
}

function spanToRange(span: clawr.SourceCodeSpan): vscode.Range {
    return new vscode.Range(
        span.start.line - 1,
        span.start.column - 1,
        span.end.line - 1,
        span.end.column - 1,
    )
}

function pushToken(
    builder: vscode.SemanticTokensBuilder,
    span: clawr.SourceCodeSpan,
    type: TokenType,
    modifiers: TokenModifier[],
) {
    const range = spanToRange(span)
    builder.push(range, type, modifiers)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walkExpression(
    expr: clawr.Expression,
    builder: vscode.SemanticTokensBuilder,
    names: NameRegistry,
) {
    const e = expr as any
    switch (expr.kind) {
        case 'variable-reference': {
            if (names.functionNames.has(e.name)) {
                pushToken(builder, expr.location, 'function', [])
            } else if (names.typeNames.has(e.name)) {
                pushToken(builder, expr.location, 'type', [])
            } else {
                pushToken(builder, expr.location, 'variable', [])
            }
            break
        }
        case 'call-expression': {
            // Mark the callee as a function call (if it is a plain name reference)
            if (e.callee && e.callee.kind === 'variable-reference') {
                pushToken(builder, e.callee.location, 'function', [])
            } else if (e.callee) {
                walkExpression(e.callee, builder, names)
            }
            if (Array.isArray(e.args)) {
                for (const arg of e.args) {
                    if (arg.value) walkExpression(arg.value, builder, names)
                }
            }
            break
        }
        case 'member-access-expression': {
            if (e.object) walkExpression(e.object, builder, names)
            if (e.memberLocation) {
                pushToken(builder, e.memberLocation, 'property', [])
            }
            break
        }
        case 'data-literal': {
            if (Array.isArray(e.fields)) {
                for (const field of e.fields) {
                    if (field.nameLocation) {
                        pushToken(builder, field.nameLocation, 'property', [])
                    }
                    if (field.value) walkExpression(field.value, builder, names)
                }
            }
            break
        }
        // Binary operators
        case 'addition-expression':
        case 'subtraction-expression':
        case 'multiplication-expression':
        case 'division-expression':
        case 'and-expression':
        case 'or-expression':
        case 'comparison-expression':
        case 'equality-expression': {
            if (e.left) walkExpression(e.left, builder, names)
            if (e.right) walkExpression(e.right, builder, names)
            break
        }
        // Prefix / unary operators
        case 'negation-expression':
        case 'bitwise-negation-expression':
        case 'not-expression': {
            if (e.operand) walkExpression(e.operand, builder, names)
            break
        }
        // Literals produce no semantic tokens (handled by TextMate grammar)
        default:
            break
    }
}

function walkStatement(
    stmt: clawr.Statement,
    builder: vscode.SemanticTokensBuilder,
    names: NameRegistry,
) {
    const s = stmt as any
    switch (stmt.kind) {
        case 'variable-declaration': {
            const modifiers: TokenModifier[] = ['declaration']
            if (s.semantics?.type === 'const') modifiers.push('readonly')
            if (s.nameLocation)
                pushToken(builder, s.nameLocation, 'variable', modifiers)
            if (s.value) walkExpression(s.value, builder, names)
            break
        }
        case 'return-statement': {
            if (s.expression) walkExpression(s.expression, builder, names)
            break
        }
        case 'data-declaration': {
            if (s.nameLocation)
                pushToken(builder, s.nameLocation, 'type', ['declaration'])
            if (Array.isArray(s.fields)) {
                for (const field of s.fields) {
                    if (field.nameLocation) {
                        pushToken(builder, field.nameLocation, 'property', [
                            'declaration',
                        ])
                    }
                    if (field.value) walkExpression(field.value, builder, names)
                }
            }
            break
        }
        default:
            break
    }
}

export class SemanticTokensProvider
    implements vscode.DocumentSemanticTokensProvider
{
    provideDocumentSemanticTokens(
        document: vscode.TextDocument,
    ): vscode.SemanticTokens {
        const builder = new vscode.SemanticTokensBuilder(semanticTokensLegend)
        const source = document.getText()
        const collector = new DiagnosticCollector()

        try {
            const context: clawr.ParsingContext = {
                stream: clawr.TokenStream.read(source, collector),
                errorReporter: collector,
            }
            const module = new clawr.ModuleParser(context).parse()
            if (!module) return builder.build()

            // Build name registries for reference classification
            const names: NameRegistry = {
                functionNames: new Set(module.functions.map((f) => f.name)),
                typeNames: new Set(module.types.map((t) => t.name)),
            }

            // --- Top-level variable declarations ---
            for (const v of module.variables) {
                const modifiers: TokenModifier[] = ['declaration']
                if (v.semantics?.type === 'const') modifiers.push('readonly')
                pushToken(builder, v.nameLocation, 'variable', modifiers)
                if (v.value)
                    walkExpression(v.value as clawr.Expression, builder, names)
            }

            // --- Type declarations (data / object) ---
            for (const t of module.types) {
                pushToken(builder, t.nameLocation, 'type', ['declaration'])
                // Mark field names for data declarations
                const td = t as any
                if (Array.isArray(td.fields)) {
                    for (const field of td.fields) {
                        if (field.nameLocation) {
                            pushToken(builder, field.nameLocation, 'property', [
                                'declaration',
                            ])
                        }
                    }
                }
            }

            // --- Function declarations ---
            for (const f of module.functions) {
                pushToken(builder, f.nameLocation, 'function', ['declaration'])

                // Parameters
                for (const param of f.parameters) {
                    pushToken(builder, param.varNameLocation, 'parameter', [
                        'declaration',
                    ])
                    // Add parameter name to local scope for body walking
                    names.functionNames.delete(param.varName) // ensure not confused with func
                }

                // Body
                const body = (f as any).body
                if (body) {
                    if (body.kind === 'expression' && body.expression) {
                        walkExpression(
                            body.expression as clawr.Expression,
                            builder,
                            names,
                        )
                    } else if (
                        body.kind === 'block' &&
                        Array.isArray(body.statements)
                    ) {
                        for (const stmt of body.statements) {
                            walkStatement(
                                stmt as clawr.Statement,
                                builder,
                                names,
                            )
                        }
                    }
                }
            }
        } catch {
            // Return partial tokens on any parse/inference error
        }

        return builder.build()
    }
}
