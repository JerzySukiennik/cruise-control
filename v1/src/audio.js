// Audio: three.js Audio wrapper, engine loop, layered explosions, iOS unlock, mute.
import * as THREE from 'three';

export class AudioManager {
  constructor(camera, assets) {
    this.assets = assets;
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.muted = false;
    this.unlocked = false;
    this.engine = null;
    this.engineOn = false;
    this._live = [];
  }

  unlock() {
    if (this.unlocked) return;
    const ctx = this.listener.context;
    if (ctx.state === 'suspended') ctx.resume();
    // silent buffer kick for iOS Safari
    try {
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) { /* ignore */ }
    this.unlocked = true;
  }

  setMuted(m) {
    this.muted = m;
    this.listener.setMasterVolume(m ? 0 : 1);
  }

  play(name, vol = 1, rate = 1) {
    const buf = this.assets.sounds[name];
    if (!buf || this.muted) return;
    const a = new THREE.Audio(this.listener);
    a.setBuffer(buf);
    a.setVolume(vol);
    a.setPlaybackRate(rate);
    a.play();
    a.onEnded = () => {
      a.isPlaying = false;
      const i = this._live.indexOf(a);
      if (i >= 0) this._live.splice(i, 1);
    };
    this._live.push(a);
    if (this._live.length > 12) {
      const old = this._live.shift();
      if (old.isPlaying) old.stop();
    }
  }

  startEngine() {
    if (this.engineOn) return;
    const buf = this.assets.sounds['space_engine_000'];
    if (!buf) return;
    if (!this.engine) {
      this.engine = new THREE.Audio(this.listener);
      this.engine.setBuffer(buf);
      this.engine.setLoop(true);
    }
    this.engine.setVolume(0);
    if (!this.engine.isPlaying) this.engine.play();
    this.engineOn = true;
  }

  setEngine(throttle, speedNorm) {
    if (!this.engine || !this.engineOn) return;
    this.engine.setVolume(throttle * 0.55);
    this.engine.setPlaybackRate(0.8 + speedNorm * 0.55 + throttle * 0.15);
  }

  stopEngine() {
    if (this.engine && this.engine.isPlaying) this.engine.stop();
    this.engineOn = false;
  }

  explosionBig() {
    const crunch = ['explosion_crunch_000', 'explosion_crunch_001', 'explosion_crunch_002'];
    this.play(crunch[(Math.random() * 3) | 0], 1.0, 0.95 + Math.random() * 0.1);
    this.play('low_frequency_explosion_00' + ((Math.random() * 2) | 0), 1.0, 1);
    setTimeout(() => this.play(crunch[(Math.random() * 3) | 0], 0.6, 0.85), 120);
  }

  crash() {
    const imp = ['impact_metal', 'impact_generic', 'impact_plate'];
    this.play(imp[(Math.random() * 3) | 0], 0.9, 0.95 + Math.random() * 0.1);
    this.play('explosion_crunch_001', 0.45, 1.15);
  }

  nearMiss(combo) {
    this.play('near_miss', 0.55, 1 + Math.min(0.5, combo * 0.06));
  }

  comboUp() { this.play('powerup', 0.4, 1); }
  whoosh() { this.play('whoosh', 0.7, 1); }
  click() { this.play('ui_click', 0.6, 1); }
  confirm() { this.play('ui_confirm', 0.7, 1); }
}
