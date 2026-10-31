import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDir, projectFile, initRun, readState, addRound, currentRound, pageUrl } from '../scripts/lib/rundir.mjs'
import { r1, r2, clone } from './helpers.mjs'

let dir
beforeEach(async () => { dir = join(await mkdtemp(join(tmpdir(), 'rw-')), 'run') })

test('paths', () => {
  assert.equal(runDir('/data', { owner: 'acme', repo: 'shop', number: 12 }), join('/data', 'runs', 'acme-shop-12'))
  assert.equal(projectFile('/data', { owner: 'acme', repo: 'shop' }), join('/data', 'projects', 'acme-shop.json'))
  assert.equal(pageUrl({ port: 5000, token: 'abc' }), 'http://127.0.0.1:5000/abc/')
})

test('initRun creates, then resumes', async () => {
  const a = await initRun(dir)
  assert.equal(a.resumed, false); assert.equal(a.state.round, 0)
  assert.match(a.state.token, /^[0-9a-f]{64}$/); assert.ok(a.state.port > 0)
  const b = await initRun(dir)
  assert.equal(b.resumed, true); assert.deepEqual(b.state, a.state)
})

test('addRound validates and numbers rounds', async () => {
  await initRun(dir)
  await assert.rejects(addRound(dir, r2), /round/) // expected round 1
  const bad = clone(r1); bad.steps[0].next.stepId = 'nope'
  await assert.rejects(addRound(dir, bad), /next.stepId/)
  assert.equal(await addRound(dir, r1), 1)
  assert.equal((await readState(dir)).round, 1)
})

test('addRound refuses a round that drops a step without a reason', async () => {
  await initRun(dir); await addRound(dir, r1)
  const dropped = clone(r2); dropped.skipped = dropped.skipped.filter(s => s.stepId !== 'client-new')
  await assert.rejects(addRound(dir, dropped), /client-new/)
  const unknown = clone(r2); unknown.skipped.push({ stepId: 'ghost', reason: 'x' })
  await assert.rejects(addRound(dir, unknown), /ghost/)
  assert.equal(await addRound(dir, r2), 2)
})

test('addRound replaces the current round until its review arrives', async () => {
  await initRun(dir)
  await assert.rejects(addRound(dir, r1, { replace: true }), /nothing to replace/)
  await addRound(dir, r1)
  const fixed = clone(r1); fixed.title = 'Fixed'
  assert.equal(await addRound(dir, fixed, { replace: true }), 1)
  assert.equal((await currentRound(dir)).scenario.title, 'Fixed')
  assert.equal((await readState(dir)).round, 1)
  await addRound(dir, r2)
  const dropped = clone(r2); dropped.skipped = dropped.skipped.slice(1)
  await assert.rejects(addRound(dir, dropped, { replace: true }), /neither kept nor skipped/) // still compared to round 1
  await writeFile(join(dir, 'review-2.json'), '{}')
  await assert.rejects(addRound(dir, r2, { replace: true }), /already sent/)
})

test('currentRound resolves skipped steps from earlier rounds', async () => {
  await initRun(dir); await addRound(dir, r1); await addRound(dir, r2)
  const cur = await currentRound(dir)
  assert.equal(cur.round, 2); assert.deepEqual(cur.credentials, []); assert.equal(cur.submitted, false)
  assert.deepEqual(cur.skippedSteps.map(s => s.id), ['clients-list', 'client-new', 'migration-archived'])
  await writeFile(join(dir, 'review-2.json'), '{}')
  assert.equal((await currentRound(dir)).submitted, true)
})

test('a work folder from before the points (scenario@1) asks for --restart', async () => {
  await initRun(dir); await addRound(dir, r1)
  const old = clone(r1); old.format = 'review-walkthru/scenario@1'
  await writeFile(join(dir, 'scenario-1.json'), JSON.stringify(old))
  await assert.rejects(initRun(dir), /--restart/)
  const again = await initRun(dir, { restart: true })
  assert.equal(again.state.round, 0)
})

test('restart keeps port and token, drops rounds', async () => {
  const { state } = await initRun(dir); await addRound(dir, r1)
  await writeFile(join(dir, 'review-1.json'), '{}')
  const again = await initRun(dir, { restart: true })
  assert.equal(again.state.round, 0); assert.equal(again.state.token, state.token); assert.equal(again.state.port, state.port)
  assert.equal(existsSync(join(dir, 'scenario-1.json')), false); assert.equal(existsSync(join(dir, 'review-1.json')), false)
})

test('restart removes captures', async () => {
  await initRun(dir)
  await mkdir(join(dir, 'captures'))
  await writeFile(join(dir, 'captures', 'r1-k1.png'), 'png')
  await initRun(dir, { restart: true })
  assert.equal(existsSync(join(dir, 'captures')), false)
})
