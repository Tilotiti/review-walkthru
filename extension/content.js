// Runs on 127.0.0.1 pages, acts only on the review page. The page marks
// itself with data-review-walkthru on <html>, then writes the app URL to data-rw-app-url.
(() => {
  const root = document.documentElement
  if (!root.hasAttribute('data-review-walkthru')) return
  root.dataset.rwExtension = '1' // tells the page not to offer its manual fallback

  let sent = false
  const trySplit = () => {
    const appUrl = root.dataset.rwAppUrl
    if (sent || !appUrl) return
    sent = true
    chrome.runtime.sendMessage({ type: 'review-walkthru:split', appUrl })
      .then(result => { root.dataset.rwSplit = result?.ok ? 'ok' : 'error'; if (!result?.ok) console.warn('[review-walkthru]', result?.error) })
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
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[data-rw-app-link]')
    if (!link || root.dataset.rwSplit !== 'ok' || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    chrome.runtime.sendMessage({ type: 'review-walkthru:navigate', url: link.href })
      .then(result => { if (!result?.ok) window.open(link.href, link.target) })
      .catch(() => window.open(link.href, link.target))
  }, true)
})()
