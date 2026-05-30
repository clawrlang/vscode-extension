const path = require('node:path')
const vm = require('node:vm')
const { buildSync } = require('esbuild')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function createMockVscode() {
  const registrations = {
    formatting: [],
    hover: [],
  }

  class Range {
    constructor(start, end) {
      this.start = start
      this.end = end
    }
  }

  class TextEdit {
    static replace(range, newText) {
      return { range, newText }
    }
  }

  class MarkdownString {
    constructor(value = '') {
      this.value = value
    }

    appendCodeblock(code, language) {
      this.value += `\n\`\`\`${language}\n${code}\n\`\`\``
    }

    appendMarkdown(text) {
      this.value += text
    }
  }

  class Hover {
    constructor(contents, range) {
      this.contents = contents
      this.range = range
    }
  }

  class SemanticTokensLegend {
    constructor(tokenTypes = [], tokenModifiers = []) {
      this.tokenTypes = tokenTypes
      this.tokenModifiers = tokenModifiers
    }
  }

  function disposable() {
    return { dispose() {} }
  }

  const vscode = {
    Range,
    TextEdit,
    MarkdownString,
    Hover,
    SemanticTokensLegend,
    languages: {
      createDiagnosticCollection() {
        return {
          set() {},
          delete() {},
          dispose() {},
        }
      },
      registerDefinitionProvider() {
        return disposable()
      },
      registerReferenceProvider() {
        return disposable()
      },
      registerDocumentSymbolProvider() {
        return disposable()
      },
      registerDocumentSemanticTokensProvider() {
        return disposable()
      },
      registerHoverProvider(languageId, provider) {
        registrations.hover.push({ languageId, provider })
        return disposable()
      },
      registerDocumentFormattingEditProvider(languageId, provider) {
        registrations.formatting.push({ languageId, provider })
        return disposable()
      },
    },
    workspace: {
      textDocuments: [],
      onDidOpenTextDocument() {
        return disposable()
      },
      onDidChangeTextDocument() {
        return disposable()
      },
      onDidCloseTextDocument() {
        return disposable()
      },
    },
    Position: class Position {
      constructor(line, character) {
        this.line = line
        this.character = character
      }
    },
  }

  return { vscode, registrations }
}

function createMockDocument(source) {
  return {
    languageId: 'clawr',
    getText() {
      return source
    },
    offsetAt(position) {
      const lines = source.split('\n')
      let offset = 0
      for (let index = 0; index < position.line; index++) {
        offset += lines[index].length + 1
      }
      return offset + position.character
    },
    positionAt(offset) {
      const before = source.slice(0, offset)
      const parts = before.split('\n')
      const line = parts.length - 1
      const character = parts[parts.length - 1].length
      return { line, character }
    },
  }
}

function loadExtensionModule(mockVscode) {
  const entry = path.join(__dirname, '..', 'src', 'extension.ts')
  const result = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    external: ['vscode'],
    target: 'node20',
  })

  const code = result.outputFiles[0].text
  const module = { exports: {} }

  const context = {
    module,
    exports: module.exports,
    require(id) {
      if (id === 'vscode') {
        return mockVscode
      }
      return require(id)
    },
    __dirname: path.dirname(entry),
    __filename: entry,
    process,
    console,
    setTimeout,
    clearTimeout,
  }

  vm.runInNewContext(code, context, { filename: 'extension.bundle.cjs' })
  return module.exports
}

async function main() {
  const { vscode, registrations } = createMockVscode()
  const extension = loadExtensionModule(vscode)
  const context = {
    subscriptions: [],
  }

  await extension.activate(context)

  assert(
    registrations.formatting.length === 1,
    `Expected one formatting provider registration, got ${registrations.formatting.length}`,
  )
  assert(
    registrations.hover.length === 1,
    `Expected one hover provider registration, got ${registrations.hover.length}`,
  )

  const registration = registrations.formatting[0]
  assert(
    registration.languageId === 'clawr',
    `Expected formatter language id 'clawr', got '${registration.languageId}'`,
  )

  const provider = registration.provider
  const unformatted = ['func main() {', 'const x = {', 'a: 1', '}', '}'].join(
    '\n',
  )
  const formattedDocument = createMockDocument(unformatted)
  const edits = provider.provideDocumentFormattingEdits(
    formattedDocument,
    { insertSpaces: true, tabSize: 4 },
    {},
  )

  assert(Array.isArray(edits), 'Expected provider to return an array of edits')
  assert(edits.length === 1, `Expected one edit, got ${edits.length}`)
  assert(
    edits[0].newText.includes('    const x = {'),
    'Expected formatted output to include normalized indentation',
  )

  const alreadyFormattedSource = edits[0].newText
  const alreadyFormattedDocument = createMockDocument(alreadyFormattedSource)
  const noEdits = provider.provideDocumentFormattingEdits(
    alreadyFormattedDocument,
    { insertSpaces: true, tabSize: 4 },
    {},
  )
  assert(
    Array.isArray(noEdits) && noEdits.length === 0,
    'Expected no edits when input is already formatted',
  )

  const hoverProvider = registrations.hover[0].provider
  const hoverDocument = createMockDocument(
    [
      'func add(_ value: integer) -> integer => value',
      'const total = add(2)',
    ].join('\n'),
  )
  const hover = await hoverProvider.provideHover(
    hoverDocument,
    { line: 0, character: 5 },
    {},
  )

  assert(hover, 'Expected hover provider to return a hover result')
  assert(
    String(hover.contents.value).includes('func add'),
    'Expected hover output to include function signature',
  )

  console.log('Formatter integration checks passed (execution-based harness)')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
