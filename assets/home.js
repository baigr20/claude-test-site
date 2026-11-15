import { toolMatchesQuery } from './search.js'

const cards = [...document.querySelectorAll('[data-tool-card]')]
const empty = document.getElementById('emptyState')
const search = document.getElementById('toolSearch')
const chips = [...document.querySelectorAll('[data-filter]')]
let category = 'all'

function cardSearchText(card) {
  return `${card.getAttribute('data-search') || ''} ${card.textContent || ''}`
}

function isVisible(card) {
  const cat = card.getAttribute('data-category') || ''
  const okCat = category === 'all' || cat === category
  const okQ = toolMatchesQuery(cardSearchText(card), search.value || '')
  return okCat && okQ
}

function render() {
  let visibleCount = 0
  cards.forEach((card) => {
    const on = isVisible(card)
    card.hidden = !on
    if (on) visibleCount += 1
  })
  empty.hidden = visibleCount > 0
}

chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    category = chip.getAttribute('data-filter') || 'all'
    chips.forEach((item) => {
      const active = item === chip
      item.classList.toggle('is-active', active)
      item.setAttribute('aria-pressed', active ? 'true' : 'false')
    })
    render()
  })
})
search.addEventListener('input', render)
render()
