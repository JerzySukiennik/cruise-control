// Bootstrap: renderer with low-res pixelated buffer, lobby/menu wiring, net, main loop.
import * as THREE from 'three';
import { Assets } from './assets.js';
import { Input } from './input.js';
import { AudioManager } from './audio.js';
import { Game } from './game.js';
import { LEVELS } from './levels.js';
import { Net } from './net.js';

const IS_TOUCH = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
const LOW = IS_TOUCH || (navigator.hardwareConcurrency || 8) <= 4;
const INTERNAL_W = LOW ? 340 : 400;

const COLORS = [0xf2f2f0, 0xff5a4e, 0x37c8c3, 0xffd23f, 0xb07ce8, 0xff8c1a];

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

const net = new Net(LEVELS.length);
game.setNet(net);

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

// ---------- lobby ----------

const nameInput = $('pilot-name');
nameInput.value = game.save.name;
nameInput.addEventListener('input', () => {
  const v = nameInput.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, '').slice(0, 10);
  if (v !== nameInput.value) nameInput.value = v;
  if (v.trim()) { game.save.name = v.trim(); game.persist(); }
});
nameInput.addEventListener('keydown', e => e.stopPropagation()); // don't trigger game keys
nameInput.addEventListener('keyup', e => e.stopPropagation());

let colorIdx = Math.max(0, Math.min(COLORS.length - 1, game.save.color));
const colorRow = $('color-row');
const swatches = COLORS.map((c, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch' + (i === colorIdx ? ' sel' : '');
  b.style.background = '#' + c.toString(16).padStart(6, '0');
  b.addEventListener('click', () => {
    audio.unlock(); audio.click();
    colorIdx = i;
    game.save.color = i;
    game.persist();
    swatches.forEach((s, j) => s.classList.toggle('sel', j === colorIdx));
  });
  colorRow.appendChild(b);
  return b;
});

const lobbyStatus = $('lobby-status');
const lobbyPlayers = $('lobby-players');
const bestRun = $('best-run');

function refreshLobby() {
  if (!net.online) {
    lobbyStatus.textContent = 'OFFLINE — SOLO RUN';
    lobbyStatus.classList.remove('on');
    lobbyPlayers.innerHTML = '';
  } else {
    const act = net.activePlayers();
    if (act.length === 0) {
      lobbyStatus.textContent = 'ONLINE — ROOM EMPTY';
      lobbyStatus.classList.add('on');
    } else if (net.roomFullFor(game.save.pid)) {
      lobbyStatus.textContent = 'ROOM FULL (3/3) — PLAY = SOLO';
      lobbyStatus.classList.remove('on');
    } else {
      const lvl = net.run && typeof net.run.level === 'number' ? net.run.level + 1 : 1;
      lobbyStatus.textContent = `${act.length}/3 IN ROOM — LVL ${lvl} — JUMP IN!`;
      lobbyStatus.classList.add('on');
    }
    lobbyPlayers.innerHTML = '';
    for (const p of act) {
      const el = document.createElement('div');
      el.className = 'lp';
      const dot = document.createElement('span');
      dot.className = 'dot';
      const c = typeof p.color === 'number' ? p.color : 0xf2f2f0;
      dot.style.background = '#' + c.toString(16).padStart(6, '0');
      el.appendChild(dot);
      el.appendChild(document.createTextNode(String(p.name || '???').slice(0, 10)));
      lobbyPlayers.appendChild(el);
    }
  }
  if (game.save.bestRun > 0) {
    bestRun.textContent = `BEST RUN: ${game.save.bestRun}/${LEVELS.length} LEVELS`;
    bestRun.classList.remove('hidden');
  }
}

let lobbyTimer = null;
function showMenu() {
  refreshLobby();
  $('menu').classList.remove('hidden');
  clearInterval(lobbyTimer);
  lobbyTimer = setInterval(refreshLobby, 2000);
}
game.onShowMenu = showMenu;
net.onPlayers = () => { if (!$('menu').classList.contains('hidden')) refreshLobby(); };

// ---------- play ----------

let starting = false;
async function play() {
  if (starting) return;
  starting = true;
  audio.unlock(); audio.confirm();
  clearInterval(lobbyTimer);
  $('menu').classList.add('hidden');
  const color = COLORS[colorIdx];
  game.setPlayer(game.save.name, color);
  if (net.online && !net.roomFullFor(game.save.pid)) {
    try { await net.join(game.save.pid, game.save.name, color); }
    catch (e) { console.warn('join failed, going solo', e); }
  }
  game.startRun();
  input.requestLock();
  starting = false;
}
$('btn-play').addEventListener('click', play);

// ---------- cards ----------

$('btn-death-retry').addEventListener('click', () => { audio.click(); game.restart(); input.requestLock(); });
$('btn-death-menu').addEventListener('click', () => { audio.click(); game.toMenu(); });
$('btn-complete-menu').addEventListener('click', () => { audio.click(); game.toMenu(); });
$('btn-resume').addEventListener('click', () => { audio.click(); game.resume(); });
$('btn-pause-restart').addEventListener('click', () => { audio.click(); game.resume(); game.restart(); input.requestLock(); });
$('btn-pause-menu').addEventListener('click', () => { audio.click(); game.toMenu(); });

// tap card background to respawn (mobile)
$('card-death').addEventListener('click', e => {
  if (e.target.id === 'card-death') { game.restart(); }
});

function applyMute(m) {
  game.save.muted = m;
  game.persist();
  audio.setMuted(m);
  $('btn-mute-menu').textContent = m ? 'SOUND: OFF' : 'SOUND: ON';
  $('btn-mute-hud').textContent = m ? 'SND OFF' : 'SND';
}
$('btn-mute-menu').addEventListener('click', () => applyMute(!game.save.muted));
$('btn-mute-hud').addEventListener('click', () => applyMute(!game.save.muted));

// ---------- input actions ----------

input.onAction = () => game.actionPressed();          // SPACE/LMB edge: respawn / relaunch / dash
input.onKamikaze = () => game.kamikazePressed();      // K: aim, K again: cancel
input.onRestart = () => {                              // R: hard reset of current level
  if (game.state === 'playing' || game.state === 'lying' || game.state === 'dead') {
    game.restart();
    input.requestLock();
  }
};
input.onPause = () => {
  if (game.aiming) { game.cancelAim(); return; }       // ESC while aiming = cancel aim
  if (game.state === 'playing' || game.state === 'lying') game.pause();
  else if (game.state === 'paused') game.resume();
};
input.onMute = () => applyMute(!game.save.muted);
input.onGesture = () => audio.unlock();

// leave the room cleanly on tab close
window.addEventListener('beforeunload', () => { if (net.joined) net.leave(); });

// ---------- load + run ----------

const loadFill = $('load-bar-fill');
const loadText = $('load-text');

const netReady = net.init().catch(() => { /* offline mode */ });

assets.loadAll(p => {
  loadFill.style.width = Math.round(p * 100) + '%';
}).then(async () => {
  loadText.textContent = 'READY';
  applyMute(game.save.muted);
  await Promise.race([netReady, new Promise(r => setTimeout(r, 1500))]);
  $('loading').classList.add('hidden');
  showMenu();
}).catch(err => {
  console.error(err);
  loadText.textContent = 'LOAD ERROR - CHECK CONSOLE';
});

window.__cc = { game, input, audio, net }; // debug handle

const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  game.update(dt);
  renderer.render(game.scene, game.camera);
}
frame();
