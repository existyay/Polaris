#!/usr/bin/env node
/**
 * dsh-polaris — standalone CLI for 北极星 atomic primitives.
 */

import {
  formatRanked,
  installCandidates,
  parseOptions,
  searchBest,
} from '../lib/polaris.js'
import { runAudit } from '../lib/audit.js'
import { runExec } from '../lib/exec.js'
import { runVerify } from '../lib/verify.js'
import { runRetrieve } from '../lib/retrieve.js'
import { runLicense } from '../lib/license.js'
import { runRules } from '../lib/rules.js'

function helpText() {
  return [
    '北极星 (Polaris) — atomic dsh-plugin primitives',
    '',
    'Usage:',
    '  dsh-polaris discover|search [--scope all|science|code] [--top 20] [--json]',
    '  dsh-polaris install     [--profile web] [--scope all|science|code] [--max 10] [--dry-run]',
    '  dsh-polaris audit       [--root <path>] [--maxFiles 400] [--timeout 90000]',
    '  dsh-polaris exec        "<command>" [--cwd <path>] [--timeout 30000] [--maxOutput 65536] [--clean-env]',
    '  dsh-polaris verify      [--root <path>] [--cmd "test"] [--coverageCmd "cov"] [--threshold 80]',
    '  dsh-polaris retrieve    [--root <path>] --query <symbol|keyword> [--top 40]',
    '  dsh-polaris license     [--root <path>] [--fail-on]',
    '  dsh-polaris rules       [--root <path>]',
  ].join('\n')
}

const argv = process.argv.slice(2)
if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
  console.log(helpText())
  process.exit(0)
}

const sub = argv[0]
const rest = argv.slice(1)
const logger = line => console.error(`[polaris] ${line}`)

try {
  if (sub === 'discover' || sub === 'search' || sub === 'list' || sub === 'install') {
    const options = parseOptions(argv)
    const ranked = await searchBest({ token: options.token, scope: options.scope, logger })
    if (sub === 'install') {
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
    } else if (options.json) {
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
  } else if (sub === 'audit') {
    console.log(await runAudit(rest))
  } else if (sub === 'exec') {
    console.log(runExec(rest))
  } else if (sub === 'verify') {
    const result = await runVerify(rest)
    console.log(result.text)
    if (!result.ok) process.exit(1)
  } else if (sub === 'retrieve') {
    console.log(await runRetrieve(rest))
  } else if (sub === 'license') {
    console.log(await runLicense(rest))
  } else if (sub === 'rules') {
    console.log(await runRules(rest))
  } else {
    console.error(`unknown command ${JSON.stringify(sub)}`)
    console.error(helpText())
    process.exit(2)
  }
} catch (error) {
  console.error(`[polaris] ${error?.stack ?? error?.message ?? error}`)
  process.exit(1)
}
