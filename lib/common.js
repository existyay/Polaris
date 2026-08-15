/**
 * Shared utilities for 北极星 atomic primitives.
 * Dependency-free on purpose.
 */

import { spawnSync } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const CJK_RE = /[\u3400-\u9fff]/

export function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, ' ')
    .trim()
}

export function matchTerms(text, terms) {
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

export async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'dsh-polaris',
        'Accept': 'application/vnd.github+json',
        ...(options.headers ?? {}),
      },
    })
  } finally {
    clearTimeout(timer)
  }
}

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function exists(path) {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function walkDirectory(root, onFile, { maxFiles = 500, skipDirs = new Set(['node_modules', '.git']) } = {}) {
  let files = 0
  async function walk(dir) {
    if (files >= maxFiles) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files >= maxFiles) return
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) await walk(join(dir, entry.name))
      } else if (entry.isFile()) {
        files += 1
        await onFile(join(dir, entry.name), entry.name)
      }
    }
  }
  await walk(resolve(root))
  return files
}

export function runSync(command, args, options = {}) {
  const merged = {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120000,
    ...options,
  }
  return spawnSync(command, args, merged)
}

export function parseArgs(argv, { defaults = {}, valueKeys = new Set(), boolKeys = new Set() } = {}) {
  const options = { command: '', arg: '', ...defaults }
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const key = eq >= 0 ? arg.slice(2, eq) : arg.slice(2)
      const attached = eq >= 0 ? arg.slice(eq + 1) : undefined
      if (boolKeys.has(key) && attached === undefined) {
        options[key] = true
      } else {
        const value = attached ?? argv[++i]
        options[key] = value
      }
    } else {
      positional.push(arg)
    }
  }
  if (positional.length > 0) options.command = positional[0]
  if (positional.length > 1) options.arg = positional[1]
  return options
}

export function findCommand(command) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], {
    stdio: 'pipe',
    shell: process.platform === 'win32',
  })
  return result.status === 0
}
