import * as vscode from 'vscode'
import * as clawr from '../clawr-main/dist/src/index'
import { Position } from '../clawr-main/dist/src/diagnostics'

/**
 * Convert a Clawr SourceCodeSpan to a VSCode Range
 */
export function spanToRange(span: clawr.SourceCodeSpan): vscode.Range {
    const start = new vscode.Position(span.start.line, span.start.column)
    const end = new vscode.Position(span.end.line, span.end.column)
    return new vscode.Range(start, end)
}

/**
 * Convert a Clawr Position to a VSCode Position
 */
export function positionToClaw(pos: clawr.Position): vscode.Position {
    return new vscode.Position(pos.line, pos.column)
}

/**
 * Convert a VSCode Position to a Clawr Position
 */
export function vscodePositionToClawPosition(
    pos: vscode.Position,
): clawr.Position {
    return {
        line: pos.line,
        column: pos.character,
    }
}

/**
 * Create a mock ErrorReporter that collects diagnostics
 */
export class DiagnosticCollector implements clawr.ErrorReporter {
    public diagnostics: vscode.Diagnostic[] = []

    reportFatalError(message: string, location: clawr.SourceCodeSpan): never {
        this.addDiagnostic(message, location, vscode.DiagnosticSeverity.Error)
        throw new Error(`Fatal Clawr error: ${message}`)
    }

    reportWarning(message: string, location: clawr.SourceCodeSpan): void {
        this.addDiagnostic(message, location, vscode.DiagnosticSeverity.Warning)
    }

    reportError(message: string, location: clawr.SourceCodeSpan): void {
        this.addDiagnostic(message, location, vscode.DiagnosticSeverity.Error)
    }

    private addDiagnostic(
        message: string,
        location: clawr.SourceCodeSpan,
        severity: vscode.DiagnosticSeverity,
    ): void {
        const range = toVSCodeRange(location)
        const diagnostic = new vscode.Diagnostic(range, message, severity)
        diagnostic.source = 'clawr'
        this.diagnostics.push(diagnostic)
    }

    getDiagnostics(): vscode.Diagnostic[] {
        return this.diagnostics
    }

    clear(): void {
        this.diagnostics = []
    }
}

function toVSCodeRange(clawrSpan: clawr.SourceCodeSpan) {
    return new vscode.Range(
        toVSCodePosition(clawrSpan.start),
        toVSCodePosition(clawrSpan.end),
    )
}

function toVSCodePosition(clawrPosition: Position): vscode.Position {
    return new vscode.Position(clawrPosition.line - 1, clawrPosition.column - 1)
}

/**
 * Tokenize Clawr source code
 */
export function tokenize(
    source: string,
    errorReporter: clawr.ErrorReporter,
): clawr.Token[] {
    try {
        const stream = clawr.TokenStream.read(source, errorReporter)
        const tokens: clawr.Token[] = []
        while (true) {
            const token = stream.peek()
            if (!token) break
            tokens.push(token)
            stream.next()
        }
        return tokens
    } catch (error) {
        return []
    }
}

/**
 * Map token kinds to TextMate scopes for syntax highlighting
 * This is a basic mapping that can be extended based on lexer token kinds
 */
export function tokenKindToScope(token: clawr.Token): string {
    // TODO: Examine clawr.Token type and implement proper mapping
    // For now, return a generic scope
    return 'source.clawr'
}

/**
 * Get language features info
 */
export const SUPPORTED_FEATURES = {
    diagnostics: 'Real-time error checking and parsing',
    hover: 'Type information and documentation on hover',
    definition: 'Go-to-definition for variables and functions',
    outline: 'Document symbol outline',
    formatting: 'Basic auto-formatting',
} as const
