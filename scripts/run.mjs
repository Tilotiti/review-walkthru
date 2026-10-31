// Commands the skill runs around a review.
//   node run.mjs check
//   node run.mjs init --data <dir> --repo <owner/name> --number <n> [--restart]
//   node run.mjs round <runDir> <scenario.json> [--replace]
//   node run.mjs port <runDir>
//   node run.mjs open <runDir>
//   node run.mjs extension
import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, delimiter, sep, win32, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { startUrl } from '../page/review.mjs'
import { runDir, projectFile, initRun, readState, writeState, addRound, pageUrl, freePort } from './lib/rundir.mjs'

export { startUrl }

const LINUX_CHROMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
// Chrome's install folders on Windows: for all users (64 and 32 bits), then per user.
const WINDOWS_DIRS = ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA']

export const EXTENSION_ID = 'kjigknfmabifbopeelbckkilheemoedh'
export const MIN_EXTENSION_VERSION = '0.5.0'
export const STORE_URL = `https://chromewebstore.google.com/detail/${EXTENSION_ID}`

export function findOnPath (names, pathEnv) {
  const dirs = pathEnv.split(delimiter).filter(Boolean)
  for (const name of names) {
    for (const dir of dirs) if (existsSync(join(dir, name))) return join(dir, name)
  }
  return null
}

// process.env ignores case on Windows, so ProgramFiles also finds PROGRAMFILES.
export function findChrome (platform, env = process.env, exists = existsSync) {
  if (platform === 'darwin') return ['/Applications', join(homedir(), 'Applications')].map(dir => join(dir, 'Google Chrome.app')).find(exists) ?? null
  if (platform === 'win32') {
    return WINDOWS_DIRS.filter(name => env[name]).map(name => win32.join(env[name], 'Google', 'Chrome', 'Application', 'chrome.exe')).find(exists) ?? null
  }
  return findOnPath(LINUX_CHROMES, env.PATH ?? '')
}

// profile: the Chrome profile folder that holds the extension ("Default", "Profile 1"…).
export function chromeCommand (platform, urls, chrome = findChrome(platform), profile = null) {
  const args = [...(profile ? [`--profile-directory=${profile}`] : []), '--new-window', ...urls]
  if (platform === 'darwin') return { cmd: 'open', args: ['-na', 'Google Chrome', '--args', ...args] }
  if (!chrome) {
    throw new Error(platform === 'win32'
      ? `Chrome not found in ${WINDOWS_DIRS.map(name => `%${name}%`).join(', ')}`
      : `Chrome not found on PATH (looked for ${LINUX_CHROMES.join(', ')})`)
  }
  return { cmd: chrome, args }
}

export function chromeUserDataDir (platform, env = process.env, home = homedir()) {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Google', 'Chrome')
  if (platform === 'win32') return env.LOCALAPPDATA ? win32.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data') : null
  return join(home, '.config', 'google-chrome')
}

// Reads Chrome's own files: Local State for the profiles, then each profile's preferences for the
// extension. Chrome may change these files: anything unexpected makes the result unreadable,
// never a crash, and the review page checks again for itself.
export function findExtension (userDataDir, { readFile = path => readFileSync(path, 'utf8'), exists = existsSync } = {}) {
  const result = { readable: true, lastUsed: null, profiles: [] }
  try {
    const { profile } = JSON.parse(readFile(join(userDataDir, 'Local State')))
    result.lastUsed = profile?.last_used ?? null
    for (const [dir, info] of Object.entries(profile?.info_cache ?? {})) {
      const files = ['Secure Preferences', 'Preferences'].map(name => join(userDataDir, dir, name)).filter(exists)
      const settings = files.map(file => JSON.parse(readFile(file)).extensions?.settings?.[EXTENSION_ID]).find(Boolean)
      if (!settings) continue
      const path = String(settings.path ?? '')
      const version = isAbsolute(path) || win32.isAbsolute(path)
        ? JSON.parse(readFile(join(path, 'manifest.json'))).version ?? null
        : /\/([\d.]+)_\d+$/.exec(path)?.[1] ?? null
      result.profiles.push({ dir, name: info?.name ?? dir, version, enabled: !settings.disable_reasons?.length })
    }
  } catch {
    result.readable = false
  }
  return result
}

const versionAtLeast = (version, min) => {
  const a = String(version).split('.').map(Number)
  const b = min.split('.').map(Number)
  for (let i = 0; i < b.length; i++) if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i]
  return true
}

// The profile to open: the last used one when it has a usable copy, else the first that does.
export function extensionStatus (found, min = MIN_EXTENSION_VERSION) {
  if (!found.readable) return { ok: false, profile: null, problem: 'unreadable' }
  const usable = found.profiles.filter(p => p.enabled && p.version && versionAtLeast(p.version, min))
  const profile = usable.find(p => p.dir === found.lastUsed) ?? usable[0]
  if (profile) return { ok: true, profile: profile.dir, problem: null }
  const problem = !found.profiles.length ? 'absent' : !found.profiles.some(p => p.enabled) ? 'disabled' : 'outdated'
  return { ok: false, profile: null, problem }
}

const MISSING = {
  absent: 'the Review Walkthru Chrome extension (install it from the Chrome Web Store)',
  disabled: 'the Review Walkthru extension enabled in Chrome',
  outdated: `the Review Walkthru extension ${MIN_EXTENSION_VERSION} or later`
}

function extension () {
  const dir = chromeUserDataDir(process.platform)
  const found = dir ? findExtension(dir) : { readable: false, lastUsed: null, profiles: [] }
  return { ...extensionStatus(found), profiles: found.profiles }
}

// Claude copies these paths into Git Bash or PowerShell commands: both take forward slashes.
const slashes = path => path.split(sep).join('/')

const run = promisify(execFile)

async function check () {
  const missing = []
  if (Number(process.versions.node.split('.')[0]) < 18) missing.push(`Node.js 18 or later (found ${process.versions.node})`)
  try { await run('gh', ['--version']) } catch { missing.push('gh, the GitHub CLI (https://cli.github.com)') }
  try { await run('gh', ['auth', 'status']) } catch { missing.push('a signed-in gh (run: gh auth login)') }
  if (!findChrome(process.platform)) missing.push('Google Chrome')
  const ext = extension()
  if (MISSING[ext.problem]) missing.push(MISSING[ext.problem])
  return { ok: missing.length === 0, missing, extension: ext }
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
      return { runDir: slashes(dir), projectFile: slashes(projectFile(data, { owner, repo })), worktree: slashes(join(dir, 'worktree')), pageUrl: pageUrl(state), round: state.round, resumed }
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
      // Only the review page: the extension opens the app next to it in split view.
      // In the profile that holds the extension, when Chrome's files say which one.
      const { cmd, args: chromeArgs } = chromeCommand(process.platform, [page], undefined, extension().profile)
      spawn(cmd, chromeArgs, { detached: true, stdio: 'ignore' }).unref()
      return { opened: true, pageUrl: page }
    }
    case 'extension': {
      const { cmd, args: chromeArgs } = chromeCommand(process.platform, [STORE_URL])
      spawn(cmd, chromeArgs, { detached: true, stdio: 'ignore' }).unref()
      return { opened: true, url: STORE_URL }
    }
    default: throw new Error('usage: run.mjs check | init | round | port | open | extension')
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    result => console.log(JSON.stringify(result, null, 2)),
    error => { console.error(error.message); process.exitCode = 1 }
  )
}
