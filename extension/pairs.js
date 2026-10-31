// Which app tab belongs to which review tab, and which review tabs run a page that talks to
// the extension (it pinged). In chrome.storage.session: the service worker stops after 30 s idle
// and loses its memory, the browser session keeps the pairs.
let cache = null

async function load () {
  if (!cache) {
    cache = {
      pairs: (await chrome.storage.session.get('pairs')).pairs ?? {},
      ready: (await chrome.storage.session.get('ready')).ready ?? []
    }
  }
  return cache
}
const save = () => chrome.storage.session.set({ pairs: cache.pairs, ready: cache.ready })

export async function getPairs () {
  return Object.entries((await load()).pairs).map(([reviewTabId, appTabId]) => [Number(reviewTabId), appTabId])
}

export async function setPair (reviewTabId, appTabId) {
  const { pairs } = await load()
  for (const [review, app] of Object.entries(pairs)) if (app === appTabId) delete pairs[review]
  pairs[reviewTabId] = appTabId
  await save()
}

export const appOf = async reviewTabId => (await load()).pairs[reviewTabId] ?? null

export async function reviewOf (appTabId) {
  const pair = Object.entries((await load()).pairs).find(([, app]) => app === appTabId)
  return pair ? Number(pair[0]) : null
}

// A page from before 0.5 never pings: its app must stay inert, or comments made there get lost.
export async function setReady (reviewTabId) {
  const { ready } = await load()
  if (!ready.includes(reviewTabId)) ready.push(reviewTabId)
  await save()
}

export const isReady = async reviewTabId => (await load()).ready.includes(reviewTabId)

export async function forgetTab (tabId) {
  const store = await load()
  delete store.pairs[tabId]
  for (const [review, app] of Object.entries(store.pairs)) if (app === tabId) delete store.pairs[review]
  store.ready = store.ready.filter(id => id !== tabId)
  await save()
}
