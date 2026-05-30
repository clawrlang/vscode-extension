# Clawr VS Code Extension

Language support for `.clawr` files, illustrating diagnostics, semantic tokens, and formatting.

This extension depends on <https://github.com/clawrlang/clawr> for rules and logic (referenced as a submodule as it is not yet published on NPM).

## Testing the Extension

1. Open the project folder in Visual Studio Code.
2. Press `F5` to launch a new `[Extension Development Host]` window with the extension installed.
3. Open [test.clawr](test.clawr) to see some examples of valid and invalid Clawr code.

## Local Development Note

When editing [package.json](package.json), VS Code may show a validation warning for:

```plain
"editor.defaultFormatter": "clawrlang.clawr-vscode"
```

This is expected during local development if the extension is not installed in the current VS Code instance yet.

Why this happens:

- The setting schema validates formatter IDs against currently known/installed extensions.
- The extension's formatter ID is not recognized until the extension is installed or running in an Extension Development Host.

What to do:

- Ignore this warning while developing locally.
- Validate behavior by running the extension in Extension Development Host, or by installing the extension package.
