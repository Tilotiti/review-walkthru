// Runs on 127.0.0.1 pages, acts only on the review page, which marks itself with
// data-review-walkthru on <html>. Two channels with the page:
// - attributes, kept from 0.4 so an older page still works: the page writes the app URL to
//   data-rw-app-url (split view) and sets data-rw-finished (leave it); app links carry data-rw-app-link;
// - window.postMessage for the rest: hello, the app's comments and console, prefill, pins,
//   locate (a point's element) and open (load a page in the app's half).
(() => {
  const root = document.documentElement
  if (!root.hasAttribute('data-review-walkthru')) return
  root.dataset.rwExtension = '1'

  const PROTOCOL = 1
  const post = (type, payload = {}) => window.postMessage({ ...payload, source: 'review-walkthru-extension', type }, location.origin)
  const toWorker = message => chrome.runtime.sendMessage(message).catch(() => null)

  // ready: answering the page's ping tells the worker this page takes the app's comments.
  async function hello (ready = false) {
    const info = await toWorker({ type: 'rw:review-hello', ready })
    // features: what this extension does beyond the protocol, so a newer page offers only that.
    post('hello', { protocol: PROTOCOL, version: info?.version ?? '', shortcut: info?.shortcut ?? '', features: ['locate'] })
  }

  let sent = false
  const trySplit = () => {
    const appUrl = root.dataset.rwAppUrl
    if (sent || !appUrl) return
    sent = true
    chrome.runtime.sendMessage({ type: 'review-walkthru:split', appUrl })
      .then(result => {
        root.dataset.rwSplit = result?.ok ? 'ok' : 'error'
        if (!result?.ok) console.warn('[review-walkthru]', result?.error)
        if (typeof result?.covered === 'boolean') post('coverage', { origin: result.origin, covered: result.covered })
      })
      .catch(error => { root.dataset.rwSplit = 'error'; console.warn('[review-walkthru]', error) })
  }
  trySplit()
  if (!sent) new MutationObserver(trySplit).observe(root, { attributes: true, attributeFilter: ['data-rw-app-url'] })

  // The page sets data-rw-finished once the whole review is done: leave the split view.
  let left = false
  const tryUnsplit = () => {
    if (left || !root.hasAttribute('data-rw-finished')) return
    left = true
    chrome.runtime.sendMessage({ type: 'review-walkthru:unsplit' }).catch(() => {})
  }
  tryUnsplit()
  new MutationObserver(tryUnsplit).observe(root, { attributes: true, attributeFilter: ['data-rw-finished'] })

  // In split view, an app link loads in the other half instead of a new tab.
  const openApp = (url, target) => chrome.runtime.sendMessage({ type: 'review-walkthru:navigate', url })
    .then(result => { if (!result?.ok) window.open(url, target) })
    .catch(() => window.open(url, target))
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[data-rw-app-link]')
    if (!link || root.dataset.rwSplit !== 'ok' || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    openApp(link.href, link.target)
  }, true)

  // Page → app (through the worker), and the page's ping.
  const TO_APP = ['prefill', 'pins', 'comment-mode', 'locate']
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== 'review-walkthru-page') return
    const { source, type, ...payload } = event.data
    if (type === 'ping') hello(true)
    else if (type === 'grant') toWorker({ type: 'rw:grant', origin: payload.origin })
    else if (type === 'open' && typeof payload.url === 'string') openApp(payload.url, 'review-walkthru-app')
    else if (TO_APP.includes(type)) toWorker({ type: 'rw:to-app', message: { type, ...payload } })
  })

  // App → page.
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'rw:to-page' && message.message?.type) post(message.message.type, message.message)
  })

  hello() // the page may already be listening; it also pings when it starts
})()
