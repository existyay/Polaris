/**
 * Tests for lib/audit.js — static pattern scan, dependency audit and rendering.
 *
 * The dependency audit is the only primitive that shells out to npm, so the
 * tests assert on the *failure mode*: a spawn failure (ENOENT on Windows
 * because npm is a `.cmd` shim) is a bug, while any real npm verdict is fine.
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { auditDependencies, formatAudit, parseAuditArgs, scanStatic } from '../lib/audit.js'
import { findCommand } from '../lib/common.js'

const tempDirs = []
const hasNpm = findCommand('npm')
const npmSkip = hasNpm ? false : 'npm is not installed in this environment'

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'polaris-audit-'))
  tempDirs.push(dir)
  return dir
}

after(async () => {
  for (const dir of tempDirs) {
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
    } catch {
      // leftover temp directory only
    }
  }
})

const LOCKFILE = {
  name: 'polaris-audit-fixture',
  version: '1.0.0',
  lockfileVersion: 3,
  requires: true,
  packages: { '': { name: 'polaris-audit-fixture', version: '1.0.0' } },
}

async function makeProject({ lockfile }) {
  const dir = await makeTempDir()
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'polaris-audit-fixture', version: '1.0.0' }, null, 2))
  if (lockfile) await writeFile(join(dir, 'package-lock.json'), JSON.stringify(LOCKFILE, null, 2))
  return dir
}

describe('auditDependencies', () => {
  it('starts npm instead of failing to spawn it', { skip: npmSkip }, async () => {
    // Regression: `spawnSync('npm', ...)` cannot start npm on Windows (ENOENT
    // for the shell-less shim, EINVAL for the .cmd), so every audit reported
    // "spawnSync npm ENOENT". A real npm verdict — success or a genuine audit
    // error — is acceptable here; a spawn failure is not.
    const dir = await makeProject({ lockfile: true })
    const result = auditDependencies(dir, { timeout: 60000 })

    assert.doesNotMatch(String(result.error ?? ''), /ENOENT|EINVAL/)
    if (result.ok) {
      assert.equal(typeof result.vulnerabilities, 'object')
      assert.equal(typeof result.summary, 'object')
    }
  })

  it('never reports a failed audit as clean', { skip: npmSkip }, async () => {
    // Regression: npm answers ENOLOCK with a well-formed JSON error object on
    // stdout, which used to parse into an empty report and render as
    // "未发现已知漏洞" (no known vulnerabilities).
    const dir = await makeProject({ lockfile: false })
    const result = auditDependencies(dir, { timeout: 60000 })

    assert.equal(result.ok, false)
    assert.match(String(result.error), /lockfile/i)
  })
})

describe('formatAudit', () => {
  it('renders a clean audit', () => {
    const text = formatAudit([], { ok: true, vulnerabilities: {}, summary: {} })
    assert.match(text, /静态扫描发现：/)
    assert.match(text, /未发现已知危险模式/)
    assert.match(text, /未发现已知漏洞/)
  })

  it('renders an unavailable audit instead of claiming it is clean', () => {
    const text = formatAudit([], { ok: false, error: 'boom' })
    assert.match(text, /审计不可用：boom/)
    assert.doesNotMatch(text, /未发现已知漏洞/)
  })

  it('renders static findings with file, line and rule', () => {
    const text = formatAudit([{ file: 'src/a.js', line: 3, rule: 'dynamic-eval', snippet: 'eval(x)' }], {
      ok: true,
      vulnerabilities: {},
      summary: {},
    })
    assert.match(text, /src\/a\.js:3 \[dynamic-eval\] eval\(x\)/)
  })

  it('renders vulnerabilities with severity and directness', () => {
    const text = formatAudit([], {
      ok: true,
      vulnerabilities: { lodash: { severity: 'high', direct: true, title: 'Prototype Pollution' } },
      summary: {},
    })
    assert.match(text, /lodash: high \(true\) Prototype Pollution/)
  })
})

describe('scanStatic', () => {
  it('finds dangerous patterns and skips node_modules and .git', async () => {
    const dir = await makeTempDir()
    await mkdir(join(dir, 'src'), { recursive: true })
    await mkdir(join(dir, 'node_modules'), { recursive: true })
    await mkdir(join(dir, '.git'), { recursive: true })
    await writeFile(join(dir, 'src', 'bad.js'), [
      'const password = "hunter2secret"',
      'eval(userInput)',
      'rejectUnauthorized: false',
    ].join('\n'))
    await writeFile(join(dir, 'src', 'clean.js'), 'export const a = 1\n')
    await writeFile(join(dir, 'node_modules', 'dep.js'), 'eval(1)\n')
    await writeFile(join(dir, '.git', 'hook.js'), 'eval(1)\n')

    const findings = await scanStatic(dir)

    assert.deepEqual(
      [...new Set(findings.map((finding) => finding.rule))].sort(),
      ['dynamic-eval', 'hardcoded-secret', 'weak-tls'],
    )
    assert.ok(findings.every((finding) => !finding.file.includes('node_modules')))
    assert.ok(findings.every((finding) => !finding.file.includes('.git')))
    assert.equal(findings.find((finding) => finding.rule === 'dynamic-eval').line, 2)
  })

  it('skips files larger than maxBytes', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'big.js'), `eval(x)\n${'// padding\n'.repeat(50)}`)

    assert.equal((await scanStatic(dir)).length, 1)
    assert.equal((await scanStatic(dir, { maxBytes: 10 })).length, 0)
  })

  it('returns nothing for a clean tree', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'ok.js'), 'export const a = 1\n')
    assert.deepEqual(await scanStatic(dir), [])
  })
})

describe('parseAuditArgs', () => {
  it('applies defaults', () => {
    const options = parseAuditArgs([])
    assert.equal(options.root, process.cwd())
    assert.equal(options.timeout, '90000')
    assert.equal(options.maxFiles, '400')
  })

  it('reads explicit values', () => {
    const options = parseAuditArgs(['--root', '/x', '--timeout', '1000', '--maxFiles', '5'])
    assert.equal(options.root, '/x')
    assert.equal(options.timeout, '1000')
    assert.equal(options.maxFiles, '5')
  })
})
