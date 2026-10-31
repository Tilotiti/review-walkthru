// Puts the review page in a known state before it loads, with the page's own state functions:
// no simulated clicks, so no focus and no scrolling during a capture.
import { initialState, togglePoint, addComment, addAppComment, setCapture, addLog, addRequest } from '/demo/review.mjs'

export const COMMENT = 'Archived clients should be hidden by default, with a toggle to show them.'
// The status filter of the demo app, as the extension describes it (extension/dom.js).
export const TARGET = { selector: '#status', unique: true, tag: 'span', role: null, text: 'Status: All ▾' }
// Cut from the app by the "capture" job of capture.mjs, as the extension cuts it.
export const CAPTURE = '/img/capture-status.png'

// state: fresh (nothing done); typing (a point validated, the app's console errors in, a comment
// being written on the app); app (that comment added); point (a point validated and the same comment
// made on the Status filter point, no console).
export async function seedReview (round, state) {
  for (const key of Object.keys(localStorage)) localStorage.removeItem(key)
  if (state === 'fresh' || round !== 1) return
  const scenario = await (await fetch('/demo/scenario-1.json')).json()
  const app = 'http://localhost:8000/clients'
  const at = '2026-10-31T09:42:07.000Z'
  let s = initialState(1, scenario.steps)
  s = togglePoint(s, 'clients-list', 'sort')
  if (state === 'point') s = addComment(s, 'clients-list', { kind: 'point', id: 'filter' }, COMMENT)
  else {
    s = addLog(s, 'clients-list', { level: 'error', text: "Uncaught TypeError: Cannot read properties of null (reading 'archivedAt')", url: app, at })
    s = addRequest(s, 'clients-list', { method: 'GET', url: `${app}/stats?status=archived`, status: 500, error: null, type: 'fetch', at })
  }
  if (state === 'app') {
    s = addAppComment(s, 'clients-list', { kind: 'element', url: app, element: TARGET, rect: { x: 600, y: 72, width: 124, height: 36 } }, COMMENT)
    s = setCapture(s, 'clients-list', s.entries['clients-list'].comments.at(-1).id, CAPTURE)
  }
  localStorage.setItem(`rw:${scenario.pr.repo}#${scenario.pr.number}:r1`, JSON.stringify(s))
}

// Resolves once the page in `frame` has rendered its points and its 1.5 s re-render is behind it.
export async function settled (frame) {
  await new Promise(resolve => frame.addEventListener('load', resolve, { once: true }))
  for (let i = 0; i < 60 && !frame.contentDocument.querySelector('.pt'); i++) await new Promise(resolve => setTimeout(resolve, 100))
  await new Promise(resolve => setTimeout(resolve, 1700))
  return frame.contentDocument
}

// What the extension does in the split view: the page hears that the app half runs its script
// (so it offers "Comment in the app"), and the app gets the extension's own overlay.
export function appReady (review) {
  const win = review.contentWindow
  win.dispatchEvent(new win.MessageEvent('message', { source: win, data: { source: 'review-walkthru-extension', type: 'app-ready' } }))
}

export async function overlay (app) {
  const win = app.contentWindow
  const messages = await (await fetch('/_extension/_locales/en/messages.json')).json()
  // The overlay's own strings take no placeholder.
  win.chrome = { i18n: { getMessage: key => messages[key].message } }
  // Open, so a composition can type in the bubble; the extension's own root is closed.
  const attach = win.Element.prototype.attachShadow
  win.Element.prototype.attachShadow = function (init) { return attach.call(this, { ...init, mode: 'open' }) }
  const script = win.document.createElement('script')
  script.src = '/_extension/overlay.js'
  await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; win.document.head.append(script) })
  return win.RW_OVERLAY
}
