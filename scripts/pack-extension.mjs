// Builds dist/extension.zip for the Chrome Web Store: the extension folder without the
// development key, which only gives an unpacked copy the Store ID. Uses the system zip
// (the maintainer's Mac).
//   npm run pack:extension
import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export function storeManifest (manifest) {
  const store = { ...manifest }
  delete store.key
  return store
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const out = join(root, 'dist', 'extension-pack')
  const zip = join(root, 'dist', 'extension.zip')
  await rm(out, { recursive: true, force: true })
  await rm(zip, { force: true })
  await mkdir(join(root, 'dist'), { recursive: true })
  await cp(join(root, 'extension'), out, { recursive: true })
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'))
  await writeFile(join(out, 'manifest.json'), JSON.stringify(storeManifest(manifest), null, 2) + '\n')
  execFileSync('zip', ['-qrX', zip, '.', '-x', '.*'], { cwd: out })
  console.log(zip)
}
