import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { storeManifest } from '../scripts/pack-extension.mjs'

const json = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))
const manifest = json('extension/manifest.json')

test('the Store package leaves out the development key, and nothing else', () => {
  const store = storeManifest(manifest)
  assert.equal('key' in store, false)
  assert.deepEqual({ ...store, key: manifest.key }, manifest)
  assert.ok(manifest.key, 'the unpacked extension keeps the Store ID through its key')
})

test('plugin and extension are 0.5.0', () => {
  assert.equal(manifest.version, '0.5.0')
  assert.equal(json('.claude-plugin/plugin.json').version, '0.5.0')
})

// Each permission is one the Store review has to accept: no more than these.
test('the extension asks for these permissions only', () => {
  assert.deepEqual(manifest.permissions, ['activeTab', 'contextMenus', 'webRequest', 'storage', 'scripting'])
  assert.deepEqual(manifest.host_permissions, ['http://localhost/*', 'https://localhost/*', 'http://*.localhost/*', 'https://*.localhost/*', 'http://127.0.0.1/*', 'https://127.0.0.1/*'])
  assert.deepEqual(manifest.optional_host_permissions, ['*://*/*'])
  assert.equal(manifest.commands.comment.suggested_key.default, 'Alt+Shift+C')
})

test('the extension texts never name Claude', () => {
  for (const lang of ['en', 'fr']) assert.doesNotMatch(readFileSync(new URL(`../extension/_locales/${lang}/messages.json`, import.meta.url), 'utf8'), /claude/i)
})
