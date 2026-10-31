import { test } from 'node:test'
import assert from 'node:assert/strict'

await import('../extension/dom.js')
const { buildSelector, roleOf, textOf, describeElement, fillField } = globalThis.RW_DOM

// The few DOM members dom.js reads, nothing more.
class El {
  constructor (tag, attrs = {}, children = [], text = '') {
    this.tagName = tag.toUpperCase()
    this.attrs = attrs
    this.id = attrs.id ?? ''
    this.type = attrs.type ?? ''
    this.checked = Boolean(attrs.checked)
    this.innerText = text
    this.children = children
    this.parentElement = null
    this.events = []
    this.clicks = 0
    for (const child of children) child.parentElement = this
  }

  getAttribute (name) { return this.attrs[name] ?? null }
  hasAttribute (name) { return name in this.attrs }
  click () { this.clicks++; if (this.type === 'checkbox') this.checked = !this.checked; else this.checked = true }
  dispatchEvent (event) { this.events.push(event.type) }
}
const counter = (map = {}) => selector => map[selector] ?? 1

test('an id wins when unique and human', () => {
  assert.deepEqual(buildSelector(new El('button', { id: 'save' }), counter()), { selector: '#save', unique: true })
})

test('a generated id is skipped for data-testid', () => {
  const el = new El('button', { id: 'radix-12345', 'data-testid': 'new-client' })
  assert.deepEqual(buildSelector(el, counter()), { selector: '[data-testid="new-client"]', unique: true })
})

test('a form field uses its name', () => {
  assert.deepEqual(buildSelector(new El('input', { name: 'siret' }), counter()), { selector: 'input[name="siret"]', unique: true })
})

test('a nested cell gets an nth-of-type path under the closest id', () => {
  const ths = [new El('th'), new El('th'), new El('th', {}, [], 'People')]
  new El('table', { id: 'clients' }, [new El('thead', {}, [new El('tr', {}, ths)]), new El('tbody')])
  assert.deepEqual(buildSelector(ths[2], counter()), { selector: '#clients > thead > tr > th:nth-of-type(3)', unique: true })
})

test('a non-unique selector is flagged', () => {
  const cell = new El('td')
  new El('tr', {}, [cell])
  assert.deepEqual(buildSelector(cell, counter({ 'tr > td': 4 })), { selector: 'tr > td', unique: false })
})

test('roleOf, explicit or implicit', () => {
  const cases = [
    [new El('a', { href: '/x' }), 'link'], [new El('a'), null], [new El('button'), 'button'],
    [new El('input', { type: 'submit' }), 'button'], [new El('input', { type: 'checkbox' }), 'checkbox'],
    [new El('input', { type: 'radio' }), 'radio'], [new El('input', { type: 'email' }), 'textbox'], [new El('input'), 'textbox'],
    [new El('textarea'), 'textbox'], [new El('select'), 'combobox'], [new El('th'), 'columnheader'], [new El('td'), 'cell'],
    [new El('h2'), 'heading'], [new El('img'), 'img'], [new El('nav'), 'navigation'], [new El('table'), 'table'],
    [new El('li'), 'listitem'], [new El('form'), 'form'], [new El('div'), null], [new El('div', { role: 'tab' }), 'tab']
  ]
  for (const [el, role] of cases) assert.equal(roleOf(el), role, `${el.tagName} ${JSON.stringify(el.attrs)}`)
})

test('textOf prefers the label a user reads, and stays short', () => {
  assert.equal(textOf(new El('button', { 'aria-label': 'Close' }, [], '×')), 'Close')
  assert.equal(textOf(new El('p', {}, [], '  New\n   client  ')), 'New client')
  assert.equal(textOf(new El('input', { placeholder: 'Search a client', name: 'q' })), 'Search a client')
  assert.equal(textOf(new El('p', {}, [], 'x'.repeat(200))).length, 80)
  assert.deepEqual(describeElement(new El('button', { id: 'save' }, [], 'Save'), counter()),
    { selector: '#save', unique: true, tag: 'button', role: 'button', text: 'Save' })
})

// React keeps its own value setter on the input instance: the native one must be used.
function fakeWindow () {
  const native = []
  class Event { constructor (type, options) { this.type = type; this.bubbles = options?.bubbles } }
  const proto = name => Object.defineProperty({}, 'value', { set (value) { native.push([name, this, value]) }, configurable: true })
  return { native, Event, HTMLInputElement: { prototype: proto('input') }, HTMLTextAreaElement: { prototype: proto('textarea') }, HTMLSelectElement: { prototype: proto('select') } }
}

test('fillField sets the value through the native setter and fires input then change', () => {
  const win = fakeWindow()
  const input = new El('input', { type: 'text' })
  let instanceSetter = 0
  Object.defineProperty(input, 'value', { set () { instanceSetter++ }, configurable: true })
  assert.equal(fillField(input, 'Bistro Test', win), 'filled')
  assert.deepEqual(win.native, [['input', input, 'Bistro Test']])
  assert.equal(instanceSetter, 0)
  assert.deepEqual(input.events, ['input', 'change'])
  const select = new El('select')
  fillField(select, 'active', win)
  assert.equal(win.native[1][0], 'select')
})

test('fillField clicks a checkbox only when its state differs', () => {
  const win = fakeWindow()
  const box = new El('input', { type: 'checkbox' })
  assert.equal(fillField(box, true, win), 'filled'); assert.equal(box.clicks, 1)
  fillField(box, true, win); assert.equal(box.clicks, 1)
  fillField(box, false, win); assert.equal(box.clicks, 2)
  const radio = new El('input', { type: 'radio' })
  fillField(radio, true, win); fillField(radio, true, win)
  assert.equal(radio.clicks, 1)
})

test('fillField reports what it cannot fill', () => {
  const win = fakeWindow()
  assert.equal(fillField(new El('input', { type: 'file' }), 'x', win), 'unsupported')
  const editable = new El('div'); editable.isContentEditable = true
  assert.equal(fillField(editable, 'x', win), 'unsupported')
  assert.equal(fillField(new El('div'), 'x', win), 'unsupported')
})
