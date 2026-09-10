/**
 * Tests for lib/verify.js — the deterministic functional-test + coverage gate.
 *
 * The coverage reporter is faked with a script that prints a canned report, so
 * the gate is exercised end to end (config -> test command -> coverage command
 * -> parsing -> verdict -> exit ok) without depending on a real toolchain.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { resolveVerifyConfig, runVerify } from '../lib/verify.js'

const tempDirs = []

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'polaris-verify-'))
  tempDirs.push(dir)
  return dir
}

after(async () => {
  for (const dir of tempDirs) {
    // spawnSync kills the shell on timeout, but on Windows the grandchild node
    // process survives for a moment and keeps the directory busy, so retry and
    // never fail the suite over temp-directory cleanup.
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
    } catch {
      // leftover temp directory only
    }
  }
})

// `node --test --experimental-test-coverage` prints the summary row in lowercase.
const NODE_TEST_REPORT = [
  'ℹ start of coverage report',
  'ℹ ----------------------------------------------------------',
  'ℹ file      | line % | branch % | funcs % | uncovered lines',
  'ℹ ----------------------------------------------------------',
  'ℹ math.js   |  45.00 |   100.00 |   33.33 | 8-13',
  'ℹ ----------------------------------------------------------',
  'ℹ all files |  45.00 |   100.00 |   33.33 | ',
  'ℹ ----------------------------------------------------------',
  'ℹ end of coverage report',
].join('\n')

const FULLY_COVERED_REPORT = NODE_TEST_REPORT
  .replace('  45.00 |   100.00 |   33.33 | 8-13', ' 100.00 |   100.00 |  100.00 | ')
  .replace('  45.00 |   100.00 |   33.33 | ', ' 100.00 |   100.00 |  100.00 | ')

// nyc / istanbul capitalises the summary row and has no "Coverage summary" line.
const ISTANBUL_REPORT = [
  '-----------------|---------|----------|---------|---------|',
  'File             | % Stmts | % Branch | % Funcs | % Lines |',
  '-----------------|---------|----------|---------|---------|',
  'All files        |   45.00 |   100.00 |   33.33 |   45.00 |',
  '-----------------|---------|----------|---------|---------|',
].join('\n')

/**
 * Build a throwaway project whose test and coverage commands are stub scripts.
 */
async function makeProject({ report, testExit = 0, threshold = 80, timeoutMs = 60000, packageJson } = {}) {
  const dir = await makeTempDir()
  await writeFile(join(dir, 'test-script.js'), `process.exit(${testExit})\n`)
  await writeFile(join(dir, 'cover-script.js'), "process.stdout.write(require('node:fs').readFileSync('report.txt', 'utf8'))\n")
  await writeFile(join(dir, 'report.txt'), `${report}\n`)
  await writeFile(join(dir, '.polaris-verify.json'), JSON.stringify({
    testCommand: 'node test-script.js',
    coverageCommand: 'node cover-script.js',
    coverageThreshold: threshold,
    timeoutMs,
  }, null, 2))
  if (packageJson) await writeFile(join(dir, 'package.json'), JSON.stringify(packageJson, null, 2))
  return dir
}

describe('runVerify coverage gate', () => {
  it('fails when node:test coverage is below the threshold', async () => {
    // Regression: the lowercase "all files |" row of node:test used to be
    // unparseable, so the gate was skipped and this returned ok: true.
    const dir = await makeProject({ report: NODE_TEST_REPORT })
    const result = await runVerify(['--root', dir])

    assert.equal(result.ok, false)
    assert.match(result.text, /\[FAIL\] coverage 45% < threshold 80%/)
  })

  it('fails when nyc/istanbul coverage is below the threshold', async () => {
    const dir = await makeProject({ report: ISTANBUL_REPORT })
    const result = await runVerify(['--root', dir])

    assert.equal(result.ok, false)
    assert.match(result.text, /\[FAIL\] coverage 45% < threshold 80%/)
  })

  it('passes when coverage meets the threshold', async () => {
    const dir = await makeProject({ report: FULLY_COVERED_REPORT })
    const result = await runVerify(['--root', dir])

    assert.equal(result.ok, true)
    assert.match(result.text, /\[PASS\] tests passed/)
    assert.match(result.text, /\[PASS\] coverage gate/)
    assert.doesNotMatch(result.text, /\[WARN\]/)
  })

  it('warns but still passes when no coverage value can be parsed', async () => {
    const dir = await makeProject({ report: 'no coverage table here' })
    const result = await runVerify(['--root', dir])

    assert.equal(result.ok, true)
    assert.match(result.text, /\[WARN\] could not parse coverage from output; gate not enforced/)
  })

  it('honours the CLI threshold override', async () => {
    const dir = await makeProject({ report: NODE_TEST_REPORT })

    const lenient = await runVerify(['--root', dir, '--threshold', '5'])
    assert.equal(lenient.ok, true)
    assert.match(lenient.text, /\[PASS\] coverage gate/)

    const strict = await runVerify(['--root', dir, '--threshold', '90'])
    assert.equal(strict.ok, false)
    assert.match(strict.text, /\[FAIL\] coverage 45% < threshold 90%/)
  })

  it('skips the coverage gate when the config has no coverage command', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'test-script.js'), 'process.exit(0)\n')
    await writeFile(join(dir, '.polaris-verify.json'), JSON.stringify({
      testCommand: 'node test-script.js',
      coverageThreshold: 80,
    }))

    const result = await runVerify(['--root', dir])
    assert.equal(result.ok, true)
    assert.match(result.text, /\[PASS\] tests passed/)
    assert.doesNotMatch(result.text, /coverage gate/)
  })
})

describe('runVerify test command', () => {
  it('reports a failing test command and stops before coverage', async () => {
    const dir = await makeProject({ report: NODE_TEST_REPORT, testExit: 3 })
    const result = await runVerify(['--root', dir])

    assert.equal(result.ok, false)
    assert.match(result.text, /\[FAIL\] tests exited with 3/)
    // The coverage command must not run once the tests have failed.
    assert.doesNotMatch(result.text, /all files/)
  })

  it('gives up when the test command exceeds the timeout', async () => {
    const dir = await makeTempDir()
    // Leave the working directory before sleeping: on Windows the grandchild
    // node process outlives the killed shell and would otherwise keep the
    // fixture directory locked.
    await writeFile(join(dir, 'hang.js'), "process.chdir(require('node:os').tmpdir())\nsetTimeout(() => {}, 3000)\n")
    await writeFile(join(dir, '.polaris-verify.json'), JSON.stringify({
      testCommand: 'node hang.js',
      // 1000 is the smallest value the config validator accepts.
      timeoutMs: 1000,
    }))

    const result = await runVerify(['--root', dir])
    assert.equal(result.ok, false)
    assert.match(result.text, /ETIMEDOUT/)
  })
})

describe('resolveVerifyConfig', () => {
  it('returns .polaris-verify.json verbatim when present', async () => {
    const config = {
      testCommand: 'node --test',
      coverageCommand: 'node --test --experimental-test-coverage',
      coverageThreshold: 80,
      timeoutMs: 120000,
    }
    const dir = await makeTempDir()
    await writeFile(join(dir, '.polaris-verify.json'), JSON.stringify(config))

    assert.deepEqual(await resolveVerifyConfig(dir), config)
  })

  it('falls back to package.json scripts.test', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }))

    assert.deepEqual(await resolveVerifyConfig(dir), {
      testCommand: `npm test --prefix ${JSON.stringify(dir)}`,
      timeoutMs: 300000,
    })
  })

  it('falls back to node --test without any project metadata', async () => {
    const dir = await makeTempDir()
    assert.deepEqual(await resolveVerifyConfig(dir), { testCommand: 'node --test', timeoutMs: 300000 })
  })

  it('rejects an out-of-range coverageThreshold', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, '.polaris-verify.json'), JSON.stringify({ coverageThreshold: 150 }))

    await assert.rejects(() => resolveVerifyConfig(dir), /invalid \.polaris-verify\.json: coverageThreshold must be 0\.\.100/)
  })

  it('rejects a too small timeoutMs', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, '.polaris-verify.json'), JSON.stringify({ timeoutMs: 10 }))

    await assert.rejects(() => resolveVerifyConfig(dir), /timeoutMs must be >= 1000/)
  })

  it('rejects a non-string testCommand', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, '.polaris-verify.json'), JSON.stringify({ testCommand: 42 }))

    await assert.rejects(() => resolveVerifyConfig(dir), /testCommand must be a string/)
  })
})
