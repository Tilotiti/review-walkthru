// The demo's stand-in for the local relay: the real review page (app.mjs) runs unchanged on top of it.

// A fetch that answers the page's two relay calls and passes everything else through.
// isFinish comes from the page's own review.mjs, so the demo answers exactly like the relay.
export function createDemoFetch (payload, { onSend, realFetch, isFinish }) {
  let submitted = payload.submitted
  const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  return async (input, init = {}) => {
    const url = String(input?.url ?? input)
    if (url.endsWith('api/round')) return json({ ...payload, submitted })
    if (url.endsWith('api/review') && init.method === 'POST') {
      const review = JSON.parse(init.body)
      submitted = true
      onSend(review)
      return json({ ok: true, finish: isFinish(review) })
    }
    return realFetch(input, init)
  }
}

// The review page links to the app on localhost:8000; the demo shows the matching mock page.
export function appPage (href) {
  const path = new URL(href).pathname.replace(/\/+$/, '')
  return `app${path || '/clients'}/`
}

// The page keeps boxes and comments in localStorage under its PR prefix: clear only those.
export function resetDemo (storage, prefix) {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(key => key?.startsWith(prefix))
  for (const key of keys) storage.removeItem(key)
  return keys.length
}
