/**
 * polaris-license: license compliance query for a project and its direct
 * installed dependencies.
 */

import { runLicense } from '../lib/license.js'
import { registerPrimitive, tokenize } from './helper.js'

export const name = 'polaris-license'
export const inject = ['commands', 'skills']

const SKILL = `# 北极星许可证原语 (polaris-license)

读取项目根目录与 \`node_modules\` 中直接依赖的 \`license\` 字段，按允许性分类。

用法：
\`\`\`
/polaris-license --root /path/to/project
/polaris-license --root /path/to/project --fail-on
\`\`\`
允许性为本地静态判断：MIT/Apache-2.0/BSD/ISC/0BSD/Unlicense/CC0 等为 permissive。`

export function apply(ctx) {
  registerPrimitive(ctx, {
    name: 'polaris-license',
    description: '许可证合规查询（项目与直接依赖，本地静态判定）',
    hint: '--root <path> [--fail-on]',
    skill: SKILL,
    handler: async invocation => ({ kind: 'success', text: await runLicense(tokenize(invocation.rawInput)) }),
  })
}
