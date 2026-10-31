// Keeps the app next to the review page, in split view, and carries messages between the two.
// The review page talks through content.js; the app tab through app.js. Pairs of tabs live in
// pairs.js, so the worker can sleep and wake up without forgetting them.
import { HOSTS, originPattern } from './hosts.js'
import { getPairs, setPair, appOf, reviewOf, forgetTab, setReady, isReady } from './pairs.js'
import { captureCrop } from './capture.js'

const httpUrl = value => {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch { return null }
}
const inSplit = tab => tab.splitViewId !== undefined && tab.splitViewId !== -1
// A host with a wildcard would ask Chrome for every site under it.
const appOrigin = value => {
  const url = httpUrl(value)
  return url && !new URL(url).hostname.includes('*') ? url : null
}
const errorText = error => String(error?.message ?? error)
const deliver = (tabId, type, message) => chrome.tabs.sendMessage(tabId, { type, message }).catch(() => {})
const toPageOf = async (appTabId, message) => {
  const review = await reviewOf(appTabId)
  if (review !== null) deliver(review, 'rw:to-page', message)
}

// Whether the extension may run its scripts in the app, so the page can ask for it.
async function coverage (appUrl) {
  const origin = new URL(appUrl).origin
  const covered = await chrome.permissions.contains({ origins: [originPattern(appUrl)] }).catch(() => false)
  return { covered, origin }
}

// ---- split view (page load, app links, end of review) ----

function split (tab, appUrl, reply) {
  const url = httpUrl(appUrl)
  if (inSplit(tab)) {
    // A reload of the review tab: find its app in the same split view.
    chrome.tabs.query({ windowId: tab.windowId })
      .then(async tabs => {
        const app = tabs.find(t => t.splitViewId === tab.splitViewId && t.id !== tab.id)
        if (app) await setPair(tab.id, app.id)
        reply({ ok: true, already: true, splitViewId: tab.splitViewId, ...(url ? await coverage(url) : {}) })
      })
      .catch(error => reply({ ok: false, error: errorText(error) }))
    return true
  }
  if (!url) return reply({ ok: false, error: 'the app URL must be http(s)' })
  // windowId: without it Chrome opens the tab in the last focused window, which may not
  // hold the review tab, and refuses the split. index: tab.index puts the app on its left.
  chrome.tabs.create({ url, splitWithTabId: tab.id, windowId: tab.windowId, index: tab.index, active: false })
    .then(async appTab => {
      await setPair(tab.id, appTab.id)
      reply({ ok: true, splitViewId: appTab.splitViewId, ...await coverage(url) })
    })
    .catch(error => reply({ ok: false, error: errorText(error) }))
  return true
}

function navigate (tab, target, reply) {
  const url = httpUrl(target)
  if (!url) return reply({ ok: false, error: 'the link must be http(s)' })
  if (!inSplit(tab)) return reply({ ok: false, error: 'the review page is not in a split view' })
  chrome.tabs.query({ windowId: tab.windowId })
    .then(tabs => {
      const app = tabs.find(t => t.splitViewId === tab.splitViewId && t.id !== tab.id)
      if (!app) return reply({ ok: false, error: 'no app tab in this split view' })
      return chrome.tabs.update(app.id, { url, active: true }).then(() => reply({ ok: true }))
    })
    .catch(error => reply({ ok: false, error: errorText(error) }))
  return true
}

// At the end of the review the page only says "Review finished": give it the whole window,
// and leave the app on its own.
function unsplit (tab, reply) {
  if (!inSplit(tab)) return reply({ ok: true, already: true })
  endReview(tab.id)
    .then(() => chrome.tabs.unsplit(tab.splitViewId))
    .then(() => reply({ ok: true }))
    .catch(error => reply({ ok: false, error: errorText(error) }))
  return true
}

// The review is over for this pair: the app drops its tools and stops forwarding its console.
async function endReview (reviewTabId) {
  const app = await appOf(reviewTabId)
  if (app !== null) deliver(app, 'rw:to-app', { type: 'unpaired' })
  await forgetTab(reviewTabId)
}

// closed: the app tab is gone, nobody to tell there.
async function endApp (appTabId, { closed = false } = {}) {
  if (await reviewOf(appTabId) === null) return
  if (!closed) deliver(appTabId, 'rw:to-app', { type: 'unpaired' })
  await toPageOf(appTabId, { type: 'app-gone' })
  lastRequest.delete(appTabId)
  await forgetTab(appTabId)
}

// ---- the app tab ----

// The app's script stays silent unless its tab is the app of a review.
async function appHello (tab, url) {
  let review = await reviewOf(tab.id)
  if (review === null && inSplit(tab)) {
    const partner = (await chrome.tabs.query({ windowId: tab.windowId })).find(t => t.splitViewId === tab.splitViewId && t.id !== tab.id)
    if (partner && (await getPairs()).some(([r]) => r === partner.id)) {
      await setPair(partner.id, tab.id)
      review = partner.id
    }
  }
  if (review === null || !await isReady(review)) return { paired: false }
  deliver(review, 'rw:to-page', { type: 'app-ready', url })
  return { paired: true }
}

async function toApp (reviewTabId, message) {
  const app = await appOf(reviewTabId)
  if (app === null) return
  if (message?.type === 'comment-mode') chrome.tabs.update(app, { active: true }).catch(() => {})
  deliver(app, 'rw:to-app', message)
}

// The last request of each app tab, for the context of a comment.
// ponytail: in memory, lost when the worker sleeps; a comment then goes without it.
const lastRequest = new Map()
const FORWARDED = new Set(['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'stylesheet'])

async function onRequest (details, error) {
  if (details.tabId < 0 || await reviewOf(details.tabId) === null) return
  if (!error && ['main_frame', 'xmlhttprequest'].includes(details.type)) {
    lastRequest.set(details.tabId, { method: details.method, url: details.url, status: details.statusCode })
  }
  const failed = error ? error !== 'net::ERR_ABORTED' : details.statusCode >= 400
  if (!failed || !FORWARDED.has(details.type)) return
  toPageOf(details.tabId, {
    type: 'request', method: details.method, url: details.url,
    status: error ? null : details.statusCode, error: error ?? null,
    resourceType: details.type, at: new Date(details.timeStamp).toISOString()
  })
}

function fromApp (appTabId, message) {
  if (message?.type === 'comment') message = { ...message, lastRequest: lastRequest.get(appTabId) ?? null }
  return toPageOf(appTabId, message)
}

async function reviewReady (reviewTabId) {
  await setReady(reviewTabId)
  const app = await appOf(reviewTabId)
  if (app !== null) deliver(app, 'rw:to-app', { type: 'ping' })
}

// The shortcut, the icon and the context menu are the gestures that let Chrome capture the tab.
async function onGesture (tab, appMessage) {
  if (!tab) return
  if (await reviewOf(tab.id) !== null) return deliver(tab.id, 'rw:to-app', appMessage)
  if (await appOf(tab.id) !== null) return deliver(tab.id, 'rw:to-page', { type: 'shortcut-in-review' })
}

async function shortcut () {
  return (await chrome.commands.getAll()).find(command => command.name === 'comment')?.shortcut ?? ''
}

// ---- hosts beyond localhost ----

function openGrant (origin) {
  if (!appOrigin(origin)) return { ok: false }
  chrome.windows.create({ url: chrome.runtime.getURL(`grant.html?origin=${encodeURIComponent(origin)}`), type: 'popup', width: 440, height: 300 })
  return { ok: true }
}

// The app scripts on a host the reviewer allowed, as the manifest declares them for localhost.
async function registerFor (patterns) {
  const known = new Set((await chrome.scripting.getRegisteredContentScripts()).map(script => script.id))
  const scripts = patterns.flatMap(pattern => [
    { id: `rw-console ${pattern}`, matches: [pattern], js: ['console.js'], runAt: 'document_start', world: 'MAIN' },
    { id: `rw-app ${pattern}`, matches: [pattern], js: ['dom.js', 'overlay.js', 'app.js'], runAt: 'document_idle' }
  ]).filter(script => !known.has(script.id))
  if (scripts.length) await chrome.scripting.registerContentScripts(scripts)
}

const grantedOrigins = async () => ((await chrome.permissions.getAll()).origins ?? []).filter(origin => origin !== '*://*/*' && !HOSTS.includes(origin))

// Called by grant.html once Chrome granted the host: run the app scripts there from now on.
async function granted (origin) {
  if (!appOrigin(origin)) return { ok: false }
  const pattern = originPattern(origin)
  if (!await chrome.permissions.contains({ origins: [pattern] })) return { ok: false }
  await registerFor([pattern])
  await buildMenus()
  for (const [review, app] of await getPairs()) {
    const tab = await chrome.tabs.get(app).catch(() => null)
    if (!tab?.url || originPattern(tab.url) !== pattern) continue
    chrome.tabs.reload(app)
    deliver(review, 'rw:to-page', { type: 'coverage', origin: new URL(tab.url).origin, covered: true })
  }
  return { ok: true }
}

async function buildMenus () {
  const documentUrlPatterns = [...HOSTS, ...await grantedOrigins()]
  await chrome.contextMenus.removeAll()
  chrome.contextMenus.create({ id: 'rw-element', title: chrome.i18n.getMessage('menuElement'), contexts: ['page', 'link', 'image'], documentUrlPatterns })
  chrome.contextMenus.create({ id: 'rw-selection', title: chrome.i18n.getMessage('menuSelection'), contexts: ['selection'], documentUrlPatterns })
}

// ---- listeners ----

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const tab = sender.tab
  if (!tab) return
  switch (message?.type) {
    case 'review-walkthru:split': return split(tab, message.appUrl, reply)
    case 'review-walkthru:navigate': return navigate(tab, message.url, reply)
    case 'review-walkthru:unsplit': return unsplit(tab, reply)
    case 'rw:review-hello':
      // ready: the page answers the extension (0.5 and later). Its app may start, after a reload too.
      ;(message.ready ? reviewReady(tab.id) : Promise.resolve())
        .then(shortcut)
        .then(key => reply({ version: chrome.runtime.getManifest().version, shortcut: key }))
      return true
    case 'rw:app-hello':
      appHello(tab, message.url).then(reply)
      return true
    case 'rw:capture':
      reviewOf(tab.id)
        .then(review => review === null ? { ok: false, error: 'not an app tab' } : captureCrop(tab.windowId, tab.id, message.rect, message.viewport, message.dpr))
        .then(reply)
      return true
    case 'rw:to-app': toApp(tab.id, message.message); return
    case 'rw:to-page': fromApp(tab.id, message.message); return
    case 'rw:grant': return reply(openGrant(message.origin))
    case 'rw:granted':
      // Only the extension's own grant page, never a web page.
      if (!sender.url?.startsWith(chrome.runtime.getURL(''))) return
      granted(message.origin).then(reply, error => reply({ ok: false, error: errorText(error) }))
      return true
  }
})

chrome.commands.onCommand.addListener((command, tab) => command === 'comment' ? onGesture(tab, { type: 'mode' }) : undefined)
chrome.action.onClicked.addListener(tab => onGesture(tab, { type: 'mode' }))
chrome.contextMenus.onClicked.addListener((info, tab) => onGesture(tab, { type: 'context', selection: info.selectionText ?? null }))

chrome.webRequest.onCompleted.addListener(details => onRequest(details, null), { urls: ['<all_urls>'] })
chrome.webRequest.onErrorOccurred.addListener(details => onRequest(details, details.error), { urls: ['<all_urls>'] })

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (change.url) await toPageOf(tabId, { type: 'navigated', url: change.url })
  if (change.splitViewId === -1) {
    // Either half left the split view: the review and its app no longer go together.
    if (await reviewOf(tabId) !== null) await endApp(tabId)
    else if (await appOf(tabId) !== null) await endReview(tabId)
  }
})
chrome.tabs.onRemoved.addListener(async tabId => {
  if (await reviewOf(tabId) !== null) return endApp(tabId, { closed: true })
  if (await appOf(tabId) !== null) return endReview(tabId)
  await forgetTab(tabId)
})

// Scripts registered for an allowed host may not survive an update: register them again.
const setUp = async () => { await buildMenus(); await registerFor((await grantedOrigins()).map(originPattern)) }
chrome.runtime.onInstalled.addListener(setUp)
chrome.runtime.onStartup.addListener(setUp)
