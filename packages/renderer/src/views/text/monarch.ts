import type * as Monaco from 'monaco-editor/editor/editor.api';

export const languageConfiguration: Monaco.languages.LanguageConfiguration = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [['{', '}'], ['[', ']'], ['(', ')']],
  autoClosingPairs: [
    { open: '{', close: '}' }, { open: '[', close: ']' }, { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string'] }, { open: "'", close: "'", notIn: ['string'] }
  ]
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

const comment: Monaco.languages.IMonarchLanguageRule[] = [
  [/[^/*]+/, 'comment'],
  [/\*\//, 'comment', '@pop'],
  [/[/*]/, 'comment']
];

/** Tokenizer for a metamodel's instance syntax: keywords come from the grammar, the rest is generic. */
export function monarchFor(keywords: string[]): Monaco.languages.IMonarchLanguage {
  const words = keywords.filter(k => /^\w+$/.test(k));
  const symbols = keywords.filter(k => !/^\w+$/.test(k)).sort((a, b) => b.length - a.length);
  return {
    keywords: words,
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/, 'string'],
        [/[0-9]+(\.[0-9]+)?/, 'number'],
        [/[_a-zA-Z][\w_]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        ...(symbols.length ? [[new RegExp(symbols.map(escapeRegex).join('|')), 'delimiter'] as Monaco.languages.IMonarchLanguageRule] : [])
      ],
      comment
    }
  };
}

const LANGIUM_KEYWORDS = [
  'grammar', 'import', 'entry', 'fragment', 'terminal', 'hidden', 'returns', 'infers', 'infer', 'current',
  'interface', 'type', 'extends', 'with', 'true', 'false', 'string', 'number', 'boolean', 'bigint', 'Date'
];

/** The language the metamodels (Langium grammars) are written in. */
export const langiumMonarch: Monaco.languages.IMonarchLanguage = {
  keywords: LANGIUM_KEYWORDS,
  tokenizer: {
    root: [
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/, 'string'],
      [/\/(?![*+?])(?:[^\r\n[/\\]|\\.|\[(?:[^\r\n\]\\]|\\.)*\])+\/[a-z]*/, 'regexp'],
      [/\+=|\?=|=|\*|\+|\?|\||!|->|\.\./, 'operator'],
      [/[A-Z][\w_]*/, { cases: { '@keywords': 'keyword', '@default': 'type.identifier' } }],
      [/[_a-zA-Z][\w_]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }]
    ],
    comment
  }
};

/** Constraint files: Monaco's built-in JavaScript pulls in the whole TypeScript worker, a tokenizer is enough here. */
export const javascriptMonarch: Monaco.languages.IMonarchLanguage = {
  keywords: [
    'return', 'const', 'let', 'var', 'function', 'if', 'else', 'for', 'of', 'in', 'while', 'new', 'typeof', 'true', 'false',
    'null', 'undefined', 'throw', 'try', 'catch', 'switch', 'case', 'break', 'continue', 'this'
  ],
  tokenizer: {
    root: [
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/, 'string'],
      [/[0-9]+(\.[0-9]+)?/, 'number'],
      [/[_$a-zA-Z][\w$]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }]
    ],
    comment
  }
};
