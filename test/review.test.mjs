import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateReview } from '../scripts/lib/format.mjs'
import {
  initialState, addComment, removeComment, togglePoint, goNext, goPrev, reopen,
  pointStatus, stepStatus, counts, buildReview, isFinish, mergeState, setDraft, draftKey
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
