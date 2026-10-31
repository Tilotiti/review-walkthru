import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateScenario, validateReview, REVIEW_FORMAT } from '../scripts/lib/format.mjs'
import { r1, r2, clone } from './helpers.mjs'

test('fixtures are valid', () => {
  assert.deepEqual(validateScenario(r1), [])
  assert.deepEqual(validateScenario(r2), [])
})

test('rejects inconsistent scenarios', () => {
  const dup = clone(r1); dup.steps[1].id = 'clients-list'
  assert.ok(validateScenario(dup).some(e => e.includes('duplicate step id')))
  const badNext = clone(r1); badNext.steps[0].next.stepId = 'nope'
  assert.ok(validateScenario(badNext).some(e => e.includes('next.stepId')))
  const badReq = clone(r1); badReq.steps[0].requires = ['ghost']
  assert.ok(validateScenario(badReq).some(e => e.includes('requires')))
  const badSource = clone(r1); badSource.steps[0].points[0].decisions[0].source = 'guess'
  assert.ok(validateScenario(badSource).some(e => e.includes('source')))
  const badPath = clone(r1); badPath.steps[0].path = 'clients'
  assert.ok(validateScenario(badPath).some(e => e.includes('path')))
  for (const offHost of ['//evil.example/x', '/\\evil.example/x']) {
    const p = clone(r1); p.steps[0].path = offHost
    assert.ok(validateScenario(p).some(e => e.includes('path')), offHost)
    const s = clone(r2); s.steps[0].start = offHost
    assert.ok(validateScenario(s).some(e => e.includes('start')), offHost)
  }
  const noLabel = clone(r2); delete noLabel.steps[0].startLabel
  assert.ok(validateScenario(noLabel).some(e => e.includes('startLabel')))
  const textStart = clone(r2); textStart.steps[0].start = "Redo the Create a client step"; delete textStart.steps[0].startLabel
  assert.deepEqual(validateScenario(textStart), [])
  const noSteps = clone(r1); noSteps.steps = []
  assert.ok(validateScenario(noSteps).some(e => e.includes('steps')))
  assert.ok(validateScenario(null).length > 0)
})

test('a scenario needs app.baseUrl and round', () => {
  const noApp = clone(r1); delete noApp.app
  assert.ok(validateScenario(noApp).some(e => e.includes('app.baseUrl')))
  const noRound = clone(r1); delete noRound.round
  assert.ok(validateScenario(noRound).some(e => e.includes('round')))
})

test('points', () => {
  const empty = clone(r1); empty.steps[3].points[1].decisions = []
  assert.ok(validateScenario(empty).some(e => e.includes('points[1]') && e.includes('To judge')))
  const dup = clone(r1); dup.steps[0].points[1].id = 'sort'
  assert.ok(validateScenario(dup).some(e => e.includes('duplicate point id')))
  const none = clone(r1); none.steps[0].points = []
  assert.ok(validateScenario(none).some(e => e.includes('points')))
  const old = clone(r1); old.steps[0].checks = []
  assert.ok(validateScenario(old).some(e => e.includes('checks')))
  const badDo = clone(r1); badDo.steps[0].points[0].do = '  '
  assert.ok(validateScenario(badDo).some(e => e.includes('do')))
  const badFlag = clone(r1); badFlag.steps[0].points[0].alreadyValidated = 'yes'
  assert.ok(validateScenario(badFlag).some(e => e.includes('alreadyValidated')))
  const target = clone(r1); target.steps[0].points[0].target = { selector: 'table.clients', text: 'Name' }
  target.steps[0].points[1].target = { selector: 'select[name=status]' }
  assert.deepEqual(validateScenario(target), [])
  for (const bad of ['#x', { text: 'Name' }, { selector: ' ' }, { selector: '#x', text: '' }]) {
    const s = clone(r1); s.steps[0].points[0].target = bad
    assert.ok(validateScenario(s).some(e => e.includes('target')), JSON.stringify(bad))
  }
})

test('validateReview v2', () => {
  const ok = { format: REVIEW_FORMAT, round: 1, submittedAt: '2026-10-31T14:02:00Z', steps: [
    { stepId: 'clients-list', status: 'commented', points: { sort: 'validated', filter: 'commented', search: 'not_seen' },
      comments: [{ id: 'r1-k1', text: 'The "Archived" status is missing.', anchor: { kind: 'point', id: 'filter' } }] } ] }
  const ctx = { round: 1, steps: r1.steps }
  assert.deepEqual(validateReview(ok, ctx), [])
  assert.ok(validateReview({ ...ok, round: 2 }, ctx).some(e => e.includes('round')))
  const ghost = clone(ok); ghost.steps[0].stepId = 'ghost'
  assert.ok(validateReview(ghost, ctx).some(e => e.includes('stepId')))
  const missing = clone(ok); delete missing.steps[0].points.search
  assert.ok(validateReview(missing, ctx).some(e => e.includes('points')))
  const extra = clone(ok); extra.steps[0].points.ghost = 'validated'
  assert.ok(validateReview(extra, ctx).some(e => e.includes('points')))
  const foreign = clone(ok); foreign.steps[0].comments[0].anchor.id = 'create'
  assert.ok(validateReview(foreign, ctx).some(e => e.includes('anchor')))
  const lying = clone(ok); lying.steps[0].points.filter = 'validated'
  assert.ok(validateReview(lying, ctx).some(e => e.includes('filter')))
  const wrongStep = clone(ok); wrongStep.steps[0].status = 'validated'
  assert.ok(validateReview(wrongStep, ctx).some(e => e.includes('status')))
  const empty = clone(ok); empty.steps[0].comments[0].text = '  '
  assert.ok(validateReview(empty, ctx).some(e => e.includes('text')))
  const dupId = clone(ok); dupId.steps[0].comments.push({ ...dupId.steps[0].comments[0] })
  assert.ok(validateReview(dupId, ctx).some(e => e.includes('duplicate comment id')))
  const allDone = { ...ok, steps: [{ stepId: 'client-show', status: 'validated', points: { archive: 'validated' }, comments: [] }] }
  assert.deepEqual(validateReview(allDone, ctx), [])
  // A tab left on a replaced round must not skip a step of the current round, nor send one twice.
  const required = { round: 1, steps: r1.steps, required: r1.steps.map(s => s.id) }
  assert.ok(validateReview(ok, required).some(e => e.includes('missing step')))
  const all = { ...ok, steps: r1.steps.map(s => ({ stepId: s.id, status: 'not_reached', comments: [], points: Object.fromEntries(s.points.map(p => [p.id, 'not_seen'])) })) }
  assert.deepEqual(validateReview(all, required), [])
  const twice = { ...all, steps: [...all.steps, all.steps[0]] }
  assert.ok(validateReview(twice, required).some(e => e.includes('duplicate step')))
  const stepComment = { ...ok, steps: [{ stepId: 'client-show', status: 'commented', points: { archive: 'not_seen' },
    comments: [{ id: 'r1-k2', text: 'Global', anchor: { kind: 'step' } }] }] }
  assert.deepEqual(validateReview(stepComment, ctx), [])
})

test('prefill entries', () => {
  const ok = clone(r1); ok.steps[1].prefill = [
    { selector: 'input[name=name]', value: 'Bistro Test' },
    { selector: 'input[name=vip]', value: true },
    { selector: 'input[name=_username]', credential: 'admin', field: 'login' }
  ]
  assert.deepEqual(validateScenario(ok), [])
  const cases = [
    [{ value: 'x' }, 'selector'],
    [{ selector: 'a' }, 'value or credential'],
    [{ selector: 'a', value: 'x', credential: 'admin', field: 'login' }, 'value or credential'],
    [{ selector: 'a', credential: 'ghost', field: 'login' }, 'unknown prerequisite'],
    [{ selector: 'a', credential: 'admin', field: 'token' }, 'field'],
    [{ selector: 'a', value: 3 }, 'value']
  ]
  for (const [entry, word] of cases) {
    const s = clone(r1); s.steps[1].prefill = [entry]
    assert.ok(validateScenario(s).some(e => e.includes('prefill') && e.includes(word)), JSON.stringify(entry))
  }
})

test('next.detect needs a valid regular expression', () => {
  const ok = clone(r1); ok.steps[0].next.detect = { urlMatches: '^/clients/new$' }
  assert.deepEqual(validateScenario(ok), [])
  const bad = clone(r1); bad.steps[0].next.detect = { urlMatches: '(' }
  assert.ok(validateScenario(bad).some(e => e.includes('next.detect.urlMatches')))
  const notText = clone(r1); notText.steps[0].next.detect = { urlMatches: 3 }
  assert.ok(validateScenario(notText).some(e => e.includes('next.detect.urlMatches')))
})

// A review step whose comments were made on the app (element, text, zone) and on a point with a quote.
const appUrl = 'http://localhost:8000/clients'
const appReview = () => ({ format: REVIEW_FORMAT, round: 1, submittedAt: '2026-10-31T14:02:00Z', steps: [{
  stepId: 'clients-list', status: 'commented', points: { sort: 'commented', filter: 'not_seen', search: 'not_seen' },
  comments: [
    { id: 'r1-k1', text: 'Which cost?', anchor: { kind: 'point', id: 'sort', quote: 'A sort to add.' } },
    { id: 'r1-k2', text: 'What does it count?', anchor: { kind: 'element', url: appUrl,
      element: { selector: 'table thead th:nth-of-type(3)', unique: true, tag: 'th', role: 'columnheader', text: 'People' },
      quote: null, rect: { x: 412, y: 188, width: 96, height: 32 }, capture: 'captures/r1-k2.png',
      context: { consoleErrors: 0, lastRequest: { method: 'GET', url: appUrl, status: 200 } } } },
    { id: 'r1-k3', text: 'Cut label.', anchor: { kind: 'text', url: appUrl, quote: 'Search a cli',
      element: { selector: 'input[name=q]', unique: true, tag: 'input', role: 'textbox', text: 'Search a client' },
      rect: { x: 10, y: 20, width: 120, height: 18 }, capture: null, context: { consoleErrors: 1, lastRequest: null } } },
    { id: 'r1-k4', text: 'Too much space.', anchor: { kind: 'zone', url: appUrl, element: null, quote: null,
      rect: { x: 0, y: 300, width: 320, height: 140 }, capture: null } }
  ],
  logs: [
    { level: 'error', text: 'TypeError: x is undefined', url: appUrl, at: '2026-10-31T14:01:12Z' },
    { level: 'warning', text: 'Deprecated API', url: appUrl, at: '2026-10-31T14:01:13Z' }
  ],
  requests: [{ method: 'POST', url: appUrl, status: 500, error: null, type: 'main_frame', at: '2026-10-31T14:01:20Z' }]
}] })
const appCtx = { round: 1, steps: r1.steps, hasCapture: name => name === 'captures/r1-k2.png' }

test('review accepts app comments, quotes, logs and requests', () => {
  assert.deepEqual(validateReview(appReview(), appCtx), [])
})

test('review rejects malformed app comments', () => {
  const cases = [
    [r => { r.steps[0].comments[1].anchor.url = 'javascript:x' }, 'url'],
    [r => { r.steps[0].comments[1].anchor.capture = '../state.json' }, 'capture'],
    [r => { r.steps[0].comments[1].anchor.capture = 'captures/r1-k9.png' }, 'capture'],
    [r => { delete r.steps[0].comments[1].anchor.rect.width }, 'rect'],
    [r => { r.steps[0].comments[1].anchor.element = null }, 'element'],
    [r => { r.steps[0].comments[2].anchor.quote = '' }, 'quote'],
    [r => { r.steps[0].comments[1].anchor.context.consoleErrors = -1 }, 'context'],
    [r => { r.steps[0].logs[0].level = 'info' }, 'level'],
    [r => { r.steps[0].logs = Array(101).fill(r.steps[0].logs[0]) }, 'logs'],
    [r => { r.steps[0].requests[0].status = '500' }, 'status'],
    [r => { r.steps[0].requests[0].at = 'yesterday' }, 'at']
  ]
  for (const [change, word] of cases) {
    const r = appReview(); change(r)
    const errors = validateReview(r, appCtx)
    assert.ok(errors.some(e => e.includes(word)), `${change}: ${errors.join(' | ')}`)
  }
})
