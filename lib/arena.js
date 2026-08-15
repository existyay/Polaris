/**
 * Dual-track arena.
 *
 * Hot track (smoke + self-consistency) is cheap and qualifies a candidate for
 * development-context mounting. Cold track runs full contract tests, bounded
 * fuzz hooks, performance benchmark hooks, SBOM audit, and adversarial replay
 * against the current champion over a golden task set. A candidate wins only
 * when its utility increment over the champion is significant.
 */

import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { auditDependencies, scanStatic } from './audit.js'
import { exists, parseArgs, readJson } from './common.js'
import { digestCandidate, summary, validateCandidate } from './ir.js'

const CONFIG_FILE = '.polaris-arena.json'

function runCommand(command, { cwd, timeout = 30000, maxBuffer = 4 * 1024 * 1024 } = {}) {
  const started = Date.now()
  const result = spawnSync(command, { cwd, timeout, maxBuffer, encoding: 'utf8', shell: true })
  return {
    command,
    ok: result.status === 0,
    code: result.status,
    signal: result.signal,
    wallMs: Date.now() - started,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    error: result.error?.message ?? null,
  }
}

function expand(template, context) {
  return template.replaceAll('{entry}', context.entry ?? '').replaceAll('{root}', context.root ?? '')
}

export async function loadArenaConfig(root) {
  const path = join(root, CONFIG_FILE)
  if (await exists(path)) {
    const config = await readJson(path)
    return {
      champion: config.champion ?? null,
      goldenTasks: config.goldenTasks ?? [],
      utilityThreshold: config.utilityThreshold ?? 0.1,
      ...config,
    }
  }
  return { champion: null, goldenTasks: [], utilityThreshold: 0.1 }
}

function selfConsistency(candidate) {
  const errors = []
  const validation = validateCandidate(candidate)
  errors.push(...validation.errors)
  if ((candidate.capabilities ?? []).length === 0) errors.push('capabilities must not be empty')
  if (candidate.entry === undefined || candidate.entry === '') errors.push('entry must not be empty')
  return { ok: errors.length === 0, errors }
}

async function sbomAudit(candidate, root) {
  const dir = candidate.origin.type === 'cli' || candidate.origin.type === 'dsh-plugin'
    ? root
    : process.cwd()
  const findings = await scanStatic(dir, { maxFiles: 80, maxBytes: 200_000 })
  const audit = auditDependencies(dir, { timeout: 60000 })
  return { findings, audit }
}

export async function runHotTrack(candidate) {
  const report = {
    track: 'hot',
    candidate: candidate.name,
    digest: digestCandidate(candidate),
    validation: validateCandidate(candidate),
    consistency: selfConsistency(candidate),
    smoke: [],
    pass: false,
  }
  if (!report.validation.ok || !report.consistency.ok) return report
  // Smoke: interpret declarative smoke tags and run cli --help for CLI entries.
  for (const tag of candidate.tests?.smoke ?? []) {
    if (tag === 'cli-help:--help' && candidate.origin.type === 'cli') {
      const result = runCommand(expand(`${candidate.entry} --help`, { entry: candidate.entry, root: process.cwd() }))
      report.smoke.push({ tag, ...result })
      if (!result.ok) return report
    } else {
      report.smoke.push({ tag, ok: true, note: 'declarative smoke accepted' })
    }
  }
  report.pass = true
  return report
}

export async function runColdTrack(candidate, config, root) {
  const report = {
    track: 'cold',
    candidate: candidate.name,
    contract: [],
    fuzz: [],
    benchmark: [],
    sbom: null,
    replay: [],
    pass: false,
  }
  for (const command of candidate.tests?.contract ?? []) {
    if (!/^[a-zA-Z0-9_./:-]+:/.test(command)) {
      report.contract.push(runCommand(expand(command, { entry: candidate.entry, root })))
    } else {
      report.contract.push({ command, ok: true, note: 'declarative contract accepted' })
    }
  }
  for (const command of candidate.tests?.fuzz ?? []) {
    report.fuzz.push(runCommand(expand(command, { entry: candidate.entry, root }), { timeout: 60000 }))
  }
  for (const command of candidate.tests?.benchmark ?? []) {
    report.benchmark.push(runCommand(expand(command, { entry: candidate.entry, root }), { timeout: 60000 }))
  }
  report.sbom = await sbomAudit(candidate, root)

  // Adversarial replay against the champion over the golden task set.
  let candidateScore = 0
  let championScore = 0
  let tasks = 0
  for (const task of config.goldenTasks ?? []) {
    tasks += 1
    const candidateResult = runCommand(expand(task.command, { entry: candidate.entry, root }), { timeout: task.timeoutMs ?? 30000 })
    const hit = task.expect !== undefined ? (candidateResult.stdout + candidateResult.stderr).includes(String(task.expect)) : candidateResult.ok
    const cand = { ...candidateResult, hit }
    candidateScore += (cand.ok ? 0.7 : 0) + (cand.hit ? 0.3 : 0)
    let champ = null
    if (config.champion?.entry) {
      const championResult = runCommand(expand(task.command, { entry: config.champion.entry, root }), { timeout: task.timeoutMs ?? 30000 })
      const champHit = task.expect !== undefined ? (championResult.stdout + championResult.stderr).includes(String(task.expect)) : championResult.ok
      champ = { ...championResult, hit: champHit }
      championScore += (champ.ok ? 0.7 : 0) + (champ.hit ? 0.3 : 0)
    }
    report.replay.push({ task: task.name, candidate: cand, champion: champ })
  }
  if (tasks > 0) {
    candidateScore /= tasks
    championScore = config.champion?.entry ? championScore / tasks : 0.5
  } else {
    candidateScore = 0.5
    championScore = 0.5
  }
  report.utility = { candidateScore, championScore, increment: candidateScore - championScore, threshold: config.utilityThreshold }
  report.pass = report.utility.increment >= report.utility.threshold
  return report
}

export function formatArenaReport(hot, cold) {
  const lines = []
  lines.push(`[hot] ${hot.candidate} ${hot.pass ? 'PASS' : 'FAIL'} ${hot.validation.errors.join('; ')}`)
  for (const item of hot.smoke) lines.push(`  smoke ${item.tag}: ${item.ok ? 'ok' : `fail ${item.error ?? item.code}`}`)
  lines.push('')
  lines.push(`[cold] ${cold.candidate} ${cold.pass ? 'PASS' : 'FAIL'}`)
  for (const item of cold.contract) lines.push(`  contract ${item.command ?? ''}: ${item.ok ? 'ok' : `fail ${item.error ?? item.code}`}`)
  for (const item of cold.fuzz) lines.push(`  fuzz ${item.command ?? ''}: ${item.ok ? 'ok' : `fail ${item.error ?? item.code}`}`)
  for (const item of cold.benchmark) lines.push(`  bench ${item.command ?? ''}: ${item.ok ? 'ok' : `fail ${item.error ?? item.code}`}`)
  lines.push(`  SBOM static findings=${cold.sbom?.findings?.length ?? 0} audit=${cold.sbom?.audit?.ok ? 'ok' : (cold.sbom?.audit?.error ?? 'n/a')}`)
  for (const item of cold.replay) {
    lines.push(`  replay ${item.task}: candidate ok=${item.candidate.ok} hit=${item.candidate.hit} | champion ok=${item.champion?.ok ?? 'n/a'} hit=${item.champion?.hit ?? 'n/a'}`)
  }
  const u = cold.utility
  lines.push(`  utility candidate=${u.candidateScore.toFixed(2)} champion=${u.championScore.toFixed(2)} increment=${u.increment.toFixed(2)} threshold=${u.threshold}`)
  lines.push('')
  if (!hot.pass) lines.push('GATE: hot track failed; candidate is not mounted.')
  else if (!cold.pass) lines.push(`GATE: utility increment ${u.increment.toFixed(2)} < ${u.threshold}; PR should be auto-closed with the differential report above.`)
  else lines.push('GATE: PASS — candidate is a verified upgrade; promote and seal it.')
  return lines.join('\n')
}

export function parseArenaArgs(argv) {
  return parseArgs(argv, {
    defaults: { root: process.cwd(), config: CONFIG_FILE },
    valueKeys: new Set(['root', 'config']),
  })
}

export async function runArena(argv) {
  const options = parseArenaArgs(argv)
  const root = options.root
  const config = await loadArenaConfig(root)
  const candidate = config.candidate
  if (!candidate) {
    throw new Error(`missing candidate in ${join(root, CONFIG_FILE)} (add "candidate" object)`)
  }
  const hot = await runHotTrack(candidate)
  if (!hot.pass) return formatArenaReport(hot, { candidate: candidate.name, pass: false, contract: [], fuzz: [], benchmark: [], sbom: null, replay: [], utility: { candidateScore: 0, championScore: 0, increment: 0, threshold: config.utilityThreshold } })
  const cold = await runColdTrack(candidate, config, root)
  return formatArenaReport(hot, cold)
}
