'use strict';

/** アプリ固有のデータ操作（科目・カード・統計） */
const Store = (() => {
  const CATEGORIES = ['テクノロジ系', 'マネジメント系', 'ストラテジ系', '午後対策', 'その他'];

  const AP_TEMPLATE = [
    ['テクノロジ系', ['基礎理論', 'アルゴリズムとプログラミング', 'コンピュータシステム', 'ヒューマンインタフェース・マルチメディア', 'データベース', 'ネットワーク', 'セキュリティ', '開発技術']],
    ['マネジメント系', ['プロジェクトマネジメント', 'サービスマネジメント', 'システム監査']],
    ['ストラテジ系', ['システム戦略・システム企画', '経営戦略', '企業活動・法務']],
    ['午後対策', ['午後問題 演習']],
  ];

  async function decks() {
    const list = await DB.getAll('decks');
    return list.sort((a, b) =>
      CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.createdAt - b.createdAt);
  }

  async function createDeck(name, category) {
    const deck = { id: uid(), name, category: CATEGORIES.includes(category) ? category : 'その他', createdAt: Date.now() };
    await DB.put('decks', deck);
    return deck;
  }

  async function createTemplateDecks() {
    const existing = new Set((await decks()).map(d => d.name));
    let t = Date.now();
    const list = [];
    for (const [category, names] of AP_TEMPLATE) {
      for (const name of names) {
        if (!existing.has(name)) list.push({ id: uid(), name, category, createdAt: t++ });
      }
    }
    await DB.putMany('decks', list);
    return list.length;
  }

  async function deleteDeck(deck) {
    const cards = await DB.getByIndex('cards', 'deckId', deck.id);
    await DB.deleteCards(cards);
    await DB.delete('decks', deck.id);
  }

  function newCard(deckId) {
    const now = Date.now();
    return {
      id: uid(), deckId, front: '', back: '', note: '', frontImages: [], backImages: [], tags: [],
      flagged: false, createdAt: now, updatedAt: now, srs: SRS.initial(),
    };
  }

  /** 今日すでに学習を始めた新規カードの枚数（科目ごと） */
  async function newStudiedToday() {
    const start = studyDayStart();
    const logs = await DB.getRange('reviews', 'ts', start, start + DAY);
    const map = new Map();
    for (const r of logs) if (r.prevState === 'new') map.set(r.deckId, (map.get(r.deckId) || 0) + 1);
    return map;
  }

  /** 科目ごとの 新規/学習中/復習 枚数 */
  async function deckCounts() {
    const [cards, studied] = await Promise.all([DB.getAll('cards'), newStudiedToday()]);
    const now = Date.now();
    const limit = Settings.get('newPerDay');
    const counts = new Map();
    for (const c of cards) {
      if (!counts.has(c.deckId)) counts.set(c.deckId, { total: 0, newAll: 0, new: 0, learn: 0, review: 0, flagged: 0 });
      const k = counts.get(c.deckId);
      k.total++;
      if (c.flagged) k.flagged++;
      if (c.srs.state === 'new') k.newAll++;
      else if (SRS.isLearning(c.srs) && c.srs.due <= now) k.learn++;
      else if (c.srs.state === 'review' && c.srs.due <= now) k.review++;
    }
    for (const [deckId, k] of counts) k.new = Math.max(0, Math.min(k.newAll, limit - (studied.get(deckId) || 0)));
    return counts;
  }

  async function logReview(card, rating, prevState) {
    const log = { id: uid(), cardId: card.id, deckId: card.deckId, ts: Date.now(), rating, prevState };
    await DB.put('reviews', log);
    return log;
  }

  // ---- バックアップ ----------------------------------------------------------

  async function exportAll() {
    const [decks, cards, reviews, images] = await Promise.all(
      ['decks', 'cards', 'reviews', 'images'].map(s => DB.getAll(s)));
    const imgs = [];
    for (const img of images) imgs.push({ id: img.id, data: await blobToDataURL(img.blob) });
    return { app: 'ap-study-cards', version: 1, exportedAt: new Date().toISOString(), decks, cards, reviews, images: imgs };
  }

  /** 同じ ID のデータは上書き、それ以外は追加（マージ） */
  async function importAll(data) {
    if (data?.app !== 'ap-study-cards') throw new Error('このアプリのバックアップファイルではありません');
    const images = [];
    for (const img of data.images || []) images.push({ id: img.id, blob: await dataURLToBlob(img.data) });
    await DB.putMany('images', images);
    images.forEach(i => Images.forget(i.id));
    await DB.putMany('decks', data.decks || []);
    await DB.putMany('cards', data.cards || []);
    await DB.putMany('reviews', data.reviews || []);
    return { decks: (data.decks || []).length, cards: (data.cards || []).length };
  }

  return {
    CATEGORIES, decks, createDeck, createTemplateDecks, deleteDeck, newCard,
    newStudiedToday, deckCounts, logReview, exportAll, importAll,
  };
})();
