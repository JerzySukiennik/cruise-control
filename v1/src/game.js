// Game orchestrator: state machine, level lifecycle, scoring, HUD, camera, save data.
import * as THREE from 'three';
import { buildMissileMesh, FlightModel } from './missile.js';
import { CollisionWorld } from './collision.js';
import { FlameTrail, DebrisPool, PuffPool, Shake, Flash } from './effects.js';
import { LEVELS } from './levels.js';

const SAVE_KEY = 'cc_save_v1';
const MISSILE_R = 0.9;

const _f = new THREE.Vector3();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

const $ = id => document.getElementById(id);

export class Game {
  constructor(assets, input) {
    this.assets = assets;
    this.input = input;
    this.audio = null;

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

    this.state = 'menu';
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

    this.camPos = new THREE.Vector3();
    this.camUp = new THREE.Vector3(0, 1, 0);

    this.onShowMenu = null;
    this.save = this._loadSave();

    this.hud = {
      root: $('hud'), score: $('score'), combo: $('combo'), timer: $('timer'),
      fuel: $('fuel'), slowmo: $('slowmo-fill'), popups: $('popups'), hint: $('hint')
    };
  }

  setAudio(a) { this.audio = a; }

  _loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && typeof s === 'object') return { unlocked: s.unlocked || 0, best: s.best || {}, muted: !!s.muted };
    } catch (e) { /* fresh save */ }
    return { unlocked: 0, best: {}, muted: false };
  }

  persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch (e) { /* private mode */ }
  }

  isUnlocked(i) { return i <= this.save.unlocked; }

  // ---------- level lifecycle ----------

  _clearLevel() {
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

  _buildLevel(i) {
    this._clearLevel();
    this.levelIndex = i;
    const lvl = this.level = LEVELS[i];
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

    // flight params
    const fp = this.flight.params;
    fp.maxSpeed = lvl.flight.maxSpeed;
    fp.turnRate = lvl.flight.turnRate;
    fp.accel = 26 + lvl.flight.maxSpeed * 0.35;
    fp.stallSpeed = 12;
    fp.gravity = 18;
    fp.drag = 8;
    this.flight.reset(
      _v.fromArray(lvl.spawn.pos),
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
    this.hud.popups.innerHTML = '';
    this._updateHud(true);

    // snap camera
    this.flight.forward(_f);
    this.camPos.copy(this.flight.pos).addScaledVector(_f, -9).addScaledVector(_up, 2.6);
    this.camPos.y = Math.max(this.camPos.y, env.groundY + 1.4);
    this.camUp.set(0, 1, 0);

    // hint
    this.hud.hint.textContent = lvl.hint;
    this.hud.hint.classList.remove('hidden', 'fade');
    this.hintTimer = 4;
  }

  startLevel(i) {
    this._buildLevel(i);
    this.state = 'playing';
    this.input.setActive(true);
    this.input.resetAim();
    this._hideCards();
    this.hud.root.classList.remove('hidden');
    if (this.audio) this.audio.stopEngine();
  }

  restart() {
    if (this.state === 'menu') return;
    this.startLevel(this.levelIndex);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.setActive(false);
    if (this.audio) this.audio.stopEngine();
    $('card-pause').classList.remove('hidden');
  }

  resume() {
    if (this.state !== 'paused') return;
    $('card-pause').classList.add('hidden');
    this.state = 'playing';
    this.input.setActive(true);
    this.input.requestLock();
  }

  toMenu() {
    this.state = 'menu';
    this.input.setActive(false);
    this.input.releaseLock();
    if (this.audio) this.audio.stopEngine();
    this._hideCards();
    this.hud.root.classList.add('hidden');
    if (this.onShowMenu) this.onShowMenu();
  }

  _hideCards() {
    $('card-death').classList.add('hidden');
    $('card-win').classList.add('hidden');
    $('card-pause').classList.add('hidden');
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

  _crash(reason) {
    if (this.state !== 'playing') return;
    this.state = 'dead';
    this.deathTimer = 0;
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
    this._popup('TARGET DESTROYED +500', true);
    this._camTargetLock = tpos.clone();

    // save results
    const stars = this.time <= this.level.par ? 3 : this.time <= this.level.par * 1.45 ? 2 : 1;
    this._lastStars = stars;
    const b = this.save.best[this.levelIndex] || {};
    this.save.best[this.levelIndex] = {
      time: b.time === undefined ? this.time : Math.min(b.time, this.time),
      fuel: b.fuel === undefined ? this.fuel : Math.min(b.fuel, this.fuel),
      score: b.score === undefined ? this.score : Math.max(b.score, this.score),
      stars: b.stars === undefined ? stars : Math.max(b.stars, stars)
    };
    if (this.levelIndex + 1 < LEVELS.length) {
      this.save.unlocked = Math.max(this.save.unlocked, this.levelIndex + 1);
    }
    this.persist();
  }

  _showWinCard() {
    $('win-time').textContent = fmtTime(this.time);
    $('win-fuel').textContent = String(this.fuel);
    $('win-score').textContent = String(this.score);
    const s = this._lastStars || 1;
    $('stars').innerHTML =
      '<span>&#9733;</span>'.repeat(s) + '<span class="off">&#9733;</span>'.repeat(3 - s);
    $('btn-win-next').style.display = this.levelIndex + 1 < LEVELS.length ? '' : 'none';
    $('card-win').classList.remove('hidden');
  }

  // ---------- per-frame ----------

  update(dtReal) {
    this.elapsed += dtReal;
    this.shake.update(dtReal);
    this.flash.update(dtReal);

    if (this.state === 'menu' || this.state === 'paused') return;

    // timescale
    let targetTs = 1;
    if (this.state === 'playing' && this.input.slowmo && this.slowMeter > 0 && this.flight.launched) {
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
    else if (this.state === 'dead') {
      this.deathTimer += dtReal;
      if (this.deathTimer > 0.55 && $('card-death').classList.contains('hidden')) {
        $('card-death').classList.remove('hidden');
      }
    } else if (this.state === 'win') {
      this.winTimer += dtReal;
      if (this.winTimer > 1.7 && $('card-win').classList.contains('hidden')) {
        this._showWinCard();
      }
    }

    this.flame.update(dt);
    this.debris.update(dt);
    this.puff.update(dt);
    this._updateCamera(dtReal);
  }

  _updatePlaying(dt, dtReal) {
    const input = this.input;
    const steer = input.getSteer();
    const fl = this.flight;
    const wasLaunched = fl.launched;

    fl.update(dt, steer, input.thrust);
    fl.applyTo(this.missileMesh);

    if (!wasLaunched && fl.launched && this.audio) {
      this.audio.startEngine();
      this.audio.whoosh();
    }

    if (fl.launched) {
      this.time += dt;

      // fuel
      if (input.thrust) {
        this.burnAcc += dt;
        while (this.burnAcc >= 0.15) { this.burnAcc -= 0.15; this.fuel++; }
      }

      // flame trail
      if (input.thrust) {
        this.flameAcc += dt;
        fl.forward(_f);
        _v.copy(fl.pos).addScaledVector(_f, -1.7);
        _v2.copy(_f).negate();
        while (this.flameAcc >= 0.014) {
          this.flameAcc -= 0.014;
          this.flame.spawn(_v, _v2, fl.speed);
        }
      }

      // engine sound
      this.throttleSm += ((input.thrust ? 1 : 0) - this.throttleSm) * Math.min(1, dtReal * 8);
      if (this.audio) this.audio.setEngine(this.throttleSm, fl.speed / fl.params.maxSpeed);

      // collisions
      const res = this.world.step(fl.pos, MISSILE_R, dt, fl.speed > 15);
      if (res.hit) {
        if (res.hit.isTarget) { this._win(); return; }
        this._crash(); return;
      }
      for (const c of res.nearMisses) {
        this._trick(c.trick, 100);
        if (this.audio) this.audio.nearMiss(this.combo);
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

      // ground + bounds
      if (alt < 0.55) { this._crash(); return; }
      if (fl.pos.y > 500 || Math.abs(fl.pos.x) > 800 || fl.pos.z < -300 || fl.pos.z > 900) {
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
    _camTarget.copy(fl.pos).addScaledVector(_f, -8.5).addScaledVector(_up, 2.6)
      .addScaledVector(_v, -vert * 7);
    _camTarget.y = Math.max(_camTarget.y, this.level.env.groundY + 1.4);
    const k = 1 - Math.exp(-dtReal * (this.state === 'dead' ? 1.5 : 7));
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
