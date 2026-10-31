// State of one round in the page: each step holds one box per point.
// Pure functions: each one returns a new JSON-serializable state, so the page can
// keep it in localStorage.

// A point already validated in an earlier round starts checked.
const entryFor = step => ({
  checked: Object.fromEntries(step.points.map(p => [p.id, p.alreadyValidated === true])),
  comments: []
})

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
      entry.comments = (old.comments ?? []).filter(c => c.anchor?.kind === 'step' || (c.anchor?.kind === 'point' && pointIds.includes(c.anchor.id)))
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
      return { stepId, status: stepStatus(e), points, comments: e.comments }
    })
  }
}

export const isFinish = review => review.steps.every(step => step.status === 'validated')

// Where the first step of a round starts in the app: its `start` path, else its `path`.
export function startUrl (scenario) {
  const step = scenario.steps[0]
  const path = step.start?.startsWith('/') ? step.start : step.path ?? '/'
  return new URL(path, scenario.app.baseUrl).href
}
