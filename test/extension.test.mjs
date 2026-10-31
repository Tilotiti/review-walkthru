import { test } from 'node:test'
import assert from 'node:assert/strict'

// A fake `chrome` that records tabs.create calls; the worker registers its listener on import.
const created = []
const updated = []
const unsplit = []
let windowTabs = []
let listener
globalThis.chrome = {
  runtime: { onMessage: { addListener: fn => { listener = fn } } },
  tabs: {
    create: async options => {
      created.push(options)
      if (options.url.includes('fail')) throw new Error('Tabs must be adjacent')
      return { id: 99, splitViewId: 7 }
    },
    query: async ({ windowId }) => windowTabs.filter(t => t.windowId === windowId),
    unsplit: async splitViewId => { unsplit.push(splitViewId) },
    update: async (tabId, props) => { updated.push([tabId, props]); return { id: tabId } }
  }
}
await import('../extension/worker.js')

function send (message, sender) {
  return new Promise(resolve => {
    const async = listener(message, sender, resolve)
    if (async !== true) resolve(undefined)
  })
}

const reviewTab = { id: 5, index: 2, splitViewId: -1 }

test('opens the app on the left of the review tab, in split view', async () => {
  created.length = 0
  const reply = await send({ type: 'review-walkthru:split', appUrl: 'http://localhost:8000/clients' }, { tab: reviewTab })
  assert.deepEqual(created, [{ url: 'http://localhost:8000/clients', splitWithTabId: 5, index: 2, active: false }])
  assert.deepEqual(reply, { ok: true, splitViewId: 7 })
})

test('a tab already in a split view is left alone', async () => {
  created.length = 0
  const reply = await send({ type: 'review-walkthru:split', appUrl: 'http://localhost:8000/' }, { tab: { ...reviewTab, splitViewId: 3 } })
  assert.deepEqual(created, [])
  assert.deepEqual(reply, { ok: true, already: true, splitViewId: 3 })
})

test('refuses app URLs that are not http(s)', async () => {
  created.length = 0
  for (const appUrl of ['javascript:alert(1)', 'chrome://settings', 'file:///etc/passwd', 'not a url']) {
    const reply = await send({ type: 'review-walkthru:split', appUrl }, { tab: reviewTab })
    assert.equal(reply.ok, false, appUrl)
  }
  assert.deepEqual(created, [])
})

test('reports a Chrome refusal', async () => {
  const reply = await send({ type: 'review-walkthru:split', appUrl: 'http://localhost:8000/fail' }, { tab: reviewTab })
  assert.deepEqual(reply, { ok: false, error: 'Tabs must be adjacent' })
})

test('an app link loads in the other half of the split view', async () => {
  updated.length = 0
  windowTabs = [
    { id: 4, windowId: 1, splitViewId: -1 },
    { id: 8, windowId: 1, splitViewId: 3 }, // the app
    { id: 5, windowId: 1, splitViewId: 3 } // the review page
  ]
  const tab = { id: 5, index: 2, windowId: 1, splitViewId: 3 }
  const reply = await send({ type: 'review-walkthru:navigate', url: 'http://localhost:8000/clients/42' }, { tab })
  assert.deepEqual(reply, { ok: true })
  assert.deepEqual(updated, [[8, { url: 'http://localhost:8000/clients/42', active: true }]])
})

test('an app link outside a split view, or not http(s), is refused', async () => {
  updated.length = 0
  windowTabs = [{ id: 5, windowId: 1, splitViewId: -1 }]
  const alone = { id: 5, index: 0, windowId: 1, splitViewId: -1 }
  assert.equal((await send({ type: 'review-walkthru:navigate', url: 'http://localhost:8000/' }, { tab: alone })).ok, false)
  const split = { id: 5, index: 1, windowId: 1, splitViewId: 3 }
  assert.equal((await send({ type: 'review-walkthru:navigate', url: 'javascript:alert(1)' }, { tab: split })).ok, false)
  assert.deepEqual(updated, [])
})

test('the end of the review leaves the split view, so the page gets the whole window', async () => {
  unsplit.length = 0
  const reply = await send({ type: 'review-walkthru:unsplit' }, { tab: { id: 5, index: 2, windowId: 1, splitViewId: 3 } })
  assert.deepEqual(reply, { ok: true })
  assert.deepEqual(unsplit, [3])
  const alone = await send({ type: 'review-walkthru:unsplit' }, { tab: { id: 5, index: 0, windowId: 1, splitViewId: -1 } })
  assert.deepEqual(alone, { ok: true, already: true })
  assert.deepEqual(unsplit, [3])
})

test('ignores other messages and messages without a tab', async () => {
  created.length = 0
  assert.equal(await send({ type: 'other' }, { tab: reviewTab }), undefined)
  assert.equal(await send({ type: 'review-walkthru:split', appUrl: 'http://localhost:8000/' }, {}), undefined)
  assert.deepEqual(created, [])
})
