// Runs in the app's own world from the first byte: keeps its console errors and warnings,
// and its uncaught errors, and hands them to app.js through DOM events. Until app.js says the
// tab is the app of a review, it only keeps the last hundred.
(() => {
  const MAX_BUFFER = 100
  const buffer = []
  let live = false

  const textOf = part => {
    if (part instanceof Error) return part.stack || String(part)
    if (typeof part === 'string') return part
    try { return JSON.stringify(part) } catch { return String(part) }
  }
  const emit = entry => document.dispatchEvent(new CustomEvent('review-walkthru:console', { detail: JSON.stringify(entry) }))
  const record = (level, parts) => {
    const entry = { level, text: parts.map(textOf).join(' ').slice(0, 2000), at: new Date().toISOString() }
    if (live) return emit(entry)
    buffer.push(entry)
    if (buffer.length > MAX_BUFFER) buffer.shift()
  }

  for (const [method, level] of [['error', 'error'], ['warn', 'warning']]) {
    const original = console[method]
    console[method] = function (...args) {
      original.apply(this, args)
      try { record(level, args) } catch {}
    }
  }
  addEventListener('error', event => record('error', [event.error ?? event.message]))
  addEventListener('unhandledrejection', event => record('error', ['Unhandled rejection:', event.reason]))

  document.addEventListener('review-walkthru:console-ready', () => {
    if (live) return
    live = true
    for (const entry of buffer.splice(0)) emit(entry)
  })
})()
