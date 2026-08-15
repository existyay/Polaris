/**
 * polaris-discover: GitHub topic dsh-plugin discovery + minimalist scoring +
 * one-shot low-cost installation. The original Polaris primitive.
 */

import { readFileSync } from 'node:fs'

import {
  DEFAULT_MAX_INSTALL,
  DEFAULT_PROFILE,
  formatRanked,
  installCandidates,
  parseOptions,
  searchBest,
} from '../lib/polaris.js'
import { registerPrimitive, textTool, tokenize } from './helper.js'

export const name = 'polaris-discovery'
export const inject = ['commands', 'skills', 'tools']

const SKILL = readFileSync(new URL('../skills/polaris/SKILL.md', import.meta.url), 'utf8')

async function handler(invocation) {
  const options = parseOptions(tokenize(invocation.rawInput))
  const logger = line => console.error(`[polaris-discovery] ${line}`)
  const ranked = await searchBest({ token: options.token, scope: options.scope, logger })
  if (options.command === 'install') {
    const result = await installCandidates(ranked, {
      profile: options.profile,
      max: options.max,
      scope: options.scope,
      dryRun: options.dryRun,
      yes: options.yes,
      logger,
    })
    if (result.dryRun) {
      return { kind: 'success', text: `[dry-run] 将安装：\n${formatRanked(result.selected ?? ranked, { top: options.top })}` }
    }
    return { kind: 'success', text: `已安装 ${(result.installed ?? []).length} 个插件到 profile "${options.profile}"：\n${(result.installed ?? []).map(item => `- ${item}`).join('\n')}\n重启 profile 后生效。` }
  }
  return { kind: 'success', text: formatRanked(ranked, { top: options.top }) }
}

export function apply(ctx) {
  registerPrimitive(ctx, {
    name: 'polaris-discover',
    description: '实时扫描 GitHub topic:dsh-plugin，按极简范式与理工科/代码优化特化评分，并一键安装最适配的 DSH 插件',
    hint: 'search [--scope all|science|code] [--top 8] | install [--profile web] [--scope code] [--max 10] [--dry-run]',
    skill: SKILL,
    handler,
    tool: textTool('polaris_discover', 'Realtime discovery of GitHub dsh-plugin topic plugins that match the Polaris minimal + science/engineering/code-optimization criteria. Call when searching for a DSH capability to avoid reimplementing it.', {
      scope: { type: 'string', description: 'all | science | code (default all).' },
      top: { type: 'number', description: 'Max candidates to return (default 8).' },
    }, async args => {
      const ranked = await searchBest({ token: process.env.GITHUB_TOKEN, scope: args.scope ?? 'all', logger: () => {} })
      return { report: formatRanked(ranked, { top: args.top ?? 8 }) }
    }),
  })
}
