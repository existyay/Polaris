/**
 * 北极星 (Polaris) core: real-time GitHub dsh-plugin discovery, minimalist
 * scoring, and low-cost one-shot installation into a DSH profile.
 *
 * The module is dependency-free on purpose: the package must install from git
 * without a build step and without pnpm build allowance. It uses only Node's
 * built-in modules and global fetch (Node >= 22.19).
 */

import { spawnSync } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import {
  access, mkdir, readFile, readdir, stat, writeFile,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

export const POLARIS_VERSION = '0.1.0'
export const TOPIC = 'dsh-plugin'
export const DEFAULT_PROFILE = 'web'
export const DEFAULT_MAX_INSTALL = 10
export const DEFAULT_MAX_SEARCH_PAGES = 2
export const PACKAGE_CHECK_LIMIT = 96
export const SCORE_THRESHOLD = 6.0

// ---------------------------------------------------------------------------
// Keyword groups. ASCII phrases are matched with word boundaries; CJK terms
// are matched as substrings after whitespace normalization.
// ---------------------------------------------------------------------------

const SCIENCE_ENGINEERING_TERMS = [
  'scientific', 'science', 'sciences', 'mathematics', 'mathematical', 'math',
  'physics', 'physical', 'chemistry', 'chemical', 'biology', 'biological',
  'engineering', 'engineer', 'research', 'academic', 'theorem', 'proving',
  'symbolic', 'numerical', 'simulation', 'solver', 'econometrics',
  'statistics', 'statistical', 'empirical', 'formal-methods',
  'formal-verification', 'computer-algebra', 'proof-assistant',
  'semantic-scholar', 'literature-review', 'ai-scientist',
  'scientific-discovery', 'stata', 'sympy', 'matlab', 'octave', 'lean4',
  'smt-solver', 'z3', 'finite-element', 'pde', 'ode', 'linear-algebra',
  'calculus', 'mechanics', 'electrical', 'signal-processing',
  'control-theory', 'data-analysis', 'experiment', 'laboratory',
  '数学', '物理', '化学', '生物', '工程', '科学', '研究', '论文', '文献',
  '实验', '定理', '证明', '统计', '计量', '数值', '仿真', '优化', '力学',
  '电学', '信号', '控制',
]

const CODE_OPTIMIZATION_TERMS = [
  'code-review', 'refactoring', 'refactor', 'lint', 'linter', 'performance',
  'optimization', 'optimize', 'profiling', 'profiler', 'static-analysis',
  'code-quality', 'code-smells', 'tech-debt', 'test-quality', 'debugging',
  'debug', 'benchmark', 'benchmarking', 'clean-code', 'architecture',
  'code-health', 'auto-fix', 'autofix', 'runtime-analysis',
  'code-intelligence', 'code-navigation', 'code-search',
  'codebase-indexing', 'token-efficient', 'token-counting',
  'context-window', 'gpu-profiling', 'performance-analysis',
  'performance-engineering', 'performance-regression',
  '优化', '重构', '审查', '性能', '静态分析', '代码质量', '测试', '调试',
  '基准', '代码',
]

const MINIMALISM_TERMS = [
  'zero-dependency', 'zero dependencies', 'dependency-free', 'no-deps',
  'dependencies-free', 'single-file', 'stdlib', 'standard-library',
  'no-build', 'buildless', 'tiny', 'lightweight', 'minimal', 'minimalist',
  'minimalistic', 'self-contained', 'pure-markdown', 'pure-python',
  'pure-js', 'pure-javascript', 'no-framework', 'framework-free', 'lean',
  'bare', 'micro', 'plain', 'zero-dep', 'zero deps',
  '极简', '零依赖', '单文件', '无构建', '轻量', '精简', '纯', '最小',
  '简洁', '无依赖', '一行',
]

const HEAVY_TERMS = [
  'react', 'vue', 'svelte', 'nextjs', 'flutter', 'electron', 'tauri',
  'docker', 'postgres', 'mysql', 'redis', 'kubernetes', 'web-ui',
  'desktop-app', 'desktop', 'theme', 'skin', 'wallpaper', 'game', 'pet',
  'bilibili', 'xiaohongshu', 'douyin', 'wechat', 'tui', 'companion',
  'design', 'figma', 'animation', 'mascot', 'office', 'ppt', 'pdf',
  'video', 'image', 'vision', 'ocr', 'multimodal', 'slack', 'export',
  'browser', 'supabase', 'vercel', 'neon', 'tailwind',
]

const DSH_AFFINITY_TERMS = ['deepseek-harness', 'dsh', 'cordis']

// ---------------------------------------------------------------------------
// Text and scoring utilities
// ---------------------------------------------------------------------------

const CJK_RE = /[\u3400-\u9fff]/

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ')
    .trim()
}

function matchTerms(text, terms) {
  const haystack = normalize(text)
  if (haystack === '') return []
  const hits = []
  for (const term of terms) {
    if (CJK_RE.test(term)) {
      if (haystack.includes(term)) hits.push(term)
    } else {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`)
      if (re.test(haystack)) hits.push(term)
    }
  }
  return hits
}

function repositoryText(repo) {
  return [
    repo.full_name,
    repo.description,
    repo.language,
    ...(repo.topics ?? []),
  ].join(' ')
}

/**
 * Preliminary score from GitHub search metadata only (no package.json fetch).
 * The score is intentionally strict: generic "codex/code" noise is excluded,
 * and heavy UI/framework topics pay a penalty.
 */
export function scoreRepository(repo) {
  const text = repositoryText(repo)
  const sci = matchTerms(text, SCIENCE_ENGINEERING_TERMS)
  const code = matchTerms(text, CODE_OPTIMIZATION_TERMS)
  const mini = matchTerms(text, MINIMALISM_TERMS)
  const heavy = matchTerms(text, HEAVY_TERMS)
  const dsh = matchTerms(text, DSH_AFFINITY_TERMS)

  let score = 0
  const reasons = []
  const evidence = {}

  if (sci.length > 0) {
    score += 3 + Math.min(3, sci.length) * 1.5
    reasons.push(`理工科:${sci.slice(0, 6).join(',')}`)
    evidence.science = sci.slice(0, 8)
  }
  if (code.length > 0) {
    score += 3 + Math.min(3, code.length) * 1.5
    reasons.push(`代码优化:${code.slice(0, 6).join(',')}`)
    evidence.code = code.slice(0, 8)
  }
  if (mini.length > 0) {
    score += 2 + Math.min(3, mini.length) * 1.2
    reasons.push(`极简:${mini.slice(0, 6).join(',')}`)
    evidence.minimal = mini.slice(0, 8)
  }
  score += Math.min(2, dsh.length) * 0.8
  score += Math.min(2, (repo.stargazers_count ?? 0) / 500)
  if (repo.archived) {
    score -= 2
    reasons.push('已归档')
  }
  score -= Math.min(3, heavy.length * 0.5)
  if (heavy.length > 0) evidence.heavy = heavy.slice(0, 8)

  const size = repo.size ?? 0
  if (size < 500) {
    score += 2
    reasons.push('小体积')
  } else if (size < 5000) {
    score += 1
  } else if (size > 100000) {
    score -= 3
    reasons.push('大体积')
  } else if (size > 20000) {
    score -= 1
  }

  if (repo.full_name === 'deepseek-ai/deepseek-harness') {
    score = -100
    reasons.push('官方 harness 本体，非插件')
  }

  return { score, reasons, evidence }
}

// ---------------------------------------------------------------------------
// Minimal GitHub API helpers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'dsh-polaris',
        'Accept': 'application/vnd.github+json',
        ...(options.headers ?? {}),
      },
    })
    return response
  } finally {
    clearTimeout(timer)
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Search GitHub repositories for a topic. Handles unauthenticated search rate
 * limits (10/min) by waiting briefly when GitHub asks us to.
 */
export async function githubTopicSearch(topic, {
  token,
  sort = 'stars',
  order = 'desc',
  page = 1,
  perPage = 100,
} = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  const url = new URL('https://api.github.com/search/repositories')
  url.searchParams.set('q', `topic:${topic}`)
  url.searchParams.set('sort', sort)
  url.searchParams.set('order', order)
  url.searchParams.set('per_page', String(perPage))
  url.searchParams.set('page', String(page))

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchWithTimeout(url, { headers })
    if (response.ok) return response.json()
    if (response.status === 403 || response.status === 429) {
      const remaining = response.headers.get('x-ratelimit-remaining')
      const reset = Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000
      const wait = reset > Date.now() ? Math.min(reset - Date.now(), 15000) : 2000 * (attempt + 1)
      if (remaining !== null && Number(remaining) > 0) throw new Error(`GitHub search rejected (HTTP ${response.status})`)
      await delay(wait)
      continue
    }
    if (response.status === 422) {
      // Usually means the query is malformed or only one page is available.
      return { items: [] }
    }
    throw new Error(`GitHub search HTTP ${response.status}: ${await response.text()}`)
  }
  return { items: [] }
}

/**
 * Collect unique repositories from `topic:dsh-plugin`, merging the two most
 * useful orderings (stars for quality, updated for freshness).
 */
export async function collectCandidates({
  token,
  maxPages = DEFAULT_MAX_SEARCH_PAGES,
  logger = () => {},
} = {}) {
  const byName = new Map()
  for (const sort of ['stars', 'updated']) {
    for (let page = 1; page <= maxPages; page += 1) {
      const data = await githubTopicSearch(TOPIC, { token, sort, page })
      const items = data.items ?? []
      for (const item of items) byName.set(item.full_name, item)
      logger(`GitHub topic:${TOPIC} sort=${sort} page=${page} -> ${items.length} repos`)
      if (items.length === 0) break
    }
  }
  return [...byName.values()]
}

// ---------------------------------------------------------------------------
// Package manifest check (raw.githubusercontent.com, no API rate limit)
// ---------------------------------------------------------------------------

function rawPackageUrl(repo) {
  const branch = encodeURIComponent(repo.default_branch ?? 'main')
  return `https://raw.githubusercontent.com/${repo.full_name}/${branch}/package.json`
}

async function fetchPackageManifest(repo, timeoutMs = 12000) {
  try {
    const response = await fetchWithTimeout(rawPackageUrl(repo), {}, timeoutMs)
    if (!response.ok) return { repo, manifest: undefined, error: `HTTP ${response.status}` }
    const text = await response.text()
    return { repo, manifest: JSON.parse(text), error: undefined }
  } catch (error) {
    return { repo, manifest: undefined, error: error?.name === 'AbortError' ? 'timeout' : (error?.message ?? 'fetch-failed') }
  }
}

function manifestCost(manifest) {
  const scripts = manifest.scripts ?? {}
  const deps = Object.keys(manifest.dependencies ?? {}).length
  const optionalDeps = Object.keys(manifest.optionalDependencies ?? {}).length
  const totalDeps = deps + optionalDeps
  const hasPrepare = typeof scripts.prepare === 'string'
  let costScore = 0
  const notes = []

  if (totalDeps === 0) {
    costScore += 1.5
    notes.push('零依赖')
  } else if (totalDeps <= 2) {
    costScore += 1
    notes.push(`仅 ${totalDeps} 个依赖`)
  } else if (totalDeps <= 5) {
    costScore += 0
  } else if (totalDeps <= 10) {
    costScore -= 1
    notes.push(`${totalDeps} 个依赖`)
  } else {
    costScore -= 2
    notes.push(`${totalDeps} 个依赖，较重`)
  }

  if (hasPrepare) {
    costScore -= 0.5
    notes.push('git 安装需 prepare 构建授权')
  } else {
    costScore += 0.5
    notes.push('无需构建授权')
  }

  return { costScore, notes, totalDeps, hasPrepare }
}

/**
 * Fetch package.json for the best preliminary candidates, keep only those
 * matching the current DSH bundle standard (`dsh.bundle.patch`).
 */
export async function evaluateCandidates(candidates, {
  packageCheckLimit = PACKAGE_CHECK_LIMIT,
  scope = 'all',
  logger = () => {},
} = {}) {
  const prelim = candidates
    .map(repo => ({ repo, ...scoreRepository(repo) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, packageCheckLimit)

  logger(`Fetching package.json for top ${prelim.length} candidates`)
  const checks = []
  // Small concurrency: raw.githubusercontent has no hard rate limit, but we
  // stay polite and keep "lowest cost" from turning into a request storm.
  let cursor = 0
  const workers = Array.from({ length: 8 }, async () => {
    while (cursor < prelim.length) {
      const index = cursor
      cursor += 1
      checks[index] = await fetchPackageManifest(prelim[index].repo)
    }
  })
  await Promise.all(workers)

  const results = []
  for (let i = 0; i < prelim.length; i += 1) {
    const entry = prelim[i]
    const check = checks[i]
    const { repo } = entry
    if (check?.manifest === undefined) {
      logger(`skip ${repo.full_name}: no package.json (${check?.error ?? 'unknown'})`)
      continue
    }
    const manifest = check.manifest
    const patch = manifest?.dsh?.bundle?.patch
    if (typeof patch !== 'string') {
      logger(`skip ${repo.full_name}: no dsh.bundle.patch (legacy or library)`)
      continue
    }
    const cost = manifestCost(manifest)
    let score = entry.score + cost.costScore
    if (scope === 'science') {
      if (entry.evidence.science === undefined) score -= 4
    } else if (scope === 'code') {
      if (entry.evidence.code === undefined) score -= 4
    }
    results.push({
      repo,
      manifest,
      score,
      prelimScore: entry.score,
      reasons: [...entry.reasons, ...cost.notes],
      evidence: entry.evidence,
      cost,
      spec: `github:${repo.full_name}#${repo.default_branch ?? 'main'}`,
    })
  }

  results.sort((a, b) => b.score - a.score)
  return results
}

/**
 * Full real-time discovery + current-standard evaluation, shared by the CLI
 * and the DSH slash command.
 */
export async function searchBest({
  token,
  maxPages = DEFAULT_MAX_SEARCH_PAGES,
  scope = 'all',
  packageCheckLimit = PACKAGE_CHECK_LIMIT,
  logger = () => {},
} = {}) {
  const candidates = await collectCandidates({ token, maxPages, logger })
  const ranked = await evaluateCandidates(candidates, { packageCheckLimit, scope, logger })
  return ranked
}

// ---------------------------------------------------------------------------
// Profile initialization and low-cost installation
// ---------------------------------------------------------------------------

export function resolveDshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

export function resolveProfileDir(profile, home = resolveDshHome()) {
  if (profile === '' || profile === '.' || profile === '..'
    || profile.includes('/') || profile.includes('\\')
    || profile === 'node_modules') {
    throw new Error(`invalid profile name ${JSON.stringify(profile)}`)
  }
  return join(home, 'profiles', profile)
}

const PROFILE_TEMPLATES = {
  web: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
  headless: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
}

const PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`

const PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Initialize a profile directory exactly like `dsh plugin` would, so pnpm can
 * run inside it and so allowBuilds can be written before the first install.
 */
export async function ensureProfile(profile, home = resolveDshHome()) {
  const dir = resolveProfileDir(profile, home)
  await mkdir(dir, { recursive: true })
  const manifestPath = join(dir, 'package.json')
  if (!(await exists(manifestPath))) {
    const bundles = PROFILE_TEMPLATES[profile] ?? ['@deepseek-ai/dsh-base']
    await writeFile(manifestPath, JSON.stringify({
      name: `dsh-profile-${basename(dir)}`,
      private: true,
      dependencies: {},
      dsh: { profile: { bundles } },
    }, null, 2) + '\n')
  }
  const patchPath = join(dir, 'cordis.patch.yml')
  if (!(await exists(patchPath))) await writeFile(patchPath, PATCH_TEMPLATE)
  const workspacePath = join(dir, 'pnpm-workspace.yaml')
  if (!(await exists(workspacePath))) await writeFile(workspacePath, PNPM_WORKSPACE)
  return dir
}

function yamlKeyLine(text, key) {
  const re = new RegExp(`^${key}:\\s*(?:#.*)?$`, 'm')
  const match = re.exec(text)
  return match === null ? -1 : match.index
}

function yamlHasEntry(text, key, entry) {
  const keyIndex = yamlKeyLine(text, key)
  if (keyIndex < 0) return false
  const rest = text.slice(keyIndex)
  const nextTop = rest.search(/^[^\s#]/m)
  const block = nextTop > 0 ? rest.slice(0, nextTop) : rest
  const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^\\s+${escaped}:`, 'm').test(block)
}

/**
 * Append an `allowBuilds` entry to the profile's pnpm-workspace.yaml. This is
 * the pnpm >= 10 gate for git-hosted packages that run a prepare script.
 */
export async function allowBuild(profileDir, packageName) {
  const path = join(profileDir, 'pnpm-workspace.yaml')
  let text = await readFile(path, 'utf8')
  if (yamlHasEntry(text, 'allowBuilds', packageName)) return false
  const allowIndex = yamlKeyLine(text, 'allowBuilds')
  if (allowIndex < 0) {
    text += `${text.endsWith('\n') ? '' : '\n'}allowBuilds:\n  ${packageName}: true\n`
  } else {
    const insertAt = allowIndex + 'allowBuilds:'.length
    text = `${text.slice(0, insertAt)}\n  ${packageName}: true${text.slice(insertAt)}`
  }
  await writeFile(path, text)
  return true
}

function findCommand(command) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {
    stdio: 'pipe',
    shell: process.platform === 'win32',
  })
  return result.status === 0
}

/**
 * Install selected candidates into a profile with a single `dsh plugin add`
 * invocation (preferred, because it also reconciles `dsh.profile.bundles`) or
 * with a direct `pnpm add` fallback.
 */
export async function installCandidates(ranked, {
  profile = DEFAULT_PROFILE,
  max = DEFAULT_MAX_INSTALL,
  scope = 'all',
  dryRun = false,
  yes = true,
  logger = () => {},
} = {}) {
  const selected = ranked
    .filter(entry => entry.score >= SCORE_THRESHOLD)
    .slice(0, max)

  if (selected.length === 0) {
    logger('No candidates passed the current dsh bundle + minimalist + science/code filter.')
    return { installed: [], dryRun }
  }

  logger(`Selected ${selected.length} plugins for profile ${profile}`)
  for (const entry of selected) {
    logger(`  - ${entry.repo.full_name}  score=${entry.score.toFixed(2)}  ${entry.spec}`)
    logger(`      ${entry.reasons.join(' | ')}`)
  }

  if (dryRun) return { installed: [], dryRun: true, selected }

  const profileDir = await ensureProfile(profile)
  for (const entry of selected) {
    if (entry.cost?.hasPrepare) {
      const changed = await allowBuild(profileDir, entry.manifest.name ?? entry.repo.name)
      if (changed) logger(`allowBuilds: ${entry.manifest.name ?? entry.repo.name}`)
    }
  }

  const specs = selected.map(entry => entry.spec)
  const useDsh = process.env.DSH_BIN
    ? true
    : findCommand('dsh')

  if (useDsh) {
    const bin = process.env.DSH_BIN ?? 'dsh'
    logger(`Running: ${bin} plugin --profile ${profile} add ${specs.join(' ')}`)
    const result = spawnSync(bin, ['plugin', '--profile', profile, 'add', ...specs], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    if (result.status !== 0) {
      throw new Error(`dsh plugin add failed with exit code ${result.status}`)
    }
    return { installed: selected.map(entry => entry.manifest.name ?? entry.repo.name), dryRun: false }
  }

  // Fallback: direct pnpm + our own dsh.profile.bundles reconciliation.
  logger(`dsh not found; running pnpm add in ${profileDir}`)
  const pnpm = spawnSync('pnpm', ['add', ...specs], {
    cwd: profileDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (pnpm.status !== 0) {
    throw new Error(`pnpm add failed with exit code ${pnpm.status}`)
  }
  await reconcileProfileBundles(profileDir)
  return { installed: selected.map(entry => entry.manifest.name ?? entry.repo.name), dryRun: false }
}

/**
 * Append every installed dependency that exports `dsh.bundle.patch` to the
 * profile's ordered `dsh.profile.bundles` list (used by the direct-pnpm
 * fallback; `dsh plugin` already does this itself).
 */
export async function reconcileProfileBundles(profileDir) {
  const manifestPath = join(profileDir, 'package.json')
  const profile = JSON.parse(await readFile(manifestPath, 'utf8'))
  const bundles = profile.dsh?.profile?.bundles ?? []
  const dependencies = Object.keys(profile.dependencies ?? {})
  let changed = false
  for (const packageName of dependencies) {
    const packageManifestPath = join(profileDir, 'node_modules', packageName, 'package.json')
    try {
      const packageManifest = JSON.parse(await readFile(packageManifestPath, 'utf8'))
      if (typeof packageManifest.dsh?.bundle?.patch === 'string' && !bundles.includes(packageName)) {
        bundles.push(packageName)
        changed = true
      }
    } catch {
      // A transitive or unresolved dependency is not a profile bundle.
    }
  }
  if (changed) {
    profile.dsh = { ...profile.dsh, profile: { ...profile.dsh?.profile, bundles } }
    await writeFile(manifestPath, JSON.stringify(profile, null, 2) + '\n')
  }
  return changed
}

// ---------------------------------------------------------------------------
// Lightweight local skill/MCP review (the "later" phase, seeded now)
// ---------------------------------------------------------------------------

const SKILL_FILE_NAMES = new Set(['SKILL.md', 'SKILL.mdc'])
const MCP_FILE_NAMES = new Set(['.mcp.json', 'mcp.json'])

async function walkDirectory(root, onFile, onError = () => {}) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    onError(error)
    return
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      await walkDirectory(path, onFile, onError)
    } else if (entry.isFile()) {
      await onFile(path, entry.name)
    }
  }
}

function parseSimpleFrontmatter(markdown) {
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

function reviewSkillMarkdown(content) {
  const frontmatter = parseSimpleFrontmatter(content)
  const text = normalize([frontmatter.name, frontmatter.description, frontmatter.whenToUse, content].join(' '))
  const sci = matchTerms(text, SCIENCE_ENGINEERING_TERMS)
  const code = matchTerms(text, CODE_OPTIMIZATION_TERMS)
  const mini = matchTerms(text, MINIMALISM_TERMS)
  const heavy = matchTerms(text, HEAVY_TERMS)
  const score = (sci.length > 0 ? 2 : 0) + (code.length > 0 ? 2 : 0)
    + (mini.length > 0 ? 1.5 : 0) - (heavy.length > 0 ? 1 : 0)
    + (content.length < 12000 ? 0.5 : -0.5)
  return { kind: 'skill', name: frontmatter.name ?? 'unnamed', score, sci, code, mini, heavy, content }
}

function reviewMcpJson(content) {
  try {
    const mcp = JSON.parse(content)
    const servers = mcp.mcpServers ?? mcp.servers ?? {}
    const names = Object.keys(servers)
    const text = normalize(content)
    const mini = matchTerms(text, MINIMALISM_TERMS)
    const heavy = matchTerms(text, HEAVY_TERMS)
    const score = names.length === 1 ? 1 : names.length <= 3 ? 0.5 : -0.5
      + (mini.length > 0 ? 1.5 : 0) - (heavy.length > 0 ? 0.5 : 0)
    return { kind: 'mcp', name: names.join(',') || 'unnamed', score, names, mini, heavy, content }
  } catch {
    return { kind: 'mcp', name: 'invalid', score: -2, names: [], mini: [], heavy: [], content }
  }
}

/**
 * Recursively review local AI-tool skills (SKILL.md) and MCP configs. Items
 * above threshold are candidates for later automatic conversion into Polaris
 * plugin/skill content. `--write` emits them under ./polaris-converted.
 */
export async function reviewLocal({ root = process.cwd(), write = false, logger = () => {} } = {}) {
  const hits = []
  await walkDirectory(resolve(root), async (path, name) => {
    if (SKILL_FILE_NAMES.has(name)) {
      const content = await readFile(path, 'utf8')
      const review = reviewSkillMarkdown(content)
      review.path = path
      if (review.score >= 1.5) hits.push(review)
    } else if (MCP_FILE_NAMES.has(name)) {
      const content = await readFile(path, 'utf8')
      const review = reviewMcpJson(content)
      review.path = path
      if (review.score >= 0) hits.push(review)
    }
  }, error => logger(`skip ${error.message}`))
  hits.sort((a, b) => b.score - a.score)

  if (write && hits.length > 0) {
    const outRoot = resolve(process.cwd(), 'polaris-converted', 'skills')
    await mkdir(outRoot, { recursive: true })
    for (const hit of hits) {
      if (hit.kind !== 'skill') continue
      const name = hit.name.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed'
      const body = `---\nname: ${name}\ndescription: Converted from ${hit.path}\n---\n\n${hit.content}`
      await writeFile(join(outRoot, `${name}.md`), body)
    }
    logger(`Wrote skill conversions under ${outRoot}`)
  }
  return hits
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatRanked(ranked, { top = 20 } = {}) {
  const lines = []
  const shown = ranked.slice(0, top)
  if (shown.length === 0) return 'No dsh-plugin repository passed the current bundle + specialization filter.'
  lines.push(`北极星 scan: ${shown.length} qualifying dsh-plugin bundle(s)`)
  lines.push('')
  for (let i = 0; i < shown.length; i += 1) {
    const entry = shown[i]
    lines.push(`${i + 1}. ${entry.repo.full_name}  score=${entry.score.toFixed(2)}`)
    lines.push(`   ${entry.repo.description ?? '(no description)'}`)
    lines.push(`   spec: ${entry.spec}`)
    lines.push(`   reasons: ${entry.reasons.join(' | ')}`)
  }
  return lines.join('\n')
}

export function parseOptions(argv) {
  const options = {
    command: 'search',
    profile: process.env.DSH_PROFILE ?? DEFAULT_PROFILE,
    scope: 'all',
    max: DEFAULT_MAX_INSTALL,
    top: 20,
    dryRun: false,
    yes: false,
    write: false,
    root: process.cwd(),
    token: process.env.GITHUB_TOKEN,
  }
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--profile' || arg === '-p') options.profile = argv[++i]
    else if (arg.startsWith('--profile=')) options.profile = arg.slice('--profile='.length)
    else if (arg === '--scope') options.scope = argv[++i]
    else if (arg.startsWith('--scope=')) options.scope = arg.slice('--scope='.length)
    else if (arg === '--max' || arg === '-n') options.max = Number(argv[++i])
    else if (arg.startsWith('--max=')) options.max = Number(arg.slice('--max='.length))
    else if (arg === '--top') options.top = Number(argv[++i])
    else if (arg.startsWith('--top=')) options.top = Number(arg.slice('--top='.length))
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--yes' || arg === '-y') options.yes = true
    else if (arg === '--write') options.write = true
    else if (arg === '--root') options.root = argv[++i]
    else if (arg.startsWith('--root=')) options.root = arg.slice('--root='.length)
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else positional.push(arg)
  }
  if (positional.length > 0) options.command = positional[0]
  if (positional.length > 1) options.arg = positional[1]
  if (options.command === 'install') options.yes = true
  return options
}
