import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBridge, gate, PROTOCOL } from '../page/bridge.mjs'

// A window whose postMessage delivers to its own listeners, like the review page's.
function fakeWindow () {
  const listeners = new Set()
  const win = {
    location: { origin: 'http://127.0.0.1:5000' },
    posted: [],
    addEventListener: (type, fn) => { if (type === 'message') listeners.add(fn) },
    removeEventListener: (type, fn) => listeners.delete(fn),
    postMessage: data => { win.posted.push(data); for (const fn of [...listeners]) fn({ source: win, data }) },
    deliver: (data, source = win) => { for (const fn of [...listeners]) fn({ source, data }) }
  }
  return win
}
const fromExtension = (type, payload = {}) => ({ source: 'review-walkthru-extension', type, ...payload })

test('waitForHello resolves with the hello the extension posts after a ping', async () => {
  const win = fakeWindow()
  const bridge = createBridge(win)
  const waiting = bridge.waitForHello(1000)
  assert.deepEqual(win.posted, [{ source: 'review-walkthru-page', type: 'ping' }])
  win.deliver(fromExtension('hello', { protocol: PROTOCOL, version: '0.5.0', shortcut: '⌥⇧C' }))
  assert.deepEqual(await waiting, fromExtension('hello', { protocol: PROTOCOL, version: '0.5.0', shortcut: '⌥⇧C' }))
})

test('waitForHello resolves null after the timeout', async () => {
  assert.equal(await createBridge(fakeWindow()).waitForHello(20), null)
})

test('messages from another window or another source are ignored', async () => {
  const win = fakeWindow()
  const bridge = createBridge(win)
  const seen = []
  bridge.on('navigated', message => seen.push(message.url))
  win.deliver(fromExtension('navigated', { url: 'a' }), {}) // another window
  win.deliver({ source: 'someone-else', type: 'navigated', url: 'b' })
  win.deliver(fromExtension('navigated', { url: 'c' }))
  assert.deepEqual(seen, ['c'])
  bridge.send('pins', { items: [] })
  assert.deepEqual(win.posted.at(-1), { source: 'review-walkthru-page', type: 'pins', items: [] })
})

test('gate', () => {
  assert.equal(gate(null, false), 'install')
  assert.equal(gate(null, true), 'update') // an extension from before the hello marks the page only
  assert.equal(gate({ protocol: 0 }, true), 'update')
  assert.equal(gate({ protocol: PROTOCOL }, false), 'ok')
})
