// The work folder of one review: state.json, scenario-<n>.json, review-<n>.json,
// credentials.json and captures/, outside the reviewed repository.
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { validateScenario, SCENARIO_FORMAT } from './format.mjs'

export const runDir = (dataDir, { owner, repo, number }) => join(dataDir, 'runs', `${owner}-${repo}-${number}`)
export const projectFile = (dataDir, { owner, repo }) => join(dataDir, 'projects', `${owner}-${repo}.json`)
export const pageUrl = ({ port, token }) => `http://127.0.0.1:${port}/${token}/`

const readJson = async path => JSON.parse(await readFile(path, 'utf8'))

export async function writeFileAtomic (path, data) {
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}

export const writeJson = (path, value) => writeFileAtomic(path, JSON.stringify(value, null, 2) + '\n')

export function freePort () {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

export const readState = dir => readJson(join(dir, 'state.json'))
export const writeState = (dir, state) => writeJson(join(dir, 'state.json'), state)

export async function initRun (dir, { restart = false } = {}) {
  await mkdir(dir, { recursive: true })
  if (existsSync(join(dir, 'state.json'))) {
    const state = await readState(dir)
    if (!restart) {
      // A folder written before the points (scenario@1) cannot be resumed by this version.
      const current = join(dir, `scenario-${state.round}.json`)
      if (state.round > 0 && existsSync(current) && (await readJson(current)).format !== SCENARIO_FORMAT) {
        throw new Error('this review was started by an older version of review-walkthru: run it again with --restart')
      }
      return { state, resumed: true }
    }
    // Keep port and token so an open tab reconnects; drop every round.
    for (const name of await readdir(dir)) {
      if (/^(scenario|review)-\d+\.json$/.test(name)) await rm(join(dir, name))
    }
    await rm(join(dir, 'captures'), { recursive: true, force: true })
    state.round = 0
    await writeState(dir, state)
    return { state, resumed: false }
  }
  const state = { port: await freePort(), token: randomBytes(32).toString('hex'), round: 0 }
  await writeState(dir, state)
  return { state, resumed: false }
}

// replace: rewrite the current round, allowed until its review arrives.
export async function addRound (dir, scenario, { replace = false } = {}) {
  const state = await readState(dir)
  if (replace && state.round === 0) throw new Error('nothing to replace: no round yet')
  if (replace && existsSync(join(dir, `review-${state.round}.json`))) throw new Error(`round ${state.round} was already sent: write the next round instead`)
  const expected = replace ? state.round : state.round + 1
  if (scenario?.round !== expected) throw new Error(`round: expected ${expected}, got ${scenario?.round}`)
  const errors = validateScenario(scenario)
  if (expected > 1) {
    // Every step of the previous round is either kept or skipped with a reason.
    const previous = await readJson(join(dir, `scenario-${expected - 1}.json`))
    const before = new Set([...previous.steps.map(s => s.id), ...previous.skipped.map(s => s.stepId)])
    const kept = new Set(scenario.steps.map(s => s.id))
    const skipped = new Set(scenario.skipped.map(s => s.stepId))
    for (const id of before) if (!kept.has(id) && !skipped.has(id)) errors.push(`skipped: step "${id}" of round ${expected - 1} is neither kept nor skipped`)
    for (const id of skipped) if (!before.has(id)) errors.push(`skipped: unknown step "${id}"`)
  }
  if (errors.length) throw new Error('invalid scenario:\n' + errors.join('\n'))
  await writeJson(join(dir, `scenario-${expected}.json`), scenario)
  await writeState(dir, { ...state, round: expected })
  return expected
}

export async function currentRound (dir) {
  const { round } = await readState(dir)
  const scenario = await readJson(join(dir, `scenario-${round}.json`))
  const credentialsPath = join(dir, 'credentials.json')
  const credentials = existsSync(credentialsPath) ? await readJson(credentialsPath) : []

  // A skipped step lives in the latest earlier round that contained it.
  const skippedSteps = []
  for (const { stepId } of scenario.skipped ?? []) {
    for (let r = round - 1; r >= 1; r--) {
      const step = (await readJson(join(dir, `scenario-${r}.json`))).steps.find(s => s.id === stepId)
      if (step) { skippedSteps.push(step); break }
    }
  }
  return { round, scenario, credentials, skippedSteps, submitted: existsSync(join(dir, `review-${round}.json`)) }
}
