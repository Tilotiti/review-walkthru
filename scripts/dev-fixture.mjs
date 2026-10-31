// Development helper: prepares a work folder from the test fixtures, to look at the page.
//   node scripts/dev-fixture.mjs <dir> r1   (fresh folder, round 1, sample credentials)
//   node scripts/dev-fixture.mjs <dir> r2   (adds round 2 to that folder)
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { initRun, addRound, readState, pageUrl, writeJson } from './lib/rundir.mjs'

const [dir, which = 'r1'] = process.argv.slice(2)
if (!dir || !['r1', 'r2'].includes(which)) {
  console.error('usage: dev-fixture.mjs <dir> [r1|r2]')
  process.exit(1)
}
const fixture = JSON.parse(await readFile(new URL(`../test/fixtures/scenario-${which}.json`, import.meta.url), 'utf8'))
if (which === 'r1') {
  await initRun(dir, { restart: true })
  await writeJson(join(dir, 'credentials.json'), [
    { prerequisiteId: 'admin', login: 'admin@shop.example', password: 'test-only-123', note: 'Account created for the review' }
  ])
}
await addRound(dir, fixture)
console.log(pageUrl(await readState(dir)))
