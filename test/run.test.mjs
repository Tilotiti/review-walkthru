import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { startUrl, chromeCommand, findChrome, findOnPath, chromeUserDataDir, findExtension, extensionStatus, EXTENSION_ID } from '../scripts/run.mjs'
import { r1, r2 } from './helpers.mjs'

test('startUrl', () => {
  assert.equal(startUrl(r1), 'http://localhost:8000/clients')
  assert.equal(startUrl(r2), 'http://localhost:8000/clients/42') // start wins over path
})

test('startUrl is shared with the page', async () => {
  const page = await import('../page/review.mjs')
  assert.equal(page.startUrl, startUrl)
})

const RUN = fileURLToPath(new URL('../scripts/run.mjs', import.meta.url))
const runCli = async (...args) => JSON.parse((await promisify(execFile)(process.execPath, [RUN, ...args])).stdout)

test('chromeCommand', () => {
  const urls = ['http://localhost:8000/clients', 'http://127.0.0.1:5000/t/']
  assert.deepEqual(chromeCommand('darwin', urls), { cmd: 'open', args: ['-na', 'Google Chrome', '--args', '--new-window', ...urls] })
  assert.deepEqual(chromeCommand('linux', urls, '/usr/bin/google-chrome'), { cmd: '/usr/bin/google-chrome', args: ['--new-window', ...urls] })
  const exe = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  assert.deepEqual(chromeCommand('win32', urls, exe), { cmd: exe, args: ['--new-window', ...urls] })
  assert.throws(() => chromeCommand('linux', urls, null), /Chrome/)
  assert.throws(() => chromeCommand('win32', urls, null), /Chrome/)
})

test('findChrome on Windows checks the install folders in order', () => {
  const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\Jean Dupont\\AppData\\Local' }
  const exe = dir => `${dir}\\Google\\Chrome\\Application\\chrome.exe`
  assert.equal(findChrome('win32', env, () => true), exe(env.ProgramFiles))
  assert.equal(findChrome('win32', env, path => path !== exe(env.ProgramFiles)), exe(env['ProgramFiles(x86)']))
  assert.equal(findChrome('win32', env, path => path === exe(env.LOCALAPPDATA)), exe(env.LOCALAPPDATA))
  assert.equal(findChrome('win32', env, () => false), null)
  assert.equal(findChrome('win32', {}, () => true), null)
})

test('check accepts every platform, and finds gh and Chrome on CI runners', async () => {
  const { missing } = await runCli('check')
  assert.ok(!missing.some(item => /macOS|Linux|Windows/.test(item)), missing.join(', '))
  if (process.env.CI) { // the runner images ship both
    assert.ok(!missing.includes('Google Chrome'), missing.join(', '))
    assert.ok(!missing.some(item => item.startsWith('gh,')), missing.join(', '))
  }
})

// Claude pastes these paths into shell commands: forward slashes survive Git Bash and PowerShell.
test('init prints forward-slash paths and creates the work folder', async () => {
  const data = await mkdtemp(join(tmpdir(), 'rw-cli-'))
  const out = await runCli('init', '--data', data, '--repo', 'octo/app', '--number', '7')
  for (const key of ['runDir', 'projectFile', 'worktree']) assert.doesNotMatch(out[key], /\\/, key)
  assert.equal(out.runDir, join(data, 'runs', 'octo-app-7').replaceAll('\\', '/'))
  assert.ok(existsSync(join(out.runDir, 'state.json')))
})

test('findOnPath returns the first match in PATH order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rw-path-'))
  const a = join(root, 'a'); const b = join(root, 'b')
  await mkdir(a); await mkdir(b)
  await writeFile(join(b, 'chromium'), '')
  assert.equal(findOnPath(['google-chrome', 'chromium'], [a, b].join(delimiter)), join(b, 'chromium'))
  assert.equal(findOnPath(['nope'], [a, b].join(delimiter)), null)
})

// A Chrome user data folder with two profiles; Profile 1 was used last.
async function chromeData () {
  const dir = await mkdtemp(join(tmpdir(), 'rw-chrome-'))
  await writeFile(join(dir, 'Local State'), JSON.stringify({ profile: { last_used: 'Profile 1', info_cache: { Default: { name: 'Perso' }, 'Profile 1': { name: 'Work' } } } }))
  await mkdir(join(dir, 'Default')); await mkdir(join(dir, 'Profile 1'))
  const prefs = (profile, settings, file = 'Secure Preferences') => writeFile(join(dir, profile, file), JSON.stringify({ extensions: { settings } }))
  return { dir, prefs }
}
const store = version => ({ [EXTENSION_ID]: { location: 1, path: `${EXTENSION_ID}/${version}_0` } })

test('an extension from the Store, in the last used profile', async () => {
  const { dir, prefs } = await chromeData()
  await prefs('Default', {}); await prefs('Profile 1', store('0.5.0'))
  const found = findExtension(dir)
  assert.deepEqual(found, { readable: true, lastUsed: 'Profile 1', profiles: [{ dir: 'Profile 1', name: 'Work', version: '0.5.0', enabled: true }] })
  assert.deepEqual(extensionStatus(found), { ok: true, profile: 'Profile 1', problem: null })
})

test('an unpacked extension in another profile, found in Preferences', async () => {
  const { dir, prefs } = await chromeData()
  const unpacked = await mkdtemp(join(tmpdir(), 'rw-unpacked-'))
  await writeFile(join(unpacked, 'manifest.json'), JSON.stringify({ version: '0.10.0' }))
  await prefs('Default', { [EXTENSION_ID]: { location: 4, path: unpacked } }, 'Preferences')
  assert.deepEqual(extensionStatus(findExtension(dir)), { ok: true, profile: 'Default', problem: null })
})

test('a disabled, an outdated or a missing extension is a problem', async () => {
  const disabled = await chromeData()
  await disabled.prefs('Profile 1', { [EXTENSION_ID]: { ...store('0.5.0')[EXTENSION_ID], disable_reasons: [1] } })
  assert.deepEqual(extensionStatus(findExtension(disabled.dir)), { ok: false, profile: null, problem: 'disabled' })
  const old = await chromeData()
  await old.prefs('Profile 1', store('0.4.0'))
  assert.deepEqual(extensionStatus(findExtension(old.dir)), { ok: false, profile: null, problem: 'outdated' })
  const none = await chromeData()
  await none.prefs('Profile 1', {})
  assert.deepEqual(extensionStatus(findExtension(none.dir)), { ok: false, profile: null, problem: 'absent' })
})

test('unreadable Chrome files do not block', async () => {
  const { dir } = await chromeData()
  await writeFile(join(dir, 'Local State'), '{')
  assert.equal(findExtension(dir).readable, false)
  assert.deepEqual(extensionStatus(findExtension(dir)), { ok: false, profile: null, problem: 'unreadable' })
  assert.equal(findExtension(join(dir, 'nowhere')).readable, false)
})

test('chromeUserDataDir per platform', () => {
  assert.equal(chromeUserDataDir('darwin', {}, '/Users/jo'), join('/Users/jo', 'Library', 'Application Support', 'Google', 'Chrome'))
  assert.equal(chromeUserDataDir('linux', {}, '/home/jo'), join('/home/jo', '.config', 'google-chrome'))
  assert.equal(chromeUserDataDir('win32', { LOCALAPPDATA: 'C:\\Users\\Jo\\AppData\\Local' }, 'C:\\Users\\Jo'), 'C:\\Users\\Jo\\AppData\\Local\\Google\\Chrome\\User Data')
  assert.equal(chromeUserDataDir('win32', {}, 'C:\\Users\\Jo'), null)
})

test('chromeCommand opens the profile that has the extension', () => {
  const urls = ['http://127.0.0.1:5000/t/']
  assert.deepEqual(chromeCommand('darwin', urls, null, 'Profile 1').args, ['-na', 'Google Chrome', '--args', '--profile-directory=Profile 1', '--new-window', ...urls])
  assert.deepEqual(chromeCommand('linux', urls, '/usr/bin/google-chrome', 'Default').args, ['--profile-directory=Default', '--new-window', ...urls])
  assert.deepEqual(chromeCommand('win32', urls, 'C:\\chrome.exe', 'Profile 2').args, ['--profile-directory=Profile 2', '--new-window', ...urls])
})
