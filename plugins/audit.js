/**
 * polaris-audit: static code scanning + dependency vulnerability audit.
 */

import { runAudit } from '../lib/audit.js'
import { registerPrimitive, textTool, tokenize } from './helper.js'

export const name = 'polaris-audit'
export const inject = ['commands', 'skills', 'tools']

const SKILL = `# 北极星审计原语 (polaris-audit)

对项目做有界静态扫描与依赖漏洞审计。

- 静态扫描：危险模式（硬编码密钥、动态 eval/exec、不安全 HTML、SQL 字符串拼接、弱 TLS 配置）。
- 依赖审计：优先调用 \`npm audit --json\`，解析已知漏洞。

模型工具：\`polaris_audit\`。开发中改动依赖、认证或动态执行代码后应自动调用，无需等待人类输入。

人工命令：\`/polaris-audit --root /path/to/project --maxFiles 400\`

边界：最多扫描 400 个文件，单文件不超过 200KB，审计超时默认 90 秒。`

export function apply(ctx) {
  registerPrimitive(ctx, {
    name: 'polaris-audit',
    description: '静态代码扫描与依赖漏洞审计（有界、无状态）',
    hint: '--root <path> [--maxFiles 400] [--timeout 90000]',
    skill: SKILL,
    handler: async invocation => ({ kind: 'success', text: await runAudit(tokenize(invocation.rawInput)) }),
    tool: textTool('polaris_audit', 'Static code scan and dependency vulnerability audit. Run this automatically before merging code that touches dependencies, authentication, or dynamic execution.', {
      root: { type: 'string', description: 'Project root to audit. Defaults to the current workspace.' },
    }, async args => ({ report: await runAudit(['--root', args.root ?? process.cwd()]) })),
  })
}
