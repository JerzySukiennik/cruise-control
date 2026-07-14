// Effects: instanced voxel flame trail, debris pool, smoke puffs, camera shake, flash.
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const _e = new THREE.Euler();
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

class CubePool {
  constructor(scene, capacity, material) {
    this.cap = capacity;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, HIDE);
      this.mesh.setColorAt(i, _c.setHex(0xffffff));
    }
    this.parts = new Array(capacity).fill(null);
    this.cursor = 0;
    scene.add(this.mesh);
  }
  alloc() {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    return i;
  }
  clearAll() {
    for (let i = 0; i < this.cap; i++) {
      this.parts[i] = null;
      this.mesh.setMatrixAt(i, HIDE);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class FlameTrail {
  constructor(scene) {
    this.pool = new CubePool(scene, 130, new THREE.MeshBasicMaterial());
    this.c0 = new THREE.Color(0xfff3a0);
    this.c1 = new THREE.Color(0xff8c1a);
    this.c2 = new THREE.Color(0x6e2408);
  }
  spawn(pos, back, missileSpeed) {
    const i = this.pool.alloc();
    const life = 0.3 + Math.random() * 0.18;
    this.pool.parts[i] = {
      x: pos.x + (Math.random() - 0.5) * 0.25,
      y: pos.y + (Math.random() - 0.5) * 0.25,
      z: pos.z + (Math.random() - 0.5) * 0.25,
      vx: back.x * (2 + missileSpeed * 0.05) + (Math.random() - 0.5) * 2,
      vy: back.y * (2 + missileSpeed * 0.05) + (Math.random() - 0.5) * 2,
      vz: back.z * (2 + missileSpeed * 0.05) + (Math.random() - 0.5) * 2,
      rot: Math.random() * Math.PI,
      size: 0.5 + Math.random() * 0.3,
      life, maxLife: life
    };
  }
  update(dt) {
    const { parts, mesh } = this.pool;
    for (let i = 0; i < parts.length; i++) {
      const pt = parts[i];
      if (!pt) continue;
      pt.life -= dt;
      if (pt.life <= 0) {
        parts[i] = null;
        mesh.setMatrixAt(i, HIDE);
        continue;
      }
      pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt;
      const t = 1 - pt.life / pt.maxLife;           // 0 fresh -> 1 dead
      const sc = pt.size * (1 - t * 0.85);
      _q.setFromAxisAngle(_s.set(0.5, 0.7, 0.5).normalize(), pt.rot + t * 3);
      _m.compose(_p.set(pt.x, pt.y, pt.z), _q, _s.set(sc, sc, sc));
      mesh.setMatrixAt(i, _m);
      if (t < 0.45) _c.copy(this.c0).lerp(this.c1, t / 0.45);
      else _c.copy(this.c1).lerp(this.c2, (t - 0.45) / 0.55);
      mesh.setColorAt(i, _c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.pool.clearAll(); }
}

export class DebrisPool {
  constructor(scene, capacity = 150) {
    this.pool = new CubePool(scene, capacity, new THREE.MeshLambertMaterial());
    this.groundY = 0;
  }
  // colors: array of hex; burst of physical voxel cubes
  burst(pos, count, colors, power = 1) {
    const n = Math.min(count, this.pool.cap);
    for (let k = 0; k < n; k++) {
      const i = this.pool.alloc();
      const a = Math.random() * Math.PI * 2;
      const b = Math.random() * Math.PI - Math.PI / 2;
      const sp = (7 + Math.random() * 18) * power;
      this.pool.parts[i] = {
        x: pos.x + (Math.random() - 0.5) * 1.5,
        y: pos.y + (Math.random() - 0.5) * 1.5,
        z: pos.z + (Math.random() - 0.5) * 1.5,
        vx: Math.cos(a) * Math.cos(b) * sp,
        vy: Math.abs(Math.sin(b)) * sp * 1.1 + 4 * power,
        vz: Math.sin(a) * Math.cos(b) * sp,
        wx: (Math.random() - 0.5) * 10, wy: (Math.random() - 0.5) * 10,
        rx: Math.random() * 3, ry: Math.random() * 3,
        size: (0.35 + Math.random() * 0.75) * Math.min(1.6, power),
        color: colors[(Math.random() * colors.length) | 0],
        life: 3.2 + Math.random() * 1.6
      };
      this.pool.mesh.setColorAt(i, _c.setHex(this.pool.parts[i].color));
    }
    if (this.pool.mesh.instanceColor) this.pool.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    const { parts, mesh } = this.pool;
    for (let i = 0; i < parts.length; i++) {
      const pt = parts[i];
      if (!pt) continue;
      pt.life -= dt;
      if (pt.life <= 0) {
        parts[i] = null;
        mesh.setMatrixAt(i, HIDE);
        continue;
      }
      pt.vy -= 26 * dt;
      pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt;
      const floor = this.groundY + pt.size / 2;
      if (pt.y < floor) {
        pt.y = floor;
        if (Math.abs(pt.vy) > 2) {
          pt.vy = -pt.vy * 0.4;
          pt.vx *= 0.75; pt.vz *= 0.75;
        } else {
          pt.vy = 0; pt.vx *= 0.9; pt.vz *= 0.9; pt.wx *= 0.9; pt.wy *= 0.9;
        }
      }
      pt.rx += pt.wx * dt; pt.ry += pt.wy * dt;
      const sc = pt.life < 0.5 ? pt.size * (pt.life / 0.5) : pt.size;
      _q.setFromEuler(_e.set(pt.rx, pt.ry, 0));
      _m.compose(_p.set(pt.x, pt.y, pt.z), _q, _s.set(sc, sc, sc));
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.pool.clearAll(); }
}

export class PuffPool {
  constructor(scene) {
    this.pool = new CubePool(scene, 40, new THREE.MeshBasicMaterial());
  }
  burst(pos, count = 14) {
    for (let k = 0; k < count; k++) {
      const i = this.pool.alloc();
      const life = 0.7 + Math.random() * 0.5;
      const g = 0.45 + Math.random() * 0.3;
      this.pool.parts[i] = {
        x: pos.x + (Math.random() - 0.5) * 1.2,
        y: pos.y + (Math.random() - 0.5) * 1.2,
        z: pos.z + (Math.random() - 0.5) * 1.2,
        vx: (Math.random() - 0.5) * 7,
        vy: 2 + Math.random() * 5,
        vz: (Math.random() - 0.5) * 7,
        size: 0.7 + Math.random() * 0.9,
        life, maxLife: life
      };
      this.pool.mesh.setColorAt(i, _c.setRGB(g, g, g));
    }
    if (this.pool.mesh.instanceColor) this.pool.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    const { parts, mesh } = this.pool;
    for (let i = 0; i < parts.length; i++) {
      const pt = parts[i];
      if (!pt) continue;
      pt.life -= dt;
      if (pt.life <= 0) {
        parts[i] = null;
        mesh.setMatrixAt(i, HIDE);
        continue;
      }
      pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt;
      pt.vx *= 0.96; pt.vy *= 0.96; pt.vz *= 0.96;
      const t = 1 - pt.life / pt.maxLife;
      const sc = pt.size * (1 + t * 1.6) * (t > 0.7 ? (1 - t) / 0.3 : 1);
      _q.identity();
      _m.compose(_p.set(pt.x, pt.y, pt.z), _q, _s.set(sc, sc, sc));
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.pool.clearAll(); }
}

export class Shake {
  constructor() { this.trauma = 0; this.t = 0; }
  add(x) { this.trauma = Math.min(1.4, this.trauma + x); }
  update(dt) {
    this.trauma = Math.max(0, this.trauma - dt * 1.1);
    this.t += dt * 40;
  }
  apply(camera) {
    if (this.trauma <= 0) return;
    const s = this.trauma * this.trauma;
    camera.position.x += Math.sin(this.t * 1.1) * s * 0.9;
    camera.position.y += Math.cos(this.t * 1.7) * s * 0.9;
    camera.rotation.z += Math.sin(this.t * 2.3) * s * 0.03;
  }
  reset() { this.trauma = 0; }
}

export class Flash {
  constructor() { this.el = document.getElementById('flash'); this.v = 0; }
  hit(strength = 1) { this.v = Math.min(1, strength); }
  update(dt) {
    if (this.v <= 0) return;
    this.v = Math.max(0, this.v - dt * 2.2);
    this.el.style.opacity = (this.v * 0.9).toFixed(3);
  }
  reset() { this.v = 0; this.el.style.opacity = '0'; }
}
