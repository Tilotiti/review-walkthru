import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Strict YAML parsers (the plugin directory's among them) reject a plain value made of
// several bracket groups, such as `argument-hint: [pr] [--restart]`: quote it.
test('SKILL.md frontmatter quotes values made of bracket groups', () => {
  const frontmatter = readFileSync(new URL('../skills/review-walkthru/SKILL.md', import.meta.url), 'utf8').split('---')[1]
  for (const line of frontmatter.split('\n')) assert.doesNotMatch(line, /^[\w-]+: \[/, line)
})
