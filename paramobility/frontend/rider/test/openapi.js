// Checks requests the app sends against the backend's OpenAPI spec
// (test/openapi.json, saved from the running backend with `npm run test:spec`).
//
// Request bodies are checked strictly: a key the backend's schema doesn't know
// is an error, because Pydantic drops unknown keys silently, so a typo'd field
// would never reach the backend and nothing would complain.

import spec from './openapi.json'

const schemas = spec.components.schemas

function resolve(schema) {
  while (schema?.$ref) schema = schemas[schema.$ref.split('/').pop()]
  return schema
}

// The spec's route for a concrete path, e.g. /trips/t1/book -> /trips/{trip_id}/book.
export function findRoute(method, pathname) {
  for (const [template, ops] of Object.entries(spec.paths)) {
    const re = new RegExp('^' + template.replace(/\{[^}]+\}/g, '[^/]+') + '$')
    if (re.test(pathname)) return ops[method.toLowerCase()] ? { template, op: ops[method.toLowerCase()] } : null
  }
  return null
}

// Returns a list of problems ("" means fine); `strict` rejects unknown object keys.
export function validate(schema, value, { strict = false, at = '$' } = {}) {
  schema = resolve(schema)
  if (!schema || Object.keys(schema).length === 0) return []
  if (schema.anyOf) {
    const results = schema.anyOf.map((s) => validate(s, value, { strict, at }))
    return results.some((r) => r.length === 0) ? [] : results[0]
  }
  if (schema.enum && !schema.enum.includes(value)) return [`${at}: ${JSON.stringify(value)} not in ${schema.enum}`]
  const type = schema.type
  if (type === 'null') return value === null ? [] : [`${at}: expected null`]
  if (value === undefined || value === null) return type ? [`${at}: expected ${type}, got ${value}`] : []
  if (type === 'string') {
    if (typeof value !== 'string') return [`${at}: expected string`]
    if (schema.minLength && value.length < schema.minLength) return [`${at}: shorter than ${schema.minLength}`]
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) return [`${at}: not a date-time`]
    return []
  }
  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number') return [`${at}: expected ${type}`]
    if (type === 'integer' && !Number.isInteger(value)) return [`${at}: expected integer`]
    if (schema.minimum != null && value < schema.minimum) return [`${at}: below ${schema.minimum}`]
    if (schema.maximum != null && value > schema.maximum) return [`${at}: above ${schema.maximum}`]
    return []
  }
  if (type === 'boolean') return typeof value === 'boolean' ? [] : [`${at}: expected boolean`]
  if (type === 'array') {
    if (!Array.isArray(value)) return [`${at}: expected array`]
    return value.flatMap((v, i) => validate(schema.items, v, { strict, at: `${at}[${i}]` }))
  }
  if (type === 'object' || schema.properties) {
    if (typeof value !== 'object' || Array.isArray(value)) return [`${at}: expected object`]
    const props = schema.properties || {}
    const problems = (schema.required || [])
      .filter((k) => value[k] === undefined)
      .map((k) => `${at}.${k}: required`)
    for (const [k, v] of Object.entries(value)) {
      if (props[k]) problems.push(...validate(props[k], v, { strict, at: `${at}.${k}` }))
      else if (strict && !schema.additionalProperties) problems.push(`${at}.${k}: unknown field`)
    }
    return problems
  }
  return []
}

export function requestSchema(op) {
  return op.requestBody?.content?.['application/json']?.schema
}

export function responseSchema(op) {
  return op.responses?.['200']?.content?.['application/json']?.schema
}
