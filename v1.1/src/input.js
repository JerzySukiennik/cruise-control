// Input: keyboard, pointer-lock mouse (with offset fallback), mobile joystick + buttons.
export class Input {
  constructor(canvas, isTouch) {
    this.canvas = canvas;
    this.isTouch = isTouch;
    this.aimX = 0; this.aimY = 0;      // virtual stick [-1,1]
    this.keyX = 0; this.keyY = 0;
    this.thrust = false;
    this.slowmo = false;
    this.active = false;                // gameplay input enabled
    this.locked = false;
    this.wantLock = false;
    this.mouseNX = 0; this.mouseNY = 0; // fallback: cursor offset from center
    this.onRestart = null;
    this.onPause = null;
    this.onMute = null;
    this.onGesture = null;
    this.onAction = null;               // thrust-press edge (relaunch/respawn/dash)
    this.onKamikaze = null;             // K key / mobile K button
    this._keys = new Set();
    this._joyId = null;
    this._thrustIds = new Set();
    this._slowIds = new Set();
    this._bind();
  }

  _gesture() { if (this.onGesture) this.onGesture(); }

  _action() { if (this.onAction) this.onAction(); }

  _bind() {
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this._gesture();
      const k = e.code;
      this._keys.add(k);
      if (k === 'Space') { this.thrust = true; this._action(); e.preventDefault(); }
      if (k === 'ShiftLeft' || k === 'ShiftRight') this.slowmo = true;
      if (k === 'KeyR' && this.onRestart) this.onRestart();
      if (k === 'KeyK' && this.onKamikaze) this.onKamikaze();
      if (k === 'Escape' && this.onPause) this.onPause();
      if (k === 'KeyM' && this.onMute) this.onMute();
    });
    window.addEventListener('keyup', e => {
      const k = e.code;
      this._keys.delete(k);
      if (k === 'Space') { this.thrust = false; e.preventDefault(); }
      if (k === 'ShiftLeft' || k === 'ShiftRight') this.slowmo = false;
    });
    window.addEventListener('blur', () => {
      this._keys.clear();
      this.thrust = false; this.slowmo = false;
    });

    if (!this.isTouch) {
      document.addEventListener('pointerlockchange', () => {
        this.locked = document.pointerLockElement === this.canvas;
        if (!this.locked && this.wantLock && this.active && this.onPause) {
          this.wantLock = false;
          this.onPause();
        }
      });
      window.addEventListener('mousemove', e => {
        if (this.locked) {
          this.aimX += e.movementX * 0.0026;
          this.aimY -= e.movementY * 0.0026;
          const m = Math.hypot(this.aimX, this.aimY);
          if (m > 1) { this.aimX /= m; this.aimY /= m; }
        } else {
          const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
          const s = Math.min(window.innerWidth, window.innerHeight) * 0.5;
          this.mouseNX = Math.max(-1, Math.min(1, (e.clientX - cx) / s));
          this.mouseNY = Math.max(-1, Math.min(1, -(e.clientY - cy) / s));
        }
      });
      this.canvas.addEventListener('mousedown', e => {
        this._gesture();
        if (e.button === 0) this._action();
        if (!this.active) return;
        if (e.button === 0) this.thrust = true;
        if (!this.locked && this.wantLock) this.requestLock();
      });
      window.addEventListener('mouseup', e => {
        if (e.button === 0) this.thrust = false;
      });
      this.canvas.addEventListener('contextmenu', e => e.preventDefault());
    } else {
      this._bindTouch();
    }
  }

  _bindTouch() {
    const zone = document.getElementById('joy-zone');
    const base = document.getElementById('joy-base');
    const knob = document.getElementById('joy-knob');
    const R = 46;
    let ox = 0, oy = 0;

    const joyMove = t => {
      let dx = t.clientX - ox, dy = t.clientY - oy;
      const m = Math.hypot(dx, dy);
      if (m > R) { dx = dx / m * R; dy = dy / m * R; }
      knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.aimX = dx / R;
      this.aimY = -dy / R;
    };
    zone.addEventListener('touchstart', e => {
      this._gesture();
      for (const t of e.changedTouches) {
        if (this._joyId !== null) continue;
        this._joyId = t.identifier;
        ox = t.clientX; oy = t.clientY;
        base.style.left = ox + 'px';
        base.style.top = oy + 'px';
        base.classList.remove('hidden');
        joyMove(t);
      }
      e.preventDefault();
    }, { passive: false });
    zone.addEventListener('touchmove', e => {
      for (const t of e.changedTouches) if (t.identifier === this._joyId) joyMove(t);
      e.preventDefault();
    }, { passive: false });
    const joyEnd = e => {
      for (const t of e.changedTouches) {
        if (t.identifier === this._joyId) {
          this._joyId = null;
          this.aimX = 0; this.aimY = 0;
          knob.style.transform = 'translate(-50%, -50%)';
          base.classList.add('hidden');
        }
      }
    };
    zone.addEventListener('touchend', joyEnd);
    zone.addEventListener('touchcancel', joyEnd);

    const hookBtn = (el, ids, set, onDown) => {
      el.addEventListener('touchstart', e => {
        this._gesture();
        for (const t of e.changedTouches) ids.add(t.identifier);
        set(true); el.classList.add('on');
        if (onDown) onDown();
        e.preventDefault();
      }, { passive: false });
      const end = e => {
        for (const t of e.changedTouches) ids.delete(t.identifier);
        if (ids.size === 0) { set(false); el.classList.remove('on'); }
      };
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
    };
    hookBtn(document.getElementById('btn-thrust'), this._thrustIds,
      v => { this.thrust = v; }, () => this._action());
    hookBtn(document.getElementById('btn-slow'), this._slowIds, v => { this.slowmo = v; });
    const kbtn = document.getElementById('btn-kami');
    if (kbtn) {
      kbtn.addEventListener('touchstart', e => {
        this._gesture();
        if (this.onKamikaze) this.onKamikaze();
        e.preventDefault();
      }, { passive: false });
    }
  }

  requestLock() {
    if (this.isTouch || this.locked) return;
    this.wantLock = true;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => { /* fallback: mouse-offset steering */ });
    } catch (e) { /* fallback mode */ }
  }

  releaseLock() {
    this.wantLock = false;
    if (this.locked) document.exitPointerLock();
  }

  setActive(v) {
    this.active = v;
    if (!v) { this.thrust = false; this.slowmo = false; }
  }

  resetAim() { this.aimX = 0; this.aimY = 0; this.mouseNX = 0; this.mouseNY = 0; }

  getSteer() {
    let x, y;
    if (this.isTouch || this.locked) { x = this.aimX; y = this.aimY; }
    else { x = this.mouseNX; y = this.mouseNY; }
    this.keyX = (this._keys.has('KeyD') || this._keys.has('ArrowRight') ? 1 : 0) -
                (this._keys.has('KeyA') || this._keys.has('ArrowLeft') ? 1 : 0);
    this.keyY = (this._keys.has('KeyW') || this._keys.has('ArrowUp') ? 1 : 0) -
                (this._keys.has('KeyS') || this._keys.has('ArrowDown') ? 1 : 0);
    x = Math.max(-1, Math.min(1, x + this.keyX));
    y = Math.max(-1, Math.min(1, y + this.keyY));
    const dz = 0.06;
    const shape = v => {
      const a = Math.abs(v);
      if (a < dz) return 0;
      const n = (a - dz) / (1 - dz);
      return Math.sign(v) * n * n * (3 - 2 * n) * (0.4 + 0.6 * n); // soft response curve
    };
    return { x: shape(x), y: shape(y) };
  }
}
