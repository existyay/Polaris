/**
 * polaris-retrieve: deterministic code symbol + documentation hybrid retrieval.
 * No embeddings, no ranking model: regex symbol extraction plus doc-string
 * capture and keyword-in-markdown retrieval.
 */

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { parseArgs, walkDirectory } from './common.js'

const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.c', '.h', '.cpp', '.hpp', '.java', '.go', '.rs'])
const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt'])

const SYMBOL_RES = [
  { ext: ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'], re: /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/ },
  { ext: ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'], re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/ },
  { ext: ['.py'], re: /^\s*(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/ },
  { ext: ['.c', '.h', '.cpp', '.hpp', '.java', '.go', '.rs'], re: /^\s*(?:[\w:<>,*&\s]+?)\s+([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?\{?/ },
]

function captureDoc(lines, index) {
  const buf = []
  for (let i = Math.max(0, index - 6); i < index; i += 1) {
    const line = lines[i]
    if (line.includes('/**') || line.includes('"""') || line.includes("'''") || /^\s*[#*]\s*/.test(line) || /^\s*\/\//.test(line)) {
      buf.push(line.trim())
    }
  }
  return buf.slice(-4).join(' ')
}

async function scanFile(path, query) {
  const text = await readFile(path, 'utf8')
  if (Buffer.byteLength(text) > 300_000) return []
  const lines = text.split(/\r?\n/)
  const ext = extname(path)
  const hits = []
  for (let i = 0; i < lines.length; i += 1) {
    for (const rule of SYMBOL_RES) {
      if (!rule.ext.includes(ext)) continue
      const match = rule.re.exec(lines[i])
      if (match === null) continue
      const name = match[1]
      if (query && !name.toLowerCase().includes(query.toLowerCase())) continue
      hits.push({ kind: 'symbol', name, file: path, line: i + 1, signature: lines[i].trim().slice(0, 180), doc: captureDoc(lines, i).slice(0, 240) })
      break
    }
  }
  return hits.slice(0, 80)
}

async function scanDoc(path, terms) {
  const text = await readFile(path, 'utf8')
  if (Buffer.byteLength(text) > 300_000) return []
  const lower = text.toLowerCase()
  if (terms.length > 0 && !terms.some(term => lower.includes(term))) return []
  const snippets = []
  const paragraphs = text.split(/\n\s*\n/)
  for (const paragraph of paragraphs) {
    if (terms.length > 0 && !terms.some(term => paragraph.toLowerCase().includes(term))) continue
    snippets.push(paragraph.replace(/\s+/g, ' ').trim().slice(0, 240))
    if (snippets.length >= 6) break
  }
  return [{ kind: 'doc', name: path, file: path, line: 0, signature: '', doc: snippets.join(' | ') }]
}

export async function runRetrieve(argv) {
  const options = parseArgs(argv, {
    defaults: { root: process.cwd(), query: '', top: '40', maxFiles: '400' },
    valueKeys: new Set(['root', 'query', 'top', 'maxFiles']),
  })
  const query = options.query || options.arg || ''
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean)
  const hits = []
  await walkDirectory(options.root, async (path) => {
    const ext = extname(path)
    if (CODE_EXTENSIONS.has(ext)) {
      hits.push(...await scanFile(path, query))
    } else if (DOC_EXTENSIONS.has(ext)) {
      hits.push(...await scanDoc(path, terms))
    }
  }, { maxFiles: Number(options.maxFiles) })
  hits.sort((a, b) => a.line - b.line).sort((a, b) => a.kind.localeCompare(b.kind))
  const top = hits.slice(0, Number(options.top))
  if (top.length === 0) return 'No symbol or documentation match found.'
  return top.map(hit => {
    if (hit.kind === 'symbol') {
      return `[symbol] ${hit.name}  ${hit.file}:${hit.line}\n  ${hit.signature}${hit.doc ? `\n  doc: ${hit.doc}` : ''}`
    }
    return `[doc] ${hit.file}\n  ${hit.doc}`
  }).join('\n')
}
