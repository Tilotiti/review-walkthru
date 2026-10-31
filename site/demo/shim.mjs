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

// Where an app link opens: the mock page in the app pane, or in a new tab when the pane is hidden (phones).
export function appTarget (href, demoRoot, appVisible) {
  return { href: new URL(appPage(href), demoRoot).href, newTab: !appVisible }
}

// What the site says Claude does with a sent review. A finished review goes to the push question.
export function summarizeReview (review, isFinish) {
  if (isFinish(review)) return 'Every point validated, no comment. Claude lists the commits it will push, then waits for your yes.'
  const statuses = review.steps.flatMap(step => Object.values(step.points))
  const comments = review.steps.flatMap(step => step.comments).length
  const validated = statuses.filter(status => status === 'validated').length
  const left = statuses.filter(status => status === 'not_seen').length
  const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`
  return `${n(validated, 'point')} validated, ${n(comments, 'comment')}, ${n(left, 'point')} left for the next round. ` +
    'Claude answers each comment in the conversation, fixes, then offers that next round.'
}

// The page keeps boxes and comments in localStorage under its PR prefix: clear only those.
export function resetDemo (storage, prefix) {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(key => key?.startsWith(prefix))
  for (const key of keys) storage.removeItem(key)
  return keys.length
}
