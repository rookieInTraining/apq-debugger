/**
 * GraphQL SDL syntax highlighting for the schema viewer.
 * A single-pass lexer classifies each token by its grammatical position
 * (definition name, field, argument, type reference, default value, …), so
 * nothing is highlighted twice and comments/strings are never re-scanned.
 * @module ui/sdl-highlighter
 */

import { escapeHtml } from './dom-helpers.js';

/** @param {string} list Space-separated words. */
const words = (list) => new Set(list.split(' '));

const KEYWORDS = words(
  'type input enum interface union scalar schema directive implements extend on repeatable'
);

/** Keywords that open a definition and are followed by its name. */
const DEFINITION_KEYWORDS = words('type input enum interface union scalar');

const BUILTINS = words('String Int Float Boolean ID');

const LITERALS = words('true false null');

/** One capture group per token kind, in KINDS order; the group that matched names the kind. */
const TOKEN =
  /(\s+)|(#.*)|("""(?:\\"""|[\s\S])*?"""|"(?:\\.|[^"\\\n\r])*"?)|(@\w+)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([_A-Za-z]\w*)|([!|&=:[\](){},])|([\s\S])/g;
const KINDS = 'space comment string directive number name punct other'.split(' ');

/** Kinds whose class is the kind itself, whatever the grammatical position. */
const FIXED_KINDS = words('comment string directive number');

/**
 * @typedef {{ kind: string, text: string }} Lexeme
 */

/**
 * @param {string} text
 * @returns {Lexeme[]}
 */
function lex(text) {
  return Array.from(text.matchAll(TOKEN), (match) => ({
    kind: KINDS[match.findIndex((group, i) => i > 0 && group !== undefined) - 1],
    text: match[0],
  }));
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
    let className = FIXED_KINDS.has(kind) ? kind : null;

    if (kind === 'space') {
      if (inValue && valueDepth === 0 && token.text.includes('\n')) inValue = false;
    } else if (kind === 'directive') {
      directiveIsUsage = prev?.text !== 'directive';
    } else if (kind === 'punct') {
      className = handlePunct(token.text);
    } else if (kind === 'name') {
      className = classifyName(token.text, i);
    }

    html += wrap(token.text, className);
    if (kind !== 'space' && kind !== 'comment') prev = token;
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

    if (parens.length > 0) {
      return next?.text === ':' ? 'field' : null;
    }

    if (braces.length > 0) {
      if (next?.text === ':' || next?.text === '(') return 'field';
      if (definition === 'enum') return 'enum-value';
      return null;
    }

    // Top level from here on.
    if (KEYWORDS.has(name) && !expectTypeName) {
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
