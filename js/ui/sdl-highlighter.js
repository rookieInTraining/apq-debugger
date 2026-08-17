/**
 * GraphQL SDL syntax highlighting for the schema viewer.
 * A single-pass lexer classifies each token by its grammatical position
 * (definition name, field, argument, type reference, default value, …), so
 * nothing is highlighted twice and comments/strings are never re-scanned.
 * @module ui/sdl-highlighter
 */

import { escapeHtml } from './dom-helpers.js';

const KEYWORDS = new Set([
  'type',
  'input',
  'enum',
  'interface',
  'union',
  'scalar',
  'schema',
  'directive',
  'implements',
  'extend',
  'on',
  'repeatable',
]);

/** Keywords that open a definition and are followed by its name. */
const DEFINITION_KEYWORDS = new Set(['type', 'input', 'enum', 'interface', 'union', 'scalar']);

const BUILTINS = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);

const LITERALS = new Set(['true', 'false', 'null']);

/**
 * Token patterns, tried in order at each position. The sticky flag anchors
 * each match at `lastIndex`.
 * @type {[string, RegExp][]}
 */
const LEXEMES = [
  ['space', /\s+/y],
  ['comment', /#[^\n\r]*/y],
  ['block-string', /"""(?:\\"""|[\s\S])*?"""/y],
  ['string', /"(?:\\.|[^"\\\n\r])*"?/y],
  ['directive', /@[_A-Za-z]\w*/y],
  ['number', /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y],
  ['name', /[_A-Za-z]\w*/y],
  ['punct', /\.\.\.|[!|&=:[\](){},]/y],
  ['other', /[\s\S]/y],
];

/**
 * @typedef {{ kind: string, text: string }} Lexeme
 */

/**
 * @param {string} text
 * @returns {Lexeme[]}
 */
function lex(text) {
  /** @type {Lexeme[]} */
  const out = [];
  let pos = 0;
  while (pos < text.length) {
    for (const [kind, re] of LEXEMES) {
      re.lastIndex = pos;
      const match = re.exec(text);
      if (!match) continue;
      out.push({ kind, text: match[0] });
      pos += match[0].length;
      break;
    }
  }
  return out;
}

/**
 * @param {Lexeme[]} tokens
 * @param {number} index
 * @returns {Lexeme | undefined} The next token that is not whitespace or a comment.
 */
function nextSignificant(tokens, index) {
  for (let i = index + 1; i < tokens.length; i++) {
    if (tokens[i].kind !== 'space' && tokens[i].kind !== 'comment') return tokens[i];
  }
  return undefined;
}

/**
 * @param {string} text
 * @param {string | null} className
 * @returns {string}
 */
function wrap(text, className) {
  const escaped = escapeHtml(text);
  return className ? `<span class="${className}">${escaped}</span>` : escaped;
}

/**
 * Highlight a single SDL definition for display in the schema viewer.
 * @param {string} text
 * @returns {string} HTML string with <span> wrappers.
 */
export function highlightSDL(text) {
  if (!text) return '';

  const tokens = lex(text);
  let html = '';

  /** Keyword of the definition currently being read (top level). */
  let definition = '';
  /** Open `{` blocks; true when the block is a value (object literal), not a body. */
  const braces = [];
  /** Open `(` groups; true when they hold directive arguments. */
  const parens = [];
  /** Nesting of `[` / `{` inside a value, so commas inside lists don't end it. */
  let valueDepth = 0;
  let inValue = false;
  /** Set after `:` in a field or argument; the next name is a type reference. */
  let expectType = false;
  /** Set after a definition keyword, `implements`, `&`, or a union's `=` / `|`. */
  let expectTypeName = false;
  /** After `on` in a directive definition: names are locations. */
  let inLocations = false;
  /** Whether the last `@name` was a directive usage rather than a definition's name. */
  let directiveIsUsage = false;
  /** @type {Lexeme | undefined} */
  let prev;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const { kind } = token;
    let className = null;

    if (kind === 'space') {
      if (inValue && valueDepth === 0 && /\n/.test(token.text)) inValue = false;
      html += wrap(token.text, null);
      continue;
    }
    if (kind === 'comment') {
      html += wrap(token.text, 'comment');
      continue;
    }

    if (kind === 'block-string' || kind === 'string') {
      className = 'string';
    } else if (kind === 'number') {
      className = 'number';
    } else if (kind === 'directive') {
      directiveIsUsage = prev?.text !== 'directive';
      className = 'directive';
    } else if (kind === 'punct') {
      className = handlePunct(token.text);
    } else if (kind === 'name') {
      className = classifyName(token.text, i);
    }

    html += wrap(token.text, className);
    prev = token;
  }

  return html;

  /**
   * Update parser state for a punctuator and pick its class.
   * @param {string} p
   * @returns {string | null}
   */
  function handlePunct(p) {
    switch (p) {
      case '{':
        if (inValue) {
          valueDepth++;
          braces.push(true);
        } else {
          braces.push(false);
        }
        expectTypeName = false;
        return null;
      case '}':
        if (braces.pop() && valueDepth > 0) valueDepth--;
        if (braces.length === 0) definition = '';
        return null;
      case '(':
        parens.push(prev?.kind === 'directive' && directiveIsUsage);
        expectTypeName = false;
        return null;
      case ')':
        parens.pop();
        inValue = false;
        valueDepth = 0;
        expectType = false;
        return null;
      case '[':
        if (inValue) valueDepth++;
        return null;
      case ']':
        if (inValue && valueDepth > 0) valueDepth--;
        return null;
      case ':':
        if (parens.at(-1) || inValue) {
          inValue = true;
        } else {
          expectType = true;
        }
        return null;
      case '=':
        if (definition === 'union' && braces.length === 0 && parens.length === 0) {
          expectTypeName = true;
        } else {
          inValue = true;
          valueDepth = 0;
          expectType = false;
        }
        return 'punct';
      case '&':
        expectTypeName = true;
        return 'punct';
      case '|':
        if (!inLocations) expectTypeName = true;
        return 'punct';
      case ',':
        if (inValue && valueDepth === 0) inValue = false;
        expectType = false;
        return null;
      case '!':
        return 'punct';
      default:
        return null;
    }
  }

  /**
   * Classify a name token by its grammatical position.
   * @param {string} name
   * @param {number} index
   * @returns {string | null}
   */
  function classifyName(name, index) {
    const next = nextSignificant(tokens, index);

    if (inValue) {
      if (LITERALS.has(name)) return 'keyword';
      // Object-literal keys inside a default value.
      if (next?.text === ':') return 'field';
      return 'enum-value';
    }

    if (expectType) {
      expectType = false;
      return BUILTINS.has(name) ? 'builtin' : 'type-name';
    }

    const atTopLevel = braces.length === 0 && parens.length === 0;

    if (parens.length > 0) {
      return next?.text === ':' ? 'field' : null;
    }

    if (braces.length > 0) {
      if (next?.text === ':' || next?.text === '(') return 'field';
      if (definition === 'enum') return 'enum-value';
      return null;
    }

    if (atTopLevel && KEYWORDS.has(name) && !expectTypeName) {
      if (name === 'extend') return 'keyword';
      if (DEFINITION_KEYWORDS.has(name) || name === 'schema' || name === 'directive') {
        definition = name;
        inLocations = false;
        expectTypeName = DEFINITION_KEYWORDS.has(name);
      } else if (name === 'implements') {
        expectTypeName = true;
      } else if (name === 'on' && definition === 'directive') {
        inLocations = true;
      }
      return 'keyword';
    }

    if (inLocations) return 'enum-value';

    if (expectTypeName) {
      expectTypeName = false;
      return BUILTINS.has(name) ? 'builtin' : 'type-name';
    }

    return null;
  }
}
