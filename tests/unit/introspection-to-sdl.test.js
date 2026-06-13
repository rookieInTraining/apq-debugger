import {
  introspectionToSDL,
  countIntrospectionTypes,
  printTypeRef,
} from '../../js/shared/introspection-to-sdl.js';

const MINIMAL_INTROSPECTION = {
  __schema: {
    queryType: { name: 'Query' },
    mutationType: null,
    subscriptionType: null,
    types: [
      {
        kind: 'OBJECT',
        name: 'Query',
        fields: [
          {
            name: 'users',
            args: [],
            type: {
              kind: 'LIST',
              ofType: { kind: 'NON_NULL', ofType: { kind: 'OBJECT', name: 'User' } },
            },
          },
        ],
      },
      {
        kind: 'OBJECT',
        name: 'User',
        fields: [
          {
            name: 'id',
            args: [],
            type: { kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'ID' } },
          },
          {
            name: 'name',
            args: [],
            type: { kind: 'SCALAR', name: 'String' },
          },
        ],
      },
      { kind: 'SCALAR', name: 'String' },
      { kind: 'SCALAR', name: 'Int' },
      { kind: 'SCALAR', name: 'Float' },
      { kind: 'SCALAR', name: 'Boolean' },
      { kind: 'SCALAR', name: 'ID' },
      { kind: 'OBJECT', name: '__Schema', fields: [] },
    ],
    directives: [
      {
        name: 'include',
        locations: ['FIELD', 'FRAGMENT_SPREAD', 'INLINE_FRAGMENT'],
        args: [{ name: 'if', type: { kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'Boolean' } } }],
      },
      {
        name: 'cacheControl',
        locations: ['FIELD_DEFINITION', 'OBJECT', 'INTERFACE'],
        args: [{ name: 'maxAge', type: { kind: 'SCALAR', name: 'Int' } }],
      },
    ],
  },
};

describe('introspection-to-sdl', () => {
  test('printTypeRef should render nested types', () => {
    expect(printTypeRef({ kind: 'SCALAR', name: 'String' })).toBe('String');
    expect(printTypeRef({ kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'ID' } })).toBe('ID!');
    expect(
      printTypeRef({
        kind: 'LIST',
        ofType: { kind: 'NON_NULL', ofType: { kind: 'OBJECT', name: 'User' } },
      })
    ).toBe('[User!]');
  });

  test('countIntrospectionTypes should exclude built-ins and introspection types', () => {
    expect(countIntrospectionTypes(MINIMAL_INTROSPECTION)).toBe(2);
  });

  test('introspectionToSDL should print object types and omit built-in scalars', () => {
    const sdl = introspectionToSDL(MINIMAL_INTROSPECTION);

    expect(sdl).toContain('type Query {');
    expect(sdl).toContain('users: [User!]');
    expect(sdl).toContain('type User {');
    expect(sdl).toContain('id: ID!');
    expect(sdl).toContain('name: String');
    expect(sdl).not.toContain('scalar String');
    expect(sdl).not.toContain('type __Schema');
    expect(sdl).not.toContain('directive @include');
    expect(sdl).toContain('directive @cacheControl');
  });

  test('introspectionToSDL should print unions, enums, interfaces, and inputs', () => {
    const introspection = {
      __schema: {
        queryType: { name: 'Query' },
        types: [
          {
            kind: 'OBJECT',
            name: 'Query',
            fields: [{ name: 'node', args: [], type: { kind: 'INTERFACE', name: 'Node' } }],
          },
          {
            kind: 'INTERFACE',
            name: 'Node',
            interfaces: [],
            fields: [{ name: 'id', args: [], type: { kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'ID' } } }],
          },
          {
            kind: 'OBJECT',
            name: 'User',
            interfaces: [{ name: 'Node' }],
            fields: [{ name: 'id', args: [], type: { kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'ID' } } }],
          },
          {
            kind: 'UNION',
            name: 'SearchResult',
            possibleTypes: [{ name: 'User' }],
          },
          {
            kind: 'ENUM',
            name: 'Role',
            enumValues: [{ name: 'ADMIN' }, { name: 'USER', deprecationReason: 'No longer supported' }],
          },
          {
            kind: 'INPUT_OBJECT',
            name: 'UserInput',
            inputFields: [
              { name: 'name', type: { kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'String' } } },
            ],
          },
          { kind: 'SCALAR', name: 'String' },
          { kind: 'SCALAR', name: 'ID' },
        ],
        directives: [],
      },
    };

    const sdl = introspectionToSDL(introspection);

    expect(sdl).toContain('interface Node {');
    expect(sdl).toContain('type User implements Node {');
    expect(sdl).toContain('union SearchResult = User');
    expect(sdl).toContain('enum Role {');
    expect(sdl).toContain('USER @deprecated');
    expect(sdl).toContain('input UserInput {');
    expect(sdl).toContain('name: String!');
  });

  test('introspectionToSDL should preserve block descriptions', () => {
    const introspection = {
      __schema: {
        queryType: { name: 'Query' },
        types: [
          {
            kind: 'OBJECT',
            name: 'Account',
            description: 'An organization in Apollo Studio.\n\nCan have multiple members.',
            fields: [
              {
                name: 'canChangePlan',
                description: 'Used by Studio to show the Change Plan button',
                args: [],
                type: { kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'Boolean' } },
              },
            ],
          },
          {
            kind: 'OBJECT',
            name: 'Query',
            fields: [{ name: 'account', args: [], type: { kind: 'OBJECT', name: 'Account' } }],
          },
          { kind: 'SCALAR', name: 'Boolean' },
        ],
        directives: [],
      },
    };

    const sdl = introspectionToSDL(introspection);

    expect(sdl).toContain('Can have multiple members.');
    expect(sdl).toContain('Used by Studio to show the Change Plan button');
    expect(sdl).toContain('canChangePlan: Boolean!');
  });

  test('introspectionToSDL should emit schema block for non-standard root type names', () => {
    const introspection = {
      __schema: {
        queryType: { name: 'RootQuery' },
        mutationType: { name: 'RootMutation' },
        types: [
          {
            kind: 'OBJECT',
            name: 'RootQuery',
            fields: [{ name: 'ping', args: [], type: { kind: 'SCALAR', name: 'String' } }],
          },
          { kind: 'OBJECT', name: 'RootMutation', fields: [] },
          { kind: 'SCALAR', name: 'String' },
        ],
        directives: [],
      },
    };

    const sdl = introspectionToSDL(introspection);

    expect(sdl).toContain('schema {');
    expect(sdl).toContain('query: RootQuery');
    expect(sdl).toContain('mutation: RootMutation');
  });

  test('introspectionToSDL should throw on invalid input', () => {
    expect(() => introspectionToSDL(null)).toThrow('missing __schema');
    expect(() => introspectionToSDL({})).toThrow('missing __schema');
  });
});
