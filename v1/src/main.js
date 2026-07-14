// Bootstrap: renderer with low-res pixelated buffer, menu wiring, main loop.
import * as THREE from 'three';
import { Assets } from './assets.js';
import { Input } from './input.js';
import { AudioManager } from './audio.js';
import { Game, fmtTime } from './game.js';
import { LEVELS } from './levels.js';

const IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
const LOW = IS_TOUCH || (navigator.hardwareConcurrency || 8) <= 4;
const INTERNAL_W = LOW ? 340 : 400;

const $ = id => document.getElementById(id);

const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

if (IS_TOUCH) {
  document.body.classList.add('touch');
  $('mobile').classList.remove('hidden');
}

const assets = new Assets();
const input = new Input(canvas, IS_TOUCH);
const game = new Game(assets, input);
const audio = new AudioManager(game.camera, assets);
game.setAudio(audio);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const iw = INTERNAL_W;
  const ih = Math.max(1, Math.round(h / w * iw));
  renderer.setSize(iw, ih, false);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  game.camera.aspect = w / h;
  game.camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));
resize();

// ---------- menu / UI wiring ----------

function refreshLevelGrid() {
  const grid = $('level-grid');
  grid.innerHTML = '';
  LEVELS.forEach((lvl, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const unlocked = game.isUnlocked(i);
    btn.className = 'lvl-btn' + (unlocked ? '' : ' locked');
    const best = game.save.best[i];
    btn.innerHTML =
      `<span class="num">${i + 1}</span>` +
      `<span class="nm">${lvl.name}</span>` +
      `<span class="best">${best ? fmtTime(best.time) + '\nFUEL ' + best.fuel : (unlocked ? '&nbsp;' : '')}</span>`;
    if (unlocked) {
      btn.addEventListener('click', () => { audio.confirm(); launch(i); });
    }
    grid.appendChild(btn);
  });
}

function showMenu() {
  refreshLevelGrid();
  $('menu').classList.remove('hidden');
}

function launch(i) {
  audio.unlock();
  $('menu').classList.add('hidden');
  game.startLevel(i);
  input.requestLock();
}

game.onShowMenu = showMenu;

$('btn-play').addEventListener('click', () => {
  audio.unlock(); audio.confirm();
  launch(Math.min(game.save.unlocked, LEVELS.length - 1));
});

$('btn-death-retry').addEventListener('click', () => { audio.click(); game.restart(); input.requestLock(); });
$('btn-death-menu').addEventListener('click', () => { audio.click(); game.toMenu(); });
$('btn-win-retry').addEventListener('click', () => { audio.click(); game.restart(); input.requestLock(); });
$('btn-win-next').addEventListener('click', () => {
  audio.confirm();
  const next = Math.min(game.levelIndex + 1, LEVELS.length - 1);
  game.startLevel(next);
  input.requestLock();
});
$('btn-win-menu').addEventListener('click', () => { audio.click(); game.toMenu(); });
$('btn-resume').addEventListener('click', () => { audio.click(); game.resume(); });
$('btn-pause-restart').addEventListener('click', () => { audio.click(); game.restart(); input.requestLock(); });
$('btn-pause-menu').addEventListener('click', () => { audio.click(); game.toMenu(); });

function applyMute(m) {
  game.save.muted = m;
  game.persist();
  audio.setMuted(m);
  $('btn-mute-menu').textContent = m ? 'SOUND: OFF' : 'SOUND: ON';
  $('btn-mute-hud').textContent = m ? 'SND OFF' : 'SND';
}
$('btn-mute-menu').addEventListener('click', () => applyMute(!game.save.muted));
$('btn-mute-hud').addEventListener('click', () => applyMute(!game.save.muted));

input.onRestart = () => {
  if (game.state === 'playing' || game.state === 'dead' || game.state === 'win') {
    game.restart();
    input.requestLock();
  }
};
input.onPause = () => {
  if (game.state === 'playing') game.pause();
  else if (game.state === 'paused') game.resume();
};
input.onMute = () => applyMute(!game.save.muted);
input.onGesture = () => audio.unlock();

// tap to retry on death card background (mobile)
$('card-death').addEventListener('click', e => {
  if (e.target.id === 'card-death') { game.restart(); }
});

// ---------- load + run ----------

const loadFill = $('load-bar-fill');
const loadText = $('load-text');

assets.loadAll(p => {
  loadFill.style.width = Math.round(p * 100) + '%';
}).then(() => {
  loadText.textContent = 'READY';
  applyMute(game.save.muted);
  $('loading').classList.add('hidden');
  showMenu();
}).catch(err => {
  console.error(err);
  loadText.textContent = 'LOAD ERROR - CHECK CONSOLE';
});

window.__cc = { game, input, audio }; // debug handle

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  game.update(dt);
  renderer.render(game.scene, game.camera);
}
frame();
