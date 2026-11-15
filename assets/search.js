export function normalizeSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function toolMatchesQuery(searchText, query) {
  const hay = normalizeSearchText(searchText)
  const needle = normalizeSearchText(query)
  if (!needle) return true
  if (hay.includes(needle)) return true
  const terms = needle.split(' ').filter(Boolean)
  return terms.every((term) => hay.includes(term))
}

export function filterToolCards(cards, { query, category }) {
  const selected = category || 'all'
  return cards.map((card) => {
    const okCategory = selected === 'all' || card.category === selected
    const okQuery = toolMatchesQuery(card.searchText, query)
    return { ...card, visible: okCategory && okQuery }
  })
}
