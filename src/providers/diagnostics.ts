import * as vscode from 'vscode'
import { DiagnosticCollector } from '../utils'
import * as clawr from '../../clawr-main/dist/src/index'
import { SemanticScope } from '../../clawr-main/dist/src/semantic-model/semantic-scope'

/**
 * Provides real-time diagnostics for Clawr source code
 */
export class DiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection

    constructor(diagnosticCollection: vscode.DiagnosticCollection) {
        this.diagnosticCollection = diagnosticCollection
    }

    /**
     * Analyze a document and publish diagnostics
     */
    public async analyze(document: vscode.TextDocument): Promise<void> {
        const source = document.getText()
        const diagnostics: vscode.Diagnostic[] = []
        const diagnosticCollector = new DiagnosticCollector()

        try {
            // Parse the full module so syntax errors are surfaced as diagnostics.
            const context: clawr.ParsingContext = {
                stream: clawr.TokenStream.read(source, diagnosticCollector),
                errorReporter: diagnosticCollector,
            }
            const module = new clawr.ModuleParser(context).parse()

            // Run semantic analysis so type/scope errors are surfaced in the editor.
            const inferenceContext: clawr.InferenceContext = {
                scope: SemanticScope.createRoot(),
                errorReporter: diagnosticCollector,
            }
            module.toAST(inferenceContext)
        } catch (error) {
            // Fatal parse errors are reported through DiagnosticCollector.
            // Only add an unexpected error if parser failed before reporting diagnostics.
            if (diagnosticCollector.getDiagnostics().length === 0) {
                const message =
                    error instanceof Error ? error.message : String(error)
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(0, 0, 0, 1),
                    `Unexpected error: ${message}`,
                    vscode.DiagnosticSeverity.Error,
                )
                diagnostic.source = 'clawr'
                diagnostics.push(diagnostic)
            }
        }

        diagnostics.push(...diagnosticCollector.getDiagnostics())

        // Publish diagnostics
        this.diagnosticCollection.set(document.uri, diagnostics)
    }

    /**
     * Clear diagnostics for a document
     */
    public clear(document: vscode.TextDocument): void {
        this.diagnosticCollection.delete(document.uri)
    }

    /**
     * Register document listeners
     */
    public registerListeners(context: vscode.ExtensionContext): void {
        // Analyze on open
        vscode.workspace.onDidOpenTextDocument(
            (doc) => {
                if (doc.languageId === 'clawr') {
                    this.analyze(doc)
                }
            },
            null,
            context.subscriptions,
        )

        // Analyze on change (with debounce)
        let changeTimeout: ReturnType<typeof setTimeout> | undefined
        vscode.workspace.onDidChangeTextDocument(
            (event) => {
                if (event.document.languageId === 'clawr') {
                    if (changeTimeout !== undefined) {
                        clearTimeout(changeTimeout)
                    }
                    changeTimeout = setTimeout(() => {
                        this.analyze(event.document)
                    }, 500)
                }
            },
            null,
            context.subscriptions,
        )

        // Clear on close
        vscode.workspace.onDidCloseTextDocument(
            (doc) => {
                if (doc.languageId === 'clawr') {
                    this.clear(doc)
                }
            },
            null,
            context.subscriptions,
        )

        // Analyze all open documents on activation
        vscode.workspace.textDocuments
            .filter((doc) => doc.languageId === 'clawr')
            .forEach((doc) => this.analyze(doc))
    }
}
