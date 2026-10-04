'use strict';

const App = (() => {
  const routes = {
    '': Views.home,
    study: Views.study,
    cram: Views.cram,
    add: Views.add,
    browse: Views.browse,
    stats: Views.stats,
    settings: Views.settings,
  };
  const navOf = { study: '', cram: '' };
  let cleanup = null;
  let renderId = 0;

  function parseHash() {
    const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    return { name: parts[0] || '', args: parts.slice(1), query: new URLSearchParams(qs || '') };
  }

  async function render() {
    const id = ++renderId;
    cleanup?.();
    cleanup = null;
    const route = parseHash();
    const view = routes[route.name] || Views.home;
    const nav = route.name in navOf ? navOf[route.name] : route.name;
    $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));

    const root = h('div', { class: 'view' });
    $('#app').replaceChildren(root);
    try {
      const c = await view(root, route);
      if (id !== renderId) return c?.();
      cleanup = c || null;
    } catch (err) {
      console.error(err);
      root.replaceChildren(h('div', { class: 'empty' }, h('p', null, 'エラーが発生しました：' + err.message)));
    }
  }

  function start() {
    applyTheme();
    window.addEventListener('hashchange', () => {
      render();
      window.scrollTo(0, 0);
    });
    render();
    // ブラウザによる自動削除からデータを守る
    navigator.storage?.persist?.().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  return { start, render };
})();

App.start();
