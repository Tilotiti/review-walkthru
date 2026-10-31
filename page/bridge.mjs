// The page's side of its channel with the extension: window.postMessage on this page,
// answered by the extension's content script (extension/content.js).

export const PROTOCOL = 1
const FROM_PAGE = 'review-walkthru-page'
const FROM_EXTENSION = 'review-walkthru-extension'

export function createBridge (win) {
  const handlers = new Map()
  win.addEventListener('message', event => {
    if (event.source !== win || event.data?.source !== FROM_EXTENSION) return
    for (const handler of handlers.get(event.data.type) ?? []) handler(event.data)
  })
  const send = (type, payload = {}) => win.postMessage({ source: FROM_PAGE, type, ...payload }, win.location.origin)
  const on = (type, handler) => {
    if (!handlers.has(type)) handlers.set(type, new Set())
    handlers.get(type).add(handler)
    return () => handlers.get(type).delete(handler)
  }
  // The content script may load before or after this module: listen first, then ask.
  const waitForHello = timeoutMs => new Promise(resolve => {
    const off = on('hello', message => { off(); clearTimeout(timer); resolve(message) })
    const timer = setTimeout(() => { off(); resolve(null) }, timeoutMs)
    send('ping')
  })
  return { send, on, waitForHello }
}

// markedByOldExtension: <html data-rw-extension> is set but no hello came, which only an
// extension older than the protocol does.
export function gate (hello, markedByOldExtension) {
  if (hello) return hello.protocol >= PROTOCOL ? 'ok' : 'update'
  return markedByOldExtension ? 'update' : 'install'
}
