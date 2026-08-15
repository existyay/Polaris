#!/usr/bin/env node
/**
 * dsh-polaris — standalone CLI for 北极星 (Polaris).
 * Shares all logic with the DSH slash command in index.js.
 */

import {
  formatRanked,
  installCandidates,
  parseOptions,
  reviewLocal,
  searchBest,
} from '../lib/polaris.js'

function helpText() {
  return [
    '北极星 (Polaris) — real-time dsh-plugin discovery & minimal-cost installer',
    '',
    'Usage:',
    '  dsh-polaris search [--scope all|science|code] [--top 20] [--json]',
    '  dsh-polaris install [--profile web] [--scope all|science|code] [--max 10] [--dry-run]',
    '  dsh-polaris review [path] [--write] [--top 20]',
    '',
    'Options:',
    '  --profile <name>   DSH profile to install into (default: web or $DSH_PROFILE)',
    '  --scope <scope>    all | science | code        (default: all)',
    '  --max <n>          max plugins to install     (default: 10)',
    '  --top <n>          max rows to print          (default: 20)',
    '  --dry-run          print install plan only',
    '  --json             machine-readable output',
    '  --root <path>      review root (default: cwd)',
  ].join('\n')
}

const options = parseOptions(process.argv.slice(2))
if (options.help) {
  console.log(helpText())
  process.exit(0)
}

const logger = line => console.error(`[polaris] ${line}`)

try {
  if (options.command === 'search' || options.command === 'list') {
    const ranked = await searchBest({
      token: options.token,
      scope: options.scope,
      logger,
    })
    if (options.json) {
      console.log(JSON.stringify(ranked.map(entry => ({
        full_name: entry.repo.full_name,
        description: entry.repo.description,
        score: Number(entry.score.toFixed(2)),
        spec: entry.spec,
        reasons: entry.reasons,
        hasPrepare: entry.cost?.hasPrepare,
        dependencies: entry.cost?.totalDeps,
      })), null, 2))
    } else {
      console.log(formatRanked(ranked, { top: options.top }))
    }
  } else if (options.command === 'install') {
    const ranked = await searchBest({
      token: options.token,
      scope: options.scope,
      logger,
    })
    const result = await installCandidates(ranked, {
      profile: options.profile,
      max: options.max,
      scope: options.scope,
      dryRun: options.dryRun,
      yes: options.yes,
      logger,
    })
    if (options.dryRun || result.dryRun) {
      console.log(`[dry-run] selected ${(result.selected ?? []).length} plugins for profile "${options.profile}"`)
      if (result.selected) console.log(formatRanked(result.selected, { top: result.selected.length }))
    } else {
      console.log(`installed ${(result.installed ?? []).length} plugin(s) into profile "${options.profile}"`)
      for (const name of (result.installed ?? [])) console.log(`- ${name}`)
    }
  } else if (options.command === 'review') {
    const hits = await reviewLocal({
      root: options.arg ?? options.root,
      write: options.write,
      logger,
    })
    if (options.json) {
      console.log(JSON.stringify(hits.slice(0, options.top), null, 2))
    } else {
      const lines = hits.slice(0, options.top).map(hit => {
        if (hit.kind === 'skill') return `SKILL ${hit.name}\t${hit.score.toFixed(2)}\t${hit.path}`
        return `MCP   ${hit.name}\t${hit.score.toFixed(2)}\t${hit.path}`
      })
      console.log(lines.length > 0 ? lines.join('\n') : 'No local SKILL.md / MCP config passed the minimalist filter.')
    }
  } else {
    console.error(`unknown command ${JSON.stringify(options.command)}`)
    console.error(helpText())
    process.exit(2)
  }
} catch (error) {
  console.error(`[polaris] ${error?.stack ?? error?.message ?? error}`)
  process.exit(1)
}
