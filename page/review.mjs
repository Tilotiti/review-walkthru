// State of one round in the page: each step holds one box per point.
// Pure functions: each one returns a new JSON-serializable state, so the page can
// keep it in localStorage.

// A point already validated in an earlier round starts checked.
const entryFor = step => ({
  checked: Object.fromEntries(step.points.map(p => [p.id, p.alreadyValidated === true])),
  comments: [],
  logs: [],
  requests: [],
  dropped: { errors: 0, warnings: 0, requests: 0 },
  missedTargets: []
})

const APP_KINDS = ['element', 'text', 'zone']
const MAX_ENTRIES = 50
const MAX_TEXT = 500

export function initialState (round, steps) {
  const entries = {}
  for (const step of steps) entries[step.id] = entryFor(step)
  return { round, current: 0, order: steps.map(step => step.id), entries, nextNo: 1, drafts: {} }
}

// After Claude replaces a round (--replace) or on reload: keep the boxes and comments of the
// steps and points that still exist, drop the rest. extraSteps are the skipped steps a
// reviewer may have reopened.
export function mergeState (saved, round, steps, extraSteps = []) {
  if (!saved?.entries || saved.round !== round) return initialState(round, steps)
  const known = new Map([...steps, ...extraSteps].map(step => [step.id, step]))
  const roundIds = steps.map(step => step.id)
  const order = [...roundIds, ...(saved.order ?? []).filter(id => !roundIds.includes(id) && known.has(id))]
  const entries = {}
  for (const id of order) {
    const step = known.get(id)
    const entry = entryFor(step)
    const old = saved.entries[id]
    if (old) {
      const pointIds = step.points.map(p => p.id)
      for (const pid of pointIds) if (Object.hasOwn(old.checked ?? {}, pid)) entry.checked[pid] = Boolean(old.checked[pid])
      entry.comments = (old.comments ?? []).filter(c => ['step', ...APP_KINDS].includes(c.anchor?.kind) || (c.anchor?.kind === 'point' && pointIds.includes(c.anchor.id)))
      entry.logs = old.logs ?? []
      entry.requests = old.requests ?? []
      entry.dropped = { errors: 0, warnings: 0, requests: 0, ...old.dropped }
      entry.missedTargets = (old.missedTargets ?? []).filter(pid => pointIds.includes(pid))
    }
    entries[id] = entry
  }
  const drafts = Object.fromEntries(Object.entries(saved.drafts ?? {}).filter(([key]) => entries[key.split('|')[0]]))
  return { round, current: Math.min(saved.current ?? 0, order.length), order, entries, nextNo: saved.nextNo ?? 1, drafts }
}

// A comment being typed lives in the state, so a render (checking a point) does not erase it.
export const draftKey = (stepId, anchor) => `${stepId}|${anchor.kind}:${anchor.id ?? ''}`

export function setDraft (s, key, text) {
  const drafts = { ...s.drafts }
  if (String(text).trim()) drafts[key] = text
  else delete drafts[key]
  return { ...s, drafts }
}

const withEntry = (s, stepId, change) => ({ ...s, entries: { ...s.entries, [stepId]: change(s.entries[stepId]) } })

export function addComment (s, stepId, anchor, text) {
  const clean = String(text).trim()
  if (!clean) return s
  const comment = { id: `r${s.round}-k${s.nextNo}`, text: clean, anchor }
  const next = { ...withEntry(s, stepId, e => ({ ...e, comments: [...e.comments, comment] })), nextNo: s.nextNo + 1 }
  return setDraft(next, draftKey(stepId, anchor), '')
}

export const nextCommentId = s => `r${s.round}-k${s.nextNo}`

// A comment made on the app: the extension sends where and what; the page adds the step's console state.
export function addAppComment (s, stepId, payload, text) {
  const clean = String(text).trim()
  if (!clean) return s
  const entry = s.entries[stepId]
  const anchor = {
    kind: payload.kind,
    url: payload.url,
    element: payload.element ?? null,
    quote: payload.quote ?? null,
    rect: payload.rect,
    capture: null,
    context: { consoleErrors: entry.logs.filter(l => l.level === 'error').length, lastRequest: payload.lastRequest ?? null }
  }
  const comment = { id: nextCommentId(s), text: clean, anchor }
  return { ...withEntry(s, stepId, e => ({ ...e, comments: [...e.comments, comment] })), nextNo: s.nextNo + 1 }
}

export const setCapture = (s, stepId, commentId, file) => withEntry(s, stepId, e => ({
  ...e, comments: e.comments.map(c => c.id === commentId ? { ...c, anchor: { ...c.anchor, capture: file } } : c)
}))

// Console entries and failed requests of the app, kept per step and bounded per kind (errors, warnings,
// requests), so a flood of warnings cannot hide an error. Past the cap they are only counted.
const kindOf = (key, item) => key === 'requests' ? 'requests' : item.level === 'error' ? 'errors' : 'warnings'

function addEntry (s, stepId, key, item) {
  const kind = kindOf(key, item)
  return withEntry(s, stepId, e => e[key].filter(x => kindOf(key, x) === kind).length >= MAX_ENTRIES
    ? { ...e, dropped: { ...e.dropped, [kind]: e.dropped[kind] + 1 } }
    : { ...e, [key]: [...e[key], item] })
}

export const addLog = (s, stepId, log) => addEntry(s, stepId, 'logs', { ...log, text: String(log.text).slice(0, MAX_TEXT) })

export const addRequest = (s, stepId, request) => addEntry(s, stepId, 'requests', request)

export function issues (entry) {
  const errors = entry.logs.filter(l => l.level === 'error').length
  return {
    errors: errors + entry.dropped.errors,
    warnings: entry.logs.length - errors + entry.dropped.warnings,
    requests: entry.requests.length + entry.dropped.requests
  }
}

export const appComments = entry => entry.comments.filter(c => APP_KINDS.includes(c.anchor?.kind))

export const pinsFor = (s, stepId) => appComments(s.entries[stepId] ?? { comments: [] }).map((c, i) => ({
  n: i + 1, url: c.anchor.url, selector: c.anchor.element?.selector ?? null, rect: c.anchor.rect
}))

// The fields to fill: a named account takes its value from credentials.json, which the scenario never holds.
export function prefillFields (step, credentials) {
  const fields = []
  const unresolved = []
  for (const entry of step.prefill ?? []) {
    if ('value' in entry) { fields.push({ selector: entry.selector, value: entry.value }); continue }
    const value = credentials.find(c => c.prerequisiteId === entry.credential)?.[entry.field]
    if (typeof value === 'string') fields.push({ selector: entry.selector, value })
    else unresolved.push(entry.selector)
  }
  return { fields, unresolved }
}

// The step the app reached, when the current step's next.detect matches its path and query.
export function detectTarget (step, url) {
  const { stepId, detect } = step?.next ?? {}
  if (!stepId || typeof detect?.urlMatches !== 'string') return null
  try {
    const { pathname, search } = new URL(url)
    return new RegExp(detect.urlMatches).test(pathname + search) ? stepId : null
  } catch { return null }
}

export function goToStep (s, stepId) {
  const i = s.order.indexOf(stepId)
  return i === -1 ? s : { ...s, current: i }
}

// A point whose "Show" found nothing goes back to Claude with the review; a later success clears it.
export const setTargetFound = (s, stepId, pointId, found) => withEntry(s, stepId, e => {
  const others = (e.missedTargets ?? []).filter(id => id !== pointId)
  return { ...e, missedTargets: found ? others : [...others, pointId] }
})

export const removeComment = (s, stepId, commentId) =>
  withEntry(s, stepId, e => ({ ...e, comments: e.comments.filter(c => c.id !== commentId) }))

export const togglePoint = (s, stepId, pointId) =>
  withEntry(s, stepId, e => ({ ...e, checked: { ...e.checked, [pointId]: !e.checked[pointId] } }))

// "Next step" only moves: a point is validated by its own box.
export const goNext = s => s.current >= s.order.length ? s : { ...s, current: s.current + 1 }

export const goPrev = s => ({ ...s, current: Math.max(0, s.current - 1) })

export function reopen (s, step) {
  if (s.order.includes(step.id)) return s
  return { ...s, order: [...s.order, step.id], entries: { ...s.entries, [step.id]: entryFor(step) } }
}

export function pointStatus (entry, pointId) {
  if (entry.comments.some(c => c.anchor?.kind === 'point' && c.anchor.id === pointId)) return 'commented'
  return entry.checked[pointId] ? 'validated' : 'not_seen'
}

export function stepStatus (entry) {
  if (entry.comments.length) return 'commented'
  return Object.keys(entry.checked).every(id => pointStatus(entry, id) === 'validated') ? 'validated' : 'not_reached'
}

export function counts (s) {
  const entries = s.order.map(id => s.entries[id])
  return {
    comments: entries.reduce((n, e) => n + e.comments.length, 0),
    pointsLeft: entries.reduce((n, e) => n + Object.keys(e.checked).filter(id => pointStatus(e, id) === 'not_seen').length, 0)
  }
}

export function buildReview (s, now) {
  return {
    format: 'review-walkthru/review@2',
    round: s.round,
    submittedAt: now.toISOString(),
    steps: s.order.map(stepId => {
      const e = s.entries[stepId]
      const points = Object.fromEntries(Object.keys(e.checked).map(id => [id, pointStatus(e, id)]))
      return { stepId, status: stepStatus(e), points, comments: e.comments, logs: e.logs ?? [], requests: e.requests ?? [], missedTargets: e.missedTargets ?? [] }
    })
  }
}

export const isFinish = review => review.steps.every(step => step.status === 'validated')

// The screen of a step in the app: its `start` path, else its `path` (null: no screen).
export const stepPage = step => step.start?.startsWith('/') ? step.start : step.path ?? null

// Where the first step of a round starts in the app.
export const startUrl = scenario => new URL(stepPage(scenario.steps[0]) ?? '/', scenario.app.baseUrl).href
