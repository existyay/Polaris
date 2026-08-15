/**
 * polaris-verify: schema-based deterministic functional test + coverage gate.
 *
 * Configuration is a tiny JSON schema file: .polaris-verify.json
 * {
 *   "testCommand": "node --test",
 *   "coverageCommand": "node --test --experimental-test-coverage",
 *   "coverageThreshold": 80,
 *   "timeoutMs": 300000
 * }
 * When the file is absent, package.json scripts.test is used as the test
 * command; coverage is skipped unless a coverage command is provided.
 */

import { exists, parseArgs, readJson, runSync } from './common.js'

const CONFIG_FILE = '.polaris-verify.json'

function validateConfig(config) {
  const errors = []
  if (config.testCommand !== undefined && typeof config.testCommand !== 'string') errors.push('testCommand must be a string')
  if (config.coverageCommand !== undefined && typeof config.coverageCommand !== 'string') errors.push('coverageCommand must be a string')
  if (config.coverageThreshold !== undefined && (typeof config.coverageThreshold !== 'number' || config.coverageThreshold < 0 || config.coverageThreshold > 100)) errors.push('coverageThreshold must be 0..100')
  if (config.timeoutMs !== undefined && (typeof config.timeoutMs !== 'number' || config.timeoutMs < 1000)) errors.push('timeoutMs must be >= 1000')
  return errors
}

function extractCoverage(output) {
  // nyc/istanbul: "All files | 85.71 | ..." ; v8: "All files | 85.71 |"
  const matches = []
  for (const re of [
    /All files\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s*\|/g,
    /All files[^\n]*?([0-9]+(?:\.[0-9]+)?)\s*\|/g,
    /Coverage summary[^\n]*?([0-9]+(?:\.[0-9]+)?)%/gi,
  ]) {
    let match
    while ((match = re.exec(output)) !== null) matches.push(Number(match[1]))
  }
  if (matches.length === 0) return undefined
  return Math.min(...matches)
}

export async function resolveVerifyConfig(root) {
  const path = `${root}/${CONFIG_FILE}`
  if (await exists(path)) {
    const config = await readJson(path)
    const errors = validateConfig(config)
    if (errors.length > 0) throw new Error(`invalid ${CONFIG_FILE}: ${errors.join('; ')}`)
    return config
  }
  let testCommand
  try {
    const pkg = await readJson(`${root}/package.json`)
    if (typeof pkg.scripts?.test === 'string') testCommand = `npm test --prefix ${JSON.stringify(root)}`
  } catch {
    // no package.json; fall through to node --test
  }
  return { testCommand: testCommand ?? 'node --test', timeoutMs: 300000 }
}

export function runVerify(argv) {
  const options = parseArgs(argv, {
    defaults: { root: process.cwd(), timeout: '300000', threshold: '' },
    valueKeys: new Set(['root', 'timeout', 'threshold']),
  })
  return resolveVerifyConfig(options.root).then((config) => {
    const timeout = Number(options.timeout) || config.timeoutMs || 300000
    const testCommand = options.cmd ?? config.testCommand
    const testResult = runSync(testCommand, [], { cwd: options.root, timeout, maxBuffer: 8 * 1024 * 1024, shell: true })
    const lines = [`$ ${testCommand}`]
    if (testResult.stdout) lines.push(testResult.stdout)
    if (testResult.stderr) lines.push(testResult.stderr)
    if (testResult.error) lines.push(`[error] ${testResult.error.message}`)
    if (testResult.status !== 0) {
      lines.push(`[FAIL] tests exited with ${testResult.status}`)
      return { ok: false, text: lines.join('\n') }
    }
    lines.push('[PASS] tests passed')

    const coverageCommand = options.coverageCmd ?? config.coverageCommand
    if (coverageCommand) {
      const coverageResult = runSync(coverageCommand, [], { cwd: options.root, timeout, maxBuffer: 8 * 1024 * 1024, shell: true })
      const coverage = extractCoverage(coverageResult.stdout || '')
      lines.push(`$ ${coverageCommand}`)
      if (coverageResult.stdout) lines.push(coverageResult.stdout)
      if (coverageResult.stderr) lines.push(coverageResult.stderr)
      const threshold = Number(options.threshold) || config.coverageThreshold
      if (threshold !== undefined && coverage !== undefined) {
        lines.push(coverage >= threshold ? '[PASS] coverage gate' : `[FAIL] coverage ${coverage}% < threshold ${threshold}%`)
        if (coverage < threshold) return { ok: false, text: lines.join('\n') }
      } else if (threshold !== undefined && coverage === undefined) {
        lines.push(`[WARN] could not parse coverage from output; gate not enforced`)
      }
    }
    return { ok: true, text: lines.join('\n') }
  })
}
