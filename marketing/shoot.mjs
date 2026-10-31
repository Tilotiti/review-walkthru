// Headless Chrome screenshots over the DevTools protocol (Node 22+ global WebSocket).
//   node marketing/shoot.mjs <url> <out.png> <width> <height> [scale] [script.js]   (SCHEME=dark, MOBILE=1)
// `script` is an expression evaluated after load; when it returns a promise, the capture waits for it.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function shoot ({ url, out, width, height, scale = 1, scheme = 'light', script = null, mobile = false }) {
  const port = 9300 + Math.floor(Math.random() * 600)
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'shoot-'))}`,
    '--hide-scrollbars', '--lang=en-US', '--accept-lang=en-US', '--no-first-run', 'about:blank'], { stdio: 'ignore' })
  try {
    let target
    for (let i = 0; i < 80 && !target; i++) {
      try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page') } catch { await sleep(100) }
    }
    if (!target) throw new Error('Chrome did not start')
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
    let id = 0
    const pending = new Map()
    ws.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    })
    const send = (method, params = {}) => new Promise(resolve => { pending.set(++id, resolve); ws.send(JSON.stringify({ id, method, params })) })
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile })
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
    await send('Page.navigate', { url })
    await sleep(1500)
    if (script) {
      const result = await send('Runtime.evaluate', { expression: script, awaitPromise: true })
      if (result.result?.exceptionDetails) throw new Error(`${url}: ${JSON.stringify(result.result.exceptionDetails.exception?.description ?? result.result.exceptionDetails)}`)
    }
    await send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true })
    await sleep(300)
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
    ws.close()
    return out
  } finally {
    chrome.kill()
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [url, out, width, height, scale = '1', scriptFile] = process.argv.slice(2)
  const script = scriptFile ? readFileSync(scriptFile, 'utf8') : null
  console.log(await shoot({ url, out, width: +width, height: +height, scale: +scale, scheme: process.env.SCHEME ?? 'light', script, mobile: process.env.MOBILE === '1' }))
}
