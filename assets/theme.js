(() => {
  const storageKey = 'nx-toolbox-theme';
  const root = document.documentElement;
  const getPreferred = () => {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') return saved;
    return 'light';
  };
  const apply = (theme) => {
    root.dataset.theme = theme;
    const button = document.getElementById('themeToggle');
    if (button) {
      button.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
      button.setAttribute('aria-label', theme === 'dark' ? '切换到浅色模式' : '切换到深色模式');
      button.title = button.getAttribute('aria-label');
    }
  };
  apply(getPreferred());
  window.toggleToolboxTheme = () => {
    const next = (root.dataset.theme === 'dark') ? 'light' : 'dark';
    localStorage.setItem(storageKey, next);
    apply(next);
  };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!localStorage.getItem(storageKey)) apply(getPreferred());
  });
})();
