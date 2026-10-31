// Which app tab belongs to which review tab. In chrome.storage.session: the service worker
// stops after 30 s idle and loses its memory, the browser session keeps the pairs.
let cache = null

async function load () {
  if (!cache) cache = (await chrome.storage.session.get('pairs')).pairs ?? {}
  return cache
}
const save = () => chrome.storage.session.set({ pairs: cache })

export async function getPairs () {
  return Object.entries(await load()).map(([reviewTabId, appTabId]) => [Number(reviewTabId), appTabId])
}

export async function setPair (reviewTabId, appTabId) {
  const pairs = await load()
  for (const [review, app] of Object.entries(pairs)) if (app === appTabId) delete pairs[review]
  pairs[reviewTabId] = appTabId
  await save()
}

export const appOf = async reviewTabId => (await load())[reviewTabId] ?? null

export async function reviewOf (appTabId) {
  const pair = Object.entries(await load()).find(([, app]) => app === appTabId)
  return pair ? Number(pair[0]) : null
}

export async function forgetTab (tabId) {
  const pairs = await load()
  delete pairs[tabId]
  for (const [review, app] of Object.entries(pairs)) if (app === tabId) delete pairs[review]
  await save()
}
