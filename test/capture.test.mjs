import { test } from 'node:test'
import assert from 'node:assert/strict'

let tab = { active: true }
let shot = async () => { throw new Error('no capture in this test') }
const shots = []
globalThis.chrome = {
  tabs: {
    get: async id => ({ id, ...tab }),
    captureVisibleTab: async (windowId, options) => { shots.push([windowId, options]); return shot() }
  }
}
const { cropBox, captureCrop } = await import('../extension/capture.js')

test('cropBox grows the rect, clamps it to the screen and scales it down', () => {
  const box = cropBox({ x: 10, y: 10, width: 100, height: 40 }, { width: 465, height: 1185 }, 2)
  assert.deepEqual([box.sx, box.sy, box.sw, box.sh], [0, 0, 268, 148]) // 24 px margin, clamped at 0
  assert.deepEqual([box.dw, box.dh], [268, 148])
  assert.deepEqual(box.target, { x: 20, y: 20, width: 200, height: 80 })
  const body = cropBox({ x: 0, y: 0, width: 2000, height: 3000 }, { width: 465, height: 1185 }, 2)
  assert.deepEqual([body.sx, body.sy, body.sw, body.sh], [0, 0, 930, 2370])
  assert.ok(Math.max(body.dw, body.dh) <= 1600)
  assert.equal(body.dh, 1600)
  const scrolledOff = cropBox({ x: 100, y: -500, width: 50, height: 50 }, { width: 400, height: 800 }, 1)
  assert.ok(scrolledOff.sh >= 1 && scrolledOff.sw >= 1) // never an empty canvas
})

test('capture is refused when the app is not the active half', async () => {
  tab = { active: false }; shots.length = 0
  assert.deepEqual(await captureCrop(1, 99, { x: 0, y: 0, width: 10, height: 10 }, { width: 400, height: 800 }, 2), { ok: false, error: 'app tab not active' })
  assert.deepEqual(shots, [])
})

test('a capture error comes back as a refusal', async () => {
  tab = { active: true }
  shot = async () => { throw new Error("Either the '<all_urls>' or 'activeTab' permission is required.") }
  assert.deepEqual(await captureCrop(1, 99, { x: 0, y: 0, width: 10, height: 10 }, { width: 400, height: 800 }, 2),
    { ok: false, error: "Either the '<all_urls>' or 'activeTab' permission is required." })
})
