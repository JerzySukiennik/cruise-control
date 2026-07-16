// Collision world: yaw-rotated boxes + spheres, hit tests, near-misses, breakables.
import * as THREE from 'three';

const _l = new THREE.Vector3();
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();

export class CollisionWorld {
  constructor() {
    this.colliders = [];
  }

  reset() { this.colliders.length = 0; }

  // center: Vector3-like, size: [w,h,d] full extents
  addBox(center, size, opts = {}) {
    const c = {
      type: 'box',
      cx: center.x !== undefined ? center.x : center[0],
      cy: center.y !== undefined ? center.y : center[1],
      cz: center.z !== undefined ? center.z : center[2],
      hx: size[0] / 2, hy: size[1] / 2, hz: size[2] / 2,
      rotY: opts.rotY || 0,
      isTarget: !!opts.isTarget,
      breakable: !!opts.breakable,
      soft: !!opts.soft,
      bouncy: !!opts.bouncy,
      mesh: opts.mesh || null,
      trick: opts.trick || 'NEAR MISS',
      noNearMiss: !!opts.noNearMiss,
      _near: false, _cool: 0
    };
    if (c.rotY) { c.cos = Math.cos(c.rotY); c.sin = Math.sin(c.rotY); }
    this.colliders.push(c);
    return c;
  }

  addSphere(center, r, opts = {}) {
    const c = {
      type: 'sphere',
      cx: center.x !== undefined ? center.x : center[0],
      cy: center.y !== undefined ? center.y : center[1],
      cz: center.z !== undefined ? center.z : center[2],
      r,
      isTarget: !!opts.isTarget,
      breakable: !!opts.breakable,
      soft: !!opts.soft,
      bouncy: !!opts.bouncy,
      mesh: opts.mesh || null,
      trick: opts.trick || 'NEAR MISS',
      noNearMiss: !!opts.noNearMiss,
      _near: false, _cool: 0
    };
    this.colliders.push(c);
    return c;
  }

  remove(c) {
    const i = this.colliders.indexOf(c);
    if (i >= 0) this.colliders.splice(i, 1);
  }

  // distance from point to collider surface (negative = inside)
  _dist(c, p) {
    let dx = p.x - c.cx, dy = p.y - c.cy, dz = p.z - c.cz;
    if (c.type === 'sphere') return Math.hypot(dx, dy, dz) - c.r;
    if (c.rotY) {
      // world -> local: rotate by -rotY around Y
      const x = dx * c.cos - dz * c.sin;
      const z = dx * c.sin + dz * c.cos;
      dx = x; dz = z;
    }
    const qx = Math.abs(dx) - c.hx, qy = Math.abs(dy) - c.hy, qz = Math.abs(dz) - c.hz;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    const outside = Math.hypot(ox, oy, oz);
    const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
    return outside + inside;
  }

  // approximate outward surface normal at p (finite differences of the SDF)
  normalAt(c, p, out) {
    const e = 0.25;
    _pa.copy(p); _pb.copy(p);
    _pa.x += e; _pb.x -= e;
    const nx = this._dist(c, _pa) - this._dist(c, _pb);
    _pa.copy(p); _pb.copy(p);
    _pa.y += e; _pb.y -= e;
    const ny = this._dist(c, _pa) - this._dist(c, _pb);
    _pa.copy(p); _pb.copy(p);
    _pa.z += e; _pb.z -= e;
    const nz = this._dist(c, _pa) - this._dist(c, _pb);
    out.set(nx, ny, nz);
    if (out.lengthSq() < 1e-8) out.set(0, 1, 0);
    else out.normalize();
    return out;
  }

  // Returns { hit, nearMisses } — hit is the first collider intersecting the
  // missile sphere, nearMisses are colliders that just cleared the near zone.
  step(pos, radius, dt, speedOk) {
    _l.copy(pos);
    let hit = null;
    const nearMisses = [];
    const nearIn = radius + 2.2;
    const nearOut = radius + 3.6;
    for (const c of this.colliders) {
      if (c._cool > 0) c._cool -= dt;
      const d = this._dist(c, _l);
      if (d <= radius) { hit = c; break; }
      if (!c.noNearMiss) {
        if (d < nearIn) {
          c._near = true;
        } else if (c._near && d > nearOut) {
          c._near = false;
          if (c._cool <= 0 && speedOk) {
            c._cool = 3;
            nearMisses.push(c);
          }
        }
      }
    }
    return { hit, nearMisses };
  }
}
