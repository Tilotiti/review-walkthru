import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initRun, addRound } from '../scripts/lib/rundir.mjs'
import { r1 } from './helpers.mjs'

const RELAY = fileURLToPath(new URL('../scripts/relay.mjs', import.meta.url))

const review = {
  format: 'review-walkthru/review@2',
  round: 1,
  submittedAt: '2026-10-31T14:02:00.000Z',
  steps: [
    { stepId: 'clients-list', status: 'commented', points: { sort: 'validated', filter: 'commented', search: 'not_seen' },
      comments: [{ id: 'r1-k1', text: 'The "Archived" status is missing.', anchor: { kind: 'point', id: 'filter' } }] },
    { stepId: 'client-new', status: 'not_reached', points: { create: 'not_seen', 'empty-name': 'not_seen' }, comments: [] },
    { stepId: 'client-show', status: 'not_reached', points: { archive: 'not_seen' }, comments: [] },
    { stepId: 'migration-archived', status: 'not_reached', points: { existing: 'not_seen', nullable: 'not_seen' }, comments: [] }
  ]
}
const finishing = {
  ...review,
  steps: r1.steps.map(s => ({
    stepId: s.id, status: 'validated', comments: [],
    points: Object.fromEntries(s.points.map(p => [p.id, 'validated']))
  }))
}

let dir, port, token, child

function startRelay () {
  const proc = spawn(process.execPath, [RELAY, dir], { stdio: ['ignore', 'pipe', 'pipe'] })
  proc.out = ''
  proc.err = ''
  proc.stderr.on('data', chunk => { proc.err += chunk })
  proc.ready = new Promise((resolve, reject) => {
    proc.stdout.on('data', chunk => { proc.out += chunk; if (proc.out.includes('READY ')) resolve() })
    proc.on('exit', code => reject(new Error(`relay exited with ${code}: ${proc.err}`)))
  })
  proc.ready.catch(() => {}) // the port-busy test never awaits it

  proc.done = new Promise(resolve => proc.on('exit', code => resolve({ code, stdout: proc.out, stderr: proc.err })))
  return proc
}

function send (method, path, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
    })
    req.on('error', reject)
    req.end(body)
  })
}
const get = (path, headers) => send('GET', path, { headers })
const post = (path, body, type = 'application/json') => send('POST', path, { body, headers: { 'Content-Type': type } })

beforeEach(async () => {
  dir = join(await mkdtemp(join(tmpdir(), 'rw-relay-')), 'run')
  const { state } = await initRun(dir)
  await addRound(dir, r1)
  port = state.port
  token = state.token
})

afterEach(() => { if (child && child.exitCode === null) child.kill() })

test('serves the page and the round under the token only', async () => {
  child = startRelay(); await child.ready
  assert.match(child.out, new RegExp(`READY http://127\\.0\\.0\\.1:${port}/${token}/`))
  assert.equal((await get(`/${token}/`)).status, 200)
  assert.equal((await get(`/${token}/review.mjs`)).headers['content-type'], 'text/javascript; charset=utf-8')
  const round = JSON.parse((await get(`/${token}/api/round`)).body)
  assert.equal(round.round, 1); assert.equal(round.scenario.steps.length, 4)
  assert.equal((await get('/wrongtoken/')).status, 404)
  assert.equal((await get(`/${token}/../state.json`)).status, 404)
  assert.equal((await get(`/${token}/state.json`)).status, 404)
  const page = await get(`/${token}/`)
  assert.equal(page.headers['access-control-allow-origin'], undefined)
  assert.equal(page.headers['referrer-policy'], 'no-referrer')
  assert.equal(page.headers['cache-control'], 'no-store')
})

test('refuses a foreign Host', async () => {
  child = startRelay(); await child.ready
  assert.equal((await get(`/${token}/`, { Host: 'evil.example:' + port })).status, 403)
  assert.equal((await get(`/${token}/`, { Host: `localhost:${port}` })).status, 200)
})

test('refuses simple cross-site posts and bad bodies, writes nothing', async () => {
  child = startRelay(); await child.ready
  assert.equal((await post(`/${token}/api/review`, JSON.stringify(review), 'text/plain')).status, 415)
  assert.equal((await post(`/${token}/api/review`, '{oops')).status, 400)
  const wrongRound = await post(`/${token}/api/review`, JSON.stringify({ ...review, round: 2 }))
  assert.equal(wrongRound.status, 422)
  assert.ok(JSON.parse(wrongRound.body).errors.some(e => e.includes('round')))
  assert.equal((await post(`/${token}/api/review`, 'x'.repeat(1_100_000))).status, 413)
  assert.equal((await post(`/wrongtoken/api/review`, JSON.stringify(review))).status, 404)
  assert.equal(existsSync(join(dir, 'review-1.json')), false)
  assert.equal(child.exitCode, null) // still serving
})

test('a valid review is written, announced, and the relay exits', async () => {
  child = startRelay(); await child.ready
  const res = await post(`/${token}/api/review`, JSON.stringify(review))
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.body), { ok: true, finish: false })
  const { code, stdout } = await child.done
  assert.equal(code, 0)
  assert.equal(stdout.trim().split('\n').at(-1), `REVIEW ${join(dir, 'review-1.json')}`)
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'review-1.json'), 'utf8')), review)
})

test('a client that drops right after sending still wakes the session', { timeout: 5000 }, async () => {
  child = startRelay(); await child.ready
  const req = request({ host: '127.0.0.1', port, method: 'POST', path: `/${token}/api/review`,
    headers: { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json' } })
  req.on('error', () => {})
  req.end(JSON.stringify(review), () => req.destroy()) // the tab closes before the answer
  const { code, stdout } = await child.done
  assert.equal(code, 0)
  assert.equal(stdout.trim().split('\n').at(-1), `REVIEW ${join(dir, 'review-1.json')}`)
})

test('a round with no comment and every step validated is a FINISH', async () => {
  child = startRelay(); await child.ready
  const res = await post(`/${token}/api/review`, JSON.stringify(finishing))
  assert.deepEqual(JSON.parse(res.body), { ok: true, finish: true })
  const { code, stdout } = await child.done
  assert.equal(code, 0)
  assert.equal(stdout.trim().split('\n').at(-1), `FINISH ${join(dir, 'review-1.json')}`)
})

// What the skill does on REVIEW: start the relay again at once, on the same port.
test('the relay starts again on the same port right after a review', async () => {
  child = startRelay(); await child.ready
  await post(`/${token}/api/review`, JSON.stringify(review))
  await child.done
  child = startRelay(); await child.ready
  assert.equal(JSON.parse((await get(`/${token}/api/round`)).body).submitted, true)
})

// On Windows an antivirus can hold the temp file and make the write fail: the page must
// be able to send again, not get a 409 it reads as "sent".
test('a review the relay could not write can be sent again', async () => {
  child = startRelay(); await child.ready
  const blocker = join(dir, `review-1.json.${child.pid}.tmp`) // writeJson's temp file
  await mkdir(blocker)
  assert.equal((await post(`/${token}/api/review`, JSON.stringify(review))).status, 500)
  await rm(blocker, { recursive: true })
  assert.equal((await post(`/${token}/api/review`, JSON.stringify(review))).status, 200)
  const { code, stdout } = await child.done
  assert.equal(code, 0)
  assert.equal(stdout.trim().split('\n').at(-1), `REVIEW ${join(dir, 'review-1.json')}`)
})

test('a relay restarted on a submitted round answers 409', async () => {
  await writeFile(join(dir, 'review-1.json'), JSON.stringify(review))
  child = startRelay(); await child.ready
  assert.equal((await post(`/${token}/api/review`, JSON.stringify(review))).status, 409)
  assert.equal(JSON.parse((await get(`/${token}/api/round`)).body).submitted, true)
})

test('port busy exits with code 2', async () => {
  const blocker = createServer()
  await new Promise(resolve => blocker.listen(port, '127.0.0.1', resolve))
  try {
    child = startRelay()
    const { code, stderr } = await child.done
    assert.equal(code, 2)
    assert.match(stderr, new RegExp(`ERROR port ${port} unavailable \\(EADDRINUSE\\)`))
  } finally {
    blocker.close()
  }
})
