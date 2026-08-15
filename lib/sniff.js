/**
 * Heterogeneous sniffing. The pipeline starts here: detect dsh-plugins,
 * third-party MCP/Skills, and local CLIs, then normalize each into Polaris IR.
 */

import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { parseArgs, walkDirectory } from './common.js'
import { normalizeCandidate } from './ir.js'

const SKILL_FILE_NAMES = new Set(['SKILL.md', 'SKILL.mdc'])
const MCP_FILE_NAMES = new Set(['.mcp.json', 'mcp.json'])
const MAX_SKILL_BYTES = 200_000

function parseFrontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown)
  if (match === null) return {}
  const fields = {}
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key) fields[key] = value
  }
  return fields
}

async function sniffSkill(path, root) {
  const content = await readFile(path, 'utf8')
  if (Buffer.byteLength(content) > MAX_SKILL_BYTES) return []
  const fm = parseFrontmatter(content)
  return [normalizeCandidate({
    name: fm.name ?? relative(root, path).replace(/[\\/]+/g, '-'),
    version: fm.version ?? '0.1.0',
    origin: { type: 'skill' },
    source: path,
    description: fm.description ?? '',
    entry: path,
    capabilities: [fm.name ?? 'skill'],
    permissions: [],
    dependencies: [],
    tests: { smoke: [`skill-name:${fm.name ?? ''}`, 'skill-frontmatter:present'] },
  })]
}

async function sniffMcp(path) {
  let parsed
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return []
  }
  const servers = parsed.mcpServers ?? parsed.servers ?? {}
  const names = Object.keys(servers)
  if (names.length === 0) return []
  return names.map((name) => normalizeCandidate({
    name,
    version: '0.1.0',
    origin: { type: 'mcp' },
    source: path,
    description: `MCP server ${name} declared in ${path}`,
    entry: servers[name].command ?? servers[name].url ?? path,
    capabilities: ['mcp', name],
    permissions: servers[name].env ? Object.keys(servers[name].env) : [],
    dependencies: [],
    tests: { smoke: [`mcp-name:${name}`] },
  }))
}

async function sniffPackage(root, path) {
  let pkg
  try {
    pkg = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return []
  }
  const candidates = []
  if (typeof pkg.dsh?.bundle?.patch === 'string') {
    candidates.push(normalizeCandidate({
      name: pkg.name ?? relative(root, path),
      version: pkg.version ?? '0.1.0',
      origin: { type: 'dsh-plugin' },
      source: path,
      description: pkg.description ?? '',
      entry: `dsh:${pkg.name ?? path}`,
      capabilities: ['dsh-plugin', ...(pkg.keywords ?? [])].slice(0, 8),
      dependencies: Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }),
      tests: { smoke: [`dsh-bundle:${pkg.dsh.bundle.patch}`] },
    }))
  }
  if (pkg.bin && Object.keys(pkg.bin).length > 0) {
    const binName = typeof pkg.bin === 'string' ? pkg.name : Object.keys(pkg.bin)[0]
    candidates.push(normalizeCandidate({
      name: binName ?? pkg.name,
      version: pkg.version ?? '0.1.0',
      origin: { type: 'cli' },
      source: path,
      description: pkg.description ?? '',
      entry: binName,
      capabilities: ['cli', binName],
      dependencies: Object.keys(pkg.dependencies ?? {}),
      tests: { smoke: ['cli-help:--help'] },
    }))
  }
  return candidates
}

export async function sniffLocal(root, { maxFiles = 500 } = {}) {
  const candidates = []
  await walkDirectory(root, async (path, name) => {
    if (SKILL_FILE_NAMES.has(name)) {
      candidates.push(...await sniffSkill(path, root))
    } else if (MCP_FILE_NAMES.has(name)) {
      candidates.push(...await sniffMcp(path))
    } else if (name === 'package.json') {
      candidates.push(...await sniffPackage(root, path))
    }
  }, { maxFiles })
  return candidates
}

export function parseSniffArgs(argv) {
  return parseArgs(argv, {
    defaults: { root: process.cwd(), maxFiles: '500' },
    valueKeys: new Set(['root', 'maxFiles']),
  })
}

export async function runSniff(argv) {
  const options = parseSniffArgs(argv)
  const candidates = await sniffLocal(options.root, { maxFiles: Number(options.maxFiles) })
  if (candidates.length === 0) return 'No heterogeneous capability detected.'
  return candidates.map((candidate, index) => (
    `${index + 1}. ${candidate.name}  origin=${candidate.origin.type}  source=${candidate.source}\n   capabilities=${candidate.capabilities.join(', ')}`
  )).join('\n')
}
