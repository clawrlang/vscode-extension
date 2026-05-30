import * as vscode from 'vscode'
import * as clawr from '../../clawr-main/dist/src/index'

/**
 * Formats Clawr documents using the shared formatter from clawr-main.
 */
export class DocumentFormattingProvider
    implements vscode.DocumentFormattingEditProvider
{
    provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        _options: vscode.FormattingOptions,
        _token: vscode.CancellationToken,
    ): vscode.TextEdit[] {
        try {
            const source = document.getText()
            const formatted = clawr.formatClawrSource(source)

            if (formatted === source) {
                return []
            }

            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(source.length),
            )
            return [vscode.TextEdit.replace(fullRange, formatted)]
        } catch (_error) {
            // Formatter should never break editor workflows.
            return []
        }
    }
}
