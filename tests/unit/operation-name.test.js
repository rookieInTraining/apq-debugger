import { extractOperationName } from '../../js/shared/operation-name.js';

describe('extractOperationName', () => {
  test('uses operationName field', () => {
    expect(extractOperationName({ operationName: 'GetCart', query: 'query X { a }' })).toBe(
      'GetCart'
    );
  });
  test('parses a named query', () => {
    expect(
      extractOperationName({ query: 'query GetCart($id: ID!) { cart(id: $id) { id } }' })
    ).toBe('GetCart');
  });
  test('parses mutation and subscription', () => {
    expect(extractOperationName({ query: 'mutation AddItem { add }' })).toBe('AddItem');
    expect(extractOperationName({ query: '  subscription OnPrice { p }' })).toBe('OnPrice');
  });
  test('ignores fragment names and comments', () => {
    expect(
      extractOperationName({ query: '# query Fake\nfragment F on T { a }\nquery Real { ...F }' })
    ).toBe('Real');
  });
  test('anonymous query and shorthand are empty', () => {
    expect(extractOperationName({ query: '{ cart { id } }' })).toBe('');
    expect(extractOperationName({ query: 'query { cart { id } }' })).toBe('');
  });
  test('multi-operation document without operationName is empty', () => {
    expect(extractOperationName({ query: 'query A { a } query B { b }' })).toBe('');
  });
  test('hash-only falls back to registry entry', () => {
    const p = { extensions: { persistedQuery: { sha256Hash: 'abc' } } };
    expect(extractOperationName(p, { operationName: 'GetUser' })).toBe('GetUser');
    expect(extractOperationName(p, null)).toBe('');
  });
  test('non-object payload is empty', () => {
    expect(extractOperationName(null)).toBe('');
  });
  test('strings containing the letter n and an unbalanced brace are stripped', () => {
    expect(extractOperationName({ query: 'query A { f(name: "Jon }}}") { id } }' })).toBe('A');
  });
  test('strings with an escaped quote containing a brace are stripped', () => {
    expect(extractOperationName({ query: 'query A { f(s: "a \\" }}} b") { id } }' })).toBe('A');
  });
  test('ignores keywords inside strings and nested selections', () => {
    expect(
      extractOperationName({ query: 'query Real { f(a: "query Fake { x }") { query } }' })
    ).toBe('Real');
  });
});
