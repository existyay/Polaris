/**
 * Polaris Intermediate Representation (IR).
 *
 * Every capability — dsh-plugin, MCP server, Skill, CLI, or desktop tool — is
 * normalized into this minimal, stripped-down contract. The IR is the only
 * format the arena, registry, and scheduler consume.
 */

import { createHash } from 'node:crypto'

export const IR_VERSION = '1.0'

export const ORIGIN_TYPES = ['dsh-plugin', 'mcp', 'skill', 'cli', 'desktop']

export function canonicalize(candidate) {
  const keys = [
    'schemaVersion', 'name', 'version', 'origin', 'source', 'description',
    'entry', 'capabilities', 'permissions', 'dependencies', 'tests',
  ]
  const sorted = {}
  for (const key of keys) {
    if (candidate[key] !== undefined) sorted[key] = candidate[key]
  }
  return sorted
}

export function digestCandidate(candidate) {
  return createHash('sha256').update(JSON.stringify(canonicalize(candidate))).digest('hex')
}

export function validateCandidate(candidate) {
  const errors = []
  if (candidate?.schemaVersion !== IR_VERSION) errors.push(`schemaVersion must be ${IR_VERSION}`)
  if (typeof candidate?.name !== 'string' || candidate.name === '') errors.push('name must be a non-empty string')
  if (!ORIGIN_TYPES.includes(candidate?.origin?.type)) errors.push(`origin.type must be one of ${ORIGIN_TYPES.join(', ')}`)
  if (typeof candidate?.source !== 'string' || candidate.source === '') errors.push('source must be a non-empty string')
  if (candidate?.capabilities !== undefined && !Array.isArray(candidate.capabilities)) errors.push('capabilities must be an array')
  if (candidate?.permissions !== undefined && !Array.isArray(candidate.permissions)) errors.push('permissions must be an array')
  if (candidate?.dependencies !== undefined && !Array.isArray(candidate.dependencies)) errors.push('dependencies must be an array')
  return { ok: errors.length === 0, errors }
}

export function normalizeCandidate(raw, defaults = {}) {
  const candidate = {
    schemaVersion: IR_VERSION,
    name: raw.name,
    version: raw.version ?? '0.1.0',
    origin: raw.origin ?? defaults.origin ?? { type: 'cli' },
    source: raw.source ?? defaults.source ?? 'local',
    description: raw.description ?? '',
    entry: raw.entry ?? defaults.entry,
    capabilities: raw.capabilities ?? defaults.capabilities ?? [],
    permissions: raw.permissions ?? [],
    dependencies: raw.dependencies ?? [],
    tests: raw.tests ?? { smoke: [], contract: [], fuzz: [], benchmark: [] },
  }
  return candidate
}

export function summary(candidate) {
  return `${candidate.name}@${candidate.version} [${candidate.origin.type}] ${candidate.description}`.trim()
}
