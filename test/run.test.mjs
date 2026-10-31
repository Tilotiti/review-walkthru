import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { startUrl, chromeCommand, findOnPath } from '../scripts/run.mjs'
import { r1, r2 } from './helpers.mjs'

test('startUrl', () => {
  assert.equal(startUrl(r1), 'http://localhost:8000/clients')
  assert.equal(startUrl(r2), 'http://localhost:8000/clients/42') // start wins over path
})

test('startUrl is shared with the page', async () => {
  const page = await import('../page/review.mjs')
  assert.equal(page.startUrl, startUrl)
})

test('chromeCommand', () => {
  const urls = ['http://localhost:8000/clients', 'http://127.0.0.1:5000/t/']
  assert.deepEqual(chromeCommand('darwin', urls), { cmd: 'open', args: ['-na', 'Google Chrome', '--args', '--new-window', ...urls] })
  assert.deepEqual(chromeCommand('linux', urls, () => '/usr/bin/google-chrome'), { cmd: '/usr/bin/google-chrome', args: ['--new-window', ...urls] })
  assert.throws(() => chromeCommand('linux', urls, () => null), /Chrome/)
  assert.throws(() => chromeCommand('win32', urls), /MVP 2/)
})

test('findOnPath returns the first match in PATH order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rw-path-'))
  const a = join(root, 'a'); const b = join(root, 'b')
  await mkdir(a); await mkdir(b)
  await writeFile(join(b, 'chromium'), '')
  assert.equal(findOnPath(['google-chrome', 'chromium'], [a, b].join(delimiter)), join(b, 'chromium'))
  assert.equal(findOnPath(['nope'], [a, b].join(delimiter)), null)
})
