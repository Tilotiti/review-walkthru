// Formats exchanged between the skill, the relay and the page. Hand-written validation:
// no dependency, each error starts with the field path.

export const SCENARIO_FORMAT = 'review-walkthru/scenario@2'
export const REVIEW_FORMAT = 'review-walkthru/review@2'

const SOURCES = ['author', 'inferred']
const STATUSES = ['validated', 'commented', 'not_reached']
const POINT_STATUSES = ['validated', 'commented', 'not_seen']
const APP_KINDS = ['element', 'text', 'zone']
const LOG_LEVELS = ['error', 'warning']
const MAX_ENTRIES = 100
const CAPTURE = /^captures\/r\d+-k\d+\.png$/

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const isText = v => typeof v === 'string' && v.trim() !== ''

function checkUrl (value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}

// A path must stay on the app's host: "//evil.example" or "/\evil.example" would leave it.
function isLocalPath (value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return false
  try { return new URL(value, 'http://app.invalid').host === 'app.invalid' } catch { return false }
}

// Checks a list of { id, text, ... } items and returns their ids.
function checkItems (list, path, errors, extra) {
  if (!Array.isArray(list)) { errors.push(`${path}: must be an array`); return [] }
  const ids = []
  list.forEach((item, i) => {
    const at = `${path}[${i}]`
    if (!isObject(item)) { errors.push(`${at}: must be an object`); return }
    if (!isText(item.id)) errors.push(`${at}.id: required`)
    else if (ids.includes(item.id)) errors.push(`${at}.id: duplicate id "${item.id}"`)
    else ids.push(item.id)
    if (!isText(item.text)) errors.push(`${at}.text: required`)
    extra?.(item, at)
  })
  return ids
}

function checkSource (item, at, errors) {
  if (!SOURCES.includes(item.source)) errors.push(`${at}.source: must be one of ${SOURCES.join(', ')}`)
}

export function validateScenario (s) {
  const errors = []
  if (!isObject(s)) return ['scenario: must be an object']
  if (s.format !== SCENARIO_FORMAT) errors.push(`format: must be "${SCENARIO_FORMAT}"`)

  if (!isObject(s.pr)) errors.push('pr: required')
  else {
    if (typeof s.pr.repo !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(s.pr.repo)) errors.push('pr.repo: must be "owner/name"')
    if (!Number.isInteger(s.pr.number) || s.pr.number < 1) errors.push('pr.number: must be a positive integer')
    if (!isText(s.pr.headSha)) errors.push('pr.headSha: required')
  }
  if (!isText(s.title)) errors.push('title: required')
  if (typeof s.summary !== 'string') errors.push('summary: required')

  if (!Number.isInteger(s.round) || s.round < 1) errors.push('round: must be an integer >= 1')
  if (!isObject(s.app) || !checkUrl(s.app.baseUrl)) errors.push('app.baseUrl: must be an http(s) URL')

  const prerequisites = checkItems(s.prerequisites ?? [], 'prerequisites', errors)

  const skipped = []
  if (!Array.isArray(s.skipped)) errors.push('skipped: must be an array')
  else s.skipped.forEach((entry, i) => {
    if (!isObject(entry) || !isText(entry.stepId) || !isText(entry.reason)) errors.push(`skipped[${i}]: must be { stepId, reason }`)
    else skipped.push(entry.stepId)
  })

  if (!Array.isArray(s.steps) || s.steps.length === 0) { errors.push('steps: must be a non-empty array'); return errors }

  const stepIds = []
  s.steps.forEach((step, i) => {
    if (isObject(step) && isText(step.id)) {
      if (stepIds.includes(step.id)) errors.push(`steps[${i}].id: duplicate step id "${step.id}"`)
      stepIds.push(step.id)
    }
  })
  const knownSteps = [...stepIds, ...skipped]

  s.steps.forEach((step, i) => {
    const at = `steps[${i}]`
    if (!isObject(step)) { errors.push(`${at}: must be an object`); return }
    if (!isText(step.id)) errors.push(`${at}.id: required`)
    if (!isText(step.title)) errors.push(`${at}.title: required`)
    if (!isText(step.page)) errors.push(`${at}.page: required`)
    if (step.path !== null && !isLocalPath(step.path)) {
      errors.push(`${at}.path: must be a path on the app ("/…") or null`)
    }
    const requires = step.requires ?? []
    if (!Array.isArray(requires)) errors.push(`${at}.requires: must be an array`)
    else requires.forEach(id => { if (!prerequisites.includes(id)) errors.push(`${at}.requires: unknown prerequisite "${id}"`) })

    for (const key of ['checks', 'decisions', 'doubts']) {
      if (key in step) errors.push(`${at}.${key}: format 1 field, put it in a point (scenario@2)`)
    }
    checkPoints(step.points, `${at}.points`, errors)
    checkPrefill(step.prefill, `${at}.prefill`, prerequisites, errors)

    if (step.next !== null && step.next !== undefined) {
      if (!isObject(step.next)) errors.push(`${at}.next: must be an object or null`)
      else {
        const { stepId, instruction } = step.next
        if (stepId !== null && !knownSteps.includes(stepId)) errors.push(`${at}.next.stepId: unknown step "${stepId}"`)
        if (!isText(instruction)) errors.push(`${at}.next.instruction: required`)
        if (step.next.detect !== undefined && step.next.detect !== null) checkDetect(step.next.detect, `${at}.next.detect`, errors)
      }
    }

    for (const key of ['start', 'startLabel', 'reason']) {
      if (step[key] !== null && step[key] !== undefined && typeof step[key] !== 'string') {
        errors.push(`${at}.${key}: must be a string or null`)
      } else if (key === 'start' && step.start?.startsWith('/')) {
        if (!isLocalPath(step.start)) errors.push(`${at}.start: a path must stay on the app`)
        if (!isText(step.startLabel)) errors.push(`${at}.startLabel: required when start is a path, the name of that page`)
      }
    }
  })
  return errors
}

// Values Claude picks for the step's form; an account is named, its password stays in credentials.json.
function checkPrefill (prefill, path, prerequisites, errors) {
  if (prefill === undefined) return
  if (!Array.isArray(prefill)) { errors.push(`${path}: must be an array`); return }
  prefill.forEach((entry, i) => {
    const at = `${path}[${i}]`
    if (!isObject(entry)) { errors.push(`${at}: must be an object`); return }
    if (!isText(entry.selector)) errors.push(`${at}.selector: required`)
    const hasValue = 'value' in entry
    const hasCredential = 'credential' in entry
    if (hasValue === hasCredential) { errors.push(`${at}: needs a value or credential, not both`); return }
    if (hasValue && !['string', 'boolean'].includes(typeof entry.value)) errors.push(`${at}.value: must be a string or a boolean`)
    if (hasCredential) {
      if (!prerequisites.includes(entry.credential)) errors.push(`${at}.credential: unknown prerequisite "${entry.credential}"`)
      if (!['login', 'password'].includes(entry.field)) errors.push(`${at}.field: must be login or password`)
    }
  })
}

function checkDetect (detect, path, errors) {
  if (!isObject(detect)) { errors.push(`${path}: must be an object`); return }
  let valid = typeof detect.urlMatches === 'string'
  if (valid) try { new RegExp(detect.urlMatches) } catch { valid = false }
  if (!valid) errors.push(`${path}.urlMatches: must be a valid regular expression`)
}

function checkPoints (points, path, errors) {
  if (!Array.isArray(points) || points.length === 0) { errors.push(`${path}: must be a non-empty array`); return }
  const ids = []
  points.forEach((point, i) => {
    const at = `${path}[${i}]`
    if (!isObject(point)) { errors.push(`${at}: must be an object`); return }
    if (!isText(point.id)) errors.push(`${at}.id: required`)
    else if (ids.includes(point.id)) errors.push(`${at}.id: duplicate point id "${point.id}"`)
    else ids.push(point.id)
    if (!isText(point.title)) errors.push(`${at}.title: required`)
    if (point.do !== null && !isText(point.do)) errors.push(`${at}.do: a text, or null for a "To judge" point`)
    const decisions = checkItems(point.decisions ?? [], `${at}.decisions`, errors, (item, p) => {
      checkSource(item, p, errors)
      if (item.cost !== undefined && typeof item.cost !== 'string') errors.push(`${p}.cost: must be a string`)
    })
    const doubts = checkItems(point.doubts ?? [], `${at}.doubts`, errors, (item, p) => checkSource(item, p, errors))
    if (point.do === null && decisions.length + doubts.length === 0) {
      errors.push(`${at}: a "To judge" point (do: null) needs a decision or a doubt`)
    }
    if (point.alreadyValidated !== undefined && typeof point.alreadyValidated !== 'boolean') {
      errors.push(`${at}.alreadyValidated: must be a boolean`)
    }
  })
}

// required: ids of the steps of the current round, each expected exactly once (a stale tab
// left on a replaced round must not skip one). Reopened skipped steps are optional.
// hasCapture: whether the relay holds a cited capture file.
export function validateReview (r, { round, steps, required = [], hasCapture = () => true }) {
  const errors = []
  if (!isObject(r)) return ['review: must be an object']
  if (r.format !== REVIEW_FORMAT) errors.push(`format: must be "${REVIEW_FORMAT}"`)
  if (r.round !== round) errors.push(`round: expected ${round}`)
  if (typeof r.submittedAt !== 'string' || Number.isNaN(Date.parse(r.submittedAt))) errors.push('submittedAt: must be an ISO date')
  if (!Array.isArray(r.steps)) return [...errors, 'steps: must be an array']

  const byId = new Map(steps.map(step => [step.id, step]))
  const commentIds = new Set()
  const seen = new Set()
  for (const entry of r.steps) {
    if (!isObject(entry)) continue
    if (seen.has(entry.stepId)) errors.push(`steps: duplicate step "${entry.stepId}"`)
    seen.add(entry.stepId)
  }
  for (const id of required) if (!seen.has(id)) errors.push(`steps: missing step "${id}" of this round`)
  r.steps.forEach((entry, i) => {
    const at = `steps[${i}]`
    if (!isObject(entry)) { errors.push(`${at}: must be an object`); return }
    const step = byId.get(entry.stepId)
    if (!step) errors.push(`${at}.stepId: unknown step "${entry.stepId}"`)
    if (!STATUSES.includes(entry.status)) errors.push(`${at}.status: must be one of ${STATUSES.join(', ')}`)
    if (!Array.isArray(entry.comments)) { errors.push(`${at}.comments: must be an array`); return }
    if (!isObject(entry.points)) { errors.push(`${at}.points: must be an object`); return }
    const pointIds = (step?.points ?? []).map(p => p.id)
    if (step && (Object.keys(entry.points).length !== pointIds.length || !pointIds.every(id => Object.hasOwn(entry.points, id)))) {
      errors.push(`${at}.points: must list exactly the points of step "${step.id}"`)
    }
    const commentedPoints = new Set(entry.comments.filter(c => c?.anchor?.kind === 'point').map(c => c.anchor.id))
    for (const [id, status] of Object.entries(entry.points)) {
      if (!POINT_STATUSES.includes(status)) errors.push(`${at}.points.${id}: must be one of ${POINT_STATUSES.join(', ')}`)
      else if ((status === 'commented') !== commentedPoints.has(id)) errors.push(`${at}.points.${id}: "commented" if and only if a comment targets it`)
    }
    const expected = entry.comments.length > 0 ? 'commented'
      : Object.values(entry.points).every(v => v === 'validated') ? 'validated' : 'not_reached'
    if (entry.status !== expected) errors.push(`${at}.status: expected "${expected}" from its points and comments`)
    entry.comments.forEach((comment, j) => {
      const cat = `${at}.comments[${j}]`
      if (!isObject(comment)) { errors.push(`${cat}: must be an object`); return }
      if (!isText(comment.id)) errors.push(`${cat}.id: required`)
      else if (commentIds.has(comment.id)) errors.push(`${cat}.id: duplicate comment id "${comment.id}"`)
      else commentIds.add(comment.id)
      if (!isText(comment.text)) errors.push(`${cat}.text: required`)
      const anchor = comment.anchor
      if (!isObject(anchor) || !['step', 'point', ...APP_KINDS].includes(anchor.kind)) {
        errors.push(`${cat}.anchor: kind must be step, point, ${APP_KINDS.join(', ')}`)
      } else if (anchor.kind === 'point') {
        if (step && !pointIds.includes(anchor.id)) errors.push(`${cat}.anchor: unknown point "${anchor.id}"`)
        if (anchor.quote !== undefined && typeof anchor.quote !== 'string') errors.push(`${cat}.anchor.quote: must be a string`)
      } else if (APP_KINDS.includes(anchor.kind)) {
        checkAppAnchor(anchor, `${cat}.anchor`, hasCapture, errors)
      }
    })
    checkEntries(entry.logs, `${at}.logs`, errors, (log, p) => {
      if (!LOG_LEVELS.includes(log.level)) errors.push(`${p}.level: must be one of ${LOG_LEVELS.join(', ')}`)
      if (typeof log.text !== 'string') errors.push(`${p}.text: must be a string`)
      if (typeof log.url !== 'string') errors.push(`${p}.url: must be a string`)
    })
    checkEntries(entry.requests, `${at}.requests`, errors, (req, p) => {
      if (!isText(req.method)) errors.push(`${p}.method: required`)
      if (typeof req.url !== 'string') errors.push(`${p}.url: must be a string`)
      if (req.status !== null && !Number.isInteger(req.status)) errors.push(`${p}.status: must be an integer or null`)
      if (req.error !== null && typeof req.error !== 'string') errors.push(`${p}.error: must be a string or null`)
      if (typeof req.type !== 'string') errors.push(`${p}.type: must be a string`)
    })
  })
  return errors
}

// A comment made on the app: where it was, what it targets, and the capture the relay holds.
function checkAppAnchor (anchor, path, hasCapture, errors) {
  if (!checkUrl(anchor.url)) errors.push(`${path}.url: must be an http(s) URL`)
  const rect = anchor.rect
  if (!isObject(rect) || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(rect[k])) || rect.width < 0 || rect.height < 0) {
    errors.push(`${path}.rect: must be { x, y, width, height } in pixels`)
  }
  if (anchor.capture !== null && (typeof anchor.capture !== 'string' || !CAPTURE.test(anchor.capture) || !hasCapture(anchor.capture))) {
    errors.push(`${path}.capture: must be null or an uploaded captures/<id>.png`)
  }
  const element = anchor.element
  if (element === null || element === undefined) {
    if (anchor.kind !== 'zone') errors.push(`${path}.element: required for ${anchor.kind}`)
  } else if (!isObject(element) || typeof element.selector !== 'string' || typeof element.unique !== 'boolean' ||
    typeof element.tag !== 'string' || (element.role !== null && typeof element.role !== 'string') || typeof element.text !== 'string') {
    errors.push(`${path}.element: must be { selector, unique, tag, role, text }`)
  }
  if (anchor.kind === 'text' ? !isText(anchor.quote) : anchor.quote != null && typeof anchor.quote !== 'string') {
    errors.push(`${path}.quote: ${anchor.kind === 'text' ? 'required' : 'must be a string or null'}`)
  }
  const context = anchor.context
  if (context !== undefined && (!isObject(context) || !Number.isInteger(context.consoleErrors) || context.consoleErrors < 0 ||
    (context.lastRequest !== null && !isObject(context.lastRequest)))) {
    errors.push(`${path}.context: must be { consoleErrors, lastRequest }`)
  }
}

// logs and requests of a step: optional, bounded, each with an ISO date.
function checkEntries (list, path, errors, check) {
  if (list === undefined) return
  if (!Array.isArray(list)) { errors.push(`${path}: must be an array`); return }
  if (list.length > MAX_ENTRIES) errors.push(`${path}: ${MAX_ENTRIES} entries at most`)
  list.slice(0, MAX_ENTRIES).forEach((item, i) => {
    const p = `${path}[${i}]`
    if (!isObject(item)) { errors.push(`${p}: must be an object`); return }
    if (typeof item.at !== 'string' || Number.isNaN(Date.parse(item.at))) errors.push(`${p}.at: must be an ISO date`)
    check(item, p)
  })
}
