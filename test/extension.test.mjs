import { test } from 'node:test'
import assert from 'node:assert/strict'

// A fake `chrome` that records what the worker does; the worker registers its listeners on import.
const created = []
const updated = []
const unsplit = []
const sentToTabs = []
const registered = []
const windowsCreated = []
const reloaded = []
const menus = []
const session = {}
let windowTabs = []
let allowed = () => true
const tabState = {}
const on = {}
const listen = name => ({ addListener: fn => { on[name] = fn } })
globalThis.chrome = {
  runtime: {
    onMessage: listen('message'), onInstalled: listen('installed'), onStartup: listen('startup'),
    getURL: path => `chrome-extension://kjig/${path}`, getManifest: () => ({ version: '0.5.0' })
  },
  storage: { session: { get: async key => ({ [key]: structuredClone(session[key]) }), set: async values => { Object.assign(session, structuredClone(values)) } } },
  tabs: {
    create: async options => {
      created.push(options)
      if (options.url.includes('fail')) throw new Error('Tabs must be adjacent')
      return { id: 99, splitViewId: 7 }
    },
    query: async ({ windowId }) => windowTabs.filter(t => t.windowId === windowId),
    unsplit: async splitViewId => { unsplit.push(splitViewId) },
    update: async (tabId, props) => { updated.push([tabId, props]); return { id: tabId } },
    sendMessage: async (tabId, message) => { sentToTabs.push([tabId, message]) },
    get: async id => ({ id, ...tabState[id] }),
    reload: async id => { reloaded.push(id) },
    onUpdated: listen('updated'), onRemoved: listen('removed')
  },
  commands: { onCommand: listen('command'), getAll: async () => [{ name: 'comment', shortcut: '⌥⇧C' }] },
  action: { onClicked: listen('action') },
  contextMenus: { create: props => { menus.push(props) }, removeAll: async () => { menus.length = 0 }, onClicked: listen('menu') },
  webRequest: { onCompleted: listen('completed'), onErrorOccurred: listen('error') },
  permissions: { contains: async ({ origins }) => allowed(origins[0]), getAll: async () => ({ origins: ['http://localhost/*', 'http://myapp.test/*'] }) },
  scripting: {
    registerContentScripts: async scripts => { registered.push(...scripts) },
    getRegisteredContentScripts: async () => registered.map(script => ({ id: script.id }))
  },
  windows: { create: async options => { windowsCreated.push(options) } },
  i18n: { getMessage: key => key }
}
await import('../extension/worker.js')
const { appOf, setPair, forgetTab } = await import('../extension/pairs.js')
const { originPattern, HOSTS } = await import('../extension/hosts.js')
const listener = (...args) => on.message(...args)

function send (message, sender) {
  return new Promise(resolve => {
    const async = listener(message, sender, resolve)
    if (async !== true) resolve(undefined)
  })
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const sent = () => sentToTabs.splice(0)

const reviewTab = { id: 5, index: 2, windowId: 1, splitViewId: -1 }

test('opens the app on the left of the review tab, in its window, in split view', async () => {
  created.length = 0
  const reply = await send({ type: 'review-walkthru:split', appUrl: 'http://localhost:8000/clients' }, { tab: reviewTab })
  assert.deepEqual(created, [{ url: 'http://localhost:8000/clients', splitWithTabId: 5, windowId: 1, index: 2, active: false }])
  assert.deepEqual(reply, { ok: true, splitViewId: 7, covered: true, origin: 'http://localhost:8000' })
  assert.equal(await appOf(5), 99)
})

test('a tab already in a split view is left alone', async () => {
  created.length = 0
  const reply = await send({ type: 'review-walkthru:split', appUrl: 'http://localhost:8000/' }, { tab: { ...reviewTab, splitViewId: 3 } })
  assert.deepEqual(created, [])
  assert.deepEqual(reply, { ok: true, already: true, splitViewId: 3, covered: true, origin: 'http://localhost:8000' })
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

test('split reports an app host the extension may not run on yet', async () => {
  allowed = origin => origin !== 'http://myapp.test/*'
  const reply = await send({ type: 'review-walkthru:split', appUrl: 'http://myapp.test:8000/clients' }, { tab: { id: 6, index: 0, windowId: 1, splitViewId: -1 } })
  allowed = () => true
  assert.equal(reply.covered, false)
  assert.equal(reply.origin, 'http://myapp.test:8000')
})

test('a reloaded review tab finds its app by split view', async () => {
  windowTabs = [{ id: 8, windowId: 1, splitViewId: 3 }, { id: 5, windowId: 1, splitViewId: 3 }]
  await send({ type: 'review-walkthru:split', appUrl: 'http://localhost:8000/' }, { tab: { id: 5, index: 1, windowId: 1, splitViewId: 3 } })
  assert.equal(await appOf(5), 8)
})

test('the review page gets the version and the real shortcut', async () => {
  assert.deepEqual(await send({ type: 'rw:review-hello' }, { tab: { id: 5 } }), { version: '0.5.0', shortcut: '⌥⇧C' })
})

test('app-hello pairs only the app of a review', async () => {
  await setPair(5, 99); sent()
  assert.deepEqual(await send({ type: 'rw:app-hello', url: 'http://localhost:8000/clients' }, { tab: { id: 99, windowId: 1, splitViewId: 7 } }), { paired: true })
  await settle()
  assert.deepEqual(sent(), [[5, { type: 'rw:to-page', message: { type: 'app-ready', url: 'http://localhost:8000/clients' } }]])
  assert.deepEqual(await send({ type: 'rw:app-hello', url: 'http://localhost:3000/' }, { tab: { id: 42, windowId: 1, splitViewId: -1 } }), { paired: false })
  await settle()
  assert.deepEqual(sent(), [])
})

test('messages are routed both ways, and nowhere for a stranger tab', async () => {
  await setPair(5, 99); sent()
  send({ type: 'rw:to-app', message: { type: 'pins', items: [] } }, { tab: { id: 5 } })
  send({ type: 'rw:to-page', message: { type: 'log', level: 'error', text: 'x', url: 'u', at: 'a' } }, { tab: { id: 99 } })
  send({ type: 'rw:to-page', message: { type: 'log', level: 'error', text: 'x', url: 'u', at: 'a' } }, { tab: { id: 42 } })
  send({ type: 'rw:to-app', message: { type: 'pins', items: [] } }, { tab: { id: 42 } })
  await settle()
  assert.deepEqual(sent(), [
    [99, { type: 'rw:to-app', message: { type: 'pins', items: [] } }],
    [5, { type: 'rw:to-page', message: { type: 'log', level: 'error', text: 'x', url: 'u', at: 'a' } }]
  ])
})

test('comment mode from the review focuses the app half', async () => {
  await setPair(5, 99); updated.length = 0
  send({ type: 'rw:to-app', message: { type: 'comment-mode' } }, { tab: { id: 5 } })
  await settle()
  assert.deepEqual(updated, [[99, { active: true }]])
  sent()
})

test("a comment gets the app tab's last request", async () => {
  await setPair(5, 99); sent()
  await on.completed({ tabId: 99, method: 'GET', url: 'http://localhost:8000/clients', statusCode: 200, type: 'xmlhttprequest', timeStamp: 0 })
  await on.completed({ tabId: 99, method: 'GET', url: 'http://localhost:8000/logo.png', statusCode: 200, type: 'image', timeStamp: 0 })
  send({ type: 'rw:to-page', message: { type: 'comment', kind: 'zone', text: 'x' } }, { tab: { id: 99 } })
  await settle()
  assert.deepEqual(sent()[0][1].message.lastRequest, { method: 'GET', url: 'http://localhost:8000/clients', status: 200 })
})

test('failed requests of the app tab are forwarded', async () => {
  await setPair(5, 99); sent()
  await on.completed({ tabId: 99, method: 'POST', url: 'http://localhost:8000/clients', statusCode: 500, type: 'main_frame', timeStamp: Date.parse('2026-10-31T14:00:00Z') })
  await on.error({ tabId: 99, method: 'GET', url: 'http://localhost:8000/x', error: 'net::ERR_ABORTED', type: 'xmlhttprequest', timeStamp: 0 })
  await on.completed({ tabId: 99, method: 'GET', url: 'http://localhost:8000/missing.png', statusCode: 404, type: 'image', timeStamp: 0 })
  await on.completed({ tabId: 42, method: 'GET', url: 'http://localhost:3000/', statusCode: 500, type: 'main_frame', timeStamp: 0 })
  await on.error({ tabId: 99, method: 'GET', url: 'http://localhost:8000/api', error: 'net::ERR_CONNECTION_REFUSED', type: 'xmlhttprequest', timeStamp: 0 })
  await settle()
  assert.deepEqual(sent().map(([tab, m]) => [tab, m.message]), [
    [5, { type: 'request', method: 'POST', url: 'http://localhost:8000/clients', status: 500, error: null, resourceType: 'main_frame', at: '2026-10-31T14:00:00.000Z' }],
    [5, { type: 'request', method: 'GET', url: 'http://localhost:8000/api', status: null, error: 'net::ERR_CONNECTION_REFUSED', resourceType: 'xmlhttprequest', at: '1970-01-01T00:00:00.000Z' }]
  ])
})

test('the shortcut and the icon toggle comment mode in the app, and warn in the review', async () => {
  await setPair(5, 99); sent()
  for (const gesture of [tab => on.command('comment', tab), tab => on.action(tab)]) {
    await gesture({ id: 99 }); await gesture({ id: 5 }); await gesture({ id: 42 })
    await settle()
    assert.deepEqual(sent(), [
      [99, { type: 'rw:to-app', message: { type: 'mode' } }],
      [5, { type: 'rw:to-page', message: { type: 'shortcut-in-review' } }]
    ])
  }
})

test('the context menu opens a comment in the app only', async () => {
  await setPair(5, 99); sent()
  await on.menu({ menuItemId: 'rw-selection', selectionText: 'Créer' }, { id: 99 })
  await on.menu({ menuItemId: 'rw-element' }, { id: 99 })
  await on.menu({ menuItemId: 'rw-element' }, { id: 42 })
  await settle()
  assert.deepEqual(sent(), [
    [99, { type: 'rw:to-app', message: { type: 'context', selection: 'Créer' } }],
    [99, { type: 'rw:to-app', message: { type: 'context', selection: null } }]
  ])
})

test('menus show on the app hosts and on granted ones only', async () => {
  await on.installed()
  await settle()
  assert.deepEqual(menus.map(m => m.id), ['rw-element', 'rw-selection'])
  for (const m of menus) {
    assert.ok(m.documentUrlPatterns.includes('http://*.localhost/*'))
    assert.ok(m.documentUrlPatterns.includes('http://myapp.test/*'))
    assert.ok(!m.documentUrlPatterns.includes('*://*/*'))
  }
})

test('app URL changes reach the review, and a closed app unpairs', async () => {
  await setPair(5, 99); sent()
  await on.updated(99, { url: 'http://localhost:8000/clients/new' })
  await on.updated(99, { status: 'complete' })
  await on.removed(99)
  await settle()
  assert.deepEqual(sent(), [
    [5, { type: 'rw:to-page', message: { type: 'navigated', url: 'http://localhost:8000/clients/new' } }],
    [5, { type: 'rw:to-page', message: { type: 'app-gone' } }]
  ])
  assert.equal(await appOf(5), null)
})

test('a grant opens the extension page, which registers the scripts for that host', async () => {
  windowsCreated.length = 0
  await send({ type: 'rw:grant', origin: 'http://myapp.test:8000' }, { tab: { id: 5 } })
  await send({ type: 'rw:grant', origin: 'javascript:alert(1)' }, { tab: { id: 5 } })
  assert.equal(windowsCreated.length, 1)
  assert.equal(windowsCreated[0].url, 'chrome-extension://kjig/grant.html?origin=http%3A%2F%2Fmyapp.test%3A8000')
  assert.equal(windowsCreated[0].type, 'popup')

  await send({ type: 'rw:granted', origin: 'http://myapp.test:8000' }, { tab: { id: 77 }, url: 'http://evil.localhost/' })
  assert.equal(registered.length, 0)
  await setPair(5, 99); tabState[99] = { url: 'http://myapp.test:8000/clients' }; sent()
  assert.deepEqual(await send({ type: 'rw:granted', origin: 'http://myapp.test:8000' }, { tab: { id: 77 }, url: 'chrome-extension://kjig/grant.html?origin=x' }), { ok: true })
  assert.deepEqual(registered.map(script => [script.matches, script.world ?? 'ISOLATED', script.runAt]), [
    [['http://myapp.test/*'], 'MAIN', 'document_start'],
    [['http://myapp.test/*'], 'ISOLATED', 'document_idle']
  ])
  assert.deepEqual(reloaded, [99])
  await settle()
  assert.deepEqual(sent(), [[5, { type: 'rw:to-page', message: { type: 'coverage', origin: 'http://myapp.test:8000', covered: true } }]])
  await send({ type: 'rw:granted', origin: 'http://myapp.test:8000' }, { tab: { id: 77 }, url: 'chrome-extension://kjig/grant.html' })
  assert.equal(registered.length, 2) // already registered: not twice
  await forgetTab(99)
})

test('originPattern drops the port and keeps the scheme; the default hosts cover localhost', () => {
  assert.equal(originPattern('http://myapp.test:8000'), 'http://myapp.test/*')
  assert.equal(originPattern('https://shop.localhost/x?y'), 'https://shop.localhost/*')
  assert.equal(HOSTS.length, 6)
})
