// Runs in every localhost tab, and does nothing unless the worker says this tab is the app of a
// running review. Then: comments on the app (element, selected text, area) with a capture,
// the app's console for the review page, the prefill of a form, the pins of the current step.
(() => {
  const { describeElement, fillField } = globalThis.RW_DOM
  const overlay = globalThis.RW_OVERLAY
  const msg = (key, ...args) => chrome.i18n.getMessage(key, args.map(String))
  const french = chrome.i18n.getUILanguage().startsWith('fr')
  const shortcut = /Mac/.test(navigator.platform) ? '⌥⇧C' : 'Alt+Shift+C'
  const toPage = message => chrome.runtime.sendMessage({ type: 'rw:to-page', message }).catch(() => {})
  const count = selector => { try { return document.querySelectorAll(selector).length } catch { return 0 } }
  // A background tab may not paint: the timeout keeps a capture from waiting forever.
  const frame = () => new Promise(resolve => { requestAnimationFrame(resolve); setTimeout(resolve, 100) })
  const plain = r => ({ x: r.x, y: r.y, width: r.width, height: r.height })
  let lastTarget = null // the element under the last right-click, for the context menu

  // The capture is taken at the gesture, before the bubble opens, without the overlay in it.
  async function comment (kind, near, element, quote) {
    overlay.hideSelectionButton()
    overlay.hideForCapture()
    await frame(); await frame()
    const shot = await chrome.runtime.sendMessage({
      type: 'rw:capture', rect: near, viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio
    }).catch(error => ({ ok: false, error: String(error?.message ?? error) }))
    overlay.restoreAfterCapture()
    const target = kind === 'zone' ? msg('zoneLabel', Math.round(near.width), Math.round(near.height))
      : kind === 'text' ? (french ? `« ${quote} »` : `“${quote}”`)
        : [element.text || element.tag, element.selector].join(' · ')
    const capture = shot?.ok ? shot.dataUrl : null
    overlay.openBubble({
      near,
      target,
      capture,
      note: capture ? null : msg('noCapture', shortcut),
      onSubmit: text => toPage({
        type: 'comment', kind, url: location.href, text,
        rect: { ...near, x: near.x + scrollX, y: near.y + scrollY }, // in the document, so pins survive scrolling
        element, quote: quote ?? null, capture, captureError: capture ? null : (shot?.error ?? 'no capture')
      })
    })
  }

  const onElement = el => comment('element', plain(el.getBoundingClientRect()), describeElement(el, count), null)
  const onZone = rect => comment('zone', rect, null, null)

  function onSelection () {
    const selection = getSelection()
    const quote = selection?.toString().replace(/\s+/g, ' ').trim()
    if (!quote || !selection.rangeCount) return false
    const range = selection.getRangeAt(0)
    const container = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement
    comment('text', plain(range.getBoundingClientRect()), describeElement(container, count), quote.slice(0, 300))
    return true
  }

  // A selected text offers its own button, outside comment mode too.
  function onMouseUp (event) {
    if (overlay.isOverlay(event.target)) return
    setTimeout(() => {
      const selection = getSelection()
      const node = selection?.anchorNode
      const inField = (node?.nodeType === 1 ? node : node?.parentElement)?.closest('input, textarea, [contenteditable]')
      if (!selection?.toString().trim() || inField) return overlay.hideSelectionButton()
      overlay.showSelectionButton(plain(selection.getRangeAt(0).getBoundingClientRect()), onSelection)
    })
  }

  function prefill ({ id, fields }) {
    let filled = 0
    const missing = []
    const unsupported = []
    for (const { selector, value } of fields) {
      let el = null
      try { el = document.querySelector(selector) } catch {}
      if (!el) missing.push(selector)
      else if (fillField(el, value, window) === 'filled') filled++
      else unsupported.push(selector)
    }
    toPage({ type: 'prefilled', id, filled, missing, unsupported })
  }

  // Pins of the current step made on this very page (origin, path and query).
  function pins ({ items }) {
    const here = location.origin + location.pathname + location.search
    overlay.setPins(items.filter(item => {
      try { const u = new URL(item.url); return u.origin + u.pathname + u.search === here } catch { return false }
    }).map(item => {
      let el = null
      try { el = item.selector ? document.querySelector(item.selector) : null } catch {}
      return { n: item.n, el, docRect: item.rect }
    }))
  }

  function onMessage (message) {
    if (message?.type !== 'rw:to-app') return
    const m = message.message
    if (m.type === 'mode') overlay.toggleMode()
    else if (m.type === 'comment-mode') overlay.setMode(true)
    else if (m.type === 'context') { if (!(m.selection && onSelection()) && lastTarget?.isConnected) onElement(lastTarget) }
    else if (m.type === 'prefill') prefill(m)
    else if (m.type === 'pins') pins(m)
  }

  function start () {
    overlay.setHandlers({ pick: onElement, zone: onZone })
    chrome.runtime.onMessage.addListener(onMessage)
    document.addEventListener('contextmenu', event => { lastTarget = event.target }, true)
    document.addEventListener('mouseup', onMouseUp, true)
    document.addEventListener('review-walkthru:console', event => {
      try {
        const { level, text, at } = JSON.parse(event.detail)
        toPage({ type: 'log', level, text, url: location.href, at })
      } catch {}
    })
    document.dispatchEvent(new CustomEvent('review-walkthru:console-ready'))
  }

  chrome.runtime.sendMessage({ type: 'rw:app-hello', url: location.href })
    .then(reply => { if (reply?.paired) start() })
    .catch(() => {})
})()
