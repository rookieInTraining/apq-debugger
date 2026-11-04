/**
 * GraphQL operation name extraction. Dependency-free: shared by the service
 * worker and the panel, so it must not import the `graphql` package.
 */

const STRINGS_AND_COMMENTS = /"""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|#[^\n]*/g;
const TOKEN = /[{}()]|\b(query|mutation|subscription|fragment)\b(?:\s+([_A-Za-z][_0-9A-Za-z]*))?/g;

/**
 * Finds the operation name in a query document, if it contains exactly one
 * operation definition and that operation is named.
 * @param {string} query GraphQL document text
 * @returns {string} The name, or '' when anonymous, ambiguous or unparseable
 */
function parseOperationName(query) {
  const text = query.replace(STRINGS_AND_COMMENTS, ' ');
  let depth = 0;
  let expectBody = false;
  let operations = 0;
  let name = '';

  TOKEN.lastIndex = 0;
  let match;
  while ((match = TOKEN.exec(text)) !== null) {
    const token = match[0];
    if (token === '{' || token === '(') {
      if (depth === 0 && token === '{') {
        if (expectBody) expectBody = false;
        else operations++; // anonymous shorthand query
      }
      depth++;
    } else if (token === '}' || token === ')') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      expectBody = true;
      if (match[1] !== 'fragment') {
        operations++;
        name = match[2] || '';
      }
    }
  }
  return operations === 1 ? name : '';
}

/**
 * Extracts the operation name of a GraphQL request payload.
 * Order: explicit `operationName`, then the single named operation in
 * `query`, then the hash registry entry (for hash-only APQ requests).
 * @param {object} payload Parsed GraphQL request body (one operation)
 * @param {{operationName?: string}|null} [registryEntry] Registry entry for the request's hash
 * @returns {string} Operation name, or '' for anonymous/unknown
 */
export function extractOperationName(payload, registryEntry = null) {
  if (payload && typeof payload === 'object') {
    if (typeof payload.operationName === 'string' && payload.operationName) {
      return payload.operationName;
    }
    if (typeof payload.query === 'string') {
      const parsed = parseOperationName(payload.query);
      if (parsed) return parsed;
    }
  }
  return registryEntry?.operationName || '';
}
