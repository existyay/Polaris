/**
 * polaris-audit: static code scanning + dependency vulnerability audit.
 * Stateless, bounded (max files / max file bytes / audit timeout).
 */

import { readFile } from 'node:fs/promises'
import { findCommand, parseArgs, runSync, walkDirectory } from './common.js'

const SECRET_PATTERNS = [
  { id: 'hardcoded-secret', re: /(?:password|passwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token)\s*[:=]\s*['"][^'"]{6,}['"]/i },
  { id: 'dynamic-eval', re: /\beval\s*\(/ },
  { id: 'dynamic-exec', re: /(?:child_process|subprocess|os\.system)\s*\.\s*exec\w*\s*\(/ },
  { id: 'unsafe-html', re: /dangerouslySetInnerHTML|innerHTML\s*=/ },
  { id: 'sql-string-concat', re: /select\s+.*\s+from\s+.*\s*\+/i },
  { id: 'weak-tls', re: /rejectUnauthorized\s*:\s*false|checkServerIdentity\s*:\s*\(\)\s*=>\s*undefined/ },
]

export function scanStatic(root, { maxFiles = 400, maxBytes = 200_000 } = {}) {
  const findings = []
  return new Promise((resolvePromise) => {
    walkDirectory(root, async (path) => {
      let text = null
      try {
        text = await readFile(path, 'utf8')
      } catch {
        return
      }
      if (Buffer.byteLength(text) > maxBytes) return
      const lines = text.split(/\r?\n/)
      for (let i = 0; i < lines.length; i += 1) {
        for (const pattern of SECRET_PATTERNS) {
          if (pattern.re.test(lines[i])) {
            findings.push({ file: path, line: i + 1, rule: pattern.id, snippet: lines[i].trim().slice(0, 160) })
          }
        }
      }
    }, { maxFiles }).then(() => resolvePromise(findings))
  })
}

export function auditDependencies(root, { timeout = 90000 } = {}) {
  if (!findCommand('npm')) return { ok: false, error: 'npm not found; cannot audit dependencies' }
  const result = runSync('npm', ['audit', '--json', '--prefix', root], { timeout, maxBuffer: 8 * 1024 * 1024 })
  if (result.error) return { ok: false, error: result.error.message }
  let parsed
  try {
    parsed = JSON.parse(result.stdout || '{}')
  } catch {
    return { ok: false, error: `npm audit returned non-JSON output: ${(result.stderr || result.stdout).slice(0, 500)}` }
  }
  const vulnerabilities = parsed.vulnerabilities ?? {}
  const summary = parsed.metadata?.vulnerabilities ?? {}
  return { ok: true, vulnerabilities, summary, raw: parsed }
}

export function formatAudit(staticFindings, audit) {
  const lines = []
  lines.push('静态扫描发现：')
  if (staticFindings.length === 0) lines.push('  - 未发现已知危险模式')
  for (const finding of staticFindings.slice(0, 200)) {
    lines.push(`  - ${finding.file}:${finding.line} [${finding.rule}] ${finding.snippet}`)
  }
  lines.push('')
  lines.push('依赖漏洞审计：')
  if (!audit.ok) {
    lines.push(`  - 审计不可用：${audit.error}`)
  } else {
    const entries = Object.entries(audit.vulnerabilities)
    if (entries.length === 0) lines.push('  - 未发现已知漏洞')
    for (const [name, vuln] of entries) {
      const v = vuln
      lines.push(`  - ${name}: ${v.severity} (${v.direct}) ${v.title ?? ''}`)
    }
  }
  return lines.join('\n')
}

export function parseAuditArgs(argv) {
  return parseArgs(argv, {
    defaults: { root: process.cwd(), timeout: '90000', maxFiles: '400' },
    valueKeys: new Set(['root', 'timeout', 'maxFiles']),
  })
}

export async function runAudit(argv) {
  const options = parseAuditArgs(argv)
  const root = options.root
  const staticFindings = await scanStatic(root, { maxFiles: Number(options.maxFiles) })
  const audit = auditDependencies(root, { timeout: Number(options.timeout) })
  return formatAudit(staticFindings, audit)
}
