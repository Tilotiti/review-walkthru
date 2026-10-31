// The review page. Every text that comes from the
// scenario goes through text nodes, never innerHTML: the page holds the relay token.
import {
  addComment, removeComment, togglePoint, goNext, goPrev, reopen,
  pointStatus, stepStatus, counts, buildReview, isFinish, startUrl, mergeState, setDraft, draftKey,
  nextCommentId, addAppComment, setCapture, addLog, addRequest, issues, appComments, pinsFor, prefillFields, detectTarget, goToStep
} from './review.mjs'
import { pickLang, t as translate, counterText, pointsSeenText, issuesText, prefillLabel, prefillText, endIssuesText } from './i18n.mjs'
import { createBridge, gate } from './bridge.mjs'

const lang = pickLang(navigator.languages ?? [navigator.language])
document.documentElement.lang = lang
const t = (key, vars) => translate(lang, key, vars)
const POLL_MS = 3000
const HELLO_MS = 3000
const STORE_URL = 'https://chromewebstore.google.com/detail/kjigknfmabifbopeelbckkilheemoedh'
const STATUS_LABEL = { validated: 'statusValidated', commented: 'statusCommented', not_reached: 'statusNotReached' }
const SVG_NS = 'http://www.w3.org/2000/svg'
// Drawn icons, one stroke weight (no emoji or glyph as an icon).
const ICONS = {
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  bubble: '<path d="M3 3.5h10a1 1 0 011 1v6a1 1 0 01-1 1H7l-3 2.5v-2.5H3a1 1 0 01-1-1v-6a1 1 0 011-1z"/>',
  decision: '<path d="M8 2v12M4 5h8M4 5l-2 4h4zM12 5l-2 4h4z"/>',
  doubt: '<circle cx="8" cy="8" r="6"/><path d="M6.3 6.3a1.8 1.8 0 113 1.4c-.7.4-1.3.8-1.3 1.6M8 11.4v.1"/>',
  out: '<path d="M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5"/>',
  left: '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
  right: '<path d="M6 3.5L10.5 8 6 12.5"/>'
}

const store = {
  get (key) { try { return JSON.parse(localStorage.getItem(key)) } catch { return null } },
  set (key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} }
}

let data = null // GET api/round
let s = null // state of the round (review.mjs)
let composer = null // { stepId, anchor, focus } of the open comment box; focus only right after opening it
let notice = null // { text, details? }
let sending = false
const bridge = createBridge(window)
let hello = null // the extension's hello: its version and the comment shortcut
let appReady = false // the app half runs the extension's script
let coverage = null // { origin, covered }: whether the extension may run in the app
const pendingCaptures = new Set() // comment ids whose capture is being uploaded
let pendingPrefill = null // { id, unresolved } of the last prefill request

const prefix = () => `rw:${data.scenario.pr.repo}#${data.scenario.pr.number}`
const stepsById = () => new Map([...data.scenario.steps, ...data.skippedSteps].map(step => [step.id, step]))
const sameAnchor = (a, b) => a.kind === b.kind && a.id === b.id
// The step comments from the app go to: the current one, or the last one on the end view.
const currentStepId = () => s.order[Math.min(s.current, s.order.length - 1)]
const shortcutKey = () => hello?.shortcut || (/Mac/.test(navigator.platform) ? '⌥⇧C' : t('altShortcut'))
const live = () => s && data && !data.submitted

function icon (name) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('class', 'ico')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = ICONS[name] // constant markup from this file, never scenario text
  return svg
}

function h (tag, props = {}, ...children) {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value)
    else if (key === 'class') el.className = value
    else el.setAttribute(key, value === true ? '' : value)
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) el.append(child)
  return el
}

function update (next) {
  s = next
  store.set(`${prefix()}:r${data.round}`, s)
  sendPins()
  render()
}

// The app shows a numbered pin for each comment of the current step made on it.
function sendPins () {
  if (appReady && s && data) bridge.send('pins', { items: data.submitted ? [] : pinsFor(s, currentStepId()) })
}

// ---- messages from the extension ----

bridge.on('app-ready', () => { appReady = true; sendPins(); render() })
bridge.on('app-gone', () => { appReady = false; render() })
bridge.on('coverage', message => { coverage = { origin: message.origin, covered: message.covered }; render() })
bridge.on('shortcut-in-review', () => { notice = { text: t('shortcutInReview', { key: shortcutKey() }) }; render() })

bridge.on('navigated', ({ url }) => {
  if (!live()) return
  sendPins()
  const step = stepsById().get(s.order[s.current])
  const target = detectTarget(step, url)
  if (!target || target === step.id || !s.order.includes(target)) return
  composer = null
  notice = { text: t('detected', { title: stepsById().get(target).title }) }
  update(goToStep(s, target))
})

bridge.on('comment', message => {
  if (!live()) return
  const stepId = currentStepId()
  const id = nextCommentId(s)
  const round = data.round
  const next = addAppComment(s, stepId, message, message.text)
  if (next === s) return
  if (message.capture) uploadCapture(round, stepId, id, message.capture)
  update(next)
})

bridge.on('log', ({ level, text, url, at }) => { if (live()) update(addLog(s, currentStepId(), { level, text, url, at })) })
// resourceType: the message's own "type" names the message.
bridge.on('request', ({ method, url, status, error, resourceType, at }) => {
  if (live()) update(addRequest(s, currentStepId(), { method, url, status, error, type: resourceType, at }))
})

bridge.on('prefilled', ({ id, filled, missing, unsupported }) => {
  if (pendingPrefill?.id !== id) return
  notice = { text: prefillText(lang, filled, [...missing, ...unsupported, ...pendingPrefill.unresolved]) }
  pendingPrefill = null
  render()
})

// The capture goes to the relay at once: localStorage could not hold the image until the review is sent.
async function uploadCapture (round, stepId, id, dataUrl) {
  pendingCaptures.add(id)
  try {
    const blob = await (await fetch(dataUrl)).blob()
    const res = await fetch(`api/capture/${id}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob })
    if (!res.ok) throw new Error(String(res.status))
    const { file } = await res.json()
    pendingCaptures.delete(id)
    if (live() && data.round === round) update(setCapture(s, stepId, id, file))
  } catch {
    pendingCaptures.delete(id)
    notice = { text: t('captureFailed') }
    render()
  }
}

function prefill (step) {
  const { fields, unresolved } = prefillFields(step, data.credentials)
  pendingPrefill = { id: `${step.id}-${Date.now()}`, unresolved }
  bridge.send('prefill', { id: pendingPrefill.id, fields })
}

// Keep what still exists from the saved state: a restart reuses round numbers,
// and --replace can add or remove a step or a point.
const restore = () => mergeState(store.get(`${prefix()}:r${data.round}`), data.round, data.scenario.steps, data.skippedSteps)

async function load () {
  let next = null
  try {
    const res = await fetch('api/round', { cache: 'no-store' })
    if (res.ok) next = await res.json()
  } catch {}
  if (next) {
    // A round we were waiting on that comes back unsent is a new round, even with the same number (restart).
    const changed = !data || next.round !== data.round || next.scenario.pr.headSha !== data.scenario.pr.headSha ||
      (data.submitted && !next.submitted)
    data = next
    const sent = store.get(prefix() + ':submitted')
    if (!data.submitted && sent?.round >= data.round) store.set(prefix() + ':submitted', null) // stale after a restart
    if (changed) { s = restore(); composer = null }
    notice = null
    document.title = t('docTitle', { n: data.scenario.pr.number })
    // The extension waits for this URL to open the app in split view.
    document.documentElement.dataset.rwAppUrl = startUrl(data.scenario)
  } else if (!data?.submitted) {
    notice = { text: t('relayDown') }
  }
  render()
  if (!next || data.submitted) setTimeout(load, POLL_MS)
}

async function send () {
  sending = true
  render()
  try {
    const res = await fetch('api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildReview(s, new Date()))
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok || res.status === 409) {
      store.set(prefix() + ':submitted', { round: data.round, finish: Boolean(body.finish) })
      store.set(`${prefix()}:r${data.round}`, null) // a restart reuses round numbers: never restore a sent round

      data = { ...data, submitted: true }
      sendPins()
      notice = null
      setTimeout(load, POLL_MS)
    } else {
      notice = { text: res.status === 422 ? t('rejected') : String(body.error ?? res.status), details: body.errors }
      if (res.status === 422 && await refreshRound()) notice = { text: t('roundChanged') }
    }
  } catch {
    notice = { text: t('relayDown') }
    setTimeout(load, POLL_MS) // clears the notice once the relay answers again
  }
  sending = false
  render()
}

// The relay refused the review: Claude may have replaced the round while this tab was open.
// Reload it and keep what still applies, instead of making the reviewer start over.
// Returns true when the round did change.
async function refreshRound () {
  const shape = d => JSON.stringify(d.scenario.steps.map(step => [step.id, step.points.map(p => p.id)]))
  try {
    const res = await fetch('api/round', { cache: 'no-store' })
    if (!res.ok) return false
    const next = await res.json()
    const changed = shape(next) !== shape(data)
    data = next
    s = mergeState(s, data.round, data.scenario.steps, data.skippedSteps)
    store.set(`${prefix()}:r${data.round}`, s)
    return changed
  } catch { return false }
}

// ---- views ----

function banner () {
  return h('div', { class: 'banner', role: 'alert' }, h('p', {}, notice.text),
    notice.details?.length ? h('ul', {}, notice.details.map(d => h('li', {}, d))) : null)
}

// The review needs the extension: without it, or with one older than the page's protocol,
// the page only says how to get it.
function gateView (access) {
  const install = access === 'install'
  return h('main', { class: 'gate' },
    h('h1', {}, t(install ? 'gateInstallTitle' : 'gateUpdateTitle')),
    h('p', {}, t(install ? 'gateInstallBody' : 'gateUpdateBody')),
    h('p', { class: 'actions' },
      install ? h('a', { href: STORE_URL, target: '_blank', rel: 'noopener', class: 'button primary' }, t('gateInstallLink')) : null,
      h('button', { type: 'button', class: 'ghost', onclick: () => location.reload() }, t('reload'))))
}

function copyButton (value) {
  return h('button', { type: 'button', class: 'ghost small', onclick: () => navigator.clipboard?.writeText(value) }, t('copy'))
}

function accounts () {
  if (!data.credentials.length) return null
  const label = id => data.scenario.prerequisites.find(p => p.id === id)?.text ?? id
  return h('details', { class: 'block' }, h('summary', {}, `${t('accounts')} (${data.credentials.length})`),
    data.credentials.map(c => h('div', { class: 'account' },
      h('p', { class: 'muted' }, label(c.prerequisiteId)),
      h('p', {}, h('span', { class: 'key' }, t('login')), h('code', {}, c.login), copyButton(c.login)),
      h('p', {}, h('span', { class: 'key' }, t('password')), h('code', {}, c.password), copyButton(c.password)),
      c.note ? h('p', { class: 'muted' }, c.note) : null)))
}

function skippedBlock () {
  const skipped = (data.scenario.skipped ?? []).filter(entry => !s.order.includes(entry.stepId))
  if (!skipped.length) return null
  const steps = stepsById()
  return h('details', { class: 'block' }, h('summary', {}, `${t('skipped')} (${skipped.length})`),
    skipped.map(entry => h('div', { class: 'skipped' },
      h('p', {}, h('strong', {}, steps.get(entry.stepId)?.title ?? entry.stepId)),
      h('p', { class: 'muted' }, entry.reason),
      steps.has(entry.stepId)
        ? h('button', { type: 'button', class: 'ghost small', onclick: () => update(reopen(s, steps.get(entry.stepId))) }, t('reopen'))
        : null)))
}

function seenCount (step) {
  const entry = s.entries[step.id]
  return step.points.filter(p => pointStatus(entry, p.id) !== 'not_seen').length
}

// Title first, no eyebrow; progress and counters on the line below.
function header (step) {
  const meta = step
    ? `${t('stepOf', { n: s.current + 1, total: s.order.length })} · ${pointsSeenText(lang, seenCount(step), step.points.length)}`
    : t('endOfRound')
  return h('header', { class: 'head' },
    h('h1', {}, step ? step.title : data.scenario.title),
    h('div', { class: 'prog' },
      h('div', { class: 'steps', 'aria-hidden': 'true' }, s.order.map((id, i) =>
        h('i', { class: `${stepStatus(s.entries[id])}${i === s.current ? ' current' : ''}` }))),
      h('span', { class: 'num' }, meta)),
    step ? issuesBlock(s.entries[step.id]) : null,
    accounts(),
    skippedBlock())
}

const clock = at => new Date(at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

// What the app's console and network reported during this step.
function issuesBlock (entry) {
  const c = issues(entry)
  if (!c.errors && !c.warnings && !c.requests) return null
  return h('details', { class: 'issues' }, h('summary', {}, issuesText(lang, c)),
    h('ul', {},
      entry.logs.map(l => h('li', { class: l.level }, h('span', { class: 'when' }, clock(l.at)), l.text)),
      entry.requests.map(r => h('li', { class: 'error' }, h('span', { class: 'when' }, clock(r.at)), `${r.method} ${r.status ?? r.error} ${r.url}`))))
}

// Offered once the app half runs the extension's script.
function toolsRow (step) {
  if (!appReady) return null
  return h('div', { class: 'tools' },
    h('button', { type: 'button', class: 'ghost small', onclick: () => bridge.send('comment-mode') }, icon('bubble'), t('commentInApp')),
    step.prefill?.length ? h('button', { type: 'button', class: 'ghost small', onclick: () => prefill(step) }, prefillLabel(lang, step.prefill.length)) : null,
    h('p', { class: 'muted small hint' }, t('shortcutHint', { key: shortcutKey() })))
}

// The app is on a host the extension may not run on yet: one click asks Chrome for it.
function grantBox () {
  if (!coverage || coverage.covered || appReady) return null
  return h('div', { class: 'tip' }, h('p', {}, t('grantBanner', { origin: coverage.origin })),
    h('button', { type: 'button', class: 'primary small', onclick: () => bridge.send('grant', { origin: coverage.origin }) }, t('grantButton')))
}

function section (title, ...children) {
  return h('section', { class: 'sec' }, h('h2', {}, title), ...children)
}

// Every app link targets one named tab, so the app opens once and is then reused; in split
// view the extension loads the link in the app's half instead. No rel=noopener:
// a named tab can only be reused by the page that opened it. The page sends no referrer.
const APP_TARGET = 'review-walkthru-app'

function appLink (path, label = path, props = {}) {
  return h('a', { href: new URL(path, data.scenario.app.baseUrl).href, target: APP_TARGET, referrerpolicy: 'no-referrer', 'data-rw-app-link': true, ...props }, label)
}

function composerBox (stepId, anchor, { free = false } = {}) {
  const key = draftKey(stepId, anchor)
  const focusNow = composer?.focus && (!free || composer.anchor.kind === 'step')
  const area = h('textarea', { rows: free ? 2 : 3, placeholder: t('placeholder'), 'aria-label': t('placeholder'), 'data-autofocus': focusNow ? true : null })
  area.value = s.drafts?.[key] ?? ''
  // Keep the draft in the state without re-rendering, so checking a point does not erase it.
  area.addEventListener('input', () => { s = setDraft(s, key, area.value); store.set(`${prefix()}:r${data.round}`, s) })
  const submit = () => {
    const next = addComment(s, stepId, anchor, area.value)
    if (next === s) return area.focus()
    composer = null
    update(next)
  }
  const cancel = () => { composer = null; update(setDraft(s, key, '')) }
  area.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit() }
    if (event.key === 'Escape' && !free) cancel()
  })
  return h('div', { class: 'composer' },
    anchor.quote ? h('p', { class: 'quote' }, t('quoted', { text: anchor.quote })) : null,
    area,
    h('div', { class: 'row' }, h('span', { class: 'muted small' }, t('shortcut')),
      h('span', {},
        free ? null : h('button', { type: 'button', class: 'ghost small', onclick: cancel }, t('cancel')),
        h('button', { type: 'button', class: 'primary small', onclick: submit }, t('add')))))
}

function note (kind, it) {
  return h('div', { class: `n ${kind}` }, icon(kind),
    h('p', {},
      h('span', { class: 'sr' }, `${t(kind === 'decision' ? 'tagDecision' : 'tagDoubt')}${t('colon')}`),
      it.text,
      it.cost ? h('small', {}, ` ${t('ifWrong')} ${it.cost}`) : null,
      it.source === 'inferred' ? h('span', { class: 'inf' }, t('inferred')) : null))
}

const removeButton = (step, c) =>
  h('button', { type: 'button', class: 'ghost small', onclick: () => update(removeComment(s, step.id, c.id)) }, t('remove'))

function commentList (step, comments) {
  return comments.map(c => h('div', { class: 'cm-txt' },
    h('div', { class: 'grow' },
      c.anchor?.quote ? h('p', { class: 'quote' }, t('quoted', { text: c.anchor.quote })) : null,
      h('p', {}, c.text)),
    removeButton(step, c)))
}

// A comment made on the app: its pin number, what it targets, and its capture.
function appCommentView (step, c, n) {
  const a = c.anchor
  const target = a.kind === 'zone' ? t('zoneLabel', { w: Math.round(a.rect.width), h: Math.round(a.rect.height) })
    : a.kind === 'text' ? t('quoted', { text: a.quote })
      : [a.element.text || a.element.tag, a.element.selector].join(' · ')
  return h('div', { class: 'cm-txt app' },
    h('span', { class: 'pin-n', 'aria-hidden': 'true' }, String(n)),
    h('div', { class: 'grow' },
      h('p', {}, c.text),
      h('p', { class: 'muted small target' }, target),
      a.capture ? h('img', { class: 'shot', src: a.capture, alt: '' })
        : pendingCaptures.has(c.id) ? null : h('p', { class: 'muted small' }, t('noCapture', { key: shortcutKey() }))),
    removeButton(step, c))
}

function pointView (step, point) {
  const entry = s.entries[step.id]
  const status = pointStatus(entry, point.id)
  const anchor = { kind: 'point', id: point.id }
  const open = composer && composer.stepId === step.id && sameAnchor(composer.anchor, anchor)
  const comments = entry.comments.filter(c => c.anchor?.kind === 'point' && c.anchor.id === point.id)
  const titleId = `pt-${step.id}-${point.id}`
  return h('div', { class: `pt ${status}`, 'data-point': point.id },
    h('button', {
      type: 'button', class: 'ck', role: 'checkbox', 'aria-checked': String(Boolean(entry.checked[point.id])), 'aria-labelledby': titleId,
      'data-focus-key': `ck:${step.id}:${point.id}`,
      onclick: () => update(togglePoint(s, step.id, point.id))
    }, status === 'validated' ? icon('check') : status === 'commented' ? icon('bubble') : null),
    h('div', { class: 'body' },
      h('p', { class: 't', id: titleId }, point.title, point.do === null ? h('span', { class: 'judge' }, t('judge')) : null),
      point.do ? h('p', { class: 'do' }, point.do) : null,
      point.alreadyValidated && entry.checked[point.id] ? h('p', { class: 'before' }, t('validatedBefore', { n: data.round - 1 })) : null,
      (point.decisions?.length || point.doubts?.length)
        ? h('div', { class: 'notes' },
          (point.doubts ?? []).map(it => note('doubt', it)),
          (point.decisions ?? []).map(it => note('decision', it)))
        : null,
      commentList(step, comments),
      open
        ? composerBox(step.id, composer.anchor)
        : h('button', { type: 'button', class: 'ghost small comment-btn', onclick: () => { composer = { stepId: step.id, anchor, focus: true }; render() } }, icon('bubble'), t('comment'))))
}

function stepView (step) {
  const entry = s.entries[step.id]
  const stepComments = entry.comments.filter(c => c.anchor?.kind === 'step')
  const stepAnchor = composer?.stepId === step.id && composer.anchor.kind === 'step' ? composer.anchor : { kind: 'step' }
  const startPath = step.start?.startsWith('/') ? step.start : null
  return h('main', {},
    h('div', { class: 'intro' },
      data.round > 1 && step.reason ? h('p', { class: 'why' }, h('strong', {}, `${t('why')}${t('colon')}`), step.reason) : null,
      h('p', {}, step.page),
      // A start path is where the step happens: it replaces the link to the step's screen.
      // Rounds registered before startLabel existed fall back to the path.
      startPath
        ? [h('p', { class: 'small' }, t('startAt')),
            appLink(startPath, [icon('out'), step.startLabel ?? startPath], { class: 'button ghost small go', title: startPath })]
        : [step.start ? h('p', { class: 'small' }, `${t('startAt')}${t('colon')}`, step.start) : null,
            step.path
              ? appLink(step.path, [icon('out'), t('openInApp')], { class: 'link' })
              : h('p', { class: 'muted small' }, t('noScreen'))],
      toolsRow(step)),
    h('div', { class: 'pts' }, step.points.map(point => pointView(step, point))),
    section(t('yourComments'),
      appComments(entry).map((c, i) => appCommentView(step, c, i + 1)),
      commentList(step, stepComments),
      composerBox(step.id, stepAnchor, { free: true })))
}

function endView () {
  const steps = stepsById()
  return h('main', {}, section(t('endOfRound'),
    s.order.map((id, i) => {
      const status = stepStatus(s.entries[id])
      return h('div', { class: 'summary-row' },
        h('span', { class: `dot ${status}` }),
        h('span', { class: 'grow' }, steps.get(id)?.title ?? id),
        h('span', { class: 'muted small' }, t(STATUS_LABEL[status])),
        h('button', { type: 'button', class: 'ghost small', onclick: () => update({ ...s, current: i }) }, t('goTo')))
    })))
}

function footer (step) {
  const c = counts(s)
  const finishing = !step && isFinish(buildReview(s, new Date()))
  const next = step?.next
  // Errors do not block the end of a round: they go to Claude, who lists them before pushing.
  const errors = step ? 0 : s.order.reduce((n, id) => { const c = issues(s.entries[id]); return n + c.errors + c.requests }, 0)
  return h('footer', { class: 'foot' },
    next ? h('div', { class: 'next' },
      h('p', {}, `${t('then')}${t('colon')}`, h('b', {}, stepsById().get(next.stepId)?.title ?? t('endOfRound'))),
      h('p', { class: 'muted small' }, next.instruction)) : null,
    h('div', { class: 'nav' },
      h('button', { type: 'button', class: 'ghost', disabled: s.current === 0, onclick: () => { composer = null; update(goPrev(s)) } }, icon('left'), t('prev')),
      step ? h('button', { type: 'button', class: 'primary', onclick: () => { composer = null; update(goNext(s)) } }, t('next'), icon('right')) : null),
    errors ? h('p', { class: 'muted small end-issues' }, endIssuesText(lang, errors)) : null,
    h('div', { class: 'review' },
      h('span', { class: 'count' }, counterText(lang, c.comments, c.pointsLeft)),
      h('button', { type: 'button', class: 'dark', disabled: sending, onclick: send }, sending ? t('sending') : t(finishing ? 'finish' : 'send'))))
}

function view () {
  const out = [notice ? banner() : null]
  if (!data) return out
  if (data.submitted) {
    const sent = store.get(prefix() + ':submitted')
    const finished = sent?.round === data.round && sent.finish
    // The extension leaves the split view when the whole review is done.
    if (finished) document.documentElement.dataset.rwFinished = '1'
    return [...out, h('main', { class: 'done' }, h('p', {}, t(finished ? 'finished' : 'sent')))]
  }
  const step = s.current < s.order.length ? stepsById().get(s.order[s.current]) : null
  return [...out, grantBox(), header(step), step ? stepView(step) : endView(), footer(step)]
}

// Selecting text of the scenario offers a comment on the point that holds it, with the quote.
// The button lives outside #app, so renders leave it alone.
let selTarget = null
const selButton = h('button', { type: 'button', class: 'primary small sel-comment', hidden: true,
  onmousedown: event => event.preventDefault(), // keep the selection
  onclick: () => {
    selButton.hidden = true
    if (!selTarget || !live()) return
    composer = { ...selTarget, focus: true }
    getSelection()?.removeAllRanges()
    render()
  } }, icon('bubble'), t('comment'))
document.body.append(selButton)

function placeSelButton () {
  const sel = getSelection()
  const text = sel?.toString().trim()
  const node = sel?.anchorNode?.nodeType === 1 ? sel.anchorNode : sel?.anchorNode?.parentElement
  const step = live() && s.current < s.order.length ? stepsById().get(s.order[s.current]) : null
  if (!text || !step || !node || !document.getElementById('app').contains(node) || node.closest('textarea, button, .composer, .cm-txt')) {
    selButton.hidden = true
    return
  }
  const quote = text.slice(0, 300)
  const point = node.closest('[data-point]')?.dataset.point
  selTarget = { stepId: step.id, anchor: point ? { kind: 'point', id: point, quote } : { kind: 'step', quote } }
  const r = sel.getRangeAt(0).getBoundingClientRect()
  selButton.style.top = `${Math.round(r.bottom + 6)}px`
  selButton.style.left = `${Math.round(Math.max(8, Math.min(r.left, innerWidth - 140)))}px`
  selButton.hidden = false
}
document.addEventListener('mouseup', () => setTimeout(placeSelButton))
document.addEventListener('keyup', event => { if (event.shiftKey) placeSelButton() })

// The page rebuilds its DOM on every change: give the focus back to the same control,
// so a keyboard user keeps their place after checking a point.
function render () {
  const root = document.getElementById('app')
  const focusKey = document.activeElement?.dataset?.focusKey
  root.replaceChildren(...view().filter(Boolean))
  const autofocus = root.querySelector('textarea[data-autofocus]')
  if (composer) composer.focus = false // only the render that opens a comment box moves the focus into it
  if (autofocus) autofocus.focus()
  else if (focusKey) root.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus()
}

hello = await bridge.waitForHello(HELLO_MS)
const access = gate(hello, document.documentElement.hasAttribute('data-rw-extension'))
if (access === 'ok') load()
else document.getElementById('app').replaceChildren(gateView(access))
