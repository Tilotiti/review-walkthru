import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Strict YAML parsers (the plugin directory's among them) reject a plain value made of
// several bracket groups, such as `argument-hint: [pr] [--restart]`: quote it.
test('SKILL.md frontmatter quotes values made of bracket groups', () => {
  const frontmatter = readFileSync(new URL('../skills/review-walkthru/SKILL.md', import.meta.url), 'utf8').split('---')[1]
  for (const line of frontmatter.split('\n')) assert.doesNotMatch(line, /^[\w-]+: \[/, line)
})

// The plugin directory builds the listing's links from these plugin.json fields.
test('plugin.json carries every directory listing link, and site links have a page', () => {
  const manifest = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8'))
  for (const field of ['homepage', 'documentationUrl', 'supportUrl', 'privacyPolicyUrl', 'termsOfServiceUrl']) {
    assert.match(manifest[field] ?? '', /^https:\/\//, field)
    const url = new URL(manifest[field])
    if (url.host === 'review-walkthru.henry.pro' && url.pathname.endsWith('.html')) {
      assert.ok(readFileSync(new URL(`../site${url.pathname}`, import.meta.url)), url.pathname)
    }
  }
})
