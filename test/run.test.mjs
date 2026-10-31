import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { startUrl, chromeCommand, findChrome, findOnPath } from '../scripts/run.mjs'
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

test('check accepts every platform, and finds Chrome on CI runners', async () => {
  const { missing } = await runCli('check')
  assert.ok(!missing.some(item => /macOS|Linux|Windows/.test(item)), missing.join(', '))
  if (process.env.CI) assert.ok(!missing.includes('Google Chrome'), 'the CI image ships Chrome')
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
