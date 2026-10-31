// Try it: the review page (demo/) next to the sample app, as the extension arranges them.
// The demo page tells this page about app links and sends; nothing leaves the browser.
import { appPage, resetDemo } from './demo/shim.mjs'

const DEMO_PREFIX = 'rw:fernhill/crm#128'
const demoRoot = new URL('demo/', location.href)
const app = document.getElementById('demo-app')
const review = document.getElementById('demo-review')
const received = document.getElementById('received')

addEventListener('message', event => {
  if (event.origin !== location.origin) return
  const { type, url, review: data } = event.data ?? {}
  if (type === 'review-walkthru:navigate') app.src = new URL(appPage(url), demoRoot).href
  if (type === 'review-walkthru:sent') show(data)
})

function show (data) {
  const statuses = data.steps.flatMap(step => Object.values(step.points))
  const comments = data.steps.flatMap(step => step.comments)
  const validated = statuses.filter(status => status === 'validated').length
  const left = statuses.filter(status => status === 'not_seen').length
  document.getElementById('received-summary').textContent =
    `${validated} ${validated === 1 ? 'point' : 'points'} validated, ${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}, ` +
    `${left} ${left === 1 ? 'point' : 'points'} left for the next round. Claude answers each comment in the conversation, fixes, then offers that next round.`
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
