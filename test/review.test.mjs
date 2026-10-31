import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateReview } from '../scripts/lib/format.mjs'
import {
  initialState, addComment, removeComment, togglePoint, goNext, goPrev, reopen,
  pointStatus, stepStatus, counts, buildReview, isFinish, mergeState, setDraft, draftKey, setTargetFound,
  nextCommentId, addAppComment, setCapture, addLog, addRequest, issues, appComments, pinsFor, prefillFields, detectTarget, goToStep
} from '../page/review.mjs'
import { r1, r2, clone } from './helpers.mjs'

const steps = r1.steps.slice(0, 3)

test('a point is validated by its box, commented by a comment', () => {
  let s = initialState(1, steps)
  s = togglePoint(s, 'clients-list', 'sort')
  assert.equal(pointStatus(s.entries['clients-list'], 'sort'), 'validated')
  s = addComment(s, 'clients-list', { kind: 'point', id: 'sort' }, 'Sorting needs another look')
  assert.equal(pointStatus(s.entries['clients-list'], 'sort'), 'commented')
  assert.equal(pointStatus(s.entries['clients-list'], 'filter'), 'not_seen')
  assert.equal(stepStatus(s.entries['clients-list']), 'commented')
  s = removeComment(s, 'clients-list', 'r1-k1')
  assert.equal(pointStatus(s.entries['clients-list'], 'sort'), 'validated')
})

test('next step validates nothing', () => {
  const s = goNext(initialState(1, steps))
  assert.equal(stepStatus(s.entries['clients-list']), 'not_reached')
  assert.equal(s.current, 1)
  assert.equal(goPrev(s).current, 0)
})

test('a step is validated when every point is checked', () => {
  let s = initialState(1, steps)
  for (const p of ['sort', 'filter', 'search']) s = togglePoint(s, 'clients-list', p)
  assert.equal(stepStatus(s.entries['clients-list']), 'validated')
})

test('alreadyValidated starts checked and can be unchecked', () => {
  let s = initialState(2, r2.steps)
  assert.equal(pointStatus(s.entries['client-show'], 'details'), 'validated')
  assert.equal(pointStatus(s.entries['client-show'], 'archive'), 'not_seen')
  s = togglePoint(s, 'client-show', 'details')
  assert.equal(pointStatus(s.entries['client-show'], 'details'), 'not_seen')
})

test('functions do not mutate their input', () => {
  const s = initialState(1, steps)
  const before = JSON.stringify(s)
  goNext(s); togglePoint(s, 'clients-list', 'sort'); addComment(s, 'clients-list', { kind: 'step' }, 'x'); reopen(s, r1.steps[3])
  assert.equal(JSON.stringify(s), before)
})

test('counts and buildReview', () => {
  let s = addComment(initialState(1, steps), 'client-new', { kind: 'step' }, ' x ')
  s = togglePoint(s, 'clients-list', 'sort')
  assert.deepEqual(counts(s), { comments: 1, pointsLeft: 5 })
  assert.equal(s.entries['client-new'].comments[0].text, 'x')
  const r = buildReview(JSON.parse(JSON.stringify(s)), new Date('2026-10-31T14:02:00Z'))
  assert.deepEqual(validateReview(r, { round: 1, steps }), [])
  assert.deepEqual(r.steps.map(x => x.status), ['not_reached', 'commented', 'not_reached'])
  assert.deepEqual(r.steps[0].points, { sort: 'validated', filter: 'not_seen', search: 'not_seen' })
  assert.equal(r.submittedAt, '2026-10-31T14:02:00.000Z')
})

test('a missed target goes back to Claude until a later Show finds it', () => {
  let s = setTargetFound(initialState(1, steps), 'clients-list', 'filter', false)
  s = setTargetFound(s, 'clients-list', 'sort', false)
  s = setTargetFound(s, 'clients-list', 'filter', false)
  assert.deepEqual(s.entries['clients-list'].missedTargets, ['sort', 'filter'])
  s = setTargetFound(s, 'clients-list', 'sort', true)
  const r = buildReview(s, new Date())
  assert.deepEqual(r.steps[0].missedTargets, ['filter'])
  assert.deepEqual(validateReview(r, { round: 1, steps }), [])
  r.steps[0].missedTargets = ['ghost']
  assert.ok(validateReview(r, { round: 1, steps }).some(e => e.includes('missedTargets')))
  const kept = mergeState(s, 1, [{ ...steps[0], points: steps[0].points.filter(p => p.id !== 'filter') }])
  assert.deepEqual(kept.entries['clients-list'].missedTargets, [])
})

test('isFinish, reopen and blank comments', () => {
  let s = initialState(1, steps.slice(0, 1))
  for (const p of ['sort', 'filter', 'search']) s = togglePoint(s, 'clients-list', p)
  assert.equal(isFinish(buildReview(s, new Date())), true)
  assert.equal(isFinish(buildReview(addComment(s, 'clients-list', { kind: 'step' }, 'y'), new Date())), false)
  assert.equal(addComment(s, 'clients-list', { kind: 'step' }, '  '), s)
  let re = reopen(initialState(2, r2.steps), r1.steps[0])
  re = reopen(re, r1.steps[0])
  assert.deepEqual(re.order, ['client-show', 'clients-list'])
  assert.deepEqual(Object.keys(re.entries['clients-list'].checked), ['sort', 'filter', 'search'])
})

test('mergeState keeps what still exists after Claude replaces the round', () => {
  let s = initialState(1, steps)
  s = togglePoint(s, 'clients-list', 'sort')
  s = addComment(s, 'clients-list', { kind: 'point', id: 'filter' }, 'Filter')
  s = addComment(s, 'client-new', { kind: 'point', id: 'empty-name' }, 'Empty name')
  s = addComment(s, 'client-new', { kind: 'step' }, 'Global')
  // --replace: "search" disappears, "export" appears, "client-new" loses "empty-name", "client-show" goes away
  const replaced = clone(steps).filter(st => st.id !== 'client-show')
  replaced[0].points = replaced[0].points.filter(p => p.id !== 'search').concat({ id: 'export', title: 'Export', do: 'Export the list', decisions: [], doubts: [] })
  replaced[1].points = replaced[1].points.filter(p => p.id !== 'empty-name')
  const m = mergeState(s, 1, replaced, [])
  assert.deepEqual(m.order, ['clients-list', 'client-new'])
  assert.deepEqual(m.entries['clients-list'].checked, { sort: true, filter: false, export: false })
  assert.deepEqual(m.entries['clients-list'].comments.map(c => c.text), ['Filter'])
  assert.deepEqual(m.entries['client-new'].comments.map(c => c.text), ['Global'])
  assert.equal(m.nextNo, s.nextNo) // comment ids stay unique
  assert.deepEqual(validateReview(buildReview(m, new Date()), { round: 1, steps: replaced, required: replaced.map(st => st.id) }), [])
})

test('mergeState keeps reopened skipped steps that still exist, and clamps the current step', () => {
  let s = reopen(initialState(2, r2.steps), r1.steps[0])
  s = { ...s, current: 5 }
  const m = mergeState(s, 2, r2.steps, [r1.steps[0]])
  assert.deepEqual(m.order, ['client-show', 'clients-list'])
  assert.equal(m.current, 2)
  assert.deepEqual(mergeState(s, 2, r2.steps, []).order, ['client-show'])
  assert.deepEqual(mergeState(null, 2, r2.steps, []), initialState(2, r2.steps)) // nothing saved
})

test('drafts survive renders and go away once the comment is added', () => {
  const key = draftKey('clients-list', { kind: 'point', id: 'filter' })
  let s = setDraft(initialState(1, steps), key, 'draft')
  s = togglePoint(s, 'clients-list', 'sort')
  assert.equal(s.drafts[key], 'draft')
  s = addComment(s, 'clients-list', { kind: 'point', id: 'filter' }, 'draft')
  assert.equal(key in s.drafts, false)
  assert.deepEqual(validateReview(buildReview(setDraft(s, key, 'x'), new Date()), { round: 1, steps }), [])
})

const APP = 'http://localhost:8000/clients'
const elementComment = { kind: 'element', url: APP, rect: { x: 1, y: 2, width: 3, height: 4 },
  element: { selector: 'th:nth-of-type(3)', unique: true, tag: 'th', role: 'columnheader', text: 'People' }, quote: null,
  lastRequest: { method: 'GET', url: APP, status: 200 } }
const zoneComment = { kind: 'zone', url: APP, rect: { x: 0, y: 300, width: 320, height: 140 }, element: null, quote: null, lastRequest: null }

test('an app comment survives a reload with its capture and the step logs', () => {
  let s = initialState(1, steps)
  s = addLog(s, 'clients-list', { level: 'error', text: 'TypeError: x', url: APP, at: '2026-10-31T14:00:00Z' })
  const id = nextCommentId(s)
  assert.equal(id, 'r1-k1')
  s = addAppComment(s, 'clients-list', elementComment, ' What does it count? ')
  s = setCapture(s, 'clients-list', id, `captures/${id}.png`)
  const back = mergeState(JSON.parse(JSON.stringify(s)), 1, steps)
  const [c] = appComments(back.entries['clients-list'])
  assert.equal(c.text, 'What does it count?')
  assert.equal(c.anchor.capture, 'captures/r1-k1.png')
  assert.deepEqual(c.anchor.context, { consoleErrors: 1, lastRequest: { method: 'GET', url: APP, status: 200 } })
  assert.equal(back.entries['clients-list'].logs.length, 1)
  assert.equal(stepStatus(back.entries['clients-list']), 'commented')
  assert.equal(addAppComment(s, 'clients-list', zoneComment, '  '), s)
})

test('logs are capped per step and counted', () => {
  let s = initialState(1, steps)
  for (let i = 0; i < 60; i++) s = addLog(s, 'clients-list', { level: 'warning', text: 'w'.repeat(900), url: 'u', at: 'a' })
  s = addLog(s, 'clients-list', { level: 'error', text: 'e', url: 'u', at: 'a' })
  s = addRequest(s, 'clients-list', { method: 'POST', url: APP, status: 500, error: null, type: 'main_frame', at: 'a' })
  const e = s.entries['clients-list']
  assert.equal(e.logs.length, 51) // 50 warnings, and the error a flood of warnings must not hide
  assert.equal(e.logs[0].text.length, 500)
  assert.deepEqual(issues(e), { errors: 1, warnings: 60, requests: 1 })
  assert.deepEqual(issues(initialState(1, steps).entries['client-new']), { errors: 0, warnings: 0, requests: 0 })
})

test('pins number the app comments of a step only', () => {
  let s = initialState(1, steps)
  s = addComment(s, 'clients-list', { kind: 'step' }, 'Global')
  s = addAppComment(s, 'clients-list', elementComment, 'One')
  s = addAppComment(s, 'clients-list', zoneComment, 'Two')
  assert.deepEqual(pinsFor(s, 'clients-list'), [
    { n: 1, url: APP, selector: 'th:nth-of-type(3)', rect: elementComment.rect },
    { n: 2, url: APP, selector: null, rect: zoneComment.rect }
  ])
  assert.deepEqual(pinsFor(s, 'client-new'), [])
})

test('a review with app comments, logs and requests passes the relay', () => {
  let s = initialState(1, steps)
  s = addAppComment(s, 'clients-list', elementComment, 'One')
  s = addAppComment(s, 'clients-list', { ...zoneComment, kind: 'text', quote: 'Search a cli', element: elementComment.element }, 'Two')
  s = addComment(s, 'clients-list', { kind: 'point', id: 'sort', quote: 'Un tri' }, 'Three')
  s = addLog(s, 'clients-list', { level: 'error', text: 'TypeError', url: APP, at: '2026-10-31T14:00:00Z' })
  s = addRequest(s, 'client-new', { method: 'POST', url: APP, status: 500, error: null, type: 'main_frame', at: '2026-10-31T14:00:01Z' })
  const r = buildReview(JSON.parse(JSON.stringify(s)), new Date('2026-10-31T14:02:00Z'))
  assert.deepEqual(validateReview(r, { round: 1, steps, hasCapture: () => false }), [])
  assert.equal(r.steps[0].comments[2].anchor.quote, 'Un tri')
  assert.equal(r.steps[0].logs.length, 1)
  assert.equal(r.steps[1].requests[0].status, 500)
})

test('prefill resolves accounts and reports what it cannot', () => {
  const step = { prefill: [{ selector: '#n', value: 'Bistro' }, { selector: '#u', credential: 'admin', field: 'login' },
    { selector: '#p', credential: 'guest', field: 'password' }, { selector: '#c', value: true }] }
  assert.deepEqual(prefillFields(step, [{ prerequisiteId: 'admin', login: 'a@test', password: 'pw' }]),
    { fields: [{ selector: '#n', value: 'Bistro' }, { selector: '#u', value: 'a@test' }, { selector: '#c', value: true }], unresolved: ['#p'] })
  assert.deepEqual(prefillFields({}, []), { fields: [], unresolved: [] })
})

test('detectTarget matches path and query only', () => {
  const step = { next: { stepId: 'client-new', instruction: 'x', detect: { urlMatches: '^/clients/new$' } } }
  assert.equal(detectTarget(step, 'http://localhost:8000/clients/new'), 'client-new')
  assert.equal(detectTarget(step, 'http://localhost:8000/clients/new?x=1'), null)
  assert.equal(detectTarget(step, 'not a url'), null)
  assert.equal(detectTarget({ next: null }, 'http://localhost:8000/'), null)
  assert.equal(detectTarget({ next: { stepId: null, instruction: 'x', detect: { urlMatches: '.' } } }, 'http://localhost:8000/'), null)
})

test('goToStep moves to a known step only', () => {
  const s = initialState(1, steps)
  assert.equal(goToStep(s, 'client-show').current, 2)
  assert.equal(goToStep(s, 'ghost'), s)
})
