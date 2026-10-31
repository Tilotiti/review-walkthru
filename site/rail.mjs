// The review rail: the page reads like a walkthrough, one point per section,
// and the points you scrolled past turn into checks.

export function railState (ids, currentId) {
  const at = Math.max(0, ids.indexOf(currentId))
  return Object.fromEntries(ids.map((id, i) => [id, i < at ? 'done' : i === at ? 'now' : 'todo']))
}

// The current section is the last one whose top crossed 40% of the viewport.
// IntersectionObserver only says when to look again; no scroll listener.
export function mountRail (doc = document) {
  const sections = [...doc.querySelectorAll('section[data-rail]')]
  const ids = sections.map(section => section.id)
  const points = [...doc.querySelectorAll('[data-point]')]
  const paint = () => {
    const line = innerHeight * 0.4
    const current = sections.filter(section => section.getBoundingClientRect().top <= line).at(-1)?.id ?? null
    const state = railState(ids, current)
    for (const el of points) el.dataset.state = state[el.dataset.point]
  }
  const observer = new IntersectionObserver(paint, { threshold: [0, 0.25, 0.5, 0.75, 1] })
  for (const section of sections) observer.observe(section)
  paint()
}
