/**
 * Convert GraphQL introspection JSON to Schema Definition Language (SDL).
 * Lightweight replacement for graphql's buildClientSchema + printSchema.
 * @module shared/introspection-to-sdl
 */

const SPECIFIED_SCALARS = new Set(['String', 'Int', 'Float', 'Boolean', 'ID']);
const SPECIFIED_DIRECTIVES = new Set(['include', 'skip', 'deprecated', 'specifiedBy']);
const DEFAULT_DEPRECATION_REASON = 'No longer supported';

/**
 * @param {string} name
 * @returns {boolean}
 */
function isIntrospectionTypeName(name) {
  return typeof name === 'string' && name.startsWith('__');
}

/**
 * @param {{ name: string }} type
 * @returns {boolean}
 */
function isDefinedType(type) {
  return !SPECIFIED_SCALARS.has(type.name) && !isIntrospectionTypeName(type.name);
}

/**
 * @param {{ kind: string, name?: string, ofType?: object } | null | undefined} type
 * @returns {string}
 */
export function printTypeRef(type) {
  if (!type) return 'Unknown';
  switch (type.kind) {
    case 'NON_NULL':
      return `${printTypeRef(type.ofType)}!`;
    case 'LIST':
      return `[${printTypeRef(type.ofType)}]`;
    default:
      return type.name || 'Unknown';
  }
}

/**
 * @param {string | null | undefined} description
 * @param {string} [indent]
 * @param {boolean} [firstInBlock]
 * @returns {string}
 */
function printDescription(description, indent = '', firstInBlock = true) {
  if (!description || typeof description !== 'string') return '';

  const prefix = indent && !firstInBlock ? `\n${indent}` : indent;
  if (description.includes('\n')) {
    const body = description
      .split('\n')
      .map((line) => indent + line)
      .join('\n');
    return `${prefix}"""\n${body}\n${indent}"""\n`;
  }

  return `${prefix}"""${description}"""\n`;
}

/**
 * @param {string | null | undefined} reason
 * @returns {string}
 */
function printDeprecated(reason) {
  if (reason == null) return '';
  if (reason === DEFAULT_DEPRECATION_REASON) return ' @deprecated';
  const escaped = reason.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return ` @deprecated(reason: "${escaped}")`;
}

/**
 * @param {{ name: string, description?: string | null, type: object, defaultValue?: string | null, isDeprecated?: boolean, deprecationReason?: string | null }} arg
 * @returns {string}
 */
function printInputValue(arg) {
  let decl = `${arg.name}: ${printTypeRef(arg.type)}`;
  if (arg.defaultValue != null && arg.defaultValue !== '') {
    decl += ` = ${arg.defaultValue}`;
  }
  return decl + printDeprecated(arg.deprecationReason);
}

/**
 * @param {object[]} args
 * @param {string} [indentation]
 * @returns {string}
 */
function printArgs(args, indentation = '') {
  if (!args || args.length === 0) return '';

  if (args.every((arg) => !arg.description)) {
    return `(${args.map(printInputValue).join(', ')})`;
  }

  return (
    '(\n' +
    args
      .map(
        (arg, index) =>
          printDescription(arg.description, `  ${indentation}`, index === 0) +
          `  ${indentation}${printInputValue(arg)}`
      )
      .join('\n') +
    `\n${indentation})`
  );
}

/**
 * @param {string[]} items
 * @returns {string}
 */
function printBlock(items) {
  return items.length !== 0 ? ` {\n${items.join('\n')}\n}` : '';
}

/**
 * @param {{ name: string, description?: string | null, args?: object[], type: object, isDeprecated?: boolean, deprecationReason?: string | null }} field
 * @param {number} index
 * @returns {string}
 */
function printField(field, index) {
  return (
    printDescription(field.description, '  ', index === 0) +
    `  ${field.name}` +
    printArgs(field.args || [], '  ') +
    `: ${printTypeRef(field.type)}` +
    printDeprecated(field.deprecationReason)
  );
}

/**
 * @param {{ name: string, description?: string | null, interfaces?: { name: string }[] }} type
 * @returns {string}
 */
function printImplementedInterfaces(type) {
  const interfaces = type.interfaces || [];
  return interfaces.length ? ` implements ${interfaces.map((i) => i.name).join(' & ')}` : '';
}

/**
 * @param {object} type
 * @returns {string}
 */
function printScalar(type) {
  let line = printDescription(type.description) + `scalar ${type.name}`;
  if (type.specifiedByURL) {
    const escaped = type.specifiedByURL.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    line += ` @specifiedBy(url: "${escaped}")`;
  }
  return line;
}

/**
 * @param {object} type
 * @returns {string}
 */
function printObject(type) {
  const fields = (type.fields || []).map(printField);
  return (
    printDescription(type.description) +
    `type ${type.name}` +
    printImplementedInterfaces(type) +
    printBlock(fields)
  );
}

/**
 * @param {object} type
 * @returns {string}
 */
function printInterface(type) {
  const fields = (type.fields || []).map(printField);
  return (
    printDescription(type.description) +
    `interface ${type.name}` +
    printImplementedInterfaces(type) +
    printBlock(fields)
  );
}

/**
 * @param {object} type
 * @returns {string}
 */
function printUnion(type) {
  const members = (type.possibleTypes || []).map((t) => t.name);
  const possibleTypes = members.length ? ` = ${members.join(' | ')}` : '';
  return printDescription(type.description) + `union ${type.name}${possibleTypes}`;
}

/**
 * @param {object} type
 * @returns {string}
 */
function printEnum(type) {
  const values = (type.enumValues || []).map(
    (value, index) =>
      printDescription(value.description, '  ', index === 0) +
      `  ${value.name}` +
      printDeprecated(value.deprecationReason)
  );
  return printDescription(type.description) + `enum ${type.name}` + printBlock(values);
}

/**
 * @param {object} type
 * @returns {string}
 */
function printInputObject(type) {
  const fields = (type.inputFields || []).map(
    (field, index) =>
      printDescription(field.description, '  ', index === 0) + `  ${printInputValue(field)}`
  );
  let header = printDescription(type.description) + `input ${type.name}`;
  if (type.isOneOf) header += ' @oneOf';
  return header + printBlock(fields);
}

/**
 * @param {object} type
 * @returns {string}
 */
function printTypeDefinition(type) {
  switch (type.kind) {
    case 'SCALAR':
      return printScalar(type);
    case 'OBJECT':
      return printObject(type);
    case 'INTERFACE':
      return printInterface(type);
    case 'UNION':
      return printUnion(type);
    case 'ENUM':
      return printEnum(type);
    case 'INPUT_OBJECT':
      return printInputObject(type);
    default:
      return '';
  }
}

/**
 * @param {object} schema
 * @returns {string}
 */
function printSchemaDefinition(schema) {
  const queryName = schema.queryType?.name;
  const mutationName = schema.mutationType?.name;
  const subscriptionName = schema.subscriptionType?.name;

  const commonNames =
    (!queryName || queryName === 'Query') &&
    (!mutationName || mutationName === 'Mutation') &&
    (!subscriptionName || subscriptionName === 'Subscription');

  if (commonNames) return '';

  const operationTypes = [];
  if (queryName) operationTypes.push(`  query: ${queryName}`);
  if (mutationName) operationTypes.push(`  mutation: ${mutationName}`);
  if (subscriptionName) operationTypes.push(`  subscription: ${subscriptionName}`);

  return `schema {\n${operationTypes.join('\n')}\n}`;
}

/**
 * @param {object} directive
 * @returns {string}
 */
function printDirective(directive) {
  let line =
    printDescription(directive.description) +
    `directive @${directive.name}` +
    printArgs(directive.args || []) +
    printDeprecated(directive.deprecationReason);
  if (directive.isRepeatable) line += ' repeatable';
  line += ` on ${(directive.locations || []).join(' | ')}`;
  return line;
}

/**
 * Count user-visible types in an introspection result.
 * @param {{ __schema?: { types?: { name: string }[] } }} introspection
 * @returns {number}
 */
export function countIntrospectionTypes(introspection) {
  const types = introspection?.__schema?.types;
  if (!Array.isArray(types)) return 0;
  return types.filter(isDefinedType).length;
}

/**
 * Convert introspection JSON (`{ __schema: ... }`) to SDL text.
 * @param {{ __schema?: object }} introspection
 * @returns {string}
 */
export function introspectionToSDL(introspection) {
  const schema = introspection?.__schema;
  if (!schema || typeof schema !== 'object') {
    throw new Error('Invalid introspection result: missing __schema');
  }

  const types = Array.isArray(schema.types) ? schema.types : [];
  const directives = Array.isArray(schema.directives) ? schema.directives : [];

  const parts = [
    printSchemaDefinition(schema),
    ...directives
      .filter((directive) => directive?.name && !SPECIFIED_DIRECTIVES.has(directive.name))
      .map(printDirective),
    ...types.filter(isDefinedType).map(printTypeDefinition),
  ].filter(Boolean);

  return parts.join('\n\n');
}
