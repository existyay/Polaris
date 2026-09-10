/**
 * Tests for lib/common.js — argument parsing, command probing, bounded exec
 * and the filesystem walk used by every primitive.
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import {
  exists,
  findCommand,
  matchTerms,
  normalize,
  parseArgs,
  readJson,
  runSync,
  walkDirectory,
} from '../lib/common.js'

const tempDirs = []

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'polaris-common-'))
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

describe('normalize', () => {
  it('lowercases and collapses punctuation', () => {
    assert.equal(normalize('Foo_Bar!!  Baz'), 'foo bar baz')
  })

  it('keeps CJK characters', () => {
    assert.equal(normalize('数值 计算'), '数值 计算')
  })

  it('maps nullish input to an empty string', () => {
    assert.equal(normalize(undefined), '')
    assert.equal(normalize(null), '')
  })
})

describe('matchTerms', () => {
  it('matches CJK terms by substring', () => {
    assert.deepEqual(matchTerms('数值计算与仿真', ['数值计算', '仿真']), ['数值计算', '仿真'])
  })

  it('requires word boundaries for ASCII terms', () => {
    assert.deepEqual(matchTerms('performance tuning', ['performance']), ['performance'])
    assert.deepEqual(matchTerms('performancex', ['performance']), [])
  })

  it('is case-insensitive and deduplicates nothing', () => {
    assert.deepEqual(matchTerms('Engineering', ['engineering']), ['engineering'])
  })

  it('returns an empty list when nothing matches', () => {
    assert.deepEqual(matchTerms('unrelated text', ['仿真', 'engineering']), [])
    assert.deepEqual(matchTerms('', ['engineering']), [])
  })
})

describe('parseArgs', () => {
  it('applies defaults', () => {
    const options = parseArgs([], { defaults: { root: '/tmp', timeout: '300000' } })
    assert.equal(options.root, '/tmp')
    assert.equal(options.timeout, '300000')
    assert.equal(options.command, '')
    assert.equal(options.arg, '')
  })

  it('reads space separated values', () => {
    const options = parseArgs(['--root', '/a', '--timeout', '1000'])
    assert.equal(options.root, '/a')
    assert.equal(options.timeout, '1000')
  })

  it('reads --key=value', () => {
    const options = parseArgs(['--root=/a', '--timeout=50'])
    assert.equal(options.root, '/a')
    assert.equal(options.timeout, '50')
  })

  it('treats a boolKey without a value as true without eating the next token', () => {
    const options = parseArgs(['--json', 'verify'], { boolKeys: new Set(['json']) })
    assert.equal(options.json, true)
    assert.equal(options.command, 'verify')
  })

  it('collects positionals into command and arg', () => {
    const options = parseArgs(['verify', 'target', '--root', '/a'])
    assert.equal(options.command, 'verify')
    assert.equal(options.arg, 'target')
    assert.equal(options.root, '/a')
  })
})

describe('findCommand', () => {
  it('finds the node binary running the suite', () => {
    assert.equal(findCommand('node'), true)
  })

  it('reports a missing command as false', () => {
    assert.equal(findCommand('polaris-definitely-missing-command'), false)
  })

  it('probes without the DEP0190 args+shell deprecation warning', () => {
    // Regression: findCommand used to pass an args array together with
    // `shell: true`, which made Node print DEP0190 on every CLI invocation.
    // The child must exit naturally: process.exit() truncates the asynchronous
    // deprecation warning and would make this assertion vacuous.
    const commonUrl = new URL('../lib/common.js', import.meta.url).href
    const script = `import(${JSON.stringify(commonUrl)}).then((m) => process.stdout.write(String(m.findCommand('node'))))`
    const result = runSync(process.execPath, ['-e', script])
    assert.equal(result.stdout, 'true')
    assert.doesNotMatch(result.stderr ?? '', /DEP0190/)
  })
})

describe('runSync', () => {
  it('reports the exit status and captured stdout', () => {
    const result = runSync(process.execPath, ['-e', 'process.stdout.write("ok"); process.exit(7)'])
    assert.equal(result.status, 7)
    assert.equal(result.stdout, 'ok')
    assert.equal(result.error, undefined)
  })

  it('surfaces a timeout as an error instead of hanging', () => {
    const result = runSync(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeout: 1000 })
    assert.notEqual(result.status, 0)
    assert.match(result.error?.message ?? '', /ETIMEDOUT/)
  })
})

describe('exists / readJson', () => {
  it('detects presence and parses JSON', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'data.json'), '{"a":1}')
    assert.equal(await exists(join(dir, 'data.json')), true)
    assert.equal(await exists(join(dir, 'missing.json')), false)
    assert.deepEqual(await readJson(join(dir, 'data.json')), { a: 1 })
  })
})

describe('walkDirectory', () => {
  it('walks files and skips node_modules and .git', async () => {
    const dir = await makeTempDir()
    await mkdir(join(dir, 'src'), { recursive: true })
    await mkdir(join(dir, 'node_modules'), { recursive: true })
    await mkdir(join(dir, '.git'), { recursive: true })
    await writeFile(join(dir, 'src', 'a.js'), 'a')
    await writeFile(join(dir, 'src', 'b.js'), 'b')
    await writeFile(join(dir, 'node_modules', 'skip.js'), 'skip')
    await writeFile(join(dir, '.git', 'skip.js'), 'skip')

    const names = []
    const count = await walkDirectory(dir, async (_path, name) => {
      names.push(name)
    })

    assert.equal(count, 2)
    assert.deepEqual(names.sort(), ['a.js', 'b.js'])
  })

  it('stops at maxFiles', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'a.js'), 'a')
    await writeFile(join(dir, 'b.js'), 'b')

    let seen = 0
    await walkDirectory(dir, async () => {
      seen += 1
    }, { maxFiles: 1 })

    assert.equal(seen, 1)
  })
})
