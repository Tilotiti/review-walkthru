// Assembles the website: site/ as is, plus the real review page code in demo/,
// so the demo always runs the plugin's current page.
//   node scripts/build-site.mjs   (writes dist/site)
import { cp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PAGE_FILES = ['app.mjs', 'review.mjs', 'i18n.mjs', 'style.css', 'favicon.svg']

export async function buildSite ({ root, out }) {
  await cp(join(root, 'site'), out, { recursive: true })
  for (const file of PAGE_FILES) await cp(join(root, 'page', file), join(out, 'demo', file))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const out = join(root, 'dist', 'site')
  await rm(out, { recursive: true, force: true })
  await buildSite({ root, out })
  console.log(out)
}
