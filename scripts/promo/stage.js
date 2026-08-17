/**
 * Promo stage helpers, driven from Playwright through window.stage.
 * Draws the fictional demo store and the presentation overlays
 * (captions, cursor, title cards) around the real panel iframe.
 */

const PRODUCTS = {
  all: [
    ['Field jacket', '#7a8b6f', '$148'],
    ['Trail runner', '#c4643c', '$112'],
    ['Wool beanie', '#3e5c7a', '$28'],
    ['Canvas tote', '#d8c39a', '$36'],
  ],
  outerwear: [
    ['Field jacket', '#7a8b6f', '$148'],
    ['Rain shell', '#2f6f8f', '$164'],
    ['Quilted vest', '#8f4f3a', '$96'],
    ['Wool overcoat', '#4b4b55', '$228'],
  ],
  shoes: [
    ['Trail runner', '#c4643c', '$112'],
    ['Court sneaker', '#e6e1d6', '$88'],
    ['Desert boot', '#a07850', '$134'],
    ['Slip-on', '#3a3a3a', '$64'],
  ],
  accessories: [
    ['Wool beanie', '#3e5c7a', '$28'],
    ['Canvas tote', '#d8c39a', '$36'],
    ['Leather belt', '#5a3a28', '$42'],
    ['Sunglasses', '#2b2b2b', '$72'],
  ],
};

function renderGrid(cat) {
  const grid = document.getElementById('grid');
  grid.textContent = '';
  for (const [name, color, price] of PRODUCTS[cat] || PRODUCTS.all) {
    const card = document.createElement('div');
    card.className = 'product';
    card.innerHTML = `<div class="swatch" style="background:${color}"></div>
      <div class="meta"><span>${name} · ${price}</span><button type="button" class="add">Add</button></div>`;
    grid.appendChild(card);
  }
}

const $ = (id) => document.getElementById(id);

window.stage = {
  setTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
  },
  setPageHeight(px) {
    document.documentElement.style.setProperty('--page-h', `${px}px`);
  },
  setCategory(cat) {
    document.querySelectorAll('#cats button').forEach((b) => {
      b.classList.toggle('on', b.dataset.cat === cat);
    });
    $('omni-path').textContent = cat;
    renderGrid(cat);
  },
  setCart(n) {
    $('cart-count').textContent = String(n);
  },
  /** @param {'on'|'off'|null} state */
  setBadge(state) {
    const badge = $('badge');
    badge.hidden = !state;
    if (state) {
      badge.textContent = state.toUpperCase();
      badge.classList.toggle('on', state === 'on');
    }
  },
  setChromeInfobar(show) {
    $('chrome-infobar').hidden = !show;
  },
  caption(text, placement) {
    const caption = $('caption');
    caption.textContent = text || '';
    caption.classList.toggle('top', placement === 'top');
  },
  callout(show) {
    $('callout').hidden = !show;
  },
  card(title, line) {
    const card = $('card');
    if (!title) {
      card.hidden = true;
      return;
    }
    $('card-title').textContent = title;
    $('card-line').textContent = line || '';
    card.hidden = false;
  },
  menu(show) {
    $('menu').hidden = !show;
    $('ext').classList.toggle('pressed', show);
  },
  cursorTo(x, y) {
    const c = $('cursor');
    c.removeAttribute('hidden'); // SVG elements have no .hidden property
    c.style.left = `${x}px`;
    c.style.top = `${y}px`;
  },
  hideCursor() {
    $('cursor').setAttribute('hidden', '');
  },
  cursorClick() {
    const c = $('cursor');
    c.classList.remove('click');
    void c.getBoundingClientRect();
    c.classList.add('click');
  },
};

// The panel iframe reports start/stop (from the mocked service worker in
// lib.js) so the toolbar badge and Chrome's infobar follow it, as in Chrome.
window.addEventListener('message', (event) => {
  const msg = event.data && event.data.apqDemo;
  if (msg === 'started') {
    window.stage.setBadge('on');
    window.stage.setChromeInfobar(true);
  } else if (msg === 'stopped') {
    window.stage.setBadge('off');
    window.stage.setChromeInfobar(false);
  }
});

renderGrid('all');
