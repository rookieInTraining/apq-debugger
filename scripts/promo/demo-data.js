/**
 * Synthetic demo traffic and schema for promo screenshots and the demo
 * video. Every host is under example.com; names and hashes are invented.
 */

const API = 'https://api.shop.example.com/graphql';
const TELEMETRY = 'https://telemetry.example.com/v1/graphql?client=web';

const HEADERS = [
  { name: 'content-type', value: 'application/json' },
  { name: 'apollographql-client-name', value: 'shopfront-web' },
];

const QUERIES = {
  GetViewer: 'query GetViewer { viewer { id name email avatarUrl } }',
  ProductListing:
    'query ProductListing($first: Int!, $after: String, $filter: ProductFilter) { products(first: $first, after: $after, filter: $filter) { edges { node { id title handle priceRange { min { amount currencyCode } } featuredImage { url altText } } } pageInfo { hasNextPage endCursor } } }',
  CartSummary:
    'query CartSummary { cart { id totalQuantity cost { total { amount currencyCode } } } }',
  AddToCart:
    'mutation AddToCart($input: CartLineInput!) { cartLinesAdd(input: $input) { cart { id totalQuantity } userErrors { field message } } }',
  ProductRecommendations:
    'query ProductRecommendations($productId: ID!, $limit: Int = 4) { recommendations(productId: $productId, limit: $limit) { id title priceRange { min { amount } } } }',
};

const HASHES = {
  GetViewer: 'ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38',
  ProductListing: '7a1f0c2e9b8d4e6f3a5c1b2d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f',
  CartSummary: '3c9e1f7a2b4d6e8f0a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d5f',
  ProductRecommendations: 'b52f0e7c1a9d3e6f8b2c4d6e8f0a2c4e6b8d0f2a4c6e8b0d2f4a6c8e0b2d4f6a',
  Telemetry: '0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c',
};

const VARIABLES = {
  ProductListing: { first: 24, after: null, filter: { category: 'outerwear', inStock: true } },
  AddToCart: { input: { merchandiseId: 'gid://shop/ProductVariant/4471', quantity: 1 } },
  ProductRecommendations: { productId: 'gid://shop/Product/1182', limit: 4 },
};

/** Hash-only request (as sent), then Apollo's full-query retry. */
function apqExchange(name, url = API) {
  const variables = VARIABLES[name] || null;
  return [
    { operationName: name, url, isAPQ: true, hash: HASHES[name], variables, headers: HEADERS },
    {
      operationName: name,
      url,
      isAPQ: false,
      hash: HASHES[name],
      query: QUERIES[name],
      variables,
      headers: HEADERS,
    },
  ];
}

const fullQuery = (name) => ({
  operationName: name,
  url: API,
  isAPQ: false,
  query: QUERIES[name],
  variables: VARIABLES[name] || null,
  headers: HEADERS,
});

/** A hash nobody retries (e.g. a telemetry server without APQ fallback). */
const unresolvedTelemetry = {
  operationName: 'Anonymous Query',
  url: TELEMETRY,
  isAPQ: true,
  hash: HASHES.Telemetry,
  headers: HEADERS,
};

const SCHEMA_SDL = `
"""Root query"""
type Query {
  viewer: User
  products(first: Int!, after: String, filter: ProductFilter): ProductConnection!
  product(id: ID!): Product
  recommendations(productId: ID!, limit: Int = 4): [Product!]!
  cart: Cart
}

type Mutation {
  cartLinesAdd(input: CartLineInput!): CartLinesAddPayload!
}

type User {
  id: ID!
  name: String!
  email: String!
  avatarUrl: String
}

"""A product in the catalogue."""
type Product {
  id: ID!
  title: String!
  handle: String!
  description: String
  priceRange: PriceRange!
  featuredImage: Image
  category: Category!
  inStock: Boolean!
}

type ProductConnection {
  edges: [ProductEdge!]!
  pageInfo: PageInfo!
}

type ProductEdge {
  cursor: String!
  node: Product!
}

type PageInfo {
  hasNextPage: Boolean!
  endCursor: String
}

type PriceRange {
  min: Money!
  max: Money!
}

type Money {
  amount: Float!
  currencyCode: CurrencyCode!
}

type Image {
  url: String!
  altText: String
}

type Cart {
  id: ID!
  totalQuantity: Int!
  cost: CartCost!
}

type CartCost {
  total: Money!
}

type CartLinesAddPayload {
  cart: Cart
  userErrors: [UserError!]!
}

type UserError {
  field: [String!]
  message: String!
}

input ProductFilter {
  category: Category
  inStock: Boolean
}

input CartLineInput {
  merchandiseId: ID!
  quantity: Int = 1
}

enum Category {
  OUTERWEAR
  SHOES
  ACCESSORIES
}

enum CurrencyCode {
  USD
  EUR
  GBP
}
`;

const SCALARS = ['String', 'Int', 'Float', 'Boolean', 'ID'];

/**
 * Parse a type reference such as `[Product!]!` into introspection form.
 * @param {string} ref
 * @param {Map<string, string>} kinds - type name → introspection kind
 */
function typeRef(ref, kinds) {
  ref = ref.trim();
  if (ref.endsWith('!'))
    return { kind: 'NON_NULL', name: null, ofType: typeRef(ref.slice(0, -1), kinds) };
  if (ref.startsWith('['))
    return { kind: 'LIST', name: null, ofType: typeRef(ref.slice(1, -1), kinds) };
  return { kind: kinds.get(ref) || 'SCALAR', name: ref, ofType: null };
}

/** Split `a: Int!, b: String = "x"` into argument definitions. */
function parseArgs(text, kinds) {
  if (!text) return [];
  return text.split(',').map((part) => {
    const [decl, defaultValue] = part.split('=').map((x) => x.trim());
    const [name, ref] = decl.split(':').map((x) => x.trim());
    return {
      name,
      description: null,
      type: typeRef(ref, kinds),
      defaultValue: defaultValue || null,
    };
  });
}

/**
 * Introspection result for the demo schema (what the worker would fetch).
 * A small parser for the controlled SDL above — not a general GraphQL parser.
 */
function buildIntrospection() {
  const blocks = [
    ...SCHEMA_SDL.matchAll(/(?:"""([^]*?)"""\s*)?(type|input|enum) (\w+) \{([^}]*)\}/g),
  ];
  const kindOf = { type: 'OBJECT', input: 'INPUT_OBJECT', enum: 'ENUM' };
  const kinds = new Map(blocks.map((b) => [b[3], kindOf[b[2]]]));

  const types = blocks.map(([, description, keyword, name, body]) => {
    const lines = body
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const type = {
      kind: kindOf[keyword],
      name,
      description: description ? description.trim() : null,
    };
    if (keyword === 'enum') {
      type.enumValues = lines.map((value) => ({
        name: value,
        description: null,
        isDeprecated: false,
      }));
      return type;
    }
    const fields = lines.map((line) => {
      const m = line.match(/^(\w+)(?:\(([^)]*)\))?:\s*(.+)$/);
      return { name: m[1], args: parseArgs(m[2], kinds), type: m[3] };
    });
    if (keyword === 'input') {
      type.inputFields = fields.map((fld) => {
        const [ref, defaultValue] = fld.type.split('=').map((x) => x.trim());
        return {
          name: fld.name,
          description: null,
          type: typeRef(ref, kinds),
          defaultValue: defaultValue || null,
        };
      });
    } else {
      type.fields = fields.map((fld) => ({
        name: fld.name,
        description: null,
        args: fld.args,
        type: typeRef(fld.type, kinds),
        isDeprecated: false,
        deprecationReason: null,
      }));
      type.interfaces = [];
    }
    return type;
  });

  for (const scalar of SCALARS) types.push({ kind: 'SCALAR', name: scalar, description: null });

  return {
    __schema: {
      queryType: { name: 'Query' },
      mutationType: { name: 'Mutation' },
      subscriptionType: null,
      types,
      directives: [],
    },
  };
}

module.exports = {
  API,
  apqExchange,
  fullQuery,
  unresolvedTelemetry,
  buildIntrospection,
};
