'use strict';

// ---- DOM helpers -------------------------------------------------------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** 小さな hyperscript: h('div', {class: 'x', onClick: fn}, child1, 'text') */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  // モーダル表示中は top layer に隠れないようダイアログ内へ移す
  ($('dialog[open]') || document.body).append(el);
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---- 日付（Anki と同様に午前4時で日付が切り替わる） ----------------------

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const DAY_CUTOFF_HOUR = 4;

/** ts が属する「学習日」の開始時刻（午前4時） */
function studyDayStart(ts = Date.now()) {
  const d = new Date(ts - DAY_CUTOFF_HOUR * HOUR);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + DAY_CUTOFF_HOUR * HOUR;
}

/** 学習日を 'YYYY-MM-DD' で返す */
function dayKey(ts = Date.now()) {
  const d = new Date(ts - DAY_CUTOFF_HOUR * HOUR);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatDuration(ms) {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}分`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}時間`;
  const days = ms / DAY;
  if (days < 30) return `${Math.round(days)}日`;
  if (days < 365) return `${(days / 30).toFixed(1).replace(/\.0$/, '')}ヶ月`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, '')}年`;
}

function formatDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ---- カード本文のレンダリング --------------------------------------------
//  **太字**  ==マーカー==  `コード`  ```コードブロック```
//  穴埋め: {{答え}} / {{答え::ヒント}}

const CLOZE_RE = /\{\{([\s\S]+?)(?:::([\s\S]+?))?\}\}/g;

function hasCloze(text) {
  CLOZE_RE.lastIndex = 0;
  return CLOZE_RE.test(text || '');
}

/** mode: 'plain' | 'front'（穴埋めを隠す） | 'back'（穴埋めを強調表示） */
function renderText(text, mode = 'plain') {
  const blocks = [];
  let s = String(text || '').replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_, code) => {
    blocks.push(code.replace(/\n$/, ''));
    return `\u0000${blocks.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(CLOZE_RE, (_, ans, hint) => {
    if (mode === 'front') return `<span class="cloze">[${hint ? hint : '…'}]</span>`;
    if (mode === 'back') return `<span class="cloze-ans">${ans}</span>`;
    return ans;
  });
  s = s
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/==([^=\n]+)==/g, '<mark>$1</mark>')
    .replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000(<br>)?/g, (_, i) => `<pre><code>${escapeHtml(blocks[+i])}</code></pre>`);
}

/** 一覧表示用の1行プレーンテキスト */
function plainSnippet(text, len = 80) {
  const s = String(text || '').replace(CLOZE_RE, '[$1]').replace(/```|\*\*|==|`/g, '').replace(/\s+/g, ' ').trim();
  return s.length > len ? s.slice(0, len) + '…' : s;
}

// ---- 画像 ------------------------------------------------------------------

/** 大きな写真は縮小して JPEG 化（保存容量の節約） */
async function compressImage(file, maxDim = 1600, quality = 0.85) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return file;
  }
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 500 * 1024) {
    bmp.close?.();
    return file;
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
  return blob && blob.size < file.size ? blob : file;
}

function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

async function dataURLToBlob(url) {
  return (await fetch(url)).blob();
}

// ---- 設定 --------------------------------------------------------------------

const Settings = (() => {
  const KEY = 'ap-study-settings';
  const defaults = { newPerDay: 20, theme: 'auto' };
  let cache;
  function load() {
    if (!cache) {
      try {
        cache = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
      } catch {
        cache = { ...defaults };
      }
    }
    return cache;
  }
  return {
    get: k => load()[k],
    set(k, v) {
      load()[k] = v;
      try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* 保存できなくても動作は継続 */ }
    },
  };
})();

function applyTheme() {
  const t = Settings.get('theme');
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
