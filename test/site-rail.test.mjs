import { test } from 'node:test'
import assert from 'node:assert/strict'
import { railState } from '../site/rail.mjs'

// The site's rail reads like a review: points behind you are checked.
const ids = ['why', 'how', 'try', 'install']

test('points before the current one are done', () => {
  assert.deepEqual(railState(ids, 'try'), { why: 'done', how: 'done', try: 'now', install: 'todo' })
})

test('before any section, the first point is current', () => {
  assert.deepEqual(railState(ids, null), { why: 'now', how: 'todo', try: 'todo', install: 'todo' })
})

test('an unknown section counts as none', () => {
  assert.deepEqual(railState(ids, 'footer'), railState(ids, null))
})
