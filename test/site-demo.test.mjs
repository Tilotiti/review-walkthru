import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
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
