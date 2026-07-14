// Game orchestrator: state machine, run flow (level -> playground -> next),
// knockdown/relaunch, kamikaze strike, multiplayer ghosts, HUD, camera, save data.
import * as THREE from 'three';
import { buildMissileMesh, FlightModel } from './missile.js';
import { CollisionWorld } from './collision.js';
import { FlameTrail, DebrisPool, PuffPool, Shake, Flash } from './effects.js';
import { LEVELS } from './levels.js';
import { PLAYGROUND } from './playground.js';

const SAVE_KEY = 'cc_save_v1';
const MISSILE_R = 0.9;
const PAD_OFFSETS = [0, -6, 6];          // spawn pad x-offset by join order (solo = center)
const SOLO_COUNTDOWN = 6;                // offline playground countdown (s)
const ZERO_STEER = { x: 0, y: 0 };

const _f = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

const $ = id => document.getElementById(id);

function randPid() {
  let s = '';
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  for (let i = 0; i < 8; i++) s += abc[(Math.random() * abc.length) | 0];
  return s;
}

export class Game {
  constructor(assets, input) {
    this.assets = assets;
    this.input = input;
    this.audio = null;
    this.net = null;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 16 / 9, 0.1, 900);
    this.hemi = new THREE.HemisphereLight(0xbfd8e8, 0x3a5c3a, 0.95);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.75);
    this.sun.position.set(60, 90, -40);
    this.scene.add(this.hemi, this.sun);

    this.levelGroup = new THREE.Group();
    this.scene.add(this.levelGroup);
    this.world = new CollisionWorld();

    this.flame = new FlameTrail(this.scene);
    this.debris = new DebrisPool(this.scene, 150);
    this.puff = new PuffPool(this.scene);
    this.shake = new Shake();
    this.flash = new Flash();

    this.missileMesh = buildMissileMesh();
    this.missileMesh.visible = false;
    this.scene.add(this.missileMesh);
    this.flight = new FlightModel();

    this.state = 'menu';                  // menu | playing | lying | dead | win | paused | complete
    this.mode = 'level';                  // level | playground
    this.levelIndex = 0;
    this.ctx = null;
    this.level = null;

    this.time = 0;
    this.fuel = 0;
    this.burnAcc = 0;
    this.flameAcc = 0;
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.slowMeter = 1;
    this.timescale = 1;
    this.winTimer = -1;
    this.deathTimer = -1;
    this.lowTime = 0;
    this.roofCool = 0;
    this.hintTimer = 0;
    this.elapsed = 0;
    this.throttleSm = 0;

    // v1.1 state
    this.runActive = false;
    this.levelsCleared = 0;
    this.kamikaze = 1;
    this.aiming = false;
    this.dashing = false;
    this.dashT = 0;
    this.graceT = 0;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.lieT = 0;
    this.lieVel = new THREE.Vector3();
    this.lieQuat = new THREE.Quaternion();
    this.soloCountdown = -1;
    this.completeTimer = -1;
    this.sendAcc = 0;
    this.ghostSyncAcc = 0;
    this.pgRefreshAcc = 99;
    this.pgText = '';
    this.ghosts = new Map();
    this.playerName = 'PILOT';
    this.playerColor = 0xf2f2f0;
    this.camBack = 8.5;

    this.camPos = new THREE.Vector3();
    this.camUp = new THREE.Vector3(0, 1, 0);

    this.onShowMenu = null;
    this.save = this._loadSave();

    this.hud = {
      root: $('hud'), score: $('score'), combo: $('combo'), timer: $('timer'),
      fuel: $('fuel'), slowmo: $('slowmo-fill'), popups: $('popups'), hint: $('hint'),
      levelInd: $('level-ind'), kami: $('kami'), crosshair: $('crosshair'), pg: $('pg-status')
    };
  }

  setAudio(a) { this.audio = a; }

  setNet(n) {
    this.net = n;
    n.onRun = run => this._onRun(run);
  }

  setPlayer(name, color) {
    this.playerName = name;
    this.playerColor = color;
    for (const m of this.missileMesh.userData.tintMats) m.color.setHex(color);
  }

  _loadSave() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { /* fresh save */ }
    if (!s || typeof s !== 'object') s = {};
    return {
      muted: !!s.muted,
      name: (typeof s.name === 'string' && s.name.trim()) ? s.name : 'PILOT' + (10 + (Math.random() * 90 | 0)),
      color: typeof s.color === 'number' ? s.color : 0,
      pid: (typeof s.pid === 'string' && s.pid) ? s.pid : randPid(),
      bestRun: s.bestRun || 0
    };
  }

  persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch (e) { /* private mode */ }
  }

  // ---------- scene lifecycle ----------

  _clearScene() {
    if (this.ctx) this.ctx.disposed = true;
    const kids = [...this.levelGroup.children];
    for (const obj of kids) {
      obj.traverse(c => {
        if ((c.isMesh || c.isLine || c.isSprite) && !c.userData.noDispose) {
          if (c.geometry) c.geometry.dispose();
          if (c.isSprite && c.material) {
            if (c.material.map) c.material.map.dispose();
            c.material.dispose();
          }
        }
      });
      this.levelGroup.remove(obj);
    }
    this.world.reset();
    this.flame.clear();
    this.debris.clear();
    this.puff.clear();
    this.shake.reset();
    this.flash.reset();
  }

  _spawnOffset() {
    if (!this.net || !this.net.joined) return 0;
    const act = this.net.activePlayers();
    const idx = act.findIndex(p => p.id === this.net.pid);
    return PAD_OFFSETS[Math.max(0, Math.min(2, idx))] || 0;
  }

  _buildScene(def) {
    this._clearScene();
    const lvl = this.level = def;
    const env = lvl.env;

    this.scene.background = new THREE.Color(env.bg);
    this.scene.fog = new THREE.Fog(env.bg, env.fogNear, env.fogFar);
    this.hemi.color.setHex(env.hemiSky);
    this.hemi.groundColor.setHex(env.hemiGround);
    this.hemi.intensity = env.hemiInt;
    this.sun.intensity = env.sun;

    // ground
    const gmat = this.assets.gridMaterial(env.groundTex, env.groundColor, env.groundRepeat, env.groundRepeat);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(env.groundSize, env.groundSize), gmat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = env.groundY;
    this.levelGroup.add(ground);
    this.debris.groundY = env.groundY;

    this.ctx = {
      group: this.levelGroup, world: this.world, assets: this.assets,
      gates: [], dynamic: [], target: { meshes: [], pos: null }, disposed: false
    };
    lvl.build(this.ctx);

    // 3 multiplayer spawn pads (visual, side by side)
    if (!lvl.playground) {
      const padMat = this.assets.gridMaterial('gridDark', 0xffffff, 2, 2);
      for (const dx of [-6, 0, 6]) {
        const pad = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.2, 4.5), padMat);
        pad.position.set(lvl.spawn.pos[0] + dx, Math.max(env.groundY + 0.6, lvl.spawn.pos[1] - 2.4), lvl.spawn.pos[2]);
        this.levelGroup.add(pad);
      }
    }

    // flight params
    const fp = this.flight.params;
    fp.maxSpeed = lvl.flight.maxSpeed;
    fp.turnRate = lvl.flight.turnRate;
    fp.accel = 26 + lvl.flight.maxSpeed * 0.35;
    fp.stallSpeed = 12;
    fp.gravity = 18;
    fp.drag = 8;
    const off = this._spawnOffset();
    _v.fromArray(lvl.spawn.pos); _v.x += off;
    this.flight.reset(
      _v,
      _v2.fromArray(lvl.spawn.dir),
      lvl.spawn.up ? _f.fromArray(lvl.spawn.up) : undefined
    );

    // missile
    const bank = this.missileMesh.userData.bank;
    bank.rotation.set(0, 0, 0);
    this.missileMesh.visible = true;
    this.flight.applyTo(this.missileMesh);

    // state reset
    this.time = 0; this.fuel = 0; this.burnAcc = 0; this.flameAcc = 0;
    this.score = 0; this.combo = 0; this.comboTimer = 0;
    this.slowMeter = 1; this.timescale = 1;
    this.winTimer = -1; this.deathTimer = -1;
    this.lowTime = 0; this.roofCool = 0; this.throttleSm = 0;
    this.kamikaze = 1;
    this.aiming = false; this.dashing = false; this.dashT = 0; this.graceT = 0;
    this.lieT = 0;
    this._camTargetLock = null;
    this.hud.crosshair.classList.add('hidden');
    this.hud.popups.innerHTML = '';
    this._updateHud(true);
    this._updateKamiHud();

    // snap camera
    this.flight.forward(_f);
    this.camBack = 8.5;
    this.camPos.copy(this.flight.pos).addScaledVector(_f, -9).addScaledVector(_up, 2.6);
    this.camPos.y = Math.max(this.camPos.y, env.groundY + 1.4);
    this.camUp.set(0, 1, 0);

    // hint
    this.hud.hint.textContent = lvl.hint;
    this.hud.hint.classList.remove('hidden', 'fade');
    this.hintTimer = 4;
  }

  startLevel(i) {
    this.mode = 'level';
    this.levelIndex = i;
    this._buildScene(LEVELS[i]);
    this.state = 'playing';
    this.input.setActive(true);
    this.input.resetAim();
    this._hideCards();
    this.hud.root.classList.remove('hidden');
    this.hud.levelInd.textContent = `LVL ${i + 1}/${LEVELS.length}`;
    this.hud.pg.classList.add('hidden');
    this.pgText = '';
    if (this.audio) this.audio.stopEngine();
    this._netSend(true);
  }

  enterPlayground() {
    this.mode = 'playground';
    this._buildScene(PLAYGROUND);
    this.state = 'playing';
    this.input.setActive(true);
    this.input.resetAim();
    this._hideCards();
    this.hud.root.classList.remove('hidden');
    this.hud.levelInd.textContent = 'PLAYGROUND';
    this.hud.pg.classList.remove('hidden');
    this.pgRefreshAcc = 99; // refresh billboard immediately
    this.soloCountdown = (this.net && this.net.online && this.net.joined) ? -1 : SOLO_COUNTDOWN;
    if (this.audio) this.audio.stopEngine();
    this._netSend(true);
  }

  // ---------- run flow ----------

  startRun() {
    this.levelsCleared = 0;
    this.runActive = true;
    if (this.net && this.net.online && this.net.joined) {
      const run = this.net.run;
      if (run && run.phase === 'countdown') this.enterPlayground();
      else this.startLevel(run && typeof run.level === 'number' ? run.level : 0);
    } else {
      this.startLevel(0);
    }
  }

  _onRun(run) {
    if (!this.runActive || !run) return;
    if (run.phase === 'level') {
      const already = this.mode === 'level' && this.levelIndex === run.level &&
        this.state !== 'menu' && this.state !== 'complete';
      if (!already) this.startLevel(run.level);
    } else if (run.phase === 'countdown') {
      // countdown display is handled per-frame; a countdown can only start
      // while everyone (incl. us) is already in the playground
    } else if (run.phase === 'complete') {
      if (this.state !== 'complete') this._runComplete();
    }
  }

  _runComplete() {
    this.runActive = false;
    this.state = 'complete';
    this.completeTimer = 0;
    this.input.setActive(false);
    this.aiming = false; this.dashing = false;
    this.hud.crosshair.classList.add('hidden');
    if (this.audio) { this.audio.stopEngine(); this.audio.explosionBig(); }
    $('complete-levels').textContent = `${this.levelsCleared} LEVELS CLEARED THIS RUN`;
    $('card-complete').classList.remove('hidden');
  }

  restart() {
    if (this.state === 'menu' || this.state === 'complete') return;
    if (this.mode === 'playground') this.enterPlayground();
    else this.startLevel(this.levelIndex);
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'lying') return;
    this._pausedFrom = this.state;
    this.state = 'paused';
    this.input.setActive(false);
    if (this.audio) this.audio.stopEngine();
    $('card-pause').classList.remove('hidden');
  }

  resume() {
    if (this.state !== 'paused') return;
    $('card-pause').classList.add('hidden');
    this.state = this._pausedFrom || 'playing';
    this.input.setActive(true);
    this.input.requestLock();
  }

  toMenu() {
    if (this.net && this.net.joined) {
      if (this.net.isHost() && this.net.run && this.net.run.phase === 'complete') {
        this.net.resetRun();
      }
      this.net.leave();
    }
    this.runActive = false;
    this.state = 'menu';
    this.mode = 'level';
    this.input.setActive(false);
    this.input.releaseLock();
    if (this.audio) this.audio.stopEngine();
    this._hideCards();
    this.hud.root.classList.add('hidden');
    this.missileMesh.visible = false;
    for (const g of this.ghosts.values()) { g.mesh.visible = false; g.label.visible = false; }
    if (this.onShowMenu) this.onShowMenu();
  }

  _hideCards() {
    $('card-death').classList.add('hidden');
    $('card-pause').classList.add('hidden');
    $('card-complete').classList.add('hidden');
  }

  // ---------- input actions (SPACE edge / K) ----------

  actionPressed() {
    if (this.state === 'dead' && this.deathTimer > 0.4) {
      this.restart(); // respawn at level start (resets timer/fuel/score)
      this.input.requestLock();
    } else if (this.state === 'lying' && this.lieT > 0.25) {
      this._relaunch();
    } else if (this.state === 'playing' && this.aiming) {
      this._dash();
    }
  }

  kamikazePressed() {
    if (this.state !== 'playing') return;
    if (this.aiming) { this.cancelAim(); return; }
    if (this.dashing || !this.flight.launched) return;
    if (this.kamikaze <= 0) { this._popup('KAMIKAZE SPENT'); return; }
    this.aiming = true;
    this.aimYaw = 0; this.aimPitch = 0;
    this.hud.crosshair.classList.remove('hidden');
    if (this.audio) this.audio.click();
  }

  cancelAim() {
    if (!this.aiming) return false;
    this.aiming = false;
    this.hud.crosshair.classList.add('hidden');
    return true;
  }

  _dash() {
    this.aiming = false;
    this.hud.crosshair.classList.add('hidden');
    this.kamikaze--;
    this._updateKamiHud();
    this._aimQuat(_q2);
    this.flight.quat.copy(_q2);
    this.dashing = true;
    this.dashT = 0;
    this.flight.speed = this.flight.params.maxSpeed * 2.2;
    this.flight.gvel = 0;
    if (this.audio) { this.audio.whoosh(); this.audio.startEngine(); }
    this.shake.add(0.5);
    this.flash.hit(0.15);
  }

  _endDash(speedMul) {
    this.dashing = false;
    this.flight.speed = Math.min(this.flight.speed, this.flight.params.maxSpeed * speedMul);
    if (this.mode === 'playground') { this.kamikaze = 1; this._updateKamiHud(); }
  }

  _aimQuat(out) {
    out.copy(this.flight.quat);
    _q.set(0, Math.sin(-this.aimYaw / 2), 0, Math.cos(-this.aimYaw / 2));
    out.multiply(_q);
    _q.set(Math.sin(-this.aimPitch / 2), 0, 0, Math.cos(-this.aimPitch / 2));
    out.multiply(_q);
    return out;
  }

  // ---------- knockdown / relaunch ----------

  _knockdown(normal) {
    if (this.state !== 'playing') return;
    const fl = this.flight;
    this.state = 'lying';
    this.lieT = 0;
    this.aiming = false;
    this.hud.crosshair.classList.add('hidden');
    if (this.dashing) this._endDash(1);
    // residual slide velocity from motion direction
    _v.copy(fl.pos).sub(fl.prevPos);
    if (_v.lengthSq() > 1e-6) _v.normalize(); else fl.forward(_v);
    this.lieVel.copy(_v).multiplyScalar(fl.speed * 0.25);
    if (normal) {
      fl.pos.addScaledVector(normal, 1.1);
      const d = this.lieVel.dot(normal);
      if (d < 0) this.lieVel.addScaledVector(normal, -1.4 * d);
    }
    this.lieVel.y = Math.min(this.lieVel.y, 2);
    fl.speed = 0;
    fl.launched = false;
    // flat heading for the resting pose
    fl.forward(_f);
    _f.y = 0;
    if (_f.lengthSq() < 1e-4) _f.set(0, 0, 1);
    _f.normalize();
    this.lieQuat.setFromUnitVectors(Z_AXIS, _f);
    if (this.audio) { this.audio.stopEngine(); this.audio.thud(); }
    this.puff.burst(fl.pos, 10);
    this.shake.add(0.3);
    this.flash.hit(0.1);
    this.hud.hint.textContent = 'SPACE — RELAUNCH';
    this.hud.hint.classList.remove('hidden', 'fade');
    this.hintTimer = 9999;
  }

  _relaunch() {
    const fl = this.flight;
    _f.copy(Z_AXIS).applyQuaternion(this.lieQuat); // flat heading
    _f.y = 0;
    if (_f.lengthSq() < 1e-4) _f.set(0, 0, 1);
    _f.normalize();
    const s = Math.sin(0.96), c = Math.cos(0.96); // ~55 degrees up
    _v.set(_f.x * c, s, _f.z * c).normalize();
    fl.quat.setFromUnitVectors(Z_AXIS, _v);
    fl.pos.y += 1.0;
    fl.prevPos.copy(fl.pos);
    fl.speed = fl.params.maxSpeed * 0.45;
    fl.gvel = 0;
    fl.launched = true;
    fl.roll = 0;
    fl.pitchRate = 0; fl.yawRate = 0;
    const bank = this.missileMesh.userData.bank;
    bank.rotation.set(0, 0, 0);
    this.state = 'playing';
    this.hud.hint.classList.add('fade');
    this.hintTimer = 0;
    this.puff.burst(fl.pos, 12);
    this.shake.add(0.2);
    if (this.audio) { this.audio.whoosh(); this.audio.startEngine(); }
  }

  // ---------- scoring ----------

  _popup(text, big = false) {
    const el = document.createElement('div');
    el.className = 'popup' + (big ? ' big' : '');
    el.textContent = text;
    this.hud.popups.appendChild(el);
    while (this.hud.popups.children.length > 4) this.hud.popups.firstChild.remove();
    el.addEventListener('animationend', () => el.remove());
  }

  _trick(name, base) {
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = 3;
    const add = base * this.combo;
    this.score += add;
    this._popup(this.combo > 1 ? `${name} x${this.combo} +${add}` : `${name} +${add}`, this.combo >= 3);
    if (this.audio && this.combo > 1) this.audio.comboUp();
  }

  // ---------- outcomes ----------

  _crash() {
    if (this.state !== 'playing') return;
    this.state = 'dead';
    this.deathTimer = 0;
    this.aiming = false; this.dashing = false;
    this.hud.crosshair.classList.add('hidden');
    this.input.setActive(false);
    if (this.audio) { this.audio.stopEngine(); this.audio.crash(); }
    const p = this.flight.pos;
    this.puff.burst(p, 16);
    this.debris.burst(p, 26, [0xd9d9de, 0xa8a8b2, 0x54586a], 0.7);
    this.shake.add(0.55);
    this.flash.hit(0.25);
    // crumpled missile
    const bank = this.missileMesh.userData.bank;
    bank.rotation.x = 0.55;
    bank.rotation.z = 0.9;
  }

  _win() {
    if (this.state !== 'playing') return;
    this.state = 'win';
    this.winTimer = 0;
    this.aiming = false;
    if (this.dashing) this._endDash(1);
    this.hud.crosshair.classList.add('hidden');
    this.input.setActive(false);
    if (this.audio) { this.audio.stopEngine(); this.audio.explosionBig(); }
    const tpos = this.ctx.target.pos
      ? _v.fromArray(this.ctx.target.pos)
      : _v.copy(this.flight.pos);
    for (const m of this.ctx.target.meshes) m.visible = false;
    this.missileMesh.visible = false;
    this.debris.burst(tpos, 140, this.level.targetColors, 1.5);
    this.puff.burst(tpos, 20);
    this.shake.add(1.25);
    this.flash.hit(1);
    this.score += 500;
    this._camTargetLock = tpos.clone();

    const stars = this.time <= this.level.par ? 3 : this.time <= this.level.par * 1.45 ? 2 : 1;
    this._popup('LEVEL CLEAR', true);
    this._popup('★'.repeat(stars) + '☆'.repeat(3 - stars), true);

    this.levelsCleared++;
    if (this.levelsCleared > this.save.bestRun) {
      this.save.bestRun = this.levelsCleared;
      this.persist();
    }
    if (this.net && this.net.joined) {
      this.net.reportClear(this.playerName, this.levelsCleared);
    }
  }

  // ---------- breakables / toys ----------

  _breakWall(c) {
    if (c.mesh) c.mesh.visible = false;
    this.world.remove(c);
    this.debris.burst(this.flight.pos, 40, [0xd9d9de, 0xef8168, 0x64c8c4, 0xa8a8b2], 1.2);
    this.puff.burst(this.flight.pos, 10);
    this.shake.add(0.7);
    this.flash.hit(0.3);
    if (this.audio) this.audio.smallBoom();
    this._trick('WRECKING BALL', 250);
    this.graceT = 0.15;
    this._endDash(0.9);
  }

  _softBurst(c) {
    if (c.mesh) c.mesh.visible = false;
    this.world.remove(c);
    this.debris.burst(this.flight.pos, 14, [0xcc8844, 0xa8763a, 0xffd23f], 0.8);
    if (this.audio) this.audio.whoosh();
    this._trick('DEMOLITION', 50);
    this.graceT = 0.05;
  }

  _bounce(c) {
    const fl = this.flight;
    this.world.normalAt(c, fl.pos, _n);
    fl.forward(_f);
    _f.addScaledVector(_n, -2 * _f.dot(_n)).normalize();
    fl.quat.setFromUnitVectors(Z_AXIS, _f);
    fl.pos.addScaledVector(_n, 0.8);
    fl.speed *= 0.85;
    this.puff.burst(fl.pos, 8);
    this.shake.add(0.25);
    if (this.audio) this.audio.whoosh();
  }

  _impact(c) {
    const fl = this.flight;
    this.world.normalAt(c, fl.pos, _n);
    if (this.mode === 'playground') { this._knockdown(_n); return; }
    if (this.dashing) { this._crash(); return; } // dash into solid = death
    _v.copy(fl.pos).sub(fl.prevPos);
    if (_v.lengthSq() > 1e-6) _v.normalize(); else fl.forward(_v);
    const headOn = -_v.dot(_n);
    const fast = fl.speed >= fl.params.maxSpeed * 0.55;
    if (fast && headOn >= 0.45) this._crash();
    else this._knockdown(_n);
  }

  // ---------- per-frame ----------

  update(dtReal) {
    this.elapsed += dtReal;
    this.shake.update(dtReal);
    this.flash.update(dtReal);

    if (this.state === 'menu' || this.state === 'paused') return;
    if (this.state === 'complete') {
      this.completeTimer += dtReal;
      if (this.completeTimer > 8) this.toMenu();
      this.flame.update(dtReal);
      this.debris.update(dtReal);
      this.puff.update(dtReal);
      return;
    }

    // timescale
    let targetTs = 1;
    if (this.state === 'playing' && this.aiming) {
      targetTs = 0.25;
    } else if (this.state === 'playing' && this.input.slowmo && this.slowMeter > 0 && this.flight.launched) {
      targetTs = 0.35;
      this.slowMeter = Math.max(0, this.slowMeter - dtReal * 0.4);
    } else if (this.state === 'playing') {
      this.slowMeter = Math.min(1, this.slowMeter + dtReal * 0.16);
    }
    if (this.state === 'win' && this.winTimer < 1.3) targetTs = 0.22;
    this.timescale += (targetTs - this.timescale) * Math.min(1, dtReal * 9);
    const dt = dtReal * this.timescale;

    for (const fn of this.ctx.dynamic) fn(this.elapsed);

    if (this.state === 'playing') this._updatePlaying(dt, dtReal);
    else if (this.state === 'lying') this._updateLying(dt, dtReal);
    else if (this.state === 'dead') {
      this.deathTimer += dtReal;
      if (this.deathTimer > 0.55 && $('card-death').classList.contains('hidden')) {
        $('card-death').classList.remove('hidden');
      }
    } else if (this.state === 'win') {
      this.winTimer += dtReal;
      if (this.winTimer > 2.5 && this.runActive) this.enterPlayground();
    }

    if (this.mode === 'playground' && (this.state === 'playing' || this.state === 'lying')) {
      this._updatePlayground(dtReal);
      if (this.state === 'menu' || this.state === 'complete') return; // solo countdown may transition
    }

    this._updateGhosts(dtReal);
    this._netTick(dtReal);

    this.flame.update(dt);
    this.debris.update(dt);
    this.puff.update(dt);
    this._updateCamera(dtReal);
  }

  _updatePlaying(dt, dtReal) {
    const input = this.input;
    const fl = this.flight;
    const steer = (this.aiming || this.dashing) ? ZERO_STEER : input.getSteer();
    const thrustEff = this.dashing ? true : (this.aiming ? false : input.thrust);
    const wasLaunched = fl.launched;

    fl.update(dt, steer, thrustEff);
    if (this.dashing) {
      this.dashT += dt;
      fl.speed = fl.params.maxSpeed * 2.2;
      if (this.dashT > 1.6) this._endDash(1);
    }
    fl.applyTo(this.missileMesh);

    if (!wasLaunched && fl.launched && this.audio) {
      this.audio.startEngine();
      this.audio.whoosh();
    }

    if (this.aiming) {
      if (fl.launched) this._updateAim(dtReal);
      else this.cancelAim();
    }

    if (fl.launched) {
      if (this.mode === 'level') this.time += dt;

      // fuel
      if (thrustEff && !this.dashing) {
        this.burnAcc += dt;
        while (this.burnAcc >= 0.15) { this.burnAcc -= 0.15; this.fuel++; }
      }

      // flame trail
      if (thrustEff) {
        this.flameAcc += dt;
        fl.forward(_f);
        _v.copy(fl.pos).addScaledVector(_f, -1.7);
        _v2.copy(_f).negate();
        const rate = this.dashing ? 0.008 : 0.014;
        while (this.flameAcc >= rate) {
          this.flameAcc -= rate;
          this.flame.spawn(_v, _v2, fl.speed);
        }
        if (this.dashing) this.shake.add(0.02);
      }

      // engine sound
      this.throttleSm += ((thrustEff ? 1 : 0) - this.throttleSm) * Math.min(1, dtReal * 8);
      if (this.audio) this.audio.setEngine(this.throttleSm, Math.min(1.4, fl.speed / fl.params.maxSpeed));

      // collisions
      this.graceT = Math.max(0, this.graceT - dt);
      if (this.graceT <= 0) {
        const res = this.world.step(fl.pos, MISSILE_R, dt, fl.speed > 15);
        if (res.hit) {
          const c = res.hit;
          if (c.isTarget && this.mode === 'level') { this._win(); return; }
          if (this.dashing && c.breakable) { this._breakWall(c); }
          else if (c.soft) { this._softBurst(c); }
          else if (c.bouncy) { this._bounce(c); }
          else if (!c.isTarget) { this._impact(c); if (this.state !== 'playing') return; }
        }
        for (const c of res.nearMisses) {
          this._trick(c.trick, 100);
          if (this.audio) this.audio.nearMiss(this.combo);
        }
      }

      // gates
      for (const g of this.ctx.gates) {
        if (g.cool > 0) { g.cool -= dt; continue; }
        const s0 = (fl.prevPos.x - g.cx) * g.nx + (fl.prevPos.y - g.cy) * g.ny + (fl.prevPos.z - g.cz) * g.nz;
        const s1 = (fl.pos.x - g.cx) * g.nx + (fl.pos.y - g.cy) * g.ny + (fl.pos.z - g.cz) * g.nz;
        if (s0 * s1 < 0 && Math.abs(s0) < 8) {
          const t = s0 / (s0 - s1);
          _v.lerpVectors(fl.prevPos, fl.pos, t);
          _v.sub(_v2.set(g.cx, g.cy, g.cz));
          const d = _v.addScaledVector(_v2.set(g.nx, g.ny, g.nz), -_v.dot(_v2.set(g.nx, g.ny, g.nz))).length();
          if (d < g.r) {
            g.cool = 2;
            this._trick(g.name, g.score);
            if (this.audio) this.audio.whoosh();
          }
        }
      }

      // roof rush
      this.roofCool = Math.max(0, this.roofCool - dt);
      const alt = fl.pos.y - this.level.env.groundY;
      if (alt < 3.6 && fl.speed > fl.params.maxSpeed * 0.5) {
        this.lowTime += dt;
        if (this.lowTime > 0.7 && this.roofCool <= 0) {
          this.roofCool = 4;
          this._trick('ROOF RUSH', 150);
          if (this.audio) this.audio.nearMiss(this.combo);
        }
      } else {
        this.lowTime = 0;
      }

      // ground contact: shallow + slow = slide to a stop; steep/fast = death
      if (alt < 0.55) {
        if (this.mode === 'playground') { this._groundLie(); return; }
        fl.forward(_f);
        if (this.dashing || _f.y < -0.4 || fl.speed > fl.params.maxSpeed * 0.6) { this._crash(); return; }
        this._groundLie(); return;
      }

      // bounds
      if (fl.pos.y > 500 || Math.abs(fl.pos.x) > 800 || fl.pos.z < -300 || fl.pos.z > 900) {
        if (this.mode === 'playground') {
          fl.pos.x = Math.max(-200, Math.min(200, fl.pos.x));
          fl.pos.z = Math.max(-200, Math.min(200, fl.pos.z));
          this._knockdown(null);
          return;
        }
        this._crash(); return;
      }

      // combo timer
      if (this.comboTimer > 0) {
        this.comboTimer -= dt;
        if (this.comboTimer <= 0) this.combo = 0;
      }

      this.hintTimer -= dtReal;
      if (this.hintTimer < 0 && !this.hud.hint.classList.contains('fade')) {
        this.hud.hint.classList.add('fade');
      }
    }

    this._updateHud();
  }

  _groundLie() {
    const fl = this.flight;
    fl.pos.y = this.level.env.groundY + 0.6;
    this._knockdown(null);
  }

  _updateLying(dt, dtReal) {
    const fl = this.flight;
    if (this.mode === 'level') this.time += dt;
    this.lieT += dt;
    this.lieVel.y -= 30 * dt;
    fl.prevPos.copy(fl.pos);
    fl.pos.addScaledVector(this.lieVel, dt);
    const floorY = this.level.env.groundY + 0.45;
    if (fl.pos.y <= floorY) {
      fl.pos.y = floorY;
      if (this.lieVel.y < -8) this.puff.burst(fl.pos, 5);
      this.lieVel.y = 0;
      const k = 1 - Math.min(1, dt * 3);
      this.lieVel.x *= k; this.lieVel.z *= k;
    }
    fl.quat.slerp(this.lieQuat, Math.min(1, dt * 4));
    const mesh = this.missileMesh;
    mesh.position.copy(fl.pos);
    mesh.quaternion.copy(fl.quat);
    const bank = mesh.userData.bank;
    bank.rotation.z += (Math.PI / 2 - bank.rotation.z) * Math.min(1, dt * 5);
    bank.rotation.x *= 1 - Math.min(1, dt * 5);
    this._updateHud();
  }

  _updateAim(dtReal) {
    const steer = this.input.getSteer();
    this.aimYaw = steer.x * 1.0;
    this.aimPitch = steer.y * 0.8;
    this._aimQuat(_q2);
    _f.copy(Z_AXIS).applyQuaternion(_q2);
    _v.copy(this.flight.pos).addScaledVector(_f, 50).project(this.camera);
    const ch = this.hud.crosshair;
    if (_v.z > 1) { ch.classList.add('hidden'); return; }
    ch.classList.remove('hidden');
    ch.style.left = ((_v.x * 0.5 + 0.5) * window.innerWidth) + 'px';
    ch.style.top = ((-_v.y * 0.5 + 0.5) * window.innerHeight) + 'px';
  }

  _updatePlayground(dtReal) {
    // countdown / waiting text
    let txt = '';
    if (this.net && this.net.online && this.net.joined) {
      const run = this.net.run;
      const act = this.net.activePlayers();
      if (run && run.phase === 'countdown') {
        const s = Math.max(0, Math.ceil((run.countdownEnd - this.net.now()) / 1000));
        txt = `NEXT LEVEL IN ${s}s...`;
      } else {
        const here = act.filter(p => p.phase === 'playground').length;
        txt = act.length <= 1 ? 'WAITING...' : `WAITING FOR PLAYERS (${here}/${act.length})`;
      }
    } else {
      this.soloCountdown -= dtReal;
      if (this.soloCountdown <= 0) {
        const next = this.levelIndex + 1;
        if (next >= LEVELS.length) { this._runComplete(); return; }
        this.startLevel(next);
        return;
      }
      txt = `NEXT LEVEL IN ${Math.max(0, Math.ceil(this.soloCountdown))}s...`;
    }
    if (txt !== this.pgText) {
      this.pgText = txt;
      this.hud.pg.textContent = txt;
    }

    // billboard refresh (on entry + every 5s)
    this.pgRefreshAcc += dtReal;
    if (this.pgRefreshAcc >= 5 && this.ctx.billboard) {
      this.pgRefreshAcc = 0;
      const rows = (this.net && this.net.online)
        ? this.net.leaderboard
        : (this.save.bestRun > 0 ? [{ name: this.playerName, levels: this.save.bestRun }] : []);
      this.ctx.billboard.draw(rows);
    }
  }

  // ---------- multiplayer ghosts + state sync ----------

  _netTick(dtReal) {
    if (!this.net || !this.net.joined || !this.runActive) return;
    this.sendAcc += dtReal;
    if (this.sendAcc < 0.11) return;
    this.sendAcc = 0;
    this._netSend(false);
  }

  _netSend(immediate) {
    if (!this.net || !this.net.joined) return;
    const fl = this.flight;
    const r2 = x => Math.round(x * 100) / 100;
    const r3 = x => Math.round(x * 1000) / 1000;
    this.net.sendState({
      phase: this.mode === 'playground' ? 'playground' : 'level',
      level: this.levelIndex,
      lying: this.state === 'lying' ? 1 : 0,
      dead: this.state === 'dead' ? 1 : 0,
      th: (this.state === 'playing' && fl.launched && (this.input.thrust || this.dashing)) ? 1 : 0,
      p: [r2(fl.pos.x), r2(fl.pos.y), r2(fl.pos.z)],
      q: [r3(fl.quat.x), r3(fl.quat.y), r3(fl.quat.z), r3(fl.quat.w)]
    });
    if (immediate) this.sendAcc = 0;
  }

  _makeGhost(peer) {
    const mesh = buildMissileMesh(typeof peer.color === 'number' ? peer.color : 0xf2f2f0);
    mesh.traverse(c => {
      if (c.isMesh) {
        c.material = c.material.clone();
        c.material.transparent = true;
        c.material.opacity = 0.85;
      }
    });
    this.scene.add(mesh);
    // name label
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 64;
    const g = cv.getContext('2d');
    g.font = '900 40px -apple-system, "Segoe UI", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 8; g.strokeStyle = '#14141f';
    const nm = String(peer.name || '???').slice(0, 10);
    g.strokeText(nm, 128, 32);
    g.fillStyle = '#ffffff';
    g.fillText(nm, 128, 32);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    label.scale.set(7, 1.75, 1);
    this.scene.add(label);
    return { mesh, label, tp: new THREE.Vector3(), tq: new THREE.Quaternion(), snap: true, flameAcc: 0 };
  }

  _removeGhost(pid) {
    const g = this.ghosts.get(pid);
    if (!g) return;
    this.scene.remove(g.mesh);
    this.scene.remove(g.label);
    g.mesh.traverse(c => { if (c.isMesh) { c.geometry.dispose(); c.material.dispose(); } });
    g.label.material.map.dispose();
    g.label.material.dispose();
    this.ghosts.delete(pid);
  }

  _updateGhosts(dtReal) {
    if (!this.net || !this.net.joined) return;
    // membership sync at 4 Hz
    this.ghostSyncAcc += dtReal;
    if (this.ghostSyncAcc >= 0.25) {
      this.ghostSyncAcc = 0;
      const act = this.net.activePlayers();
      const seen = new Set();
      for (const p of act) {
        if (p.id === this.net.pid) continue;
        seen.add(p.id);
        if (!this.ghosts.has(p.id)) this.ghosts.set(p.id, this._makeGhost(p));
      }
      for (const pid of [...this.ghosts.keys()]) {
        if (!seen.has(pid)) this._removeGhost(pid);
      }
    }
    // per-frame interpolation from latest raw data
    const myPhase = this.mode === 'playground' ? 'playground' : 'level';
    for (const [pid, g] of this.ghosts) {
      const raw = this.net.playersRaw[pid];
      if (!raw || !Array.isArray(raw.p) || !Array.isArray(raw.q)) {
        g.mesh.visible = false; g.label.visible = false; continue;
      }
      const samePlace = raw.phase === myPhase &&
        (myPhase === 'playground' || raw.level === this.levelIndex) && !raw.dead;
      g.mesh.visible = samePlace && this.state !== 'menu';
      g.label.visible = g.mesh.visible;
      if (!g.mesh.visible) { g.snap = true; continue; }
      g.tp.set(raw.p[0] || 0, raw.p[1] || 0, raw.p[2] || 0);
      g.tq.set(raw.q[0] || 0, raw.q[1] || 0, raw.q[2] || 0, raw.q[3] === undefined ? 1 : raw.q[3]);
      if (g.snap || g.mesh.position.distanceToSquared(g.tp) > 2500) {
        g.mesh.position.copy(g.tp);
        g.mesh.quaternion.copy(g.tq);
        g.snap = false;
      } else {
        const k = 1 - Math.exp(-dtReal * 8);
        g.mesh.position.lerp(g.tp, k);
        g.mesh.quaternion.slerp(g.tq, k);
      }
      g.label.position.copy(g.mesh.position);
      g.label.position.y += 2.6;
      // ghost engine flame
      if (raw.th) {
        g.flameAcc += dtReal;
        if (g.flameAcc >= 0.05) {
          g.flameAcc = 0;
          _f.copy(Z_AXIS).applyQuaternion(g.mesh.quaternion);
          _v.copy(g.mesh.position).addScaledVector(_f, -1.7);
          _v2.copy(_f).negate();
          this.flame.spawn(_v, _v2, 30);
        }
      }
    }
  }

  // ---------- HUD ----------

  _updateKamiHud() {
    const k = this.hud.kami;
    if (this.kamikaze > 0) k.classList.remove('dim');
    else k.classList.add('dim');
  }

  _updateHud(force = false) {
    const h = this.hud;
    h.timer.textContent = fmtTime(this.time);
    h.fuel.textContent = 'FUEL USED: ' + this.fuel;
    h.score.textContent = String(this.score);
    if (this.combo > 1) {
      h.combo.textContent = 'x' + this.combo;
      h.combo.classList.remove('hidden');
    } else {
      h.combo.classList.add('hidden');
    }
    h.slowmo.style.width = (this.slowMeter * 100).toFixed(1) + '%';
  }

  _updateCamera(dtReal) {
    const fl = this.flight;
    if (this.state === 'win' && this._camTargetLock) {
      this.camera.position.copy(this.camPos);
      this.camera.up.copy(this.camUp);
      this.camera.lookAt(this._camTargetLock);
      this.shake.apply(this.camera);
      return;
    }
    fl.forward(_f);
    const vert = Math.min(1, Math.max(0, (Math.abs(_f.y) - 0.6) / 0.3));
    _v.set(0, 1, 0).applyQuaternion(fl.quat); // missile local up
    const backTarget = this.aiming ? 12 : 8.5;
    this.camBack += (backTarget - this.camBack) * Math.min(1, dtReal * 5);
    _camTarget.copy(fl.pos).addScaledVector(_f, -this.camBack)
      .addScaledVector(_up, 2.6 + (this.camBack - 8.5) * 0.35)
      .addScaledVector(_v, -vert * 7);
    _camTarget.y = Math.max(_camTarget.y, this.level.env.groundY + 1.4);
    const k = 1 - Math.exp(-dtReal * (this.state === 'dead' || this.state === 'lying' ? 1.5 : 7));
    this.camPos.lerp(_camTarget, k);

    // look target pulls back to the missile itself when flying vertical
    _v2.copy(fl.pos).addScaledVector(_f, 6 * (1 - vert * 0.85));
    // stable camera up: world up unless looking near-vertical
    _f.copy(_v2).sub(this.camPos).normalize();
    if (Math.abs(_f.y) < 0.82) _v.copy(_up);
    this.camUp.lerp(_v, Math.min(1, dtReal * 5)).normalize();

    this.camera.position.copy(this.camPos);
    this.camera.up.copy(this.camUp);
    this.camera.lookAt(_v2);
    this.shake.apply(this.camera);
  }
}

export function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const c = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')},${String(c).padStart(2, '0')}`;
}
