/**
 * Immutable content-addressed registry + GitOps promotion.
 *
 * Every promoted candidate is stored once at entries/<sha256>.json; the
 * `index.json` pointer is updated by a git commit, so the index is auditable
 * and each entry is append-only immutable.
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from './common.js'
import { digestCandidate, validateCandidate } from './ir.js'

export function defaultIndexRoot() {
  return process.env.POLARIS_INDEX ?? join(process.cwd(), '.polaris-index')
}

function readJsonFile(path, fallback) {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

export function promoteCandidate(candidate, { indexRoot = defaultIndexRoot(), gitOps = true } = {}) {
  const validation = validateCandidate(candidate)
  if (!validation.ok) {
    throw new Error(`candidate validation failed: ${validation.errors.join('; ')}`)
  }
  const digest = digestCandidate(candidate)
  mkdirSync(join(indexRoot, 'entries'), { recursive: true })
  const entryPath = join(indexRoot, 'entries', `${digest}.json`)
  if (!existsSync(entryPath)) {
    writeFileSync(entryPath, JSON.stringify(candidate, null, 2) + '\n')
  }
  const indexPath = join(indexRoot, 'index.json')
  const index = readJsonFile(indexPath, { schemaVersion: '1.0', entries: {}, byCapability: {} })
  index.entries[candidate.name] = digest
  for (const capability of candidate.capabilities ?? []) {
    index.byCapability[capability] ??= []
    if (!index.byCapability[capability].includes(candidate.name)) index.byCapability[capability].push(candidate.name)
  }
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n')

  let git = null
  if (gitOps && existsSync(join(indexRoot, '.git'))) {
    const commit = spawnSync('git', ['-C', indexRoot, 'add', 'entries', 'index.json'], { encoding: 'utf8' })
    const status = spawnSync('git', ['-C', indexRoot, 'status', '--porcelain'], { encoding: 'utf8' })
    if (status.status === 0 && status.stdout.trim() !== '') {
      const result = spawnSync('git', ['-C', indexRoot, 'commit', '-m', `polaris: promote ${candidate.name} (${digest.slice(0, 12)})`], { encoding: 'utf8' })
      git = { committed: result.status === 0, stdout: result.stdout, stderr: result.stderr }
    } else {
      git = { committed: true, unchanged: true }
    }
    if (commit.status !== 0) git = { committed: false, stdout: commit.stdout, stderr: commit.stderr }
  }
  return { promoted: true, digest, entryPath, indexPath, index, git }
}

export function parsePromoteArgs(argv) {
  return parseArgs(argv, {
    defaults: { indexRoot: defaultIndexRoot(), gitOps: true },
    valueKeys: new Set(['indexRoot', 'name', 'version', 'origin', 'source', 'entry', 'capabilities']),
    boolKeys: new Set(['gitOps']),
  })
}

export function promoteFromArgs(argv) {
  const options = parsePromoteArgs(argv)
  const candidate = {
    schemaVersion: '1.0',
    name: options.name ?? 'unnamed',
    version: options.version ?? '0.1.0',
    origin: { type: options.origin ?? 'cli' },
    source: options.source ?? 'local',
    description: options.description ?? '',
    entry: options.entry ?? options.name,
    capabilities: String(options.capabilities ?? '').split(',').filter(Boolean),
    permissions: [],
    dependencies: [],
    tests: {},
  }
  const result = promoteCandidate(candidate, { indexRoot: options.indexRoot, gitOps: options.gitOps })
  return JSON.stringify(result, null, 2)
}
