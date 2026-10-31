// Commands the skill runs around a review.
//   node run.mjs check
//   node run.mjs init --data <dir> --repo <owner/name> --number <n> [--restart]
//   node run.mjs round <runDir> <scenario.json> [--replace]
//   node run.mjs port <runDir>
//   node run.mjs open <runDir>
import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, delimiter } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { startUrl } from '../page/review.mjs'
import { runDir, projectFile, initRun, readState, writeState, addRound, pageUrl, freePort } from './lib/rundir.mjs'

export { startUrl }

const LINUX_CHROMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']



export function findOnPath (names, pathEnv) {
  const dirs = pathEnv.split(delimiter).filter(Boolean)
  for (const name of names) {
    for (const dir of dirs) if (existsSync(join(dir, name))) return join(dir, name)
  }
  return null
}

export function chromeCommand (platform, urls, findExecutable = names => findOnPath(names, process.env.PATH ?? '')) {
  if (platform === 'darwin') return { cmd: 'open', args: ['-na', 'Google Chrome', '--args', '--new-window', ...urls] }
  if (platform === 'win32') throw new Error('Windows arrives with MVP 2')
  const chrome = findExecutable(LINUX_CHROMES)
  if (!chrome) throw new Error(`Chrome not found on PATH (looked for ${LINUX_CHROMES.join(', ')})`)
  return { cmd: chrome, args: ['--new-window', ...urls] }
}

const run = promisify(execFile)

async function check () {
  const missing = []
  if (Number(process.versions.node.split('.')[0]) < 18) missing.push(`Node.js 18 or later (found ${process.versions.node})`)
  try { await run('gh', ['--version']) } catch { missing.push('gh, the GitHub CLI (https://cli.github.com)') }
  try { await run('gh', ['auth', 'status']) } catch { missing.push('a signed-in gh (run: gh auth login)') }
  const hasChrome = process.platform === 'darwin'
    ? ['/Applications', join(homedir(), 'Applications')].some(dir => existsSync(join(dir, 'Google Chrome.app')))
    : process.platform !== 'win32' && findOnPath(LINUX_CHROMES, process.env.PATH ?? '') !== null
  if (!hasChrome) missing.push('Google Chrome')
  if (process.platform === 'win32') missing.push('macOS or Linux (Windows arrives with MVP 2)')
  return { ok: missing.length === 0, missing }
}

async function waitForRelay (url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('relay not reachable at ' + url)
}

function option (args, name) {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

async function main ([command, ...args]) {
  switch (command) {
    case 'check': return check()
    case 'init': {
      const data = option(args, '--data')
      const [owner, repo] = (option(args, '--repo') ?? '').split('/')
      const number = Number(option(args, '--number'))
      if (!data || !owner || !repo || !Number.isInteger(number)) throw new Error('usage: run.mjs init --data <dir> --repo <owner/name> --number <n> [--restart]')
      const dir = runDir(data, { owner, repo, number })
      const { state, resumed } = await initRun(dir, { restart: args.includes('--restart') })
      return { runDir: dir, projectFile: projectFile(data, { owner, repo }), worktree: join(dir, 'worktree'), pageUrl: pageUrl(state), round: state.round, resumed }
    }
    case 'round': return { round: await addRound(args[0], JSON.parse(await readFile(args[1], 'utf8')), { replace: args.includes('--replace') }) }
    case 'port': {
      const state = { ...await readState(args[0]), port: await freePort() }
      await writeState(args[0], state)
      return { pageUrl: pageUrl(state) }
    }
    case 'open': {
      const page = pageUrl(await readState(args[0]))
      await waitForRelay(page + 'api/round')
      // Only the review page: the extension opens the app next to it in split view,
      // and without the extension the page offers "Open the app alongside".
      const { cmd, args: chromeArgs } = chromeCommand(process.platform, [page])
      spawn(cmd, chromeArgs, { detached: true, stdio: 'ignore' }).unref()
      return { opened: true, pageUrl: page }
    }
    default: throw new Error('usage: run.mjs check | init | round | port | open')
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    result => console.log(JSON.stringify(result, null, 2)),
    error => { console.error(error.message); process.exitCode = 1 }
  )
}
