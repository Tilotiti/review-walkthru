// Try it: the review page (demo/) next to the sample app, as the extension arranges them.
// The demo page tells this page about app links and sends; nothing leaves the browser.
import { appTarget, resetDemo, summarizeReview } from './demo/shim.mjs'
import { isFinish } from './demo/review.mjs'

const DEMO_PREFIX = 'rw:fernhill/crm#128'
const demoRoot = new URL('demo/', location.href)
const app = document.getElementById('demo-app')
const review = document.getElementById('demo-review')
const received = document.getElementById('received')

addEventListener('message', event => {
  if (event.origin !== location.origin) return
  const { type, url, review: data } = event.data ?? {}
  if (type === 'review-walkthru:navigate') {
    const target = appTarget(url, demoRoot, getComputedStyle(app).display !== 'none')
    if (target.newTab) open(target.href, '_blank', 'noopener')
    else app.src = target.href
  }
  if (type === 'review-walkthru:sent') show(data)
})

function show (data) {
  document.getElementById('received-summary').textContent = summarizeReview(data, isFinish)
  const comments = data.steps.flatMap(step => step.comments)
  document.getElementById('received-comments').replaceChildren(...comments.map(comment => {
    const item = document.createElement('li')
    item.textContent = comment.text
    return item
  }))
  document.getElementById('received-json').textContent = JSON.stringify(data, null, 2)
  received.hidden = false
}

document.getElementById('demo-reset').addEventListener('click', () => {
  resetDemo(localStorage, DEMO_PREFIX)
  received.hidden = true
  app.src = new URL('app/clients/', demoRoot).href
  review.src = demoRoot.href
})
