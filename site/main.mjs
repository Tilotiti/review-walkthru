// The page's own behaviour: the review rail, copy buttons, and the How section's visual.
import { mountRail } from './rail.mjs'

mountRail(document)

for (const button of document.querySelectorAll('.copy')) {
  button.addEventListener('click', async () => {
    await navigator.clipboard.writeText(button.nextElementSibling.textContent)
    button.textContent = 'Copied'
    setTimeout(() => { button.textContent = 'Copy' }, 1500)
  })
}

// Film: the YouTube player loads only on click, so the page makes no request to YouTube before that.
for (const button of document.querySelectorAll('[data-youtube]')) {
  button.addEventListener('click', () => {
    const player = document.createElement('iframe')
    player.src = `https://www.youtube-nocookie.com/embed/${button.dataset.youtube}?autoplay=1&rel=0&playsinline=1`
    player.title = 'Review Walkthru, the film'
    player.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
    player.allowFullscreen = true
    button.replaceWith(player)
  })
}

// How: the step whose top crossed 45% of the viewport picks the visual on the right.
const stage = document.querySelector('.stage')
const steps = [...document.querySelectorAll('.steps li')]
const pick = () => {
  const line = innerHeight * 0.45
  const current = steps.filter(step => step.getBoundingClientRect().top <= line).at(-1) ?? steps[0]
  stage.dataset.active = current.dataset.visual
  for (const step of steps) step.classList.toggle('on', step === current)
}
const observer = new IntersectionObserver(pick, { threshold: [0, 0.25, 0.5, 0.75, 1] })
for (const step of steps) observer.observe(step)
pick()
