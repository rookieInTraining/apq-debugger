/**
 * Regex-based GraphQL SDL syntax highlighting for the schema viewer.
 * Uses placeholder tokens so nested replacements stay well-formed.
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

const BUILTINS = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);

/**
 * @param {string} text
 * @param {string} className
 * @param {{ key: string, html: string }[]} tokens
 * @param {{ value: number }} id
 * @returns {string}
 */
function tokenize(text, className, tokens, id) {
  const key = `\uE000${id.value++}\uE001`;
  tokens.push({ key, html: `<span class="${className}">${text}</span>` });
  return key;
}

/**
 * Highlight a single SDL definition for display in the schema viewer.
 * @param {string} text
 * @returns {string}
 */
export function highlightSDL(text) {
  if (!text) return '';

  /** @type {{ key: string, html: string }[]} */
  const tokens = [];
  const id = { value: 0 };

  /** @param {string} match @param {string} className */
  const stash = (match, className) => tokenize(match, className, tokens, id);

  let s = escapeHtml(text);

  s = s.replace(/"""[\s\S]*?"""/g, (match) => stash(match, 'string'));
  s = s.replace(/"(?:\\.|[^"\\])*"/g, (match) => stash(match, 'string'));
  s = s.replace(/^([ \t]*#.*)$/gm, (match) => stash(match, 'comment'));
  s = s.replace(/@[A-Za-z_]\w*/g, (match) => stash(match, 'directive'));

  s = s.replace(/^(\s+)([_A-Za-z]\w*)(\s*:)/gm, (line, indent, name, colon) => {
    if (KEYWORDS.has(name)) return line;
    return `${indent}${tokenize(name, 'field', tokens, id)}${colon}`;
  });

  s = s.replace(/^(\s+)([A-Z][A-Z0-9_]*)(\s*,?\s*)$/gm, (line, indent, name, tail) => {
    return `${indent}${tokenize(name, 'enum-value', tokens, id)}${tail}`;
  });

  s = s.replace(/\b(String|Int|Float|Boolean|ID)\b/g, (match) => stash(match, 'builtin'));

  s = s.replace(
    /\b(type|input|enum|interface|union|scalar|schema|directive|implements|extend|on|repeatable)\b/g,
    (match) => stash(match, 'keyword')
  );

  s = s.replace(/\b([A-Z][a-z][A-Za-z0-9_]*)\b/g, (match) => stash(match, 'type-name'));

  s = s.replace(/\b([A-Z][A-Z0-9_]+)\b/g, (match) => {
    if (BUILTINS.has(match)) return match;
    return stash(match, 'enum-value');
  });

  s = s.replace(/!/g, () => tokenize('!', 'punct', tokens, id));
  s = s.replace(/(\s)\|(\s)/g, (_, before, after) => {
    return `${before}${tokenize('|', 'punct', tokens, id)}${after}`;
  });

  for (const { key, html } of tokens) {
    s = s.split(key).join(html);
  }

  return s;
}
