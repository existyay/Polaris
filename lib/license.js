/**
 * polaris-license: license compliance query for a project and its installed
 * direct dependencies. Stateless and bounded: reads local manifests only.
 */

import { join } from 'node:path'
import { exists, parseArgs, readJson } from './common.js'

const PERMISSIVE = new Set([
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD',
  'Unlicense', 'CC0-1.0', 'WTFPL', 'Zlib', 'Python-2.0', 'BlueOak-1.0.0',
])

export function classify(license) {
  if (license === undefined || license === null || license === '') return { id: 'UNKNOWN', permissive: false }
  if (typeof license === 'string') {
    const id = license.trim().toUpperCase()
    return { id, permissive: PERMISSIVE.has(id) }
  }
  if (Array.isArray(license)) {
    return license.map(classify).reduce((acc, item) => ({
      id: acc.id === 'UNKNOWN' ? item.id : `${acc.id} AND ${item.id}`,
      permissive: acc.permissive && item.permissive,
    }), { id: 'UNKNOWN', permissive: true })
  }
  if (typeof license === 'object') {
    const type = license.type ?? 'UNKNOWN'
    const id = String(type).toUpperCase()
    return { id, permissive: PERMISSIVE.has(id) }
  }
  return { id: String(license).toUpperCase(), permissive: false }
}

export async function readProjectLicenses(root) {
  const rows = []
  let pkg
  try {
    pkg = await readJson(join(root, 'package.json'))
  } catch {
    return { rows: [{ name: '(no package.json)', license: { id: 'UNKNOWN', permissive: false }, direct: true }], rootLicense: undefined }
  }
  const rootLicense = classify(pkg.license)
  rows.push({ name: pkg.name ?? '(project root)', license: rootLicense, direct: true })
  const dependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
  for (const name of Object.keys(dependencies).sort()) {
    const manifestPath = join(root, 'node_modules', name, 'package.json')
    if (await exists(manifestPath)) {
      try {
        const depPkg = await readJson(manifestPath)
        rows.push({ name, license: classify(depPkg.license), direct: true })
      } catch {
        rows.push({ name, license: { id: 'UNKNOWN', permissive: false }, direct: true })
      }
    } else {
      rows.push({ name, license: { id: 'NOT-INSTALLED', permissive: true }, direct: true })
    }
  }
  return { rows, rootLicense }
}

export function formatLicenses(rows, { failOnNonpermissive = false } = {}) {
  const lines = []
  let nonpermissive = 0
  for (const row of rows) {
    const mark = row.license.permissive ? 'OK ' : '!! '
    if (!row.license.permissive && row.license.id !== 'NOT-INSTALLED') nonpermissive += 1
    lines.push(`${mark}${row.name}\t${row.license.id}`)
  }
  lines.push('')
  if (failOnNonpermissive && nonpermissive > 0) {
    lines.push(`[FAIL] ${nonpermissive} package(s) use non-permissive or unknown licenses`)
  } else if (nonpermissive > 0) {
    lines.push(`[WARN] ${nonpermissive} package(s) use non-permissive or unknown licenses`)
  } else {
    lines.push('[PASS] all detected licenses are permissive')
  }
  return lines.join('\n')
}

export async function runLicense(argv) {
  const options = parseArgs(argv, {
    defaults: { root: process.cwd(), 'fail-on': false },
    valueKeys: new Set(['root']),
    boolKeys: new Set(['fail-on']),
  })
  const { rows } = await readProjectLicenses(options.root)
  return formatLicenses(rows, { failOnNonpermissive: options['fail-on'] })
}
