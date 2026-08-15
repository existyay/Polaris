/**
 * polaris-verify: schema-based deterministic functional test + coverage gate.
 */

import { runVerify } from '../lib/verify.js'
import { registerPrimitive, textTool, tokenize } from './helper.js'

export const name = 'polaris-verify'
export const inject = ['commands', 'skills', 'tools']

const SKILL = `# 北极星验证原语 (polaris-verify)

基于声明式 schema 的确定性功能测试与覆盖率门槛。

配置：项目根目录 \`.polaris-verify.json\`
\`\`\`json
{
  "testCommand": "node --test",
  "coverageCommand": "node --test --experimental-test-coverage",
  "coverageThreshold": 80,
  "timeoutMs": 300000
}
\`\`\`
未提供配置时，使用 \`package.json\` 的 \`test\` 脚本，覆盖率门槛跳过。

用法：
\`\`\`
/polaris-verify --root /path/to/project
/polaris-verify --root /path/to/project --cmd "pytest -q" --coverageCmd "pytest --cov" --threshold 80
\`\`\``

export function apply(ctx) {
  registerPrimitive(ctx, {
    name: 'polaris-verify',
    description: '基于 schema 的确定性功能测试与覆盖率门槛（有界、无状态）',
    hint: '--root <path> [--cmd "test command"] [--coverageCmd "cov command"] [--threshold 80]',
    skill: SKILL,
    handler: async invocation => {
      const result = await runVerify(tokenize(invocation.rawInput))
      return { kind: result.ok ? 'success' : 'error', text: result.text }
    },
    tool: textTool('polaris_verify', 'Run deterministic functional tests and enforce a coverage threshold from .polaris-verify.json. Call before declaring a task done or a change verified.', {
      root: { type: 'string', description: 'Project root to verify.' },
      cmd: { type: 'string', description: 'Optional test command override.' },
      coverageCmd: { type: 'string', description: 'Optional coverage command override.' },
      threshold: { type: 'number', description: 'Coverage percentage gate (0-100).' },
    }, async args => {
      const result = await runVerify(['--root', args.root ?? process.cwd(), ...(args.cmd ? ['--cmd', args.cmd] : []), ...(args.coverageCmd ? ['--coverageCmd', args.coverageCmd] : []), ...(args.threshold !== undefined ? ['--threshold', String(args.threshold)] : [])])
      return { report: result.text, ok: result.ok }
    }),
  })
}
