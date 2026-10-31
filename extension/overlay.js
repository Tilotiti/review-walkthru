// What the reviewer sees on top of the app: the comment mode, the bubble, the button on a
// selected text, the numbered pins. One closed shadow root, so the app's styles and scripts
// leave it alone. app.js decides what each gesture does.
globalThis.RW_OVERLAY = (() => {
  const ORANGE = '#ff9f0a'
  const DRAG_PX = 6
  const msg = (key, ...args) => chrome.i18n.getMessage(key, args.map(String))
  const STYLE = `
    :host { all: initial; }
    * { box-sizing: border-box; font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
    .outline { position: fixed; border: 2px solid ${ORANGE}; border-radius: 4px; pointer-events: none; display: none; }
    .outline.zone { border-style: dashed; background: rgba(255, 159, 10, .08); }
    .bar { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); max-width: calc(100vw - 28px); padding: 7px 12px; border-radius: 9px;
      background: #18181b; color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.25); pointer-events: auto; display: none; }
    .bubble { position: fixed; width: 300px; max-width: calc(100vw - 16px); padding: 10px; border-radius: 12px; background: #fff; color: #18181b;
      border: 1px solid #e6e6ea; box-shadow: 0 12px 34px rgba(0,0,0,.2); pointer-events: auto; display: none; }
    .target { color: #5c5c66; margin: 0 0 6px; overflow-wrap: anywhere; }
    .shot { display: block; max-width: 100%; max-height: 120px; margin: 0 0 8px; border: 1px solid #e6e6ea; border-radius: 6px; }
    .note { color: #b5560a; margin: 0 0 8px; }
    textarea { width: 100%; min-height: 64px; resize: vertical; padding: 7px 8px; border: 1px solid #2156d9; border-radius: 8px; color: inherit; background: inherit; outline: none; }
    .row { display: flex; gap: 6px; align-items: center; justify-content: space-between; margin-top: 8px; color: #5c5c66; }
    .row > span:last-child { display: flex; gap: 6px; flex: none; }
    button { cursor: pointer; border-radius: 7px; padding: 5px 10px; border: 1px solid #e6e6ea; background: #fff; color: #18181b; }
    button.primary { background: #2156d9; border-color: #2156d9; color: #fff; }
    .sel { position: fixed; display: none; pointer-events: auto; box-shadow: 0 4px 14px rgba(0,0,0,.2); }
    .pin { position: fixed; width: 22px; height: 22px; border-radius: 50% 50% 50% 0; background: ${ORANGE}; color: #fff; font-weight: 700; font-size: 11px;
      display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,.25); pointer-events: none; }
    @media (prefers-color-scheme: dark) {
      .bubble { background: #1b1b1f; color: #ececf1; border-color: #2f2f36; }
      .target { color: #a4a4b0; }
      button { background: #222227; color: #ececf1; border-color: #2f2f36; }
    }`

  let host, root, outline, bar, bubble, selButton, pinsLayer
  let mode = false
  let bubbleOpen = false
  let drag = null // { x, y, moved } from mousedown in comment mode
  let handlers = { pick () {}, zone () {} }
  let pins = [] // { n, el, docRect }

  const make = (tag, className, parent) => {
    const el = document.createElement(tag)
    if (className) el.className = className
    parent.append(el)
    return el
  }

  function ensure () {
    if (host) return
    host = document.createElement('review-walkthru-overlay')
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;'
    root = host.attachShadow({ mode: 'closed' })
    make('style', null, root).textContent = STYLE
    pinsLayer = make('div', null, root)
    outline = make('div', 'outline', root)
    bar = make('div', 'bar', root)
    bar.textContent = msg('modeBar')
    bubble = make('div', 'bubble', root)
    selButton = make('button', 'sel primary', root)
    selButton.textContent = msg('selectionButton')
    selButton.addEventListener('mousedown', event => event.preventDefault()) // keep the selection
    // Typing in the bubble must not reach the app's keyboard shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress']) bubble.addEventListener(type, event => event.stopPropagation())
    document.documentElement.append(host)
    document.addEventListener('keydown', onKey, true)
    addEventListener('scroll', schedulePins, true)
    addEventListener('resize', schedulePins)
  }

  const isOverlay = target => target === host
  const box = (el, r) => Object.assign(el.style, { display: 'block', left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` })
  const pageTarget = (x, y) => {
    const el = document.elementFromPoint(x, y)
    return el && !isOverlay(el) && el !== document.documentElement ? el : null
  }

  // ---- comment mode: hover outlines, click pins, drag draws an area ----

  function onMove (event) {
    if (bubbleOpen) return
    if (drag) {
      drag.moved = drag.moved || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > DRAG_PX
      if (drag.moved) {
        outline.classList.add('zone')
        box(outline, { x: Math.min(drag.x, event.clientX), y: Math.min(drag.y, event.clientY), width: Math.abs(event.clientX - drag.x), height: Math.abs(event.clientY - drag.y) })
      }
      return
    }
    const el = pageTarget(event.clientX, event.clientY)
    outline.classList.remove('zone')
    if (el) box(outline, el.getBoundingClientRect())
    else outline.style.display = 'none'
  }

  function block (event) {
    if (!mode || isOverlay(event.target)) return
    event.preventDefault()
    event.stopPropagation()
  }

  function onDown (event) {
    if (!mode || isOverlay(event.target) || event.button !== 0) return
    block(event)
    if (!bubbleOpen) drag = { x: event.clientX, y: event.clientY, moved: false }
  }

  function onUp (event) {
    if (!mode || isOverlay(event.target)) return
    block(event)
    if (!drag || bubbleOpen) { drag = null; return }
    const { x, y, moved } = drag
    drag = null
    outline.style.display = 'none'
    if (moved) {
      const rect = { x: Math.min(x, event.clientX), y: Math.min(y, event.clientY), width: Math.abs(event.clientX - x), height: Math.abs(event.clientY - y) }
      handlers.zone(rect)
    } else {
      const el = pageTarget(event.clientX, event.clientY)
      if (el) handlers.pick(el)
    }
  }

  function onKey (event) {
    if (event.key !== 'Escape') return
    if (bubbleOpen) return closeBubble()
    if (mode) setMode(false)
  }

  function setMode (on) {
    ensure()
    if (on === mode) return
    mode = on
    bar.style.display = on ? 'block' : 'none'
    outline.style.display = 'none'
    drag = null
    const method = on ? 'addEventListener' : 'removeEventListener'
    // Pointer events drive the mode; the mouse events the browser derives from them are
    // swallowed, so the app never sees the click (canceling pointerdown already drops mousedown).
    document[method]('pointermove', onMove, true)
    document[method]('pointerdown', onDown, true)
    document[method]('pointerup', onUp, true)
    for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'auxclick']) document[method](type, block, true)
  }

  // ---- the bubble ----

  // near: the client rect it points at. capture: a data URL or null; note: why there is none.
  function openBubble ({ near, target, capture, note, onSubmit }) {
    ensure()
    hideSelectionButton()
    bubble.replaceChildren()
    make('p', 'target', bubble).textContent = target
    if (capture) make('img', 'shot', bubble).src = capture
    else if (note) make('p', 'note', bubble).textContent = note
    const area = make('textarea', null, bubble)
    area.placeholder = msg('bubblePlaceholder')
    area.setAttribute('aria-label', msg('bubblePlaceholder'))
    const row = make('div', 'row', bubble)
    make('span', null, row).textContent = msg('bubbleShortcut')
    const buttons = make('span', null, row)
    const cancel = make('button', null, buttons)
    cancel.textContent = msg('bubbleCancel')
    const add = make('button', 'primary', buttons)
    add.textContent = msg('bubbleAdd')
    const submit = () => {
      if (!area.value.trim()) return area.focus()
      onSubmit(area.value.trim())
      closeBubble()
    }
    cancel.addEventListener('click', closeBubble)
    add.addEventListener('click', submit)
    area.addEventListener('keydown', event => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit() }
      if (event.key === 'Escape') { event.preventDefault(); closeBubble() }
    })
    // Below the target when it fits, above otherwise, always on screen.
    bubble.style.display = 'block'
    const height = bubble.offsetHeight
    const below = near.y + near.height + 10
    const top = below + height < innerHeight ? below : Math.max(8, near.y - height - 10)
    Object.assign(bubble.style, { top: `${top}px`, left: `${Math.max(8, Math.min(near.x, innerWidth - bubble.offsetWidth - 8))}px` })
    bubbleOpen = true
    area.focus()
  }

  function closeBubble () {
    bubble.style.display = 'none'
    bubbleOpen = false
  }

  // ---- selected text ----

  function showSelectionButton (rect, onClick) {
    ensure()
    if (bubbleOpen) return
    selButton.onclick = () => { hideSelectionButton(); onClick() }
    Object.assign(selButton.style, { display: 'block', top: `${Math.min(rect.y + rect.height + 6, innerHeight - 36)}px`, left: `${Math.max(8, Math.min(rect.x, innerWidth - 120))}px` })
  }

  function hideSelectionButton () {
    if (selButton) selButton.style.display = 'none'
  }

  // ---- pins: on the element when it is still there, else where the comment was made ----

  let pinsFrame = 0
  function schedulePins () {
    if (!pinsFrame) pinsFrame = requestAnimationFrame(drawPins)
  }

  function drawPins () {
    pinsFrame = 0
    if (!pinsLayer) return
    pinsLayer.replaceChildren(...pins.map(({ n, el, docRect }) => {
      const r = el?.isConnected ? el.getBoundingClientRect() : { x: docRect.x - scrollX, y: docRect.y - scrollY, width: docRect.width }
      const pin = document.createElement('div')
      pin.className = 'pin'
      pin.textContent = String(n)
      Object.assign(pin.style, { left: `${r.x + r.width - 8}px`, top: `${r.y - 14}px` })
      return pin
    }))
  }

  function setPins (items) {
    ensure()
    pins = items
    schedulePins()
  }

  // ---- captures leave the overlay out ----

  const hideForCapture = () => { ensure(); host.style.visibility = 'hidden' }
  const restoreAfterCapture = () => { host.style.visibility = '' }

  return {
    setHandlers: next => { handlers = next },
    setMode,
    toggleMode: () => setMode(!mode),
    openBubble,
    showSelectionButton,
    hideSelectionButton,
    setPins,
    hideForCapture,
    restoreAfterCapture,
    isOverlay: node => node === host
  }
})()
