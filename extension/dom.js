// What the extension says about an element of the app, and how it fills a form field.
// A classic script: content scripts share globalThis.RW_DOM, and tests import it in Node.
(() => {
  // Ids that frameworks generate change from one load to the next: never use them.
  const GENERATED = /\d{4,}|[0-9a-f]{8,}|^:r|^(ember|react|mui|radix|headlessui)-/i
  const DATA_ATTRS = ['data-testid', 'data-test', 'data-cy']
  const FIELDS = ['input', 'select', 'textarea']
  const MAX_DEPTH = 5

  const tagOf = el => el.tagName.toLowerCase()
  const quote = value => `"${String(value).replace(/["\\]/g, '\\$&')}"`
  const idSelector = id => /^[A-Za-z][\w-]*$/.test(id) ? `#${id}` : `[id=${quote(id)}]`
  const usableId = (el, count) => el.id && !GENERATED.test(el.id) && count(idSelector(el.id)) === 1

  function step (el) {
    const tag = tagOf(el)
    const same = [...(el.parentElement?.children ?? [])].filter(child => child.tagName === el.tagName)
    return same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(el) + 1})` : tag
  }

  // count(selector) → how many elements of the page match it.
  function buildSelector (el, count) {
    if (usableId(el, count)) return { selector: idSelector(el.id), unique: true }
    const candidates = DATA_ATTRS.filter(name => el.getAttribute(name)).map(name => `[${name}=${quote(el.getAttribute(name))}]`)
    if (FIELDS.includes(tagOf(el)) && el.getAttribute('name')) candidates.push(`${tagOf(el)}[name=${quote(el.getAttribute('name'))}]`)
    for (const selector of candidates) if (count(selector) === 1) return { selector, unique: true }
    // A path of tags up to the closest ancestor with a usable id, five levels at most.
    const parts = []
    let node = el
    let anchor = null
    while (node && parts.length < MAX_DEPTH) {
      if (node !== el && usableId(node, count)) { anchor = idSelector(node.id); break }
      parts.unshift(step(node))
      node = node.parentElement
    }
    const selector = [anchor, ...parts].filter(Boolean).join(' > ')
    return { selector, unique: count(selector) === 1 }
  }

  const IMPLICIT = {
    button: 'button', textarea: 'textbox', select: 'combobox', th: 'columnheader', td: 'cell',
    h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
    img: 'img', nav: 'navigation', table: 'table', li: 'listitem', form: 'form'
  }
  const INPUT_ROLES = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button' }

  function roleOf (el) {
    if (el.getAttribute('role')) return el.getAttribute('role')
    const tag = tagOf(el)
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : null
    if (tag === 'input') return INPUT_ROLES[(el.getAttribute('type') ?? 'text').toLowerCase()] ?? 'textbox'
    return IMPLICIT[tag] ?? null
  }

  const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim()

  function textOf (el) {
    const text = [el.getAttribute('aria-label'), el.innerText, el.getAttribute('placeholder'), el.getAttribute('name')].map(clean).find(Boolean)
    return (text ?? '').slice(0, 80)
  }

  const describeElement = (el, count) => ({ ...buildSelector(el, count), tag: tagOf(el), role: roleOf(el), text: textOf(el) })

  // React and Vue track a field's value through their own setter: the native one, then the
  // events they listen to, make them see the change as a user's.
  function fillField (el, value, win) {
    const tag = tagOf(el)
    const type = String(el.type ?? '').toLowerCase()
    if (el.isContentEditable || (tag === 'input' && type === 'file')) return 'unsupported'
    if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
      const wanted = type === 'radio' ? true : Boolean(value)
      if (el.checked !== wanted) el.click() // the click fires the events frameworks listen to
      return 'filled'
    }
    const proto = { input: win.HTMLInputElement, textarea: win.HTMLTextAreaElement, select: win.HTMLSelectElement }[tag]?.prototype
    if (!proto) return 'unsupported'
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value))
    el.dispatchEvent(new win.Event('input', { bubbles: true }))
    el.dispatchEvent(new win.Event('change', { bubbles: true }))
    return 'filled'
  }

  // The element a point of the scenario names: the one visible match of its selector whose text
  // holds `text` (case ignored). None or several: null, rather than the wrong element.
  function findTarget (doc, { selector, text }) {
    let found = []
    try { found = [...doc.querySelectorAll(selector)] } catch { return null }
    const wanted = clean(text).toLowerCase()
    const matches = found.filter(el => el.getClientRects().length > 0 &&
      (!wanted || clean([el.innerText, el.getAttribute('aria-label'), el.getAttribute('value')].join(' ')).toLowerCase().includes(wanted)))
    return matches.length === 1 ? matches[0] : null
  }

  globalThis.RW_DOM = { buildSelector, roleOf, textOf, describeElement, fillField, findTarget }
})()
