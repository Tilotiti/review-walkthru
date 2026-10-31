// Keeps the app next to the review page, in split view. Messages come from
// content.js: on page load ("split", no user gesture needed since Chrome 155) and on a
// click on an app link ("navigate", which loads the link in the other half of the split).

const httpUrl = value => {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch { return null }
}
const inSplit = tab => tab.splitViewId !== undefined && tab.splitViewId !== -1

function split (tab, appUrl, reply) {
  if (inSplit(tab)) return reply({ ok: true, already: true, splitViewId: tab.splitViewId })
  const url = httpUrl(appUrl)
  if (!url) return reply({ ok: false, error: 'the app URL must be http(s)' })
  // windowId: without it Chrome opens the tab in the last focused window, which may not
  // hold the review tab, and refuses the split. index: tab.index puts the app on its left.
  chrome.tabs.create({ url, splitWithTabId: tab.id, windowId: tab.windowId, index: tab.index, active: false })
    .then(appTab => reply({ ok: true, splitViewId: appTab.splitViewId }))
    .catch(error => reply({ ok: false, error: String(error?.message ?? error) }))
  return true
}

function navigate (tab, target, reply) {
  const url = httpUrl(target)
  if (!url) return reply({ ok: false, error: 'the link must be http(s)' })
  if (!inSplit(tab)) return reply({ ok: false, error: 'the review page is not in a split view' })
  chrome.tabs.query({ windowId: tab.windowId })
    .then(tabs => {
      const app = tabs.find(t => t.splitViewId === tab.splitViewId && t.id !== tab.id)
      if (!app) return reply({ ok: false, error: 'no app tab in this split view' })
      return chrome.tabs.update(app.id, { url, active: true }).then(() => reply({ ok: true }))
    })
    .catch(error => reply({ ok: false, error: String(error?.message ?? error) }))
  return true
}

// At the end of the review the page only says "Review finished": give it the whole window.
function unsplit (tab, reply) {
  if (!inSplit(tab)) return reply({ ok: true, already: true })
  chrome.tabs.unsplit(tab.splitViewId)
    .then(() => reply({ ok: true }))
    .catch(error => reply({ ok: false, error: String(error?.message ?? error) }))
  return true
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!sender.tab) return
  if (message?.type === 'review-walkthru:split') return split(sender.tab, message.appUrl, reply)
  if (message?.type === 'review-walkthru:navigate') return navigate(sender.tab, message.url, reply)
  if (message?.type === 'review-walkthru:unsplit') return unsplit(sender.tab, reply)
})
