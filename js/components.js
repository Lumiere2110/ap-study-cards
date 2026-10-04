'use strict';

// ---- ダイアログ --------------------------------------------------------------

const Dialog = {
  /** 戻り値の closed は close(value) に渡した値で resolve（Esc 等なら undefined） */
  open(title, body, { actions, wide, onClose } = {}) {
    let result;
    const dlg = h('dialog', { class: 'dlg' + (wide ? ' wide' : '') },
      h('div', { class: 'dlg-head' },
        h('h2', null, title),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': '閉じる', onClick: () => close() }, '✕')),
      h('div', { class: 'dlg-body' }, body),
      actions ? h('div', { class: 'dlg-actions' }, actions) : null);
    const closed = new Promise(resolve => {
      dlg.addEventListener('close', () => {
        dlg.remove();
        onClose?.();
        resolve(result);
      });
    });
    function close(value) {
      result = value;
      if (dlg.open) dlg.close();
    }
    document.body.append(dlg);
    dlg.showModal();
    return { el: dlg, close, closed };
  },

  confirm(message, { ok = 'OK', danger = false } = {}) {
    const d = Dialog.open('確認', h('p', { class: 'pre' }, message), {
      actions: [
        h('button', { class: 'btn', type: 'button', onClick: () => d.close(false) }, 'キャンセル'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', onClick: () => d.close(true) }, ok),
      ],
    });
    return d.closed.then(v => v === true);
  },
};

const anyDialogOpen = () => !!$('dialog[open]');

// ---- 画像表示 ----------------------------------------------------------------

function imageGrid(ids) {
  if (!ids?.length) return null;
  const grid = h('div', { class: 'img-grid' });
  for (const id of ids) {
    const img = h('img', { class: 'zoomable', alt: '画像', loading: 'lazy' });
    grid.append(img);
    Images.url(id).then(u => { if (u) img.src = u; });
  }
  return grid;
}

function openLightbox(src) {
  const box = h('div', { class: 'lightbox', onClick: () => box.remove() }, h('img', { src, alt: '拡大画像' }));
  // モーダルダイアログ表示中は top layer の上に出すためダイアログ内に置く
  ($('dialog[open]') || document.body).append(box);
}

document.addEventListener('click', e => {
  const img = e.target.closest('img.zoomable');
  if (img?.src) openLightbox(img.src);
});

// ---- カード表示 --------------------------------------------------------------

function cardFace(card, showBack) {
  const cloze = hasCloze(card.front);
  const wrap = h('div', { class: 'card-face' });
  appendChildren(wrap, [
    h('div', { class: 'content', html: renderText(card.front, cloze ? (showBack ? 'back' : 'front') : 'plain') }),
    imageGrid(card.frontImages)]);
  if (!showBack) return wrap;

  const hasBack = card.back?.trim() || card.backImages?.length;
  if (hasBack) {
    appendChildren(wrap, [
      h('hr', { class: 'answer-sep' }),
      card.back?.trim() ? h('div', { class: 'content', html: renderText(card.back) }) : null,
      imageGrid(card.backImages)]);
  }
  if (card.note?.trim()) {
    wrap.append(h('div', { class: 'note-box' },
      h('div', { class: 'note-label' }, '解説・メモ'),
      h('div', { class: 'content', html: renderText(card.note) })));
  }
  if (card.tags?.length) wrap.append(h('div', { class: 'tags' }, card.tags.map(t => h('span', { class: 'tag' }, '#' + t))));
  return wrap;
}

// ---- カード編集フォーム ------------------------------------------------------

function wrapSelection(ta, before, after) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const sel = value.slice(s, e);
  ta.setRangeText(before + sel + after, s, e, 'end');
  if (!sel) ta.setSelectionRange(s + before.length, s + before.length);
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

/**
 * カード編集フォームを返す。
 * onSave(card, { next }) — next は「保存して続ける」が押された場合 true
 */
function cardEditor({ card, decks, isNew, onSave, onCancel }) {
  const created = [];
  const draft = {};
  for (const side of ['front', 'back']) draft[side] = (card[side + 'Images'] || []).map(id => ({ id }));

  const deckSel = h('select', { class: 'input', id: 'ed-deck' },
    Store.CATEGORIES.map(cat => {
      const ds = decks.filter(d => d.category === cat);
      return ds.length ? h('optgroup', { label: cat }, ds.map(d => h('option', { value: d.id, selected: d.id === card.deckId }, d.name))) : null;
    }));

  const frontTa = h('textarea', { class: 'input', rows: 5, placeholder: '問題・覚えたいこと\n例）DNS の役割は？\n穴埋めにしたい語句は {{ }} で囲む → 例）DNS は {{ドメイン名}} を IP アドレスに変換する', value: card.front });
  const backTa = h('textarea', { class: 'input', rows: 4, placeholder: '答え（穴埋めカードでは省略可）', value: card.back });
  const noteTa = h('textarea', { class: 'input', rows: 3, placeholder: '解説・間違えた理由・関連知識など（任意）', value: card.note });
  const tagsIn = h('input', { class: 'input', placeholder: '例）過去問 R5秋 午前', value: (card.tags || []).join(' ') });
  const flagCb = h('input', { type: 'checkbox', checked: !!card.flagged });
  const clozeHint = h('div', { class: 'hint' });

  const updateClozeHint = () => {
    clozeHint.textContent = hasCloze(frontTa.value) ? '✓ 穴埋めカードとして出題されます（{{ }} の部分が隠れます）' : '';
  };
  frontTa.addEventListener('input', updateClozeHint);
  updateClozeHint();

  function toolbar(ta, withCloze) {
    const b = (label, title, fn) => h('button', { class: 'tool', type: 'button', title, onClick: fn }, label);
    return h('div', { class: 'toolbar' },
      withCloze ? b('{{ }} 穴埋め', '選択した語句を穴埋めにする (Ctrl+Shift+C)', () => wrapSelection(ta, '{{', '}}')) : null,
      b('B', '太字', () => wrapSelection(ta, '**', '**')),
      b('マーカー', '強調', () => wrapSelection(ta, '==', '==')),
      b('</>', 'コード（複数行は ``` で囲む）', () => {
        const multi = ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n');
        multi ? wrapSelection(ta, '```\n', '\n```') : wrapSelection(ta, '`', '`');
      }));
  }

  function imagePicker(side, ta, field) {
    const thumbs = h('div', { class: 'thumbs' });
    const renderThumbs = () => {
      thumbs.replaceChildren(...draft[side].map((it, i) => {
        const img = h('img', { class: 'zoomable', alt: '' });
        if (it.url) img.src = it.url;
        else Images.url(it.id).then(u => { if (u) img.src = u; });
        return h('div', { class: 'thumb' }, img,
          h('button', { class: 'thumb-del', type: 'button', title: '削除', onClick: () => { draft[side].splice(i, 1); renderThumbs(); } }, '✕'));
      }));
    };
    async function addFiles(files) {
      const imgs = Array.from(files).filter(f => f.type.startsWith('image/'));
      for (const f of imgs) {
        const blob = await compressImage(f);
        const url = URL.createObjectURL(blob);
        created.push(url);
        draft[side].push({ blob, url });
      }
      if (imgs.length) renderThumbs();
      return imgs.length;
    }
    const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true,
      onChange: e => { addFiles(e.target.files); e.target.value = ''; } });
    const camIn = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true,
      onChange: e => { addFiles(e.target.files); e.target.value = ''; } });

    ta.addEventListener('paste', e => {
      const files = Array.from(e.clipboardData?.files || []);
      if (files.some(f => f.type.startsWith('image/'))) {
        e.preventDefault();
        addFiles(files).then(n => n && toast('画像を貼り付けました'));
      }
    });
    field.addEventListener('dragover', e => { e.preventDefault(); field.classList.add('drag'); });
    field.addEventListener('dragleave', () => field.classList.remove('drag'));
    field.addEventListener('drop', e => {
      e.preventDefault();
      field.classList.remove('drag');
      addFiles(e.dataTransfer.files);
    });
    renderThumbs();
    return h('div', { class: 'img-picker' },
      thumbs,
      h('div', { class: 'row gap' },
        h('button', { class: 'btn small', type: 'button', onClick: () => fileIn.click() }, '🖼 画像を追加'),
        h('button', { class: 'btn small', type: 'button', onClick: () => camIn.click() }, '📷 撮影'),
        h('span', { class: 'hint' }, 'Ctrl+V で貼り付け / ドラッグ&ドロップも可')),
      fileIn, camIn);
  }

  function field(label, ta, side, withCloze) {
    const f = h('div', { class: 'field' }, h('label', null, label), toolbar(ta, withCloze), ta);
    if (side) f.append(imagePicker(side, ta, f));
    return f;
  }

  async function save(next) {
    const front = frontTa.value.trim();
    if (!front && !draft.front.length) {
      toast('表（問題）にテキストか画像を入れてください');
      frontTa.focus();
      return;
    }
    if (!deckSel.value) {
      toast('科目を選んでください');
      return;
    }
    const ids = { front: [], back: [] };
    for (const side of ['front', 'back']) {
      for (const it of draft[side]) {
        if (!it.id) it.id = await Images.save(it.blob);
        ids[side].push(it.id);
      }
    }
    const kept = new Set([...ids.front, ...ids.back]);
    const removed = [...(card.frontImages || []), ...(card.backImages || [])].filter(id => !kept.has(id));
    const saved = {
      ...card,
      deckId: deckSel.value,
      front,
      back: backTa.value.trim(),
      note: noteTa.value.trim(),
      tags: tagsIn.value.split(/[\s,、]+/).filter(Boolean),
      flagged: flagCb.checked,
      frontImages: ids.front,
      backImages: ids.back,
      updatedAt: Date.now(),
    };
    await DB.put('cards', saved);
    await DB.deleteMany('images', removed);
    removed.forEach(Images.forget);
    cleanup();
    onSave(saved, { next });
  }

  function cleanup() {
    created.forEach(u => URL.revokeObjectURL(u));
    created.length = 0;
  }

  const form = h('form', { class: 'editor', onSubmit: e => { e.preventDefault(); save(false); } },
    h('div', { class: 'field' }, h('label', { for: 'ed-deck' }, '科目'), deckSel),
    field('表（問題・覚えたいこと）', frontTa, 'front', true),
    clozeHint,
    field('裏（答え）', backTa, 'back', false),
    field('解説・メモ', noteTa, null, false),
    h('div', { class: 'field' }, h('label', null, 'タグ（スペース区切り）'), tagsIn),
    h('label', { class: 'check' }, flagCb, ' ★ 苦手カードとしてマーク'),
    h('details', { class: 'syntax-help' },
      h('summary', null, '書き方のヒント'),
      h('ul', null,
        h('li', null, h('code', null, '{{答え}}'), ' … 穴埋め。', h('code', null, '{{答え::ヒント}}'), ' でヒント付き'),
        h('li', null, h('code', null, '**太字**'), ' / ', h('code', null, '==マーカー=='), ' / ', h('code', null, '`コード`')),
        h('li', null, h('code', null, '```'), ' で囲むと複数行のコード（擬似言語など）'),
        h('li', null, 'Ctrl+Enter で保存、Ctrl+Shift+C で選択範囲を穴埋め'))),
    h('div', { class: 'form-actions' },
      onCancel ? h('button', { class: 'btn', type: 'button', onClick: () => { cleanup(); onCancel(); } }, 'キャンセル') : null,
      isNew ? h('button', { class: 'btn', type: 'button', onClick: () => save(true) }, '保存して続けて追加') : null,
      h('button', { class: 'btn primary', type: 'submit' }, isNew ? '保存' : '更新')));

  form.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save(isNew);
    } else if (e.key.toLowerCase() === 'c' && e.ctrlKey && e.shiftKey && e.target.tagName === 'TEXTAREA') {
      e.preventDefault();
      wrapSelection(e.target, '{{', '}}');
    }
  });
  form.cleanup = cleanup;
  return form;
}

/** ダイアログでカードを編集。保存されたカード（削除時は null、キャンセル時は undefined）を返す */
async function editCardInDialog(card) {
  const decks = await Store.decks();
  let d;
  const form = cardEditor({
    card, decks, isNew: false,
    onSave: saved => { toast('更新しました'); d.close(saved); },
    onCancel: () => d.close(),
  });
  const delBtn = h('button', { class: 'btn danger small', type: 'button', onClick: async () => {
    if (!await Dialog.confirm('このカードを削除しますか？', { ok: '削除', danger: true })) return;
    await DB.deleteCards([card]);
    toast('削除しました');
    d.close(null);
  } }, 'このカードを削除');
  d = Dialog.open('カードを編集', [form, h('div', { class: 'dlg-footer-left' }, delBtn)], { wide: true, onClose: form.cleanup });
  return d.closed;
}

/** 科目の作成・編集ダイアログ */
async function deckDialog(deck) {
  const nameIn = h('input', { class: 'input', value: deck?.name || '', placeholder: '例）ネットワーク', required: true });
  const catSel = h('select', { class: 'input' },
    Store.CATEGORIES.map(c => h('option', { value: c, selected: c === (deck?.category || 'テクノロジ系') }, c)));
  let d;
  const form = h('form', { onSubmit: async e => {
    e.preventDefault();
    const name = nameIn.value.trim();
    if (!name) return;
    if (deck) {
      await DB.put('decks', { ...deck, name, category: catSel.value });
      d.close(true);
    } else {
      d.close(await Store.createDeck(name, catSel.value));
    }
  } },
    h('div', { class: 'field' }, h('label', null, '科目名'), nameIn),
    h('div', { class: 'field' }, h('label', null, '分野'), catSel),
    h('div', { class: 'form-actions' },
      h('button', { class: 'btn', type: 'button', onClick: () => d.close() }, 'キャンセル'),
      h('button', { class: 'btn primary', type: 'submit' }, deck ? '保存' : '作成')));
  d = Dialog.open(deck ? '科目を編集' : '科目を追加', form);
  nameIn.focus();
  return d.closed;
}
