/**
 * SLSA provenance sealing.
 *
 * The local implementation signs a candidate digest with an Ed25519 key so a
 * promoted artifact carries a tamper-evident provenance envelope. In a real
 * deployment the signing key MUST live in a trusted service (CI/OIDC, KMS, or
 * a dedicated signer); this module is the code path that service would call.
 */

import {
  createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify,
} from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { parseArgs } from './common.js'
import { digestCandidate } from './ir.js'

const KEY_ENV = 'POLARIS_SIGNING_KEY'
const DEFAULT_KEY_PATH = join(homedir(), '.polaris', 'signing-key.pem')

export function generateKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }),
  }
}

export function loadOrCreateKey(keyPath = process.env[KEY_ENV] ?? DEFAULT_KEY_PATH, { persist = false } = {}) {
  if (keyPath && existsSync(keyPath)) {
    const privateKey = createPrivateKey(readFileSync(keyPath, 'utf8'))
    const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' })
    return { privateKey, publicPem, keyPath, ephemeral: false }
  }
  const pair = generateKeyPair()
  if (persist && keyPath) {
    mkdirSync(dirname(keyPath), { recursive: true })
    writeFileSync(keyPath, pair.privatePem, { mode: 0o600 })
  }
  return {
    privateKey: createPrivateKey(pair.privatePem),
    publicPem: pair.publicPem,
    keyPath,
    ephemeral: !(persist && keyPath),
  }
}

export function sealCandidate(candidate, { keyPath, persist = false } = {}) {
  const digest = candidate.digest ?? digestCandidate(candidate)
  const key = loadOrCreateKey(keyPath, { persist })
  const statement = JSON.stringify({
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: candidate.name, digest: { sha256: digest } }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      builder: { id: 'polaris-local-sealer' },
      recipe: { type: 'polaris-arena', schemaVersion: candidate.schemaVersion ?? '1.0' },
    },
  })
  const signature = sign(null, Buffer.from(statement), key.privateKey).toString('base64')
  return { digest, statement, signature, publicPem: key.publicPem, ephemeral: key.ephemeral, keyPath }
}

export function verifySeal(envelope, publicPem) {
  return verify(null, Buffer.from(envelope.statement), createPublicKey(publicPem), Buffer.from(envelope.signature, 'base64'))
}

export function parseSealArgs(argv) {
  return parseArgs(argv, {
    defaults: { keyPath: process.env[KEY_ENV] ?? DEFAULT_KEY_PATH, persist: false },
    valueKeys: new Set(['keyPath', 'name', 'version', 'origin', 'source', 'entry', 'capabilities']),
    boolKeys: new Set(['persist']),
  })
}

export function sealFromArgs(argv) {
  const options = parseSealArgs(argv)
  const candidate = {
    schemaVersion: '1.0',
    name: options.name ?? 'unnamed',
    version: options.version ?? '0.1.0',
    origin: { type: options.origin ?? 'cli' },
    source: options.source ?? 'local',
    description: options.description ?? '',
    entry: options.entry ?? options.name,
    capabilities: String(options.capabilities ?? '').split(',').filter(Boolean),
    permissions: [],
    dependencies: [],
    tests: {},
  }
  const sealed = sealCandidate(candidate, { keyPath: options.keyPath, persist: options.persist })
  return JSON.stringify({
    digest: sealed.digest,
    signature: sealed.signature,
    publicPem: sealed.publicPem,
    statement: JSON.parse(sealed.statement),
    note: sealed.ephemeral
      ? 'ephemeral key: use a trusted signing service for production SLSA provenance'
      : `loaded or persisted key: ${sealed.keyPath}`,
  }, null, 2)
}
