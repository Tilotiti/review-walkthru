// Puts the review page in a known state before it loads, with the page's own state functions:
// no simulated clicks, so no focus and no scrolling during a capture.
import { initialState, togglePoint, addComment } from '/demo/review.mjs'

export const COMMENT = 'Archived clients should be hidden by default, with a toggle to show them.'

export async function seedReview (round, state) {
  for (const key of Object.keys(localStorage)) localStorage.removeItem(key)
  if (state === 'fresh' || round !== 1) return
  const scenario = await (await fetch('/demo/scenario-1.json')).json()
  let s = initialState(1, scenario.steps)
  s = togglePoint(s, 'clients-list', 'sort')
  s = addComment(s, 'clients-list', { kind: 'point', id: 'filter' }, COMMENT)
  localStorage.setItem(`rw:${scenario.pr.repo}#${scenario.pr.number}:r1`, JSON.stringify(s))
}

// Resolves once the page in `frame` has rendered its points and its 1.5 s re-render is behind it.
export async function settled (frame) {
  await new Promise(resolve => frame.addEventListener('load', resolve, { once: true }))
  for (let i = 0; i < 60 && !frame.contentDocument.querySelector('.pt'); i++) await new Promise(resolve => setTimeout(resolve, 100))
  await new Promise(resolve => setTimeout(resolve, 1700))
  return frame.contentDocument
}
