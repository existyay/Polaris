/**
 * Deterministic semantic scheduler.
 *
 * Reads the immutable index and routes a natural-language intent to the best
 * capability entry. The current router is deterministic and transparent: it
 * scores capability tags and entry metadata against intent terms, and returns
 * the exact entry the runtime should dispatch. A production scheduler can
 * replace this function while preserving the same IR and index contract.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { matchTerms, parseArgs } from './common.js'
import { defaultIndexRoot } from './registry.js'

export function routeIntent(intent, { indexRoot = defaultIndexRoot() } = {}) {
  const indexPath = join(indexRoot, 'index.json')
  if (!existsSync(indexPath)) return { intent, candidates: [], routed: null, note: `no index at ${indexRoot}` }
  const index = JSON.parse(readFileSync(indexPath, 'utf8'))
  const entries = Object.entries(index.entries ?? {})
  const terms = String(intent).toLowerCase().split(/\s+/).filter(Boolean)
  const scored = []
  for (const [name, digest] of entries) {
    const entryPath = join(indexRoot, 'entries', `${digest}.json`)
    if (!existsSync(entryPath)) continue
    const candidate = JSON.parse(readFileSync(entryPath, 'utf8'))
    const haystack = [
      name,
      candidate.description ?? '',
      ...(candidate.capabilities ?? []),
      candidate.origin?.type ?? '',
    ].join(' ')
    const hits = terms.length > 0 ? matchTerms(haystack, terms) : []
    let score = hits.length
    if (terms.length > 0) {
      for (const cap of candidate.capabilities ?? []) {
        if (terms.includes(cap.toLowerCase())) score += 3
      }
      if (name.toLowerCase().includes(terms[0])) score += 2
    } else {
      score = 1
    }
    scored.push({ name, digest, candidate, hits, score })
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  const routed = scored.length > 0 && (terms.length === 0 || scored[0].score > 0) ? scored[0] : null
  return {
    intent,
    indexRoot,
    candidates: scored.map(item => ({ name: item.name, digest: item.digest, score: item.score, hits: item.hits })),
    routed: routed === null ? null : {
      name: routed.name,
      digest: routed.digest,
      entry: routed.candidate.entry,
      source: routed.candidate.source,
      capabilities: routed.candidate.capabilities,
    },
  }
}

export function parseRouteArgs(argv) {
  return parseArgs(argv, {
    defaults: { indexRoot: defaultIndexRoot() },
    valueKeys: new Set(['indexRoot']),
  })
}

export function runRoute(argv) {
  const options = parseRouteArgs(argv)
  const intent = [options.command, options.arg].filter(Boolean).join(' ') || options.intent || ''
  if (!intent) throw new Error('usage: route --intent "code review" or route <intent>')
  return JSON.stringify(routeIntent(intent, { indexRoot: options.indexRoot }), null, 2)
}
