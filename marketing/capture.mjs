// Captures every marketing image from the built site, so visuals always show the real page.
//   npm run assets   (site images in site/, Store and GitHub images in dist/store/)
import { createServer } from 'node:http'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSite } from '../scripts/build-site.mjs'
import { shoot } from './shoot.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const built = join(root, 'dist', 'site')
const store = join(root, 'dist', 'store')
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }

rmSync(built, { recursive: true, force: true })
await buildSite({ root, out: built })
mkdirSync(join(root, 'site', 'img'), { recursive: true })
mkdirSync(store, { recursive: true })

// /_compose/* comes from marketing/compose; everything else from site/ (fresh images) then the build (the demo).
const server = createServer(async (req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (path.endsWith('/')) path += 'index.html'
  const candidates = path.startsWith('/_compose/')
    ? [join(root, 'marketing', 'compose', path.slice('/_compose/'.length))]
    : [join(root, 'site', path), join(built, path)]
  const file = candidates.find(f => existsSync(f) && statSync(f).isFile())
  if (!file) { res.writeHead(404).end(); return }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(await readFile(file))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const compose = (page, query = '') => `${base}/_compose/${page}${query}`

// Order matters: later compositions embed the images the first ones produce.
const jobs = [
  { url: compose('window.html', '?round=1&state=commented'), out: join(root, 'site/img/hero.png'), width: 1280, height: 800, scale: 2, script: 'window.ready' },
  { url: compose('window.html', '?round=2&state=fresh'), out: join(root, 'site/img/next-round.png'), width: 1280, height: 800, scale: 2, script: 'window.ready' },
  { url: compose('review.html', '?round=1&state=commented&frame=points'), out: join(root, 'site/img/points.png'), width: 520, height: 400, scale: 2, script: 'window.ready' },
  { url: compose('store-1.html'), out: join(store, 'screenshot-1.png'), width: 1280, height: 800 },
  { url: compose('store-2.html'), out: join(store, 'screenshot-2.png'), width: 1280, height: 800 },
  { url: compose('store-3.html'), out: join(store, 'screenshot-3.png'), width: 1280, height: 800 },
  { url: compose('store-4.html'), out: join(store, 'screenshot-4.png'), width: 1280, height: 800 },
  { url: compose('store-5.html'), out: join(store, 'screenshot-5.png'), width: 1280, height: 800 },
  { url: compose('tile.html'), out: join(store, 'tile-440x280.png'), width: 440, height: 280 },
  { url: compose('marquee.html'), out: join(store, 'marquee-1400x560.png'), width: 1400, height: 560 },
  { url: compose('social.html'), out: join(root, 'site/og.png'), width: 1280, height: 640 },
  { url: compose('social.html'), out: join(store, 'github-social-preview.png'), width: 1280, height: 640 }
]
const only = process.argv[2]
try {
  for (const job of jobs.filter(job => !only || job.out.includes(only))) console.log(await shoot(job))
} finally {
  server.close()
}
