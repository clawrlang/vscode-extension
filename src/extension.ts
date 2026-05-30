import * as vscode from 'vscode'
import { DiagnosticsProvider } from './providers/diagnostics'
import { HoverProvider } from './providers/hover'
import {
    DefinitionProvider,
    ReferenceProvider,
    DocumentSymbolProvider,
} from './providers/definition'
import {
    SemanticTokensProvider,
    semanticTokensLegend,
} from './providers/semanticTokens'
import { DocumentFormattingProvider } from './providers/formatting'

export async function activate(context: vscode.ExtensionContext) {
    console.log('Clawr language extension activated')

    // Create diagnostic collection for error reporting
    const diagnosticCollection =
        vscode.languages.createDiagnosticCollection('clawr')
    context.subscriptions.push(diagnosticCollection)

    // Register language features
    const diagnosticsProvider = new DiagnosticsProvider(diagnosticCollection)
    diagnosticsProvider.registerListeners(context)

    // Hover provider
    context.subscriptions.push(
        vscode.languages.registerHoverProvider('clawr', new HoverProvider()),
    )

    // Definition provider
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            'clawr',
            new DefinitionProvider(),
        ),
    )

    // Reference provider
    context.subscriptions.push(
        vscode.languages.registerReferenceProvider(
            'clawr',
            new ReferenceProvider(),
        ),
    )

    // Document symbol provider (outline)
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            'clawr',
            new DocumentSymbolProvider(),
        ),
    )

    // Semantic tokens provider (symbol coloring)
    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider(
            'clawr',
            new SemanticTokensProvider(),
            semanticTokensLegend,
        ),
    )

    // Document formatting provider (Format Document / format-on-save)
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(
            'clawr',
            new DocumentFormattingProvider(),
        ),
    )

    console.log('Clawr extension ready')
}

export function deactivate() {
    console.log('Clawr language extension deactivated')
}
