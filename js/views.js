'use strict';

const Views = {};

const STATE_LABEL = { new: '新規', learning: '学習中', relearning: '再学習', review: '復習' };

function pageTitle(text, ...extra) {
  return h('div', { class: 'page-head' }, h('h1', null, text), extra);
}

function emptyState(message, ...actions) {
  return h('div', { class: 'empty' }, h('p', { class: 'pre' }, message), h('div', { class: 'row gap center wrap' }, actions));
}

function linkBtn(href, label, cls = 'btn') {
  return h('a', { class: cls, href }, label);
}

/** 学習画面などで使うキーボードショートカット登録（クリーンアップ関数を返す） */
function onKeys(handler) {
  const fn = e => {
    if (anyDialogOpen() || e.ctrlKey && e.key !== 'z' || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    handler(e);
  };
  document.addEventListener('keydown', fn);
  return () => document.removeEventListener('keydown', fn);
}

// ---- ホーム ------------------------------------------------------------------

Views.home = async root => {
  const [decks, counts, cards] = await Promise.all([Store.decks(), Store.deckCounts(), DB.getAll('cards')]);
  const start = studyDayStart();
  const todayLogs = await DB.getRange('reviews', 'ts', start, start + DAY);

  if (!decks.length) {
    root.append(
      pageTitle('応用情報 暗記カード'),
      emptyState(
        'まずは科目（デッキ）を作りましょう。\n応用情報技術者試験のシラバスに沿った科目セットをまとめて作ることもできます。',
        h('button', { class: 'btn primary', onClick: async () => {
          const n = await Store.createTemplateDecks();
          toast(`${n} 個の科目を作成しました`);
          App.render();
        } }, '応用情報の科目セットを作成'),
        h('button', { class: 'btn', onClick: async () => { if (await deckDialog()) App.render(); } }, '自分で科目を追加')));
    return;
  }

  let totNew = 0, totLearn = 0, totReview = 0;
  for (const k of counts.values()) {
    totNew += k.new;
    totLearn += k.learn;
    totReview += k.review;
  }
  const totalDue = totNew + totLearn + totReview;
  const flagged = cards.filter(c => c.flagged).length;

  root.append(
    h('section', { class: 'summary' },
      h('div', { class: 'summary-stats' },
        stat(todayLogs.length, '今日の回答数'),
        stat(totReview + totLearn, '復習待ち'),
        stat(totNew, '今日の新規'),
        stat(cards.length, '総カード数')),
      h('div', { class: 'row gap wrap' },
        !cards.length
          ? linkBtn('#/add', '＋ 最初のカードを追加する', 'btn primary big')
          : totalDue
            ? linkBtn('#/study/all', `すべての科目を学習（${totalDue}）`, 'btn primary big')
            : h('span', { class: 'done-msg' }, '🎉 今日の学習はすべて完了しました'),
        flagged ? linkBtn('#/cram/flagged', `★ 苦手カードを練習（${flagged}）`, 'btn big') : null)));

  for (const cat of Store.CATEGORIES) {
    const ds = decks.filter(d => d.category === cat);
    if (!ds.length) continue;
    root.append(h('section', { class: 'deck-group' },
      h('h2', null, cat),
      h('div', { class: 'deck-list' }, ds.map(d => deckRow(d, counts.get(d.id))))));
  }

  root.append(h('div', { class: 'row gap wrap center mt' },
    h('button', { class: 'btn', onClick: async () => { if (await deckDialog()) App.render(); } }, '＋ 科目を追加'),
    h('button', { class: 'btn', onClick: async () => {
      const n = await Store.createTemplateDecks();
      toast(n ? `${n} 個の科目を追加しました` : '科目セットはすべて作成済みです');
      App.render();
    } }, '応用情報の科目セットを追加')));

  function stat(value, label) {
    return h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-label' }, label));
  }

  function deckRow(deck, k = { total: 0, new: 0, learn: 0, review: 0, flagged: 0 }) {
    const due = k.new + k.learn + k.review;
    return h('div', { class: 'deck-row' },
      h('a', { class: 'deck-main', href: due ? `#/study/${deck.id}` : `#/browse?deck=${deck.id}` },
        h('div', { class: 'deck-name' }, deck.name),
        h('div', { class: 'deck-sub' }, `${k.total} 枚`, k.flagged ? ` · ★${k.flagged}` : '')),
      h('div', { class: 'counts', title: '新規 / 学習中 / 復習' },
        h('span', { class: 'c-new' + (k.new ? '' : ' zero') }, k.new),
        h('span', { class: 'c-learn' + (k.learn ? '' : ' zero') }, k.learn),
        h('span', { class: 'c-review' + (k.review ? '' : ' zero') }, k.review)),
      h('div', { class: 'deck-actions' },
        h('a', { class: 'icon-btn', href: `#/add?deck=${deck.id}`, title: 'カードを追加' }, '＋'),
        h('button', { class: 'icon-btn', title: 'メニュー', onClick: () => deckMenu(deck, k) }, '⋯')));
  }

  function deckMenu(deck, k) {
    const go = href => { d.close(); location.hash = href; };
    const d = Dialog.open(deck.name, h('div', { class: 'menu' },
      h('button', { class: 'menu-item', disabled: !(k.new + k.learn + k.review), onClick: () => go(`#/study/${deck.id}`) }, '📖 学習する（復習スケジュール通り）'),
      h('button', { class: 'menu-item', disabled: !k.total, onClick: () => go(`#/cram/${deck.id}`) }, '🔁 自由練習（全カードをシャッフル）'),
      h('button', { class: 'menu-item', disabled: !k.flagged, onClick: () => go(`#/cram/${deck.id}?flagged=1`) }, '★ この科目の苦手カードを練習'),
      h('button', { class: 'menu-item', onClick: () => go(`#/add?deck=${deck.id}`) }, '＋ カードを追加'),
      h('button', { class: 'menu-item', onClick: () => go(`#/browse?deck=${deck.id}`) }, '📋 カード一覧'),
      h('button', { class: 'menu-item', onClick: async () => { d.close(); if (await deckDialog(deck)) App.render(); } }, '✏️ 名前・分野を変更'),
      h('button', { class: 'menu-item danger', onClick: async () => {
        d.close();
        if (!await Dialog.confirm(`「${deck.name}」とその中のカード ${k.total} 枚を削除します。\nこの操作は取り消せません。`, { ok: '削除', danger: true })) return;
        await Store.deleteDeck(deck);
        toast('削除しました');
        App.render();
      } }, '🗑 科目を削除')));
  }
};

// ---- カード追加 ----------------------------------------------------------------

Views.add = async (root, { query }) => {
  const decks = await Store.decks();
  if (!decks.length) {
    root.append(pageTitle('カードを追加'), emptyState('カードを追加する前に、ホームで科目を作成してください。', linkBtn('#/', 'ホームへ', 'btn primary')));
    return;
  }
  const ids = new Set(decks.map(d => d.id));
  const pick = [query.get('deck'), Settings.get('lastDeck')].find(id => ids.has(id)) || decks[0].id;

  const mount = card => {
    const form = cardEditor({
      card, decks, isNew: true,
      onSave: (saved, { next }) => {
        Settings.set('lastDeck', saved.deckId);
        toast('保存しました');
        if (next) {
          mount({ ...Store.newCard(saved.deckId), tags: saved.tags });
          window.scrollTo(0, 0);
        } else {
          location.hash = '#/';
        }
      },
      onCancel: () => history.back(),
    });
    root.replaceChildren(pageTitle('カードを追加'), form);
    form.querySelector('textarea').focus();
  };
  mount(Store.newCard(pick));
};

// ---- 学習（間隔反復） ------------------------------------------------------------

Views.study = async (root, { args }) => {
  const target = args[0] || 'all';
  const decks = await Store.decks();
  const deckIds = new Set(target === 'all' ? decks.map(d => d.id) : decks.filter(d => d.id === target).map(d => d.id));
  const deckName = target === 'all' ? 'すべての科目' : decks.find(d => d.id === target)?.name;
  if (!deckIds.size) {
    root.append(emptyState('科目が見つかりません。', linkBtn('#/', 'ホームへ', 'btn primary')));
    return;
  }

  const [all, studied] = await Promise.all([DB.getAll('cards'), Store.newStudiedToday()]);
  const now = Date.now();
  const limit = Settings.get('newPerDay');
  const newLeft = new Map([...deckIds].map(id => [id, Math.max(0, limit - (studied.get(id) || 0))]));
  const pool = [];
  for (const c of all.filter(c => deckIds.has(c.deckId)).sort((a, b) => a.createdAt - b.createdAt)) {
    if (c.srs.state === 'new') {
      if (newLeft.get(c.deckId) > 0) {
        pool.push(c);
        newLeft.set(c.deckId, newLeft.get(c.deckId) - 1);
      }
    } else if (SRS.isLearning(c.srs) || c.srs.due <= now) {
      pool.push(c);
    }
  }

  let current = null;
  let showBack = false;
  let lastId = null;
  let undo = null;
  let answered = 0;
  let waitTimer = null;

  const byDue = (a, b) => a.srs.due - b.srs.due;

  function pickNext() {
    const t = Date.now();
    const candidates = [
      ...pool.filter(c => SRS.isLearning(c.srs) && c.srs.due <= t).sort(byDue),
      ...pool.filter(c => c.srs.state === 'review' && c.srs.due <= t).sort(byDue),
      ...pool.filter(c => c.srs.state === 'new'),
    ];
    // 同じカードが連続しないようにする（他に候補がなければ連続も可）
    return candidates.find(c => c.id !== lastId) || candidates[0] || null;
  }

  function next() {
    clearTimeout(waitTimer);
    current = pickNext();
    showBack = false;
    render();
  }

  async function rate(rating) {
    if (!current || !showBack) return;
    const card = current;
    const before = structuredClone(card);
    const prevState = card.srs.state;
    card.srs = SRS.answer(card.srs, rating);
    card.updatedAt = Date.now();
    await DB.put('cards', card);
    const log = await Store.logReview(card, rating, prevState);
    undo = { card, before, logId: log.id };
    answered++;
    if (card.srs.state === 'review') pool.splice(pool.indexOf(card), 1);
    lastId = card.id;
    next();
  }

  async function doUndo() {
    if (!undo) return;
    const { card, before, logId } = undo;
    undo = null;
    for (const k of Object.keys(card)) delete card[k];
    Object.assign(card, before);
    if (!pool.includes(card)) pool.push(card);
    await DB.put('cards', card);
    await DB.delete('reviews', logId);
    answered = Math.max(0, answered - 1);
    current = card;
    showBack = false;
    toast('元に戻しました');
    render();
  }

  async function toggleFlag() {
    if (!current) return;
    current.flagged = !current.flagged;
    await DB.put('cards', current);
    toast(current.flagged ? '★ 苦手カードにしました' : '苦手マークを外しました');
    render();
  }

  async function edit() {
    if (!current) return;
    const res = await editCardInDialog(current);
    if (res === null) {
      pool.splice(pool.indexOf(current), 1);
      if (undo?.card === current) undo = null;
      next();
    } else if (res) {
      Object.assign(current, res);
      if (!deckIds.has(current.deckId)) {
        pool.splice(pool.indexOf(current), 1);
        next();
      } else {
        render();
      }
    }
  }

  function render() {
    const t = Date.now();
    const nNew = pool.filter(c => c.srs.state === 'new').length;
    const nLearn = pool.filter(c => SRS.isLearning(c.srs)).length;
    const nReview = pool.filter(c => c.srs.state === 'review' && c.srs.due <= t).length;
    const counts = h('div', { class: 'counts big' },
      h('span', { class: 'c-new' + (nNew ? '' : ' zero'), title: '新規' }, nNew),
      h('span', { class: 'c-learn' + (nLearn ? '' : ' zero'), title: '学習中' }, nLearn),
      h('span', { class: 'c-review' + (nReview ? '' : ' zero'), title: '復習' }, nReview));
    const head = pageTitle(deckName, counts);

    if (!current) {
      const later = pool.filter(c => SRS.isLearning(c.srs)).sort(byDue)[0];
      root.replaceChildren(head, emptyState(
        later
          ? `ひとまず完了！（${answered} 枚回答）\n学習中のカードが ${formatDuration(later.srs.due - t)} 後に再出題されます。`
          : `🎉 お疲れさまでした！\nこの科目の今日の学習は完了です（${answered} 枚回答）。`,
        later ? h('button', { class: 'btn primary', onClick: () => {
          // 待たずに前倒しで出題する
          lastId = null;
          current = later;
          showBack = false;
          render();
        } }, '今すぐ続ける') : null,
        linkBtn('#/', 'ホームへ', later ? 'btn' : 'btn primary'),
        undo ? h('button', { class: 'btn', onClick: doUndo }, '↶ 直前の回答を取り消す') : null));
      // 学習中カードの時間が来たら自動で再開
      if (later) waitTimer = setTimeout(() => { if (!current) next(); }, Math.max(1000, later.srs.due - t + 500));
      return;
    }

    const deck = decks.find(d => d.id === current.deckId);
    const meta = h('div', { class: 'card-meta' },
      h('span', { class: 'badge ' + current.srs.state }, STATE_LABEL[current.srs.state]),
      target === 'all' && deck ? h('span', { class: 'muted' }, deck.name) : null,
      h('span', { class: 'spacer' }),
      undo ? h('button', { class: 'icon-btn', title: '元に戻す (Z)', onClick: doUndo }, '↶') : null,
      h('button', { class: 'icon-btn' + (current.flagged ? ' flagged' : ''), title: '苦手マーク (F)', onClick: toggleFlag }, current.flagged ? '★' : '☆'),
      h('button', { class: 'icon-btn', title: '編集 (E)', onClick: edit }, '✏️'));

    let actions;
    if (!showBack) {
      actions = h('div', { class: 'answer-bar' },
        h('button', { class: 'btn primary big wide', onClick: () => { showBack = true; render(); } }, '答えを表示', h('kbd', null, 'Space')));
    } else {
      const labels = SRS.preview(current.srs);
      actions = h('div', { class: 'answer-bar rating' }, SRS.RATINGS.map((r, i) =>
        h('button', { class: `btn rate ${r.cls}`, onClick: () => rate(r.value) },
          h('span', { class: 'ivl' }, labels[i]), r.label, h('kbd', null, r.key))));
    }
    root.replaceChildren(head, h('div', { class: 'study-card' }, meta, cardFace(current, showBack)), actions);
  }

  next();

  const offKeys = onKeys(e => {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'enter') {
      e.preventDefault();
      if (!current) return;
      if (!showBack) { showBack = true; render(); } else rate(3);
    } else if (/^[1-4]$/.test(k)) rate(+k);
    else if (k === 'z') doUndo();
    else if (k === 'f') toggleFlag();
    else if (k === 'e') edit();
  });
  return () => {
    offKeys();
    clearTimeout(waitTimer);
  };
};

// ---- 自由練習（スケジュールに影響しない） ----------------------------------------

Views.cram = async (root, { args, query }) => {
  const target = args[0] || 'all';
  const flaggedOnly = target === 'flagged' || query.get('flagged') === '1';
  const decks = await Store.decks();
  const deck = decks.find(d => d.id === target);
  let cards = await DB.getAll('cards');
  if (deck) cards = cards.filter(c => c.deckId === deck.id);
  if (flaggedOnly) cards = cards.filter(c => c.flagged);
  const title = `${deck ? deck.name : 'すべての科目'}${flaggedOnly ? '（★苦手）' : ''} 自由練習`;

  let queue = shuffle(cards);
  let showBack = false;
  let ok = 0, again = 0;

  function grade(good) {
    if (!showBack || !queue.length) return;
    const card = queue.shift();
    if (good) ok++;
    else {
      again++;
      queue.splice(Math.min(3, queue.length), 0, card);
    }
    showBack = false;
    render();
  }

  async function toggleFlag() {
    const card = queue[0];
    if (!card) return;
    card.flagged = !card.flagged;
    await DB.put('cards', card);
    toast(card.flagged ? '★ 苦手カードにしました' : '苦手マークを外しました');
    render();
  }

  function render() {
    const head = pageTitle(title, h('span', { class: 'muted' }, `残り ${queue.length} 枚`));
    if (!cards.length) {
      root.replaceChildren(head, emptyState('対象のカードがありません。', linkBtn('#/', 'ホームへ', 'btn primary')));
      return;
    }
    if (!queue.length) {
      root.replaceChildren(head, emptyState(
        `練習完了！\n覚えた: ${ok} / もう一度: ${again}`,
        h('button', { class: 'btn primary', onClick: () => { queue = shuffle(cards); ok = again = 0; render(); } }, 'もう一周'),
        linkBtn('#/', 'ホームへ')));
      return;
    }
    const card = queue[0];
    const meta = h('div', { class: 'card-meta' },
      h('span', { class: 'badge cram' }, '自由練習'),
      !deck ? h('span', { class: 'muted' }, decks.find(d => d.id === card.deckId)?.name || '') : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn' + (card.flagged ? ' flagged' : ''), title: '苦手マーク (F)', onClick: toggleFlag }, card.flagged ? '★' : '☆'),
      h('button', { class: 'icon-btn', title: '編集', onClick: async () => {
        const res = await editCardInDialog(card);
        if (res === null) {
          queue.shift();
          cards = cards.filter(c => c !== card);
        } else if (res) Object.assign(card, res);
        render();
      } }, '✏️'));
    const actions = !showBack
      ? h('div', { class: 'answer-bar' },
        h('button', { class: 'btn primary big wide', onClick: () => { showBack = true; render(); } }, '答えを表示', h('kbd', null, 'Space')))
      : h('div', { class: 'answer-bar rating two' },
        h('button', { class: 'btn rate again', onClick: () => grade(false) }, 'もう一度', h('kbd', null, '1')),
        h('button', { class: 'btn rate good', onClick: () => grade(true) }, '覚えた', h('kbd', null, 'Space')));
    root.replaceChildren(head, h('div', { class: 'study-card' }, meta, cardFace(card, showBack)), actions);
  }

  render();
  return onKeys(e => {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'enter') {
      e.preventDefault();
      if (!showBack) { showBack = true; render(); } else grade(true);
    } else if (k === '1') grade(false);
    else if (k === '3' || k === '4') grade(true);
    else if (k === 'f') toggleFlag();
  });
};

// ---- カード一覧 ------------------------------------------------------------------

Views.browse = async (root, { query }) => {
  const decks = await Store.decks();
  const deckMap = new Map(decks.map(d => [d.id, d]));
  let cards = await DB.getAll('cards');
  const PAGE = 100;
  let shown = PAGE;

  const deckSel = h('select', { class: 'input' },
    h('option', { value: '' }, 'すべての科目'),
    Store.CATEGORIES.map(cat => {
      const ds = decks.filter(d => d.category === cat);
      return ds.length ? h('optgroup', { label: cat }, ds.map(d => h('option', { value: d.id, selected: d.id === query.get('deck') }, d.name))) : null;
    }));
  const search = h('input', { class: 'input', type: 'search', placeholder: '🔍 キーワード・#タグで検索', value: query.get('q') || '' });
  const stateSel = h('select', { class: 'input' },
    [['', 'すべての状態'], ['flagged', '★ 苦手のみ'], ['new', '新規'], ['learning', '学習中'], ['review', '復習'], ['due', '今日が期限'], ['lapsed', '間違えたことがある']]
      .map(([v, l]) => h('option', { value: v }, l)));
  const sortSel = h('select', { class: 'input' },
    [['created', '新しい順'], ['lapses', '間違えた回数順'], ['due', '次回の復習が近い順']].map(([v, l]) => h('option', { value: v }, l)));
  const list = h('div', { class: 'card-list' });
  const countEl = h('span', { class: 'muted' });

  function filtered() {
    const deckId = deckSel.value;
    const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const st = stateSel.value;
    const now = Date.now();
    const res = cards.filter(c => {
      if (deckId && c.deckId !== deckId) return false;
      if (st === 'flagged' && !c.flagged) return false;
      if (st === 'new' && c.srs.state !== 'new') return false;
      if (st === 'learning' && !SRS.isLearning(c.srs)) return false;
      if (st === 'review' && c.srs.state !== 'review') return false;
      if (st === 'due' && !SRS.isDue(c.srs, now)) return false;
      if (st === 'lapsed' && !c.srs.lapses) return false;
      if (words.length) {
        const hay = [c.front, c.back, c.note, ...(c.tags || []).map(t => '#' + t)].join('\n').toLowerCase();
        if (!words.every(w => hay.includes(w))) return false;
      }
      return true;
    });
    const sort = sortSel.value;
    res.sort(sort === 'lapses' ? (a, b) => b.srs.lapses - a.srs.lapses || b.createdAt - a.createdAt
      : sort === 'due' ? (a, b) => (a.srs.state === 'new') - (b.srs.state === 'new') || a.srs.due - b.srs.due
        : (a, b) => b.createdAt - a.createdAt);
    return res;
  }

  function row(c) {
    const thumbId = c.frontImages?.[0] || c.backImages?.[0];
    const thumb = h('div', { class: 'row-thumb' });
    if (thumbId) {
      const img = h('img', { alt: '' });
      Images.url(thumbId).then(u => { if (u) img.src = u; });
      thumb.append(img);
    }
    const s = c.srs;
    const when = s.state === 'new' ? '未学習' : `次回 ${formatDate(s.due)}`;
    return h('div', { class: 'card-row', onClick: async e => {
      if (e.target.closest('.flag-btn')) return;
      const res = await editCardInDialog(c);
      if (res === null) cards = cards.filter(x => x !== c);
      else if (res) Object.assign(c, res);
      if (res !== undefined) refresh(false);
    } },
      thumb,
      h('div', { class: 'row-body' },
        h('div', { class: 'row-front' }, plainSnippet(c.front) || (c.frontImages?.length ? '（画像）' : '')),
        h('div', { class: 'row-back muted' }, plainSnippet(c.back, 60)),
        h('div', { class: 'row-meta' },
          h('span', { class: 'badge ' + s.state }, STATE_LABEL[s.state]),
          h('span', null, deckMap.get(c.deckId)?.name || '（科目なし）'),
          h('span', null, when),
          s.lapses ? h('span', { class: 'lapses' }, `✗${s.lapses}`) : null,
          (c.tags || []).map(t => h('span', { class: 'tag' }, '#' + t)))),
      h('button', { class: 'icon-btn flag-btn' + (c.flagged ? ' flagged' : ''), title: '苦手マーク', onClick: async () => {
        c.flagged = !c.flagged;
        await DB.put('cards', c);
        refresh(false);
      } }, c.flagged ? '★' : '☆'));
  }

  function refresh(resetPage = true) {
    if (resetPage) shown = PAGE;
    const res = filtered();
    countEl.textContent = `${res.length} 枚`;
    list.replaceChildren(...res.slice(0, shown).map(row));
    if (res.length > shown) {
      list.append(h('button', { class: 'btn wide', onClick: () => { shown += PAGE; refresh(false); } }, `さらに表示（残り ${res.length - shown} 枚）`));
    }
    if (!res.length) list.append(h('p', { class: 'empty muted' }, cards.length ? '条件に合うカードがありません' : 'まだカードがありません'));
  }

  [deckSel, stateSel, sortSel].forEach(el => el.addEventListener('change', () => refresh()));
  search.addEventListener('input', () => refresh());

  root.append(
    pageTitle('カード一覧', countEl, linkBtn(`#/add${query.get('deck') ? '?deck=' + query.get('deck') : ''}`, '＋ 追加', 'btn primary small')),
    h('div', { class: 'filters' }, search, deckSel, stateSel, sortSel),
    list);
  refresh();
};

// ---- 統計 --------------------------------------------------------------------

Views.stats = async root => {
  const [decks, cards, logs] = await Promise.all([Store.decks(), DB.getAll('cards'), DB.getAll('reviews')]);
  const now = Date.now();
  const today = dayKey(now);

  const perDay = new Map();
  for (const l of logs) {
    const k = dayKey(l.ts);
    perDay.set(k, (perDay.get(k) || 0) + 1);
  }
  const todayLogs = logs.filter(l => dayKey(l.ts) === today);
  const todayCorrect = todayLogs.filter(l => l.rating > 1).length;

  // 連続学習日数
  let streak = 0;
  let cursor = studyDayStart(now);
  if (!perDay.has(today)) cursor -= DAY;
  while (perDay.has(dayKey(cursor))) {
    streak++;
    cursor -= DAY;
  }

  const states = { new: 0, learning: 0, young: 0, mature: 0 };
  for (const c of cards) {
    if (c.srs.state === 'new') states.new++;
    else if (SRS.isLearning(c.srs)) states.learning++;
    else if (c.srs.interval >= 21) states.mature++;
    else states.young++;
  }

  root.append(pageTitle('学習の記録'));
  root.append(h('section', { class: 'summary-stats wide' },
    statBox(todayLogs.length, '今日の回答数'),
    statBox(todayLogs.length ? Math.round(todayCorrect / todayLogs.length * 100) + '%' : '-', '今日の正答率'),
    statBox(streak + '日', '連続学習'),
    statBox(logs.length, '累計回答数')));

  // ヒートマップ（直近 18 週）
  const WEEKS = 18;
  const startDay = studyDayStart(now) - ((WEEKS - 1) * 7 + new Date(studyDayStart(now)).getDay()) * DAY;
  const heat = h('div', { class: 'heatmap' });
  for (let i = 0; i < WEEKS * 7; i++) {
    const ts = startDay + i * DAY;
    if (ts > now) {
      heat.append(h('div', { class: 'cell future' }));
      continue;
    }
    const n = perDay.get(dayKey(ts)) || 0;
    const lv = n === 0 ? 0 : n < 10 ? 1 : n < 30 ? 2 : n < 60 ? 3 : 4;
    heat.append(h('div', { class: `cell lv${lv}`, title: `${formatDate(ts)}：${n} 回` }));
  }
  root.append(section('学習カレンダー', heat,
    h('div', { class: 'legend muted' }, '少', [0, 1, 2, 3, 4].map(lv => h('div', { class: `cell lv${lv}` })), '多')));

  // カードの習熟度
  const total = cards.length || 1;
  const bar = h('div', { class: 'stack-bar' },
    [['new', '新規'], ['learning', '学習中'], ['young', '復習中（21日未満）'], ['mature', '定着（21日以上）']]
      .map(([k, l]) => states[k] ? h('div', { class: 'seg ' + k, style: { flex: states[k] }, title: `${l}: ${states[k]}` }) : null));
  root.append(section('カードの習熟度', bar,
    h('div', { class: 'legend-row' },
      [['new', '新規'], ['learning', '学習中'], ['young', '復習中'], ['mature', '定着（間隔21日以上）']]
        .map(([k, l]) => h('span', null, h('i', { class: 'dot ' + k }), `${l} ${states[k]}（${Math.round(states[k] / total * 100)}%）`)))));

  // 今後 7 日の復習予定
  const forecast = Array.from({ length: 7 }, () => 0);
  const base = studyDayStart(now);
  for (const c of cards) {
    if (c.srs.state === 'new') continue;
    const d = Math.max(0, Math.floor((c.srs.due - base) / DAY));
    if (d < 7) forecast[d]++;
  }
  const maxF = Math.max(1, ...forecast);
  root.append(section('今後 7 日間の復習予定',
    h('div', { class: 'bars' }, forecast.map((n, i) => h('div', { class: 'bar-col' },
      h('div', { class: 'bar-num' }, n),
      h('div', { class: 'bar', style: { height: `${n / maxF * 100}%` } }),
      h('div', { class: 'bar-label' }, i === 0 ? '今日' : formatDate(base + i * DAY)))))));

  // 科目別
  const since = now - 30 * DAY;
  const rows = decks.map(d => {
    const dc = cards.filter(c => c.deckId === d.id);
    const dl = logs.filter(l => l.deckId === d.id && l.ts >= since);
    const mature = dc.filter(c => c.srs.state === 'review' && c.srs.interval >= 21).length;
    return h('tr', null,
      h('td', null, h('a', { href: `#/browse?deck=${d.id}` }, d.name)),
      h('td', { class: 'num' }, dc.length),
      h('td', { class: 'num' }, dc.length ? Math.round(mature / dc.length * 100) + '%' : '-'),
      h('td', { class: 'num' }, dl.length ? Math.round(dl.filter(l => l.rating > 1).length / dl.length * 100) + '%' : '-'),
      h('td', { class: 'num' }, dc.filter(c => c.flagged).length || ''));
  });
  root.append(section('科目別',
    h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, '科目'), h('th', null, '枚数'), h('th', null, '定着率'), h('th', null, '正答率(30日)'), h('th', null, '★'))),
      h('tbody', null, rows)))));

  // よく間違えるカード
  const againCount = new Map();
  for (const l of logs) if (l.rating === 1) againCount.set(l.cardId, (againCount.get(l.cardId) || 0) + 1);
  const worst = cards.filter(c => againCount.get(c.id)).sort((a, b) => againCount.get(b.id) - againCount.get(a.id)).slice(0, 15);
  root.append(section('よく間違えるカード',
    worst.length
      ? h('div', { class: 'card-list compact' }, worst.map(c => h('div', { class: 'card-row', onClick: async () => { if (await editCardInDialog(c) !== undefined) App.render(); } },
        h('div', { class: 'row-body' },
          h('div', { class: 'row-front' }, plainSnippet(c.front) || '（画像）'),
          h('div', { class: 'row-meta' }, h('span', { class: 'lapses' }, `✗ ${againCount.get(c.id)} 回`), h('span', null, decks.find(d => d.id === c.deckId)?.name || ''))),
        h('button', { class: 'icon-btn flag-btn' + (c.flagged ? ' flagged' : ''), title: '苦手マーク', onClick: async e => {
          e.stopPropagation();
          c.flagged = !c.flagged;
          await DB.put('cards', c);
          e.currentTarget.textContent = c.flagged ? '★' : '☆';
          e.currentTarget.classList.toggle('flagged', c.flagged);
        } }, c.flagged ? '★' : '☆'))))
      : h('p', { class: 'muted' }, 'まだデータがありません')));

  function statBox(v, l) {
    return h('div', { class: 'stat' }, h('div', { class: 'stat-value' }, v), h('div', { class: 'stat-label' }, l));
  }
  function section(title, ...body) {
    return h('section', { class: 'panel' }, h('h2', null, title), body);
  }
};

// ---- 設定 --------------------------------------------------------------------

Views.settings = async root => {
  const newIn = h('input', { class: 'input narrow', type: 'number', min: 0, max: 999, value: Settings.get('newPerDay'),
    onChange: e => {
      const v = Math.max(0, Math.min(999, parseInt(e.target.value, 10) || 0));
      e.target.value = v;
      Settings.set('newPerDay', v);
      toast('保存しました');
    } });
  const themeSel = h('select', { class: 'input narrow', onChange: e => { Settings.set('theme', e.target.value); applyTheme(); } },
    [['auto', '端末の設定に合わせる'], ['light', 'ライト'], ['dark', 'ダーク']].map(([v, l]) => h('option', { value: v, selected: Settings.get('theme') === v }, l)));

  const usage = h('span', { class: 'muted' }, '計算中…');
  navigator.storage?.estimate?.().then(({ usage: u }) => { usage.textContent = `約 ${(u / 1024 / 1024).toFixed(1)} MB 使用中`; })
    .catch(() => { usage.textContent = '不明'; });

  const importIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onChange: async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!await Dialog.confirm(`バックアップ（${data.exportedAt?.slice(0, 10) || '日付不明'}）を読み込みます。\n同じカードは上書きされ、それ以外は追加されます。`, { ok: '読み込む' })) return;
      const r = await Store.importAll(data);
      toast(`科目 ${r.decks} 件・カード ${r.cards} 枚を読み込みました`);
    } catch (err) {
      Dialog.confirm('読み込みに失敗しました：\n' + err.message);
    }
  } });

  async function doExport() {
    toast('バックアップを作成中…');
    const data = await Store.exportAll();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `ap-study-backup-${dayKey()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  root.append(
    pageTitle('設定'),
    h('section', { class: 'panel' },
      h('h2', null, '学習'),
      h('div', { class: 'setting' }, h('div', null, h('div', null, '1日の新規カード上限'), h('div', { class: 'hint' }, '科目ごとに、1日に新しく学習するカードの最大枚数')), newIn),
      h('div', { class: 'setting' }, h('div', null, 'テーマ'), themeSel)),
    h('section', { class: 'panel' },
      h('h2', null, 'バックアップ'),
      h('p', { class: 'hint' }, 'データはこのブラウザ内に保存されています。ブラウザのデータ削除や端末の変更に備えて、定期的にバックアップしてください。別の端末（スマホ⇔PC）へ移すときもこのファイルを使います。'),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn primary', onClick: doExport }, '⬇ バックアップを保存'),
        h('button', { class: 'btn', onClick: () => importIn.click() }, '⬆ バックアップを読み込む'),
        importIn),
      h('div', { class: 'setting' }, h('div', null, '保存容量'), usage)),
    h('section', { class: 'panel' },
      h('h2', null, 'キーボードショートカット（学習中）'),
      h('table', { class: 'table' }, h('tbody', null,
        [['Space / Enter', '答えを表示 → 「正解」'], ['1 〜 4', 'もう一度 / 難しい / 正解 / 簡単'], ['F', '苦手マークの切り替え'], ['E', 'カードを編集'], ['Z', '直前の回答を取り消す']]
          .map(([k, v]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, v)))))),
    h('section', { class: 'panel danger-zone' },
      h('h2', null, 'データの削除'),
      h('button', { class: 'btn danger', onClick: async () => {
        if (!await Dialog.confirm('すべての科目・カード・画像・学習記録を削除します。\nこの操作は取り消せません。先にバックアップを保存することをおすすめします。', { ok: 'すべて削除', danger: true })) return;
        await DB.clearAll();
        toast('すべてのデータを削除しました');
        location.hash = '#/';
      } }, 'すべてのデータを削除')));
};
