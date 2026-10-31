// Local relay between the review page and the session.
//   node relay.mjs <runDir>
// Serves the page and the current round under /<token>/, accepts one review,
// writes it, prints `REVIEW <file>` or `FINISH <file>`, then exits: the end of
// this background command is what wakes the session up.
import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readState, currentRound, pageUrl, writeJson } from './lib/rundir.mjs'
import { validateReview } from './lib/format.mjs'
import { isFinish } from '../page/review.mjs'

const PAGE_DIR = fileURLToPath(new URL('../page/', import.meta.url))
const MAX_BODY_BYTES = 1024 * 1024
const STATIC = {
  '': ['index.html', 'text/html; charset=utf-8'],
  'style.css': ['style.css', 'text/css; charset=utf-8'],
  'app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'],
  'review.mjs': ['review.mjs', 'text/javascript; charset=utf-8'],
  'i18n.mjs': ['i18n.mjs', 'text/javascript; charset=utf-8'],
  'favicon.svg': ['favicon.svg', 'image/svg+xml']
}

const dir = process.argv[2]
if (!dir || !existsSync(join(dir, 'state.json'))) {
  process.stderr.write('usage: relay.mjs <runDir> (a folder created by run.mjs init)\n')
  process.exit(1)
}
const state = await readState(dir)
const prefix = Buffer.from(`/${state.token}/`)
const allowedHosts = [`127.0.0.1:${state.port}`, `localhost:${state.port}`]
let closing = false

function reply (res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff'
  })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

// Returns the route after /<token>/, or null when the token does not match.
function route (pathname) {
  const candidate = Buffer.from(pathname.slice(0, prefix.length))
  if (candidate.length !== prefix.length || !timingSafeEqual(candidate, prefix)) return null
  return pathname.slice(prefix.length)
}

function readBody (req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size <= MAX_BODY_BYTES) chunks.push(chunk) // past the limit, drain without keeping
    })
    req.on('end', () => resolve(size > MAX_BODY_BYTES ? null : Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function acceptReview (req, res) {
  if (!String(req.headers['content-type']).startsWith('application/json')) return reply(res, 415, { error: 'Content-Type must be application/json' })
  const raw = await readBody(req)
  if (raw === null) return reply(res, 413, { error: 'body larger than 1 MiB' })
  let review
  try { review = JSON.parse(raw) } catch { return reply(res, 400, { error: 'body is not JSON' }) }

  const round = await currentRound(dir)
  if (round.submitted || closing) return reply(res, 409, { error: `round ${round.round} was already sent` })
  const errors = validateReview(review, {
    round: round.round,
    steps: [...round.scenario.steps, ...round.skippedSteps],
    required: round.scenario.steps.map(step => step.id)
  })
  if (errors.length) return reply(res, 422, { errors })

  closing = true
  const file = join(dir, `review-${round.round}.json`)
  try {
    await writeJson(file, review)
  } catch (error) {
    closing = false // nothing was written: the page may send again
    throw error
  }
  const finish = isFinish(review)
  // The review is on disk: the session must wake up even if the tab went away
  // before the answer. Announce once the answer is out, or after 1 s at most.
  let announced = false
  const announce = () => {
    if (announced) return
    announced = true
    server.close()
    process.stdout.write(`${finish ? 'FINISH' : 'REVIEW'} ${file}\n`, () => process.exit(0))
  }
  res.on('close', announce)
  setTimeout(announce, 1000)
  reply(res, 200, { ok: true, finish })
}

async function handle (req, res) {
  if (!allowedHosts.includes(req.headers.host)) return reply(res, 403, { error: 'forbidden host' })
  const target = route(new URL(req.url, 'http://127.0.0.1').pathname)
  if (target === null) return reply(res, 404, { error: 'not found' })

  if (target === 'api/review') {
    return req.method === 'POST' ? acceptReview(req, res) : reply(res, 405, { error: 'POST only' })
  }
  if (req.method !== 'GET') return reply(res, 405, { error: 'GET only' })
  if (target === 'api/round') return reply(res, 200, await currentRound(dir))
  const file = STATIC[target]
  if (!file) return reply(res, 404, { error: 'not found' })
  return reply(res, 200, await readFile(join(PAGE_DIR, file[0])), file[1])
}

const server = createServer((req, res) => {
  handle(req, res).catch(error => {
    process.stderr.write(`relay error: ${error.stack}\n`)
    if (!res.headersSent) reply(res, 500, { error: 'relay error' })
  })
})

// EACCES: on Windows, Hyper-V and WSL reserve port ranges at boot, which can take the
// port this review kept from an earlier session.
server.on('error', error => {
  if (!['EADDRINUSE', 'EACCES'].includes(error.code)) throw error
  process.stderr.write(`ERROR port ${state.port} unavailable (${error.code})\n`)
  process.exit(2)
})

server.listen(state.port, '127.0.0.1', () => {
  process.stdout.write(`READY ${pageUrl(state)}\n`)
})
