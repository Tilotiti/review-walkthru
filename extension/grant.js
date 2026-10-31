// Asks Chrome for the app's host, from a click on an extension page: Chrome accepts
// permissions.request only there. The worker then runs the app scripts on that host.
import { originPattern } from './hosts.js'

const origin = new URLSearchParams(location.search).get('origin') ?? ''
const text = (id, key, ...args) => { document.getElementById(id).textContent = chrome.i18n.getMessage(key, args) }
text('title', 'grantTitle')
text('body', 'grantBody', origin)
text('allow', 'grantButton')

document.getElementById('allow').addEventListener('click', async () => {
  // Never a wildcard host: it would cover every site under it.
  const ok = !origin.includes('*') && await chrome.permissions.request({ origins: [originPattern(origin)] }).catch(() => false)
  if (!ok) return text('body', 'grantRefused')
  await chrome.runtime.sendMessage({ type: 'rw:granted', origin })
  text('body', 'grantDone')
  setTimeout(() => window.close(), 1200)
})
