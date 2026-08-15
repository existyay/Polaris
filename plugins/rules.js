/**
 * polaris-rules: declarative Chinese sci/eng terminology mapping and code
 * optimization rule injection.
 */

import { injectRules, runRules } from '../lib/rules.js'
import { registerPrimitive, textTool, tokenize } from './helper.js'

export const name = 'polaris-rules'
export const inject = ['commands', 'skills', 'tools']

const SKILL = `# 北极星规则原语 (polaris-rules)

以声明式配置注入中文理工科术语映射与代码优化规则。

配置查找顺序：
1. \`<root>/.dsh/polaris-rules.yml\`
2. \`<root>/polaris-rules.yml\`
3. 插件内置默认规则

用法：
\`\`\`
/polaris-rules --root /path/to/project
\`\`\`
启动时插件会把规则注册为 \`polaris-scieng-rules\` 运行时技能，供模型按需加载。`

export function apply(ctx) {
  registerPrimitive(ctx, {
    name: 'polaris-rules',
    description: '声明式配置注入中文理工科术语映射与代码优化规则',
    hint: '--root <path>',
    skill: SKILL,
    handler: async invocation => ({ kind: 'success', text: await runRules(tokenize(invocation.rawInput)) }),
    tool: textTool('polaris_rules', 'Read and render the declarative Chinese science/engineering terminology mapping and code optimization rules for the current workspace.', {
      root: { type: 'string', description: 'Project root containing polaris-rules.yml or .dsh/polaris-rules.yml.' },
    }, async args => ({ report: await runRules(['--root', args.root ?? process.cwd()]) })),
  })
  const root = process.env.POLARIS_RULES_ROOT ?? process.cwd()
  injectRules(ctx, root)
}
