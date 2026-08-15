/**
 * 北极星 (Polaris) — DSH bundle entry.
 *
 * Registers:
 *   - `/polaris`  human command (search/install/review)
 *   - `polaris`   runtime skill so the model can invoke the same capability
 *
 * The package intentionally ships as plain ESM JavaScript: no build step, no
 * dependencies, no prepare script. A git install into a dsh profile works
 * without pnpm build allowance.
 */

import { readFileSync } from 'node:fs'

import {
  DEFAULT_MAX_INSTALL,
  DEFAULT_PROFILE,
  formatRanked,
  installCandidates,
  parseOptions,
  reviewLocal,
  searchBest,
} from './lib/polaris.js'

export const name = 'polaris'
export const inject = ['commands', 'skills']

const SKILL_PATH = new URL('./skills/polaris/SKILL.md', import.meta.url)

const COMMAND_DESCRIPTION = '实时扫描 GitHub dsh-plugin 主题，按极简范式与理工科/代码优化特化，一键安装最适配的 DSH 插件'
const COMMAND_INPUT_HINT = 'search | install [--profile web] [--max 10] [--scope all|science|code] [--dry-run] | review [path]'

function tokenizeInput(rawInput) {
  const tokens = []
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = regex.exec(rawInput)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3])
  }
  return tokens
}

function brief(ranked, top = 8) {
  return formatRanked(ranked, { top })
}

async function handleCommand(invocation) {
  const options = parseOptions(tokenizeInput(invocation.rawInput ?? ''))
  if (options.help) return { kind: 'success', text: helpText() }

  const logger = (line) => {
    console.error(`[polaris] ${line}`)
  }

  switch (options.command) {
    case 'search':
    case 'list': {
      const ranked = await searchBest({
        token: options.token,
        scope: options.scope,
        logger,
      })
      return { kind: 'success', text: brief(ranked, options.top) }
    }
    case 'install': {
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
      if (result.dryRun) {
        return { kind: 'success', text: `[dry-run] 将安装以下插件：\n${brief(result.selected ?? ranked, options.top)}` }
      }
      const installed = result.installed ?? []
      return {
        kind: 'success',
        text: `已通过 dsh-plugin 标准与极简/理工科/代码优化过滤，安装 ${installed.length} 个插件到 profile "${options.profile}"：\n${installed.map(name => `- ${name}`).join('\n')}\n重启 profile 后生效。`,
      }
    }
    case 'review': {
      const hits = await reviewLocal({
        root: options.arg ?? options.root,
        write: options.write,
        logger,
      })
      const lines = hits.slice(0, options.top).map(hit => {
        if (hit.kind === 'skill') return `SKILL  ${hit.name}  score=${hit.score.toFixed(2)}  ${hit.path}`
        return `MCP    ${hit.name}  score=${hit.score.toFixed(2)}  ${hit.path}`
      })
      return {
        kind: 'success',
        text: lines.length > 0
          ? `本地审阅候选（符合极简/理工科/代码优化）：\n${lines.join('\n')}\n\n使用 review --write 可将 SKILL 转换写入 polaris-converted/skills/。`
          : '未发现符合条件的本地 SKILL.md / MCP 配置。',
      }
    }
    default:
      return { kind: 'error', text: `未知子命令 ${JSON.stringify(options.command)}。${helpText()}` }
  }
}

function helpText() {
  return [
    '北极星 /polaris 用法：',
    '  /polaris search [--scope all|science|code] [--top 8]   实时扫描并排序 dsh-plugin 主题插件',
    '  /polaris install [--profile web] [--scope all|science|code] [--max 10] [--dry-run]',
    '      一键安装通过「当前 dsh.bundle 标准 + 极简 + 理工科/代码优化特化」的插件',
    '  /polaris review [path] [--write]',
    '      审阅本地 SKILL.md 与 MCP 配置，并可将符合极简范式的技能转换为插件内容（后期能力）',
  ].join('\n')
}

export function apply(ctx) {
  ctx.commands.register({
    name: 'polaris',
    description: COMMAND_DESCRIPTION,
    input: { hint: COMMAND_INPUT_HINT },
    handler: async (invocation) => {
      try {
        return await handleCommand(invocation)
      } catch (error) {
        return { kind: 'error', text: `polaris failed: ${error?.message ?? error}` }
      }
    },
  })

  ctx.skills.register({
    name: 'polaris',
    description: '北极星 (Polaris)：实时发现 GitHub topic:dsh-plugin 中符合 DeepSeek Harness 极简开发范式、且面向理工科与代码优化的插件，并一键安装到 DSH profile。',
    whenToUse: '当用户需要发现、比较或批量安装 DSH 插件，或需要审阅本地 SKILL/MCP 并转换为极简插件内容时使用。',
    content: readFileSync(SKILL_PATH, 'utf8'),
  })
}
