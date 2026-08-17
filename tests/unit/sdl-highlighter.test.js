/**
 * @jest-environment jsdom
 */

import { highlightSDL } from '../../js/ui/sdl-highlighter.js';

describe('highlightSDL', () => {
  test('should highlight keywords, fields, builtins, and custom types', () => {
    const html = highlightSDL('type Query {\n  users: [User!]!\n}');

    expect(html).toContain('<span class="keyword">type</span>');
    expect(html).toContain('<span class="type-name">Query</span>');
    expect(html).toContain('<span class="field">users</span>');
    expect(html).toContain('<span class="type-name">User</span>');
    expect(html).toContain('<span class="punct">!</span>');
  });

  test('should highlight enum values and directives', () => {
    const html = highlightSDL(
      'enum Status {\n  ACTIVE\n  INACTIVE\n}\n\ndirective @deprecated(reason: String = "old") on FIELD_DEFINITION'
    );

    expect(html).toContain('<span class="enum-value">ACTIVE</span>');
    expect(html).toContain('<span class="directive">@deprecated</span>');
    expect(html).toContain('<span class="string">"old"</span>');
    expect(html).toContain('<span class="keyword">on</span>');
  });

  test('should highlight block string descriptions', () => {
    const html = highlightSDL('"""\nAccount info.\n"""\ntype Account {\n  id: ID\n}');

    expect(html).toContain('<span class="string">');
    expect(html).toContain('Account info.');
    expect(html).toContain('<span class="builtin">ID</span>');
  });

  test('should escape HTML in SDL text', () => {
    const html = highlightSDL('type Query {\n  note: String\n  # <script>alert(1)</script>\n}');

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('should not leak placeholders when a comment contains a string', () => {
    const html = highlightSDL('type Query {\n  # legacy "name" field\n  id: ID\n}');

    expect(html).toContain('<span class="comment"># legacy "name" field</span>');
    expect(html).not.toMatch(/[-]/);
  });

  test('should highlight fields with arguments, argument names and defaults', () => {
    const html = highlightSDL(
      'type Query {\n  posts(first: Int = 10, order: Order = DESC, tags: [String] = ["a"]): [Post!]!\n}'
    );

    expect(html).toContain('<span class="field">posts</span>(');
    expect(html).toContain('<span class="field">first</span>: <span class="builtin">Int</span>');
    expect(html).toContain('<span class="number">10</span>');
    expect(html).toContain(
      '<span class="field">order</span>: <span class="type-name">Order</span>'
    );
    expect(html).toContain('<span class="enum-value">DESC</span>');
    expect(html).toContain('<span class="string">"a"</span>');
    expect(html).toContain('<span class="type-name">Post</span>');
  });

  test('should treat all-caps names in type position as types, not enum values', () => {
    const html = highlightSDL('type Link {\n  href: URL\n}');

    expect(html).toContain('<span class="type-name">URL</span>');
  });

  test('should treat directive arguments as values', () => {
    const html = highlightSDL(
      'type User @key(fields: "id") {\n  id: ID! @deprecated(reason: "no")\n}'
    );

    expect(html).toContain(
      '<span class="directive">@key</span>(<span class="field">fields</span>: <span class="string">"id"</span>)'
    );
    expect(html).toContain('<span class="field">reason</span>: <span class="string">"no"</span>');
  });

  test('should highlight interfaces, unions and directive definitions', () => {
    const html = highlightSDL(
      'type User implements Node & Entity {\n  id: ID\n}\nunion Result = User | Post\n' +
        'directive @auth(role: Role = ADMIN) repeatable on FIELD_DEFINITION | OBJECT'
    );

    expect(html).toContain(
      '<span class="type-name">Node</span> <span class="punct">&amp;</span> <span class="type-name">Entity</span>'
    );
    expect(html).toContain(
      '<span class="type-name">User</span> <span class="punct">|</span> <span class="type-name">Post</span>'
    );
    expect(html).toContain('<span class="field">role</span>: <span class="type-name">Role</span>');
    expect(html).toContain('<span class="enum-value">ADMIN</span>');
    expect(html).toContain('<span class="keyword">repeatable</span>');
    expect(html).toContain(
      '<span class="enum-value">FIELD_DEFINITION</span> <span class="punct">|</span> <span class="enum-value">OBJECT</span>'
    );
  });

  test('should highlight a field named like a keyword as a field', () => {
    const html = highlightSDL('type Node {\n  type: String\n  input: String\n}');

    expect(html).toContain('<span class="field">type</span>');
    expect(html).toContain('<span class="field">input</span>');
  });

  test('should highlight schema root operation fields', () => {
    const html = highlightSDL('schema {\n  query: Query\n  mutation: Mutation\n}');

    expect(html).toContain('<span class="keyword">schema</span>');
    expect(html).toContain(
      '<span class="field">query</span>: <span class="type-name">Query</span>'
    );
  });

  test('should preserve the source text exactly', () => {
    const sdl =
      '"""\nDocs & <stuff>\n"""\ninput Filter {\n  ids: [ID!] = []\n  meta: JSON = {a: 1, b: [true, null]}\n}';
    const div = document.createElement('div');
    div.innerHTML = highlightSDL(sdl);

    expect(div.textContent).toBe(sdl);
  });
});
