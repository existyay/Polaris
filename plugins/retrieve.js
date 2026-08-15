/**
 * polaris-retrieve: deterministic code symbol + documentation hybrid retrieval.
 */

import { runRetrieve } from '../lib/retrieve.js'
import { registerPrimitive, textTool, tokenize } from './helper.js'

export const name = 'polaris-retrieve'
export const inject = ['commands', 'skills', 'tools']

const SKILL = `# 北极星检索原语 (polaris-retrieve)

确定性的代码符号与文档混合检索：正则提取函数/类/接口签名及其前置注释，并在 Markdown/文本中做关键词匹配。无嵌入、无排序模型。

用法：
\`\`\`
/polaris-retrieve --root /path/to/project --query "solver"
\`\`\`
边界：最多扫描 400 个文件，单文件不超过 300KB。`

export function apply(ctx) {
  registerPrimitive(ctx, {
    name: 'polaris-retrieve',
    description: '代码符号与文档混合检索（确定性、无模型）',
    hint: '--root <path> --query <symbol|keyword> [--top 40]',
    skill: SKILL,
    handler: async invocation => ({ kind: 'success', text: await runRetrieve(tokenize(invocation.rawInput)) }),
    tool: textTool('polaris_retrieve', 'Deterministic code symbol and documentation hybrid retrieval. Use when locating a function, class, or documented concept in the workspace.', {
      root: { type: 'string', description: 'Project root to search.' },
      query: { type: 'string', description: 'Symbol name or keyword.' },
      top: { type: 'number', description: 'Max results (default 40).' },
    }, async args => ({ report: await runRetrieve(['--root', args.root ?? process.cwd(), '--query', args.query ?? '', ...(args.top !== undefined ? ['--top', String(args.top)] : [])]) })),
  })
}
