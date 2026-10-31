// Runs the real review page (app.mjs, copied here by scripts/build-site.mjs) against the demo relay.
// Inside the site's Try it section it tells the parent page about app links and sends.
import { createDemoFetch, appPage } from './shim.mjs'
import { isFinish } from './review.mjs'

const round = new URLSearchParams(location.search).get('round') === '2' ? 2 : 1
const load = file => fetch(file).then(res => res.json())
const [scenario, credentials, first] = await Promise.all([
  load(`scenario-${round}.json`), load('credentials.json'), round === 2 ? load('scenario-1.json') : null
])
// As the relay does: a skipped step comes from the earlier round that contained it.
const skippedSteps = (scenario.skipped ?? []).map(({ stepId }) => first.steps.find(step => step.id === stepId))

const embedded = parent !== window
const tell = message => { if (embedded) parent.postMessage(message, location.origin) }

window.fetch = createDemoFetch({ round, scenario, credentials, skippedSteps, submitted: false }, {
  onSend: review => tell({ type: 'review-walkthru:sent', review }),
  realFetch: window.fetch.bind(window),
  isFinish
})

// The demo content is English: keep the page in English whatever the visitor's browser says.
Object.defineProperty(navigator, 'languages', { get: () => ['en'] })
// Act as the extension does: the page refuses to run until the extension answers its ping.
document.documentElement.dataset.rwExtension = '1'
window.addEventListener('message', event => {
  if (event.source !== window || event.data?.source !== 'review-walkthru-page' || event.data.type !== 'ping') return
  window.postMessage({ source: 'review-walkthru-extension', type: 'hello', protocol: 1, version: 'demo', shortcut: '' }, location.origin)
})

// App links point at localhost:8000: show the matching mock page instead.
document.addEventListener('click', event => {
  const link = event.target.closest?.('a[data-rw-app-link]')
  if (!link) return
  event.preventDefault()
  if (embedded) tell({ type: 'review-walkthru:navigate', url: link.href })
  else window.open(new URL(appPage(link.href), location.href), '_blank', 'noopener')
}, true)

await import('./app.mjs')
