// Shop: pilot rank, cosmetic/power catalog, applyLoadout, and the playground modal.
// Everything is data-driven so the same CATALOG feeds the store UI, the migration
// defaults, and the apply functions that make an equipped item actually take effect.
import { applySkin } from './missile.js';

const $ = id => document.getElementById(id);
const hex = n => '#' + (n >>> 0).toString(16).padStart(6, '0');

// ---------- pilot rank (from lifetime points) ----------

const RANKS = [
  { name: 'CADET', at: 0 },
  { name: 'PILOT', at: 5000 },
  { name: 'GUNNER', at: 15000 },
  { name: 'ACE', at: 40000 },
  { name: 'VETERAN', at: 80000 },
  { name: 'LEGEND', at: 150000 },
  { name: 'NUKE', at: 300000 }
];

// -> { name, next (points to next rank or null), progress 0..1 within the current band }
export function rankFor(lifetime) {
  const lt = Math.max(0, lifetime || 0);
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (lt >= RANKS[k].at) i = k;
  const cur = RANKS[i];
  const nxt = RANKS[i + 1] || null;
  if (!nxt) return { name: cur.name, next: null, progress: 1 };
  const span = nxt.at - cur.at;
  return { name: cur.name, next: nxt.at, progress: span > 0 ? (lt - cur.at) / span : 1 };
}

// ---------- credits formatting ----------

export function fmtCredits(n) {
  return '◆ ' + Math.max(0, Math.floor(n || 0)).toLocaleString('en-US');
}

// ---------- catalog ----------
// Free items (price 0) are owned by default. ids are stable save keys.

export const CATALOG = {
  // ROCKET SKINS — body/nose colors (+ optional emissive glow, +optional chunkier shape).
  // c0..c5 mirror the 6 lobby colors and stay in sync with the lobby picker.
  skin: [
    { id: 'c0', name: 'CLASSIC', price: 0, body: 0xf2f2f0 },
    { id: 'c1', name: 'SCARLET', price: 0, body: 0xff5a4e },
    { id: 'c2', name: 'TEAL', price: 0, body: 0x37c8c3 },
    { id: 'c3', name: 'SUNFLOWER', price: 0, body: 0xffd23f },
    { id: 'c4', name: 'VIOLET', price: 0, body: 0xb07ce8 },
    { id: 'c5', name: 'EMBER', price: 0, body: 0xff8c1a },
    { id: 'crimson', name: 'CRIMSON', price: 800, body: 0x9b1b1b, dot: 0xffd23f },
    { id: 'aqua', name: 'AQUA', price: 800, body: 0x1fd6ff },
    { id: 'lime', name: 'LIME', price: 800, body: 0x9be021 },
    { id: 'gold', name: 'GOLD', price: 2500, body: 0xffcf33, dot: 0xffffff, emissive: 0x3a2c00 },
    { id: 'chrome', name: 'CHROME', price: 3000, body: 0xdfe4ef, nose: 0xeef2fb, emissive: 0x20242e },
    { id: 'carbon', name: 'CARBON', price: 3500, body: 0x1c1c22, nose: 0x2a2a33, dot: 0xff5a4e },
    { id: 'neon', name: 'NEON', price: 4000, body: 0xff2fd0, nose: 0x2ffcff, emissive: 0x2a0030 },
    { id: 'camo', name: 'CAMO', price: 2000, body: 0x5a6b3a, nose: 0x6b5a3a, dot: 0x2f3a20 },
    { id: 'candy', name: 'CANDY', price: 5000, body: 0xff6fd5, nose: 0x9b5de5 },
    { id: 'retro', name: 'RETRO', price: 6000, body: 0xf0c2a0, nose: 0xa0d0f0, dot: 0xff8c1a, shape: [1.18, 1.18, 1] }
  ],
  // TRAILS — FlameTrail 3-stop palette + optional special mode / softness.
  trail: [
    { id: 'classic', name: 'CLASSIC', price: 0, c0: 0xfff3a0, c1: 0xff8c1a, c2: 0x6e2408 },
    { id: 'plasma', name: 'PLASMA', price: 1000, c0: 0xd6f4ff, c1: 0x2f9bff, c2: 0x0a2a6e },
    { id: 'toxic', name: 'TOXIC', price: 1500, c0: 0xe6ff9b, c1: 0x5fdd2f, c2: 0x14501a },
    { id: 'smoke', name: 'SMOKE', price: 2000, c0: 0xe8e8ee, c1: 0x9a9aa6, c2: 0x3a3a44, transparent: true, opacity: 0.5 },
    { id: 'ghost', name: 'GHOST', price: 2000, c0: 0xffffff, c1: 0xd6e2ff, c2: 0x8fa0c8, transparent: true, opacity: 0.4 },
    { id: 'ember', name: 'EMBER', price: 2500, c0: 0xffd0a0, c1: 0xff4a2a, c2: 0x5a0e04 },
    { id: 'rainbow', name: 'RAINBOW', price: 3500, mode: 'rainbow', c0: 0xff4e4e, c1: 0x37c8c3, c2: 0xb07ce8 },
    { id: 'stars', name: 'STARS', price: 4000, mode: 'stars', c0: 0xffffff, c1: 0xffe14d, c2: 0x2a2a44 }
  ],
  // SOUNDS — pack id maps to AudioManager pitch/gain (no new files).
  sound: [
    { id: 'default', name: 'DEFAULT', price: 0, pack: 'default' },
    { id: 'quiet', name: 'QUIET', price: 500, pack: 'quiet' },
    { id: 'retro', name: 'RETRO', price: 1500, pack: 'retro' },
    { id: 'bass', name: 'BASS', price: 2000, pack: 'bass' },
    { id: 'scifi', name: 'SCI-FI', price: 2500, pack: 'scifi' }
  ],
  // FX — target explosion color set (null = use the level's own target colors).
  fx: [
    { id: 'fx_default', name: 'DEFAULT', price: 0, colors: null },
    { id: 'fx_gold', name: 'GOLD BLAST', price: 1200, colors: [0xffd23f, 0xffcf33, 0xffe98a, 0xfff4c2] },
    { id: 'fx_white', name: 'FLASHBANG', price: 1500, colors: [0xffffff, 0xe8e8f0, 0xc8d0e0] },
    { id: 'fx_toxic', name: 'TOXIC', price: 2000, colors: [0x9be021, 0x5fdd2f, 0xd6ff9b, 0x2f8f1a] },
    { id: 'fx_rainbow', name: 'RAINBOW', price: 3000, colors: [0xff4e4e, 0xff8c1a, 0xffd23f, 0x7dff8a, 0x37c8c3, 0x6fa8ff, 0xb07ce8] }
  ],
  // CROSSHAIR — CSS class suffix on #crosshair (ch-<cls>).
  crosshair: [
    { id: 'ch_red', name: 'RED', price: 0, cls: 'red' },
    { id: 'ch_cyan', name: 'CYAN', price: 500, cls: 'cyan' },
    { id: 'ch_gold', name: 'GOLD', price: 1500, cls: 'gold' },
    { id: 'ch_skull', name: 'SKULL', price: 2000, cls: 'skull' }
  ],
  // HUD accent — sets the --accent CSS custom property.
  hud: [
    { id: 'hud_yellow', name: 'YELLOW', price: 0, color: '#ffd23f' },
    { id: 'hud_cyan', name: 'CYAN', price: 800, color: '#37c8c3' },
    { id: 'hud_green', name: 'GREEN', price: 800, color: '#7dff8a' },
    { id: 'hud_pink', name: 'PINK', price: 1200, color: '#ff6fd5' },
    { id: 'hud_white', name: 'WHITE', price: 1500, color: '#ffffff' }
  ],
  // TITLE — name suffix shown over the missile + lobby. NONE falls back to the auto rank.
  title: [
    { id: 't_none', name: 'AUTO (RANK)', price: 0, text: null },
    { id: 't_menace', name: 'MENACE', price: 1500, text: 'MENACE' },
    { id: 't_ghost', name: 'GHOST', price: 2000, text: 'GHOST' },
    { id: 't_nuke', name: 'NUKE', price: 4000, text: 'NUKE' },
    { id: 't_legend', name: 'LEGEND', price: 6000, text: 'LEGEND' }
  ],
  // POWER-UPS — consumables queued for the NEXT level start (bought repeatedly).
  powerup: [
    { id: 'pu_kami', name: 'EXTRA KAMIKAZE', price: 500, kind: 'kamikaze', desc: '+1 strike next level' },
    { id: 'pu_slow', name: 'SLO-MO SURGE', price: 400, kind: 'slowmo', desc: 'deeper slow-mo next level' }
  ]
};

// Categories that map to an equipped slot (powerups are consumables, not equipped).
export const EQUIP_CATS = ['skin', 'trail', 'sound', 'fx', 'crosshair', 'hud', 'title'];

export function findItem(cat, id) {
  const list = CATALOG[cat];
  if (!list) return null;
  return list.find(it => it.id === id) || null;
}

// Default owned = every free (price 0) item in each equip category.
export function ownedDefaults() {
  const out = {};
  for (const cat of EQUIP_CATS) out[cat] = CATALOG[cat].filter(it => it.price === 0).map(it => it.id);
  return out;
}

// Default equipped = free defaults; skin follows the chosen lobby color index.
export function equippedDefaults(colorIdx = 0) {
  return {
    skin: 'c' + Math.max(0, Math.min(5, colorIdx | 0)),
    trail: 'classic', sound: 'default', fx: 'fx_default',
    crosshair: 'ch_red', hud: 'hud_yellow', title: 't_none'
  };
}

// ---------- apply an equipped loadout to the live game ----------
// Called on load, after any equip, and on every level build.
export function applyLoadout(game, save) {
  const eq = save.equipped || {};

  // ROCKET skin -> missile body/nose colors (+ emissive, + optional chunkier shape)
  const skin = findItem('skin', eq.skin) || findItem('skin', 'c0');
  applySkin(game.missileMesh, skin);

  // TRAIL -> flame palette / mode
  const trail = findItem('trail', eq.trail) || findItem('trail', 'classic');
  game.flame.applyPalette(trail);

  // SOUND -> audio pack
  const sound = findItem('sound', eq.sound) || findItem('sound', 'default');
  if (game.audio) game.audio.setPack(sound.pack);

  // FX -> win explosion debris colors (null = use the level's target colors)
  const fx = findItem('fx', eq.fx) || findItem('fx', 'fx_default');
  game.fxDebris = fx.colors || null;

  // CROSSHAIR -> CSS class on #crosshair (preserve the .hidden toggle used in play)
  const ch = findItem('crosshair', eq.crosshair) || findItem('crosshair', 'ch_red');
  const chEl = $('crosshair');
  if (chEl) {
    chEl.classList.remove('ch-red', 'ch-cyan', 'ch-gold', 'ch-skull');
    chEl.classList.add('ch-' + ch.cls);
  }

  // HUD accent -> --accent custom property
  const hud = findItem('hud', eq.hud) || findItem('hud', 'hud_yellow');
  document.documentElement.style.setProperty('--accent', hud.color);

  // TITLE -> label suffix (null means "use the auto pilot rank")
  const title = findItem('title', eq.title) || findItem('title', 't_none');
  game.titleOverride = title.text || null;
}

// The prefix shown before a pilot's name over their missile + in the lobby.
export function labelPrefixFor(lifetime, titleOverride) {
  return titleOverride || rankFor(lifetime).name;
}

// ---------- shop modal controller ----------

const TABS = [
  { key: 'ROCKET', cats: ['skin'] },
  { key: 'TRAILS', cats: ['trail'] },
  { key: 'SOUNDS', cats: ['sound'] },
  { key: 'FX', cats: ['fx', 'crosshair', 'hud', 'title'] },
  { key: 'POWER-UPS', cats: ['powerup'] }
];

const CAT_LABEL = {
  fx: 'TARGET EXPLOSION', crosshair: 'KAMIKAZE CROSSHAIR',
  hud: 'HUD ACCENT', title: 'PILOT TITLE'
};

export class Shop {
  constructor(game) {
    this.game = game;
    this.audio = game.audio;
    this.open = false;
    this.activeTab = 'ROCKET';
    this.root = $('shop');
    this.tabsEl = $('shop-tabs');
    this.gridEl = $('shop-grid');
    this._built = false;
    $('shop-close').addEventListener('click', () => this.close());
    // close on backdrop tap (but not on clicks inside the panel)
    this.root.addEventListener('click', e => { if (e.target === this.root) this.close(); });
  }

  isOpen() { return this.open; }

  _buildTabs() {
    this.tabsEl.innerHTML = '';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'shop-tab' + (t.key === this.activeTab ? ' on' : '');
      b.textContent = t.key;
      b.addEventListener('click', () => {
        if (this.audio) this.audio.click();
        this.activeTab = t.key;
        this.render();
      });
      this.tabsEl.appendChild(b);
    }
  }

  show() {
    this.open = true;
    if (!this._built) { this._buildTabs(); this._built = true; }
    this.root.classList.remove('hidden');
    this.game.input.setActive(false);
    this.game.input.releaseLock();
    if (this.audio) this.audio.confirm();
    this.render();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.root.classList.add('hidden');
    if (this.audio) this.audio.click();
    // hand control back to the playground without igniting on the closing tap
    if (this.game.state === 'playing' || this.game.state === 'lying') {
      this.game.input.setActive(true);
      this.game.input.consumeThrust();
      this.game.input.requestLock();
    }
  }

  // called by the game when a level starts underneath an open shop
  forceClose() {
    this.open = false;
    this.root.classList.add('hidden');
  }

  render() {
    if (!this.open) return;
    const save = this.game.save;
    $('shop-credits').textContent = fmtCredits(save.credits);
    const rk = rankFor(save.lifetime);
    $('shop-rank').textContent = rk.name;
    this._buildTabs();

    this.gridEl.innerHTML = '';
    const tab = TABS.find(t => t.key === this.activeTab) || TABS[0];
    for (const cat of tab.cats) {
      if (tab.cats.length > 1) {
        const h = document.createElement('div');
        h.className = 'shop-subhead';
        h.textContent = CAT_LABEL[cat] || cat.toUpperCase();
        this.gridEl.appendChild(h);
      }
      const grid = document.createElement('div');
      grid.className = 'shop-cards';
      for (const item of CATALOG[cat]) grid.appendChild(this._card(cat, item, save));
      this.gridEl.appendChild(grid);
    }
  }

  _preview(cat, item) {
    const el = document.createElement('div');
    el.className = 'shop-prev';
    if (cat === 'skin') {
      const nose = item.nose !== undefined ? item.nose : item.body;
      el.style.background = `linear-gradient(135deg, ${hex(item.body)} 0%, ${hex(item.body)} 55%, ${hex(nose)} 55%, ${hex(nose)} 100%)`;
      if (item.emissive) el.style.boxShadow = `0 0 12px ${hex(item.body)}`;
    } else if (cat === 'trail') {
      if (item.mode === 'rainbow') el.style.background = 'conic-gradient(#ff4e4e,#ff8c1a,#ffd23f,#7dff8a,#37c8c3,#6fa8ff,#b07ce8,#ff4e4e)';
      else el.style.background = `linear-gradient(90deg, ${hex(item.c0)}, ${hex(item.c1)}, ${hex(item.c2)})`;
      if (item.mode === 'stars') el.textContent = '✦';
    } else if (cat === 'sound') {
      el.classList.add('ico'); el.textContent = item.pack === 'quiet' ? '🔈' : '🔊';
    } else if (cat === 'fx') {
      el.classList.add('dots');
      const cols = item.colors || [0xffffff, 0xd0d0d6, 0x8a8378];
      for (const c of cols.slice(0, 5)) {
        const d = document.createElement('span'); d.className = 'dot'; d.style.background = hex(c); el.appendChild(d);
      }
    } else if (cat === 'crosshair') {
      el.classList.add('ch-prev', 'ch-' + item.cls);
    } else if (cat === 'hud') {
      el.style.background = item.color;
    } else if (cat === 'title') {
      el.classList.add('ico'); el.textContent = item.text || '★';
    } else if (cat === 'powerup') {
      el.classList.add('ico'); el.textContent = item.kind === 'kamikaze' ? '💥' : '⏱';
    }
    return el;
  }

  _card(cat, item, save) {
    const card = document.createElement('div');
    card.className = 'shop-card';
    card.appendChild(this._preview(cat, item));

    const name = document.createElement('div');
    name.className = 'shop-name';
    name.textContent = item.name;
    card.appendChild(name);

    if (item.desc) {
      const d = document.createElement('div');
      d.className = 'shop-desc';
      d.textContent = item.desc;
      card.appendChild(d);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shop-buy';

    if (cat === 'powerup') {
      const have = (save.powerups && save.powerups[item.kind]) || 0;
      const afford = save.credits >= item.price;
      btn.textContent = have > 0 ? `BUY (${have})` : 'BUY';
      if (!afford) { btn.classList.add('dis'); btn.disabled = true; }
      btn.addEventListener('click', () => this._buyPowerup(cat, item));
      const price = document.createElement('div');
      price.className = 'shop-price';
      price.textContent = fmtCredits(item.price);
      card.appendChild(price);
      card.appendChild(btn);
      return card;
    }

    const owned = (save.owned[cat] || []).includes(item.id);
    const equipped = save.equipped[cat] === item.id;
    const afford = save.credits >= item.price;

    const price = document.createElement('div');
    price.className = 'shop-price';
    price.textContent = item.price === 0 ? 'FREE' : fmtCredits(item.price);
    card.appendChild(price);

    if (equipped) {
      btn.textContent = 'EQUIPPED';
      btn.classList.add('on'); btn.disabled = true;
    } else if (owned) {
      btn.textContent = 'EQUIP';
      btn.addEventListener('click', () => this._equip(cat, item));
    } else if (afford) {
      btn.textContent = 'BUY';
      btn.addEventListener('click', () => this._buy(cat, item));
    } else {
      btn.textContent = '◆ TOO PRICEY';
      btn.classList.add('dis'); btn.disabled = true;
    }
    card.appendChild(btn);
    return card;
  }

  _buy(cat, item) {
    const save = this.game.save;
    if (save.credits < item.price || (save.owned[cat] || []).includes(item.id)) {
      if (this.audio) this.audio.thud();
      return;
    }
    save.credits -= item.price;
    if (!save.owned[cat]) save.owned[cat] = [];
    save.owned[cat].push(item.id);
    if (this.audio) this.audio.confirm();
    this._equip(cat, item, true);   // auto-equip on purchase
  }

  _buyPowerup(cat, item) {
    const save = this.game.save;
    if (save.credits < item.price) { if (this.audio) this.audio.thud(); return; }
    save.credits -= item.price;
    if (!save.powerups) save.powerups = { kamikaze: 0, slowmo: 0 };
    save.powerups[item.kind] = (save.powerups[item.kind] || 0) + 1;
    if (this.audio) this.audio.confirm();
    this.game.persist();
    this.game.syncHud();
    this.render();
  }

  _equip(cat, item, silent) {
    const save = this.game.save;
    save.equipped[cat] = item.id;
    // free skins double as the lobby color so the two stay in sync
    if (cat === 'skin') {
      const m = /^c(\d)$/.exec(item.id);
      if (m) save.color = parseInt(m[1], 10);
    }
    if (!silent && this.audio) this.audio.click();
    this.game.onLoadoutChanged();   // applyLoadout + persist + HUD + net meta
    this.render();
  }
}
