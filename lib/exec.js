/**
 * polaris-exec: bounded subprocess execution + runtime behavior monitoring.
 *
 * Honest boundary: this primitive gives a hard wall-clock timeout, output cap,
 * and a clean minimal environment. Real OS-level sandboxing remains the job of
 * the DSH sandbox stack; this primitive is the bounded runner/monitor that can
 * sit inside it.
 */

import { spawnSync } from 'node:child_process'
import { parseArgs } from './common.js'

export function runBounded(command, {
  cwd = process.cwd(),
  timeout = 30000,
  maxOutput = 64 * 1024,
  cleanEnv = false,
} = {}) {
  const started = Date.now()
  const env = cleanEnv
    ? { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? process.cwd() }
    : process.env
  const result = spawnSync(command, {
    cwd,
    timeout,
    maxBuffer: maxOutput,
    encoding: 'utf8',
    shell: true,
    env,
  })
  const wallMs = Date.now() - started
  if (result.error) {
    const truncated = result.error.code === 'ENOBUFS'
    return {
      ok: false,
      truncated,
      timedOut: truncated, // maxBuffer overflow kills the process, indistinguishable from timeout in this context
      wallMs,
      code: null,
      signal: result.error.code ?? null,
      stdout: truncated ? String(result.stdout ?? '').slice(0, maxOutput) : String(result.stdout ?? ''),
      stderr: truncated ? String(result.stderr ?? '').slice(0, maxOutput) : String(result.stderr ?? ''),
      error: result.error.message,
    }
  }
  return {
    ok: result.status === 0,
    code: result.status,
    signal: result.signal,
    timedOut: result.signal === 'SIGTERM' || result.signal === 'SIGKILL',
    truncated: false,
    wallMs,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    error: null,
  }
}

export function formatExec(result) {
  const lines = [
    `exit=${result.code} signal=${result.signal ?? '-'} wall=${result.wallMs}ms truncated=${result.truncated}`,
  ]
  if (result.stdout) lines.push(`[stdout]\n${result.stdout}`)
  if (result.stderr) lines.push(`[stderr]\n${result.stderr}`)
  if (result.error) lines.push(`[error] ${result.error}`)
  return lines.join('\n')
}

export function parseExecArgs(argv) {
  return parseArgs(argv, {
    defaults: { cwd: process.cwd(), timeout: '30000', maxOutput: '65536', 'clean-env': false },
    valueKeys: new Set(['cwd', 'timeout', 'maxOutput']),
    boolKeys: new Set(['clean-env']),
  })
}

export function runExec(argv) {
  const options = parseExecArgs(argv)
  const command = [options.command, options.arg].filter(Boolean).join(' ') || options.cmd
  if (!command) throw new Error('usage: polaris-exec "<command>" [--timeout 30000] [--maxOutput 65536] [--clean-env]')
  return formatExec(runBounded(command, {
    cwd: options.cwd,
    timeout: Number(options.timeout),
    maxOutput: Number(options.maxOutput),
    cleanEnv: options['clean-env'],
  }))
}
