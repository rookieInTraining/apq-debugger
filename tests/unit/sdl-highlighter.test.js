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
});
