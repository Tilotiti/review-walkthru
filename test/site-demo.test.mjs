import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isFinish } from '../page/review.mjs'
import { validateScenario } from '../scripts/lib/format.mjs'

// The site's demo runs the real review page on these two rounds.
const read = file => JSON.parse(readFileSync(new URL(`../site/demo/${file}`, import.meta.url), 'utf8'))
const round1 = read('scenario-1.json')
const round2 = read('scenario-2.json')

test('demo scenarios are valid', () => {
  assert.deepEqual(validateScenario(round1), [])
  assert.deepEqual(validateScenario(round2), [])
})

test('round 2 skips only steps that exist in round 1', () => {
  const ids = round1.steps.map(step => step.id)
  assert.ok(round2.skipped.length > 0)
  for (const { stepId } of round2.skipped) assert.ok(ids.includes(stepId), stepId)
})

test('every demo path has a mock app page', () => {
  for (const step of [...round1.steps, ...round2.steps]) {
    for (const p of [step.path, step.start]) {
      if (typeof p !== 'string' || !p.startsWith('/')) continue
      const page = new URL(`../site/demo/app${p.replace(/\/$/, '')}/index.html`, import.meta.url)
      assert.ok(existsSync(page), `${step.id}: no mock page for ${p}`)
    }
  }
})

// The demo's fake relay, app link routing and reset (site/demo/shim.mjs).
const { createDemoFetch, appPage, resetDemo } = await import('../site/demo/shim.mjs')
const { buildSite } = await import('../scripts/build-site.mjs')

const allValidated = {
  format: 'review-walkthru/review@2',
  round: 1,
  steps: round1.steps.map(step => ({
    id: step.id,
    status: 'validated',
    points: Object.fromEntries(step.points.map(p => [p.id, 'validated'])),
    comments: []
  }))
}

test('createDemoFetch serves the round, then marks it submitted', async () => {
  const sent = []
  const fetchDemo = createDemoFetch({ round: 1, scenario: round1, credentials: [], skippedSteps: [], submitted: false },
    { onSend: review => sent.push(review), realFetch: () => { throw new Error('no network in the demo') }, isFinish })

  const before = await (await fetchDemo('api/round', { cache: 'no-store' })).json()
  assert.equal(before.submitted, false)
  assert.equal(before.scenario.pr.number, 128)

  const res = await fetchDemo('api/review', { method: 'POST', body: JSON.stringify(allValidated) })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true, finish: true })
  assert.deepEqual(sent, [allValidated])

  const after = await (await fetchDemo('http://localhost:8123/demo/api/round')).json()
  assert.equal(after.submitted, true)
})

test('createDemoFetch leaves other requests to the real fetch', async () => {
  const fetchDemo = createDemoFetch({ round: 1, scenario: round1, credentials: [], skippedSteps: [], submitted: false },
    { onSend: () => {}, realFetch: async url => new Response(`real ${url}`), isFinish })
  assert.equal(await (await fetchDemo('style.css')).text(), 'real style.css')
})

test('appPage maps app URLs to mock pages', () => {
  assert.equal(appPage('http://localhost:8000/clients/42'), 'app/clients/42/')
  assert.equal(appPage('http://localhost:8000/clients'), 'app/clients/')
  assert.equal(appPage('http://localhost:8000/clients/'), 'app/clients/')
  assert.equal(appPage('http://localhost:8000/'), 'app/clients/')
})

test('resetDemo removes only the demo keys', () => {
  const data = new Map([['rw:fernhill/crm#128:r1', '{}'], ['rw:fernhill/crm#128:submitted', '{}'], ['other', '1']])
  const storage = { get length () { return data.size }, key: i => [...data.keys()][i] ?? null, removeItem: k => data.delete(k) }
  assert.equal(resetDemo(storage, 'rw:fernhill/crm#128'), 2)
  assert.deepEqual([...data.keys()], ['other'])
})

test('buildSite assembles the demo next to the real page code', async () => {
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const out = await mkdtemp(join(tmpdir(), 'rw-site-'))
  await buildSite({ root: fileURLToPath(new URL('..', import.meta.url)), out })
  for (const file of ['index.html', 'demo/index.html', 'demo/app.mjs', 'demo/review.mjs', 'demo/i18n.mjs', 'demo/style.css', 'demo/app/clients/index.html']) {
    assert.ok(existsSync(join(out, file)), file)
  }
})
