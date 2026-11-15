(() => {
  const cards = [...document.querySelectorAll('[data-tool-card]')];
  const empty = document.getElementById('emptyState');
  const search = document.getElementById('toolSearch');
  const chips = [...document.querySelectorAll('[data-filter]')];
  let category = 'all';

  const visible = (card) => {
    const q = (search.value || '').trim().toLowerCase();
    const hay = (card.getAttribute('data-search') || '').toLowerCase();
    const cat = card.getAttribute('data-category') || '';
    const okCat = category === 'all' || cat === category;
    const okQ = !q || hay.includes(q);
    return okCat && okQ;
  };

  const render = () => {
    let n = 0;
    cards.forEach((card) => {
      const on = visible(card);
      card.hidden = !on;
      if (on) n += 1;
    });
    empty.hidden = n > 0;
  };

  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      category = chip.getAttribute('data-filter') || 'all';
      chips.forEach((item) => {
        const active = item === chip;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      render();
    });
  });
  search.addEventListener('input', render);
  render();
})();
