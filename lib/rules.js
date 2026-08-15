/**
 * polaris-rules: declarative Chinese science/engineering terminology mapping
 * and code-optimization rules. The plugin reads a workspace-level YAML file
 * and injects it as a runtime skill; the CLI validates and renders the file.
 *
 * Config lookup order:
 *   1. <root>/.dsh/polaris-rules.yml
 *   2. <root>/polaris-rules.yml
 *   3. this package's default rules (skills/polaris/default-rules.yml)
 */

import { existsSync, readFileSync } from 'node:fs'
import { parseArgs } from './common.js'

const CONFIG_NAMES = ['polaris-rules.yml', '.dsh/polaris-rules.yml']

function parseRuleYaml(text) {
  const sections = {}
  let current = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s+/, '').replace(/\s+#.*$/, '').trimEnd()
    if (line.trim() === '') continue
    const section = /^([A-Za-z_][A-Za-z0-9_-]*):\s*$/.exec(line)
    if (section) {
      current = section[1]
      sections[current] = []
      continue
    }
    const item = /^-\s+(.+)$/.exec(line)
    if (item && current) {
      sections[current].push(item[1].trim().replace(/^['"]|['"]$/g, ''))
    }
  }
  return sections
}

function renderRules(sections) {
  const lines = ['# 北极星理工科规则注入 (Polaris Sci/Eng Rules)']
  const science = sections.science_terms ?? sections.scienceTerms ?? []
  const code = sections.code_optimization_rules ?? sections.codeOptimizationRules ?? []
  const constraints = sections.constraints ?? []
  if (science.length > 0) {
    lines.push('', '## 中文理工科术语映射')
    for (const term of science) lines.push(`- ${term}`)
  }
  if (code.length > 0) {
    lines.push('', '## 代码优化规则')
    for (const rule of code) lines.push(`- ${rule}`)
  }
  if (constraints.length > 0) {
    lines.push('', '## 边界约束')
    for (const rule of constraints) lines.push(`- ${rule}`)
  }
  if (science.length === 0 && code.length === 0 && constraints.length === 0) {
    lines.push('', '(未配置规则，使用默认规则文件或在工作区创建 polaris-rules.yml)')
  }
  return lines.join('\n')
}

export function loadRules(root) {
  for (const name of CONFIG_NAMES) {
    const path = `${root}/${name}`
    if (existsSync(path)) {
      return { path, sections: parseRuleYaml(readFileSync(path, 'utf8')) }
    }
  }
  const defaultPath = new URL('../skills/polaris/default-rules.yml', import.meta.url)
  try {
    return { path: defaultPath.pathname, sections: parseRuleYaml(readFileSync(defaultPath, 'utf8')) }
  } catch {
    return { path: '(built-in empty)', sections: {} }
  }
}

export function runRules(argv) {
  const options = parseArgs(argv, {
    defaults: { root: process.cwd() },
    valueKeys: new Set(['root']),
  })
  const { path, sections } = loadRules(options.root)
  const rendered = renderRules(sections)
  return `规则来源: ${path}\n\n${rendered}`
}

export function injectRules(ctx, root) {
  const { path, sections } = loadRules(root)
  const content = renderRules(sections)
  ctx.skills.register({
    name: 'polaris-scieng-rules',
    description: '声明式注入的中文理工科术语映射与代码优化规则；来源: ' + path,
    content,
  })
}
