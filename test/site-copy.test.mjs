import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

// Public copy rules for the website and the README.
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const pages = readdirSync(new URL('../site/', import.meta.url)).filter(f => f.endsWith('.html')).map(f => `site/${f}`)
const index = read('site/index.html')

test('no em or en dashes in public copy', () => {
  for (const file of [...pages, 'README.md']) assert.doesNotMatch(read(file), /[—–]/, file)
})

test('the headline and subhead are verbatim', () => {
  assert.ok(index.includes("Don't merge what you haven't seen."))
  assert.ok(index.includes('Review Walkthru turns a pull request into a real acceptance test: every screen, every decision Claude made, checked in your running app.'))
})

test('every image has alt text', () => {
  for (const file of pages) {
    for (const tag of read(file).match(/<img\b[^>]*>/g) ?? []) assert.match(tag, /\balt=/, `${file}: ${tag}`)
  }
})

test('the demo has a no-JavaScript fallback', () => {
  assert.match(index, /<noscript>/)
})

test('the rail has a point for each section', () => {
  for (const id of ['why', 'how', 'try', 'install']) {
    assert.match(index, new RegExp(`<section[^>]*id="${id}"[^>]*data-rail`), `section ${id}`)
    assert.match(index, new RegExp(`data-point="${id}"`), `rail point ${id}`)
  }
})

test('without JavaScript the live demo hides and points to the install', () => {
  assert.match(read('site/style.css'), /@media \(scripting: none\) \{[^}]*\.panes/)
  assert.match(index.match(/<noscript>[\s\S]*?<\/noscript>/)[0], /href="#install"/)
})

test('the Chrome button says the extension is pending review', () => {
  const button = index.match(/<a[^>]*chromewebstore[^>]*>([\s\S]*?)<\/a>/)[1]
  assert.match(button, /pending review/i)
  assert.match(read('README.md'), /chromewebstore[^)]*\)?[^\n]*pending/i)
})

test('How steps that are not current keep their text readable', () => {
  assert.doesNotMatch(read('site/style.css'), /\.steps li \{[^}]*opacity: 0\.[0-6]/)
})

test('the illustrative terminal in the hero is labeled for everyone', () => {
  assert.match(index, /class="term hero-term" role="img" aria-label="[^"]*illustrative/)
  assert.match(index, /<figcaption[^>]*>[^<]*illustrative/i)
})

test('the README header is centered', () => {
  assert.match(read('README.md'), /^<div align="center">/)
})

test('the extension is required: no manual fallback in the copy', () => {
  for (const file of [...pages, 'README.md']) assert.doesNotMatch(read(file), /Open the app alongside/, file)
})

test('the privacy page says what the extension reads', () => {
  const privacy = read('site/privacy.html')
  assert.match(privacy, /capture/)
  assert.match(privacy, /console/)
  assert.doesNotMatch(privacy, /collects no data/)
})
