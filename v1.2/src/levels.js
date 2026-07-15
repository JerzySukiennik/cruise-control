// Level data + builders: walls with holes, rings, furniture, city, pipes, boss factory.
import * as THREE from 'three';

const _v = new THREE.Vector3();

// ---------- shared helpers ----------

function gm(ctx, tex, color, a, b) {
  return ctx.assets.gridMaterial(tex, color, Math.max(1, a / 2.5), Math.max(1, b / 2.5));
}

// Box mesh + collider. Thin boxes (min extent <= 3) are breakable by default
// (kamikaze dash smashes them) unless opts.breakable === false.
function box(ctx, pos, size, mat, opts = {}) {
  const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(pos[0], pos[1], pos[2]);
  if (opts.rotY) mesh.rotation.y = opts.rotY;
  ctx.group.add(mesh);
  let col = null;
  if (opts.collide !== false) {
    const thin = Math.min(size[0], size[1], size[2]) <= 3;
    const breakable = opts.breakable !== undefined
      ? !!opts.breakable
      : (thin && !opts.isTarget);
    col = ctx.world.addBox(pos, size, {
      rotY: opts.rotY || 0,
      isTarget: !!opts.isTarget,
      breakable,
      soft: !!opts.soft,
      bouncy: !!opts.bouncy,
      mesh,
      trick: opts.trick,
      noNearMiss: !!opts.noNearMiss
    });
  }
  if (opts.targetMesh) ctx.target.meshes.push(mesh);
  return mesh;
}

function scorchMat(ctx) {
  const key = 'scorchDecal';
  if (ctx.assets.matCache.has(key)) return ctx.assets.matCache.get(key);
  const m = new THREE.MeshBasicMaterial({
    map: ctx.assets.textures.scorch || null,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    color: 0x111111
  });
  ctx.assets.matCache.set(key, m);
  return m;
}

function scorchDecal(ctx, pos, normal, r) {
  const geo = new THREE.PlaneGeometry(r * 3.4, r * 3.4);
  const mesh = new THREE.Mesh(geo, scorchMat(ctx));
  mesh.position.set(pos[0], pos[1], pos[2]);
  _v.set(pos[0] + normal[0], pos[1] + normal[1], pos[2] + normal[2]);
  mesh.lookAt(_v);
  ctx.group.add(mesh);
}

function addGate(ctx, pos, normal, r, name = 'THREAD THE NEEDLE', score = 200) {
  ctx.gates.push({
    cx: pos[0], cy: pos[1], cz: pos[2],
    nx: normal[0], ny: normal[1], nz: normal[2],
    r, name, score, cool: 0
  });
}

// Wall with a square opening (scorch-ringed). hx/hy relative to wall center.
// Segments are thin boxes → breakable by kamikaze dash unless o.breakable === false.
function wallHole(ctx, o) {
  const { pos, w, h, t, hr } = o;
  const hx = o.hx || 0, hy = o.hy || 0;
  const rotY = o.rotY || 0;
  const mat = o.mat;
  const cos = Math.cos(rotY), sin = Math.sin(rotY);
  const place = (lx, ly, sw, sh) => {
    if (sw < 0.05 || sh < 0.05) return;
    const wx = pos[0] + lx * cos;
    const wz = pos[2] - lx * sin;
    box(ctx, [wx, pos[1] + ly, wz], [sw, sh, t], mat,
      { rotY, noNearMiss: o.noNearMiss, breakable: o.breakable });
  };
  const lw = (hx - hr) + w / 2;
  const rw = w / 2 - (hx + hr);
  const bh = (hy - hr) + h / 2;
  const th = h / 2 - (hy + hr);
  place(-w / 2 + lw / 2, 0, lw, h);
  place(w / 2 - rw / 2, 0, rw, h);
  place(hx, -h / 2 + bh / 2, 2 * hr, bh);
  place(hx, h / 2 - th / 2, 2 * hr, th);
  const gx = pos[0] + hx * cos, gy = pos[1] + hy, gz = pos[2] - hx * sin;
  const n = [sin, 0, cos];
  if (o.scorch !== false) {
    scorchDecal(ctx, [gx + n[0] * (t / 2 + 0.2), gy, gz + n[2] * (t / 2 + 0.2)], n, hr);
    scorchDecal(ctx, [gx - n[0] * (t / 2 + 0.2), gy, gz - n[2] * (t / 2 + 0.2)], [-n[0], 0, -n[2]], hr);
  }
  if (o.gate !== false) addGate(ctx, [gx, gy, gz], n, hr * 1.15);
}

function ring(ctx, o) {
  const r = o.r;
  const geo = new THREE.TorusGeometry(r, 0.55, 8, 20);
  const mesh = new THREE.Mesh(geo, ctx.assets.plainMaterial(o.color || 0x3a3f4a));
  mesh.position.set(o.pos[0], o.pos[1], o.pos[2]);
  if (o.rotY) mesh.rotation.y = o.rotY;
  ctx.group.add(mesh);
  const cos = Math.cos(o.rotY || 0), sin = Math.sin(o.rotY || 0);
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2;
    const lx = Math.cos(a) * r, ly = Math.sin(a) * r;
    ctx.world.addSphere(
      [o.pos[0] + lx * cos, o.pos[1] + ly, o.pos[2] - lx * sin],
      0.85, { noNearMiss: true }
    );
  }
  addGate(ctx, o.pos, [sin, 0, cos], r - 0.9, 'THREAD THE NEEDLE', 200);
}

// Kenney OBJ model with approximated colliders.
function model(ctx, o) {
  let obj = ctx.assets.getModel(o.name);
  if (!obj) {
    obj = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ctx.assets.plainMaterial(0x888888));
    obj.userData.noDispose = false;
  }
  const s = o.scale || 1;
  obj.scale.setScalar(s);
  obj.rotation.y = o.rotY || 0;
  obj.position.set(o.pos[0], o.pos[1], o.pos[2]);
  if (o.tint) {
    obj.traverse(c => {
      if (c.isMesh) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        const nm = mats.map(m => {
          const col = m.color;
          const sat = Math.max(col.r, col.g, col.b) - Math.min(col.r, col.g, col.b);
          if (sat > 0.18) {
            const cl = m.clone();
            cl.color.set(o.tint);
            return cl;
          }
          return m;
        });
        c.material = Array.isArray(c.material) ? nm : nm[0];
      }
    });
  }
  ctx.group.add(obj);
  obj.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(obj);
  const size = bb.getSize(new THREE.Vector3());
  const center = bb.getCenter(new THREE.Vector3());
  const mode = o.collider || 'box';
  const opts = { trick: o.trick || 'FLYBY', isTarget: !!o.isTarget, noNearMiss: !!o.noNearMiss };
  if (mode === 'box') {
    ctx.world.addBox(center, [size.x, size.y, size.z], opts);
  } else if (mode === 'sphere') {
    ctx.world.addSphere(center, Math.max(size.x, size.z) * 0.38, opts);
  } else if (mode === 'table') {
    const slabH = size.y * 0.2;
    ctx.world.addBox([center.x, bb.max.y - slabH / 2, center.z], [size.x, slabH, size.z], opts);
    const lw = size.x * 0.14, ld = size.z * 0.14, lh = size.y - slabH;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      ctx.world.addBox(
        [center.x + sx * (size.x / 2 - lw / 2), bb.min.y + lh / 2, center.z + sz * (size.z / 2 - ld / 2)],
        [lw, lh, ld], opts
      );
    }
    addGate(ctx, [center.x, bb.min.y + lh * 0.45, center.z], [0, 0, 1], Math.min(size.x, lh) * 0.5, 'THREAD THE NEEDLE', 200);
  }
  if (o.targetMesh) ctx.target.meshes.push(obj);
  return obj;
}

function textSprite(ctx, text, pos, scale = 1, color = '#ffffff') {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d');
  g.font = '900 84px -apple-system, "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 14; g.strokeStyle = '#14141f';
  g.strokeText(text, 256, 68);
  g.fillStyle = color;
  g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sp.position.set(pos[0], pos[1], pos[2]);
  sp.scale.set(16 * scale, 4 * scale, 1);
  ctx.group.add(sp);
  return sp;
}

function corridor(ctx, o) {
  // side walls + ceiling for indoor levels (structural — never breakable)
  const { x, y, z0, z1, mat, ceilMat } = o;
  const len = z1 - z0, zc = (z0 + z1) / 2;
  box(ctx, [-x, y / 2, zc], [1.5, y, len], mat, { noNearMiss: true, breakable: false });
  box(ctx, [x, y / 2, zc], [1.5, y, len], mat, { noNearMiss: true, breakable: false });
  box(ctx, [0, y + 0.75, zc], [x * 2 + 1.5, 1.5, len], ceilMat || mat, { noNearMiss: true, breakable: false });
}

function launcherStand(ctx, pos) {
  box(ctx, [pos[0], pos[1] / 2, pos[2]], [2.2, pos[1], 2.2],
    ctx.assets.gridMaterial('gridDark', 0xffffff, 1, 2), { noNearMiss: true, breakable: false });
}

function proceduralCharacter(ctx, pos, scale) {
  const g = new THREE.Group();
  const skin = ctx.assets.plainMaterial(0xf0c8a0);
  const shirt = ctx.assets.plainMaterial(0x4a7dd6);
  const pants = ctx.assets.plainMaterial(0x33395a);
  const mk = (p, s, m) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), m);
    mesh.position.set(p[0], p[1], p[2]);
    g.add(mesh);
    return mesh;
  };
  mk([-0.25, 0.5, 0], [0.4, 1, 0.4], pants);
  mk([0.25, 0.5, 0], [0.4, 1, 0.4], pants);
  mk([0, 1.55, 0], [1, 1.1, 0.55], shirt);
  mk([0, 2.6, 0], [0.85, 0.85, 0.85], skin);
  mk([-0.7, 1.6, 0], [0.32, 1, 0.32], shirt).rotation.z = 0.25;
  const wave = mk([0.75, 2.0, 0], [0.32, 1, 0.32], shirt);
  wave.rotation.z = -2.6;
  ctx.dynamic.push(t => { wave.rotation.z = -2.6 + Math.sin(t * 6) * 0.35; });
  g.scale.setScalar(scale);
  g.position.set(pos[0], pos[1], pos[2]);
  ctx.group.add(g);
  return g;
}

// Boss character target on a spot: procedural fallback + lazy FBX swap-in.
function bossTarget(ctx, pos) {
  const fallback = proceduralCharacter(ctx, [pos[0], pos[1], pos[2]], 1.8);
  ctx.target.meshes.push(fallback);
  ctx.world.addBox([pos[0], pos[1] + 3.6, pos[2]], [4.5, 7.2, 4.5], { isTarget: true });
  ctx.target.pos = [pos[0], pos[1] + 3.5, pos[2]];
  ctx.assets.loadCharacter().then(fbx => {
    if (ctx.disposed || !fbx) return;
    const ch = fbx; // reuse cached instance (SkinnedMesh-safe, single use)
    ch.traverse(c => { if (c.isMesh) c.frustumCulled = false; });
    ch.scale.setScalar(1);
    ch.position.set(0, 0, 0);
    ch.rotation.set(0, 0, 0);
    ch.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(ch);
    const h = bb.max.y - bb.min.y || 1;
    const s = 7 / h;
    ch.scale.setScalar(s);
    ch.position.set(pos[0], pos[1] - bb.min.y * s, pos[2]);
    ctx.group.add(ch);
    ctx.group.remove(fallback);
    const i = ctx.target.meshes.indexOf(fallback);
    if (i >= 0) ctx.target.meshes[i] = ch;
  });
}

// Horizontal pipe across the course (never breakable).
function pipeAcross(ctx, y, z, r, w, mat) {
  const geo = new THREE.CylinderGeometry(r, r, w, 12);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.z = Math.PI / 2;
  mesh.position.set(0, y, z);
  ctx.group.add(mesh);
  ctx.world.addBox([0, y, z], [w, r * 2, r * 2], { breakable: false });
}

// White/grey block tower target (fun to obliterate).
function blockTowerTarget(ctx, z) {
  const white = ctx.assets.plainMaterial(0xf0f0f2);
  const grey = ctx.assets.plainMaterial(0xc7c7cf);
  for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
    box(ctx, [(c - 1) * 1.7, 0.85 + r * 1.7, z], [1.6, 1.6, 1.6],
      (r + c) % 2 ? white : grey, { collide: false, targetMesh: true });
  }
  ctx.world.addBox([0, 4.3, z], [5.2, 8.6, 2.2], { isTarget: true });
  ctx.target.pos = [0, 4.3, z];
}

// Exported for the playground scene builder.
export const HELPERS = {
  gm, box, ring, wallHole, model, textSprite, addGate, corridor,
  launcherStand, scorchDecal, pipeAcross
};

// ---------- shared envs ----------

const ENV_MEADOW = {
  bg: 0x142f38, fogNear: 90, fogFar: 460, hemiSky: 0xbfd8e8, hemiGround: 0x3a5c3a, hemiInt: 0.95,
  sun: 0.75, groundTex: 'gridGreen', groundColor: 0xffffff, groundSize: 1400, groundRepeat: 340, groundY: 0
};

// ---------- levels (15, ordered by difficulty) ----------

export const LEVELS = [
  {
    id: 0, name: 'LAUNCH PAD', par: 26,
    hint: 'HOLD THRUST TO LAUNCH — STEER THROUGH THE RINGS',
    env: ENV_MEADOW,
    spawn: { pos: [0, 3.4, -20], dir: [0, 1, 0], up: [0, 0, 1] },
    flight: { maxSpeed: 45, turnRate: 1.6 },
    targetColors: [0xd8cfc0, 0x8a8378, 0xffffff, 0xb8552f],
    build(ctx) {
      box(ctx, [0, 0.9, -20], [7, 1.8, 7], gm(ctx, 'gridDark', 0xffffff, 7, 7), { noNearMiss: true, breakable: false });
      launcherStand(ctx, [0, 1.8, -20]);
      ring(ctx, { pos: [0, 26, 30], r: 4.5 });
      ring(ctx, { pos: [9, 19, 75], r: 4 });
      ring(ctx, { pos: [-7, 11, 120], r: 4 });
      // scenery
      model(ctx, { name: 'tree_default', pos: [-22, 0, 40], scale: 9, collider: 'sphere' });
      model(ctx, { name: 'tree_pineTallA', pos: [20, 0, 90], scale: 10, collider: 'sphere' });
      model(ctx, { name: 'tree_small', pos: [-18, 0, 140], scale: 9, collider: 'sphere' });
      model(ctx, { name: 'tree_cone', pos: [16, 0, 150], scale: 9, collider: 'sphere' });
      box(ctx, [-30, 3, 100], [8, 6, 8], gm(ctx, 'gridLight2', 0xd0cabd, 8, 6));
      // target shed
      box(ctx, [0, 3, 176], [9, 6, 9], gm(ctx, 'gridLight', 0xd8cfc0, 9, 6), { isTarget: true, targetMesh: true });
      const roof = box(ctx, [0, 7.2, 176], [7.4, 3.4, 9.6], gm(ctx, 'gridRed', 0xb8552f, 8, 4), { isTarget: true, targetMesh: true });
      roof.rotation.z = Math.PI / 4;
      ctx.target.pos = [0, 4, 176];
    }
  },
  {
    id: 1, name: 'RING CANYON', par: 30,
    hint: 'SLALOM THE RINGS BETWEEN THE MESAS',
    env: {
      bg: 0x16303a, fogNear: 100, fogFar: 480, hemiSky: 0xbfd8e8, hemiGround: 0x3a5c3a, hemiInt: 0.95,
      sun: 0.8, groundTex: 'gridGreen', groundColor: 0xffffff, groundSize: 1400, groundRepeat: 340, groundY: 0
    },
    spawn: { pos: [0, 5, -20], dir: [0, 0.1, 1] },
    flight: { maxSpeed: 46, turnRate: 1.6 },
    targetColors: [0xffffff, 0xd0d0d6, 0x8899aa, 0xff8c1a],
    build(ctx) {
      launcherStand(ctx, [0, 3.2, -20]);
      // canyon mesas
      const mesa = gm(ctx, 'gridRed', 0xcf9070, 14, 26);
      const hs = [24, 28, 22, 30, 26, 24];
      for (let i = 0; i < 6; i++) {
        const z = 15 + i * 30;
        box(ctx, [-25, hs[i] / 2, z], [14, hs[i], 18], mesa, { noNearMiss: true, breakable: false });
        box(ctx, [25, hs[(i + 3) % 6] / 2, z + 15], [14, hs[(i + 3) % 6], 18], mesa, { noNearMiss: true, breakable: false });
      }
      ring(ctx, { pos: [-6, 11, 30], r: 5 });
      ring(ctx, { pos: [6, 14, 60], r: 4.8 });
      ring(ctx, { pos: [-7, 9, 90], r: 4.6 });
      ring(ctx, { pos: [7, 15, 120], r: 4.6 });
      ring(ctx, { pos: [0, 11, 150], r: 4.6 });
      model(ctx, { name: 'tree_default', pos: [-14, 0, 175], scale: 9, collider: 'sphere' });
      model(ctx, { name: 'tree_cone', pos: [13, 0, 182], scale: 9, collider: 'sphere' });
      // target van
      model(ctx, {
        name: 'van', pos: [0, 0, 205], scale: 9, rotY: Math.PI / 2,
        collider: 'box', isTarget: true, targetMesh: true
      });
      ctx.target.pos = [0, 2.5, 205];
    }
  },
  {
    id: 2, name: 'SALMON MAZE', par: 40,
    hint: 'PULSE THE THRUST — FUEL IS SCORED',
    env: {
      bg: 0x0d0d18, fogNear: 40, fogFar: 260, hemiSky: 0xc4c8e0, hemiGround: 0x4a4058, hemiInt: 1.35,
      sun: 0.9, groundTex: 'gridDark', groundColor: 0xffffff, groundSize: 900, groundRepeat: 220, groundY: 0
    },
    spawn: { pos: [0, 5, -14], dir: [0, 0, 1] },
    flight: { maxSpeed: 32, turnRate: 1.9 },
    targetColors: [0xffffff, 0xd9d9de, 0xa8a8b2],
    build(ctx) {
      const salmon = gm(ctx, 'gridLight', 0xef8168, 36, 26);
      const salmonDark = gm(ctx, 'gridLight2', 0xb86050, 26, 26);
      launcherStand(ctx, [0, 3.2, -14]);
      corridor(ctx, { x: 18, y: 34, z0: -22, z1: 172, mat: salmonDark, ceilMat: gm(ctx, 'gridDark2', 0x6a6a78, 36, 190) });
      wallHole(ctx, { pos: [0, 13, 20], w: 36, h: 26, t: 2, hx: 0, hy: -7, hr: 4.8, mat: salmon });
      wallHole(ctx, { pos: [0, 13, 50], w: 36, h: 26, t: 2, hx: -7, hy: -6, hr: 4.8, mat: salmon });
      wallHole(ctx, { pos: [0, 13, 80], w: 36, h: 26, t: 2, hx: 7, hy: -3, hr: 4.8, mat: salmon });
      // clock tower wall: 3 stacked holes at x=0 (y=5,12,19), pick one
      {
        const t = 2.5, z = 110, hw = 4.2;
        const side = gm(ctx, 'gridLight', 0xef8168, 15, 26);
        box(ctx, [-(hw + (18 - hw) / 2), 13, z], [18 - hw, 26, t], side);
        box(ctx, [hw + (18 - hw) / 2, 13, z], [18 - hw, 26, t], side);
        const seg = gm(ctx, 'gridLight2', 0xcc7060, 6, 5);
        box(ctx, [0, 1.1, z], [2 * hw, 2.2, t], seg);
        box(ctx, [0, 8.5, z], [2 * hw, 1.4, t], seg);
        box(ctx, [0, 15.5, z], [2 * hw, 1.4, t], seg);
        box(ctx, [0, 23.9, z], [2 * hw, 4.2, t], seg);
        for (const hy of [5, 12, 19]) {
          scorchDecal(ctx, [0, hy, z - t / 2 - 0.2], [0, 0, -1], 2.6);
          scorchDecal(ctx, [0, hy, z + t / 2 + 0.2], [0, 0, 1], 2.6);
          addGate(ctx, [0, hy, z], [0, 0, 1], 4.0);
        }
      }
      wallHole(ctx, { pos: [0, 13, 140], w: 36, h: 26, t: 2, hx: 0, hy: -6, hr: 5.0, mat: salmon });
      // end wall + block tower target
      box(ctx, [0, 17, 171], [36, 34, 2], salmon, { noNearMiss: true, breakable: false });
      blockTowerTarget(ctx, 158);
    }
  },
  {
    id: 3, name: 'FURNITURE ROOM', par: 40,
    hint: 'GIANT FURNITURE — WEAVE UNDER AND HIT THE CAR',
    env: {
      bg: 0x0a0a14, fogNear: 50, fogFar: 320, hemiSky: 0xaab4dc, hemiGround: 0x2e2a44, hemiInt: 1.1,
      sun: 0.85, groundTex: 'gridDark2', groundColor: 0xffffff, groundSize: 900, groundRepeat: 220, groundY: 0
    },
    spawn: { pos: [0, 5, -20], dir: [0, 0, 1] },
    flight: { maxSpeed: 32, turnRate: 1.9 },
    targetColors: [0xffffff, 0xd0d0d6, 0x333340, 0x8899aa],
    build(ctx) {
      const wallMat = gm(ctx, 'gridDark', 0x8f8fa0, 60, 40);
      launcherStand(ctx, [0, 3.2, -20]);
      corridor(ctx, { x: 30, y: 40, z0: -26, z1: 216, mat: wallMat });
      box(ctx, [0, 20, -25], [60, 40, 2], wallMat, { noNearMiss: true, breakable: false });
      box(ctx, [0, 20, 215], [60, 40, 2], wallMat, { noNearMiss: true, breakable: false });
      model(ctx, { name: 'table', pos: [0, 0, 28], scale: 13, collider: 'table' });
      model(ctx, { name: 'chair', pos: [-8, 0, 58], scale: 11, rotY: 0.5, collider: 'box' });
      model(ctx, { name: 'chairRounded', pos: [8, 0, 66], scale: 11, rotY: -2.2, collider: 'box' });
      model(ctx, { name: 'bench', pos: [0, 0, 88], scale: 11, rotY: Math.PI / 2, collider: 'box' });
      model(ctx, { name: 'bookcaseClosedWide', pos: [-13, 0, 108], scale: 13, collider: 'box' });
      model(ctx, { name: 'bookcaseClosedWide', pos: [13, 0, 108], scale: 13, collider: 'box' });
      addGate(ctx, [0, 6, 108], [0, 0, 1], 4.5);
      model(ctx, { name: 'desk', pos: [8, 0, 134], scale: 12, rotY: Math.PI, collider: 'box' });
      model(ctx, { name: 'lampSquareTable', pos: [-10, 0, 138], scale: 12, collider: 'box' });
      model(ctx, { name: 'cabinetTelevision', pos: [12, 0, 162], scale: 12, rotY: -0.4, collider: 'box' });
      model(ctx, { name: 'loungeChairRelax', pos: [-7, 0, 172], scale: 11, rotY: 0.9, collider: 'box' });
      model(ctx, { name: 'sideTable', pos: [2, 0, 150], scale: 11, collider: 'table' });
      model(ctx, {
        name: 'sedan', pos: [0, 0, 196], scale: 9, rotY: Math.PI / 2,
        collider: 'box', isTarget: true, targetMesh: true, tint: 0xffffff
      });
      ctx.target.pos = [0, 2.5, 196];
    }
  },
  {
    id: 4, name: 'GLASS CHICANE', par: 34,
    hint: 'THIN WALLS SHATTER — PRESS K TO SMASH THROUGH',
    env: {
      bg: 0x0c1a22, fogNear: 50, fogFar: 300, hemiSky: 0xa8d4d8, hemiGround: 0x28444a, hemiInt: 1.2,
      sun: 0.85, groundTex: 'gridDark2', groundColor: 0xffffff, groundSize: 900, groundRepeat: 220, groundY: 0
    },
    spawn: { pos: [0, 5, -18], dir: [0, 0, 1] },
    flight: { maxSpeed: 34, turnRate: 1.9 },
    targetColors: [0xffffff, 0x37c8c3, 0xd9d9de],
    build(ctx) {
      const glass = gm(ctx, 'gridLight', 0x64c8c4, 40, 28);
      const wallMat = gm(ctx, 'gridDark2', 0x3a5a5e, 40, 28);
      launcherStand(ctx, [0, 3.2, -18]);
      corridor(ctx, { x: 20, y: 28, z0: -24, z1: 150, mat: wallMat });
      box(ctx, [0, 14, 149], [42, 28, 2], wallMat, { noNearMiss: true, breakable: false });
      wallHole(ctx, { pos: [0, 14, 15], w: 40, h: 28, t: 1, hx: -7, hy: -7, hr: 5.0, mat: glass });
      wallHole(ctx, { pos: [0, 14, 45], w: 40, h: 28, t: 1, hx: 7, hy: -5, hr: 5.0, mat: glass });
      // near-solid pane: squeeze through the right edge gap or kamikaze through
      box(ctx, [-4, 14, 75], [32, 28, 1], glass);
      addGate(ctx, [16, 8, 75], [0, 0, 1], 3.2, 'EDGE SQUEEZE', 250);
      scorchDecal(ctx, [0, 12, 74.2], [0, 0, -1], 4);
      wallHole(ctx, { pos: [0, 14, 105], w: 40, h: 28, t: 1, hx: 0, hy: -6, hr: 4.8, mat: glass });
      textSprite(ctx, 'SMASH', [0, 22, 75], 1.1, '#37c8c3');
      blockTowerTarget(ctx, 135);
    }
  },
  {
    id: 5, name: 'ORCHARD STRAFE', par: 34,
    hint: 'STAY LOW BETWEEN THE TREES — HIT THE BARN',
    env: {
      bg: 0x143528, fogNear: 90, fogFar: 440, hemiSky: 0xcfe8c8, hemiGround: 0x2e5c3a, hemiInt: 1.0,
      sun: 0.85, groundTex: 'gridGreen', groundColor: 0xffffff, groundSize: 1400, groundRepeat: 340, groundY: 0
    },
    spawn: { pos: [0, 5, -22], dir: [0, 0.08, 1] },
    flight: { maxSpeed: 46, turnRate: 1.6 },
    targetColors: [0xd8cfc0, 0xb8552f, 0xffffff, 0x8a8378],
    build(ctx) {
      launcherStand(ctx, [0, 3.2, -22]);
      const trees = ['tree_default', 'tree_small', 'tree_pineTallA', 'tree_cone'];
      // rows of trees with a wandering lane
      const lanes = [0, 1, 1, 2, 2, 1, 0, 0, 1, 2, 1]; // lane index per row (0=left,1=mid,2=right)
      const laneX = [-18, 0, 18];
      for (let r = 0; r < 11; r++) {
        const z = 20 + r * 20;
        for (let c = 0; c < 4; c++) {
          const x = -27 + c * 18;
          // keep the lane gap open (skip trees near the lane center)
          if (Math.abs(x - laneX[lanes[r]]) < 10) continue;
          model(ctx, {
            name: trees[(r + c) % 4], pos: [x + ((r * 7 + c * 3) % 5) - 2, 0, z],
            scale: 8 + ((r + c) % 3) * 1.5, collider: 'sphere'
          });
        }
      }
      addGate(ctx, [laneX[lanes[2]], 6, 60], [0, 0, 1], 6, 'TREE LINE', 150);
      addGate(ctx, [laneX[lanes[5]], 6, 120], [0, 0, 1], 6, 'TREE LINE', 150);
      addGate(ctx, [laneX[lanes[8]], 6, 180], [0, 0, 1], 6, 'TREE LINE', 150);
      // target barn
      box(ctx, [0, 4, 260], [14, 8, 12], gm(ctx, 'gridLight', 0xd8cfc0, 14, 8), { isTarget: true, targetMesh: true });
      const roof = box(ctx, [0, 9.6, 260], [11, 4.4, 12.6], gm(ctx, 'gridRed', 0xb8552f, 11, 5), { isTarget: true, targetMesh: true });
      roof.rotation.z = Math.PI / 4;
      ctx.target.pos = [0, 5, 260];
    }
  },
  {
    id: 6, name: 'CITY RUN', par: 55,
    hint: 'FULL SEND — FINISH WITH A DIVE INTO THE ROOF',
    env: {
      bg: 0x102e36, fogNear: 110, fogFar: 560, hemiSky: 0xaed4dd, hemiGround: 0x2e4a30, hemiInt: 1.0,
      sun: 0.8, groundTex: 'gridGreen', groundColor: 0xffffff, groundSize: 1600, groundRepeat: 400, groundY: 0
    },
    spawn: { pos: [0, 6, -34], dir: [0, 0.18, 1] },
    flight: { maxSpeed: 48, turnRate: 1.5 },
    targetColors: [0x9aa7c0, 0x6a7590, 0xffffff, 0xff8c1a],
    build(ctx) {
      launcherStand(ctx, [0, 4.2, -34]);
      const trees = ['tree_default', 'tree_small', 'tree_pineTallA', 'tree_cone'];
      const spots = [
        [-24, 5], [18, 18], [-15, 35], [26, 42], [-28, 70], [30, 85], [-20, 130],
        [24, 128], [-30, 165], [28, 170], [-16, 215], [20, 258], [-26, 260], [34, 220]
      ];
      spots.forEach((s, i) => model(ctx, {
        name: trees[i % 4], pos: [s[0], 0, s[1]], scale: 8 + (i % 3) * 2, collider: 'sphere'
      }));
      // aqueduct
      {
        const z = 60, mat = gm(ctx, 'gridLight', 0xcfc5b4, 4, 18);
        for (const x of [-32, -16, 0, 16, 32]) box(ctx, [x, 9, z], [4, 18, 4], mat);
        box(ctx, [0, 20.5, z], [84, 5, 6], gm(ctx, 'gridLight2', 0xbfb5a4, 84, 5));
        for (const x of [-24, -8, 8, 24]) addGate(ctx, [x, 9, z], [0, 0, 1], 5.5, 'THREAD THE NEEDLE', 150);
        scorchDecal(ctx, [8, 4, z + 3.3], [0, 0, 1], 4);
      }
      // pylons + wires
      {
        const mat = gm(ctx, 'gridOrange', 0xffffff, 3, 26);
        const tops = [];
        for (const z of [105, 150]) for (const x of [-13, 13]) {
          box(ctx, [x, 13, z], [2.6, 26, 2.6], mat);
          box(ctx, [x, 24.4, z], [10, 1.8, 1.8], mat);
          tops.push([x, 24.4, z]);
        }
        const wm = new THREE.LineBasicMaterial({ color: 0x222630 });
        for (const pair of [[0, 2], [1, 3]]) {
          const a = tops[pair[0]], b = tops[pair[1]];
          for (const off of [-4, 4]) {
            const geo = new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(a[0] + off, a[1], a[2]),
              new THREE.Vector3((a[0] + b[0]) / 2 + off, a[1] - 3.5, (a[2] + b[2]) / 2),
              new THREE.Vector3(b[0] + off, b[1], b[2])
            ]);
            ctx.group.add(new THREE.Line(geo, wm));
          }
        }
        addGate(ctx, [0, 14, 127], [0, 0, 1], 9, 'FLYBY', 100);
      }
      // red brick slalom
      {
        const b = (p, s) => box(ctx, p, s, gm(ctx, 'gridRed', 0xffffff, s[0], s[1]));
        b([-15, 8, 195], [13, 16, 13]);
        b([13, 11, 208], [11, 22, 11]);
        b([-9, 6, 232], [15, 12, 15]);
        b([11, 9, 248], [12, 18, 12]);
        b([-18, 13, 258], [10, 26, 10]);
      }
      // skyscraper + roof target
      box(ctx, [0, 35, 305], [18, 70, 18], gm(ctx, 'gridDark2', 0x9aa7c0, 18, 70), { noNearMiss: true, breakable: false });
      box(ctx, [0, 71, 305], [18, 2, 18], gm(ctx, 'gridDark', 0x666f85, 18, 18), { isTarget: true, targetMesh: true });
      const frameMat = gm(ctx, 'gridOrange', 0xffffff, 18, 1);
      for (const s of [[-8.2, 0], [8.2, 0], [0, -8.2], [0, 8.2]]) {
        box(ctx, [s[0], 72.4, 305 + s[1]], s[1] === 0 ? [1.6, 0.8, 18] : [18, 0.8, 1.6],
          frameMat, { collide: false, targetMesh: true });
      }
      scorchDecal(ctx, [0, 72.3, 305], [0, 1, 0], 5);
      ctx.target.pos = [0, 71, 305];
    }
  },
  {
    id: 7, name: 'DOUBLE DECK', par: 42,
    hint: 'RIDE THE TOP DECK — THEN DIVE TO THE BOTTOM',
    env: {
      bg: 0x0b1020, fogNear: 46, fogFar: 300, hemiSky: 0xaab8e0, hemiGround: 0x2a3050, hemiInt: 1.15,
      sun: 0.85, groundTex: 'gridDark', groundColor: 0xffffff, groundSize: 900, groundRepeat: 220, groundY: 0
    },
    spawn: { pos: [0, 22, -12], dir: [0, 0, 1] },
    flight: { maxSpeed: 32, turnRate: 1.9 },
    targetColors: [0xffffff, 0x6fd3ff, 0x333340],
    build(ctx) {
      const wallMat = gm(ctx, 'gridDark2', 0x506080, 32, 30);
      const deckMat = gm(ctx, 'gridLight2', 0x8090b0, 31, 95);
      corridor(ctx, { x: 16, y: 30, z0: -20, z1: 180, mat: wallMat });
      box(ctx, [0, 15, -19], [33, 30, 2], wallMat, { noNearMiss: true, breakable: false });
      box(ctx, [0, 15, 179], [33, 30, 2], wallMat, { noNearMiss: true, breakable: false });
      // mid slab: upper deck floor from z -20 to 75 (thin → kamikaze can punch through)
      box(ctx, [0, 14, 27.5], [31, 1.5, 95], deckMat, { noNearMiss: true });
      // upper deck walls
      wallHole(ctx, { pos: [0, 22.5, 20], w: 31, h: 15, t: 2, hx: -5, hy: 0, hr: 4.4, mat: gm(ctx, 'gridLight', 0x7fa8d0, 31, 15) });
      wallHole(ctx, { pos: [0, 22.5, 50], w: 31, h: 15, t: 2, hx: 5, hy: 0, hr: 4.4, mat: gm(ctx, 'gridLight', 0x7fa8d0, 31, 15) });
      // upper deck dead-end at z 85 → dive down between 75 and 85
      box(ctx, [0, 22.5, 85], [31, 15, 2], gm(ctx, 'gridOrange', 0xcc7722, 31, 15));
      textSprite(ctx, 'DIVE', [0, 20, 72], 1, '#6fd3ff');
      addGate(ctx, [0, 12, 80], [0, 0, 1], 6, 'DECK DIVE', 250);
      // lower deck
      const colMat = gm(ctx, 'gridOrange', 0xffffff, 4, 14);
      box(ctx, [-5.5, 7, 105], [4, 14, 4], colMat);
      box(ctx, [5.5, 7, 105], [4, 14, 4], colMat);
      wallHole(ctx, { pos: [0, 7, 130], w: 31, h: 14, t: 2, hx: 0, hy: 0, hr: 4.4, mat: gm(ctx, 'gridLight', 0x7fa8d0, 31, 14) });
      model(ctx, {
        name: 'sedanSports', pos: [0, 0, 163], scale: 9, rotY: Math.PI / 2,
        collider: 'box', isTarget: true, targetMesh: true, tint: 0x37c8c3
      });
      ctx.target.pos = [0, 2.5, 163];
    }
  },
  {
    id: 8, name: 'WAREHOUSE', par: 44,
    hint: 'SHELF GAUNTLET — DELIVER IT TO THE TAXI',
    env: {
      bg: 0x0a0a14, fogNear: 50, fogFar: 340, hemiSky: 0xaab4dc, hemiGround: 0x2e2a44, hemiInt: 1.1,
      sun: 0.85, groundTex: 'gridDark2', groundColor: 0xffffff, groundSize: 900, groundRepeat: 220, groundY: 0
    },
    spawn: { pos: [0, 5, -22], dir: [0, 0, 1] },
    flight: { maxSpeed: 33, turnRate: 1.9 },
    targetColors: [0xffd23f, 0xffffff, 0x333340, 0xff8c1a],
    build(ctx) {
      const wallMat = gm(ctx, 'gridDark', 0x707585, 52, 34);
      launcherStand(ctx, [0, 3.2, -22]);
      corridor(ctx, { x: 26, y: 34, z0: -28, z1: 220, mat: wallMat });
      box(ctx, [0, 17, -27], [54, 34, 2], wallMat, { noNearMiss: true, breakable: false });
      box(ctx, [0, 17, 219], [54, 34, 2], wallMat, { noNearMiss: true, breakable: false });
      // shelf rows with alternating gaps
      model(ctx, { name: 'bookcaseClosedWide', pos: [-18, 0, 45], scale: 13, collider: 'box' });
      model(ctx, { name: 'bookcaseClosedWide', pos: [-6, 0, 45], scale: 13, collider: 'box' });
      addGate(ctx, [13, 6, 45], [0, 0, 1], 5);
      model(ctx, { name: 'bookcaseClosedWide', pos: [7, 0, 85], scale: 13, collider: 'box' });
      model(ctx, { name: 'bookcaseClosedWide', pos: [19, 0, 85], scale: 13, collider: 'box' });
      addGate(ctx, [-13, 6, 85], [0, 0, 1], 5);
      // crate stacks
      const crate = gm(ctx, 'gridOrange', 0xcc8844, 4, 4);
      box(ctx, [0, 2, 60], [4, 4, 4], crate);
      box(ctx, [0, 6, 60], [4, 4, 4], crate);
      box(ctx, [-11, 2, 105], [4, 4, 4], crate);
      box(ctx, [-11, 6, 105], [4, 4, 4], crate);
      box(ctx, [-11, 10, 105], [4, 4, 4], crate);
      box(ctx, [12, 2, 118], [4, 4, 4], crate);
      // desk row + gate
      model(ctx, { name: 'desk', pos: [-15, 0, 135], scale: 12, collider: 'box' });
      model(ctx, { name: 'desk', pos: [15, 0, 135], scale: 12, rotY: Math.PI, collider: 'box' });
      addGate(ctx, [0, 6, 135], [0, 0, 1], 5);
      model(ctx, { name: 'bench', pos: [0, 0, 158], scale: 11, rotY: Math.PI / 2, collider: 'box' });
      model(ctx, { name: 'lampSquareTable', pos: [-14, 0, 170], scale: 12, collider: 'box' });
      model(ctx, { name: 'cabinetTelevision', pos: [14, 0, 175], scale: 12, rotY: -0.4, collider: 'box' });
      textSprite(ctx, 'WAREHOUSE', [0, 26, 90], 1.3, '#ffd23f');
      model(ctx, {
        name: 'taxi', pos: [0, 0, 200], scale: 9, rotY: Math.PI / 2,
        collider: 'box', isTarget: true, targetMesh: true
      });
      ctx.target.pos = [0, 2.5, 200];
    }
  },
  {
    id: 9, name: 'TOWER CLIMB', par: 55,
    hint: 'SPIRAL UP THE TOWER — TARGET ON TOP',
    env: {
      bg: 0x10222e, fogNear: 110, fogFar: 520, hemiSky: 0xbfd8e8, hemiGround: 0x3a4c5a, hemiInt: 1.0,
      sun: 0.85, groundTex: 'gridGreen', groundColor: 0xffffff, groundSize: 1400, groundRepeat: 340, groundY: 0
    },
    spawn: { pos: [0, 5, 20], dir: [0, 0.25, 1] },
    flight: { maxSpeed: 44, turnRate: 1.7 },
    targetColors: [0xff8c1a, 0xffffff, 0x9aa7c0, 0xffd23f],
    build(ctx) {
      launcherStand(ctx, [0, 3.2, 20]);
      // the tower
      box(ctx, [0, 55, 110], [14, 110, 14], gm(ctx, 'gridDark2', 0x8a97b5, 14, 110), { noNearMiss: true, breakable: false });
      // spiral of rings
      const R = 22;
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + i * 0.75;
        const x = Math.sin(a) * R;
        const z = 110 + Math.cos(a) * R;
        ring(ctx, { pos: [x, 12 + i * 10.5, z], r: 4.6, rotY: a + Math.PI / 2, color: i % 2 ? 0xff8c1a : 0x3a3f4a });
      }
      // scenery
      model(ctx, { name: 'tree_pineTallA', pos: [-30, 0, 60], scale: 11, collider: 'sphere' });
      model(ctx, { name: 'tree_default', pos: [28, 0, 80], scale: 9, collider: 'sphere' });
      model(ctx, { name: 'tree_cone', pos: [-26, 0, 150], scale: 9, collider: 'sphere' });
      box(ctx, [30, 4, 140], [8, 8, 8], gm(ctx, 'gridLight2', 0xd0cabd, 8, 8));
      // rooftop target hut
      box(ctx, [0, 112.5, 110], [9, 5, 9], gm(ctx, 'gridOrange', 0xffffff, 9, 5), { isTarget: true, targetMesh: true });
      box(ctx, [0, 116.4, 110], [4, 2.8, 4], gm(ctx, 'gridRed', 0xb8552f, 4, 3), { isTarget: true, targetMesh: true });
      scorchDecal(ctx, [0, 115.2, 110], [0, 1, 0], 4);
      ctx.target.pos = [0, 113, 110];
    }
  },
  {
    id: 10, name: 'bOSS FACTORY', par: 48,
    hint: 'PIPE GAUNTLET — TAKE OUT THE bOSS',
    env: {
      bg: 0x0b0912, fogNear: 36, fogFar: 300, hemiSky: 0xa8a8d0, hemiGround: 0x342a3a, hemiInt: 1.1,
      sun: 0.8, groundTex: 'gridDark', groundColor: 0xffffff, groundSize: 900, groundRepeat: 220, groundY: 0
    },
    spawn: { pos: [0, 5, -16], dir: [0, 0, 1] },
    flight: { maxSpeed: 34, turnRate: 1.9 },
    targetColors: [0xff5a4e, 0xffd23f, 0x7dff8a, 0x6fd3ff, 0xffffff, 0xff8c1a],
    build(ctx) {
      const wallMat = gm(ctx, 'gridDark2', 0x565064, 40, 30);
      launcherStand(ctx, [0, 3.2, -16]);
      corridor(ctx, { x: 20, y: 30, z0: -22, z1: 192, mat: wallMat });
      box(ctx, [0, 15, 191], [42, 30, 2], wallMat, { noNearMiss: true, breakable: false });
      // pipe gauntlet: horizontal cylinders across the corridor
      const pipeMat = gm(ctx, 'gridOrange', 0xffffff, 40, 3);
      pipeAcross(ctx, 6, 25, 1.6, 40, pipeMat);
      pipeAcross(ctx, 15, 45, 1.8, 40, pipeMat);
      pipeAcross(ctx, 8, 65, 1.6, 40, pipeMat); pipeAcross(ctx, 20, 65, 1.6, 40, pipeMat);
      pipeAcross(ctx, 5, 85, 1.4, 40, pipeMat); pipeAcross(ctx, 16, 85, 1.8, 40, pipeMat);
      pipeAcross(ctx, 10, 100, 1.6, 40, pipeMat); pipeAcross(ctx, 22, 100, 1.4, 40, pipeMat);
      // conveyors + columns
      const beltMat = gm(ctx, 'gridDark', 0x3a3a44, 10, 3);
      box(ctx, [-9, 1.6, 115], [12, 3.2, 5], beltMat, { breakable: false });
      box(ctx, [9, 1.6, 122], [12, 3.2, 5], beltMat, { breakable: false });
      box(ctx, [-4, 1.6, 132], [12, 3.2, 5], beltMat, { breakable: false });
      const colMat = gm(ctx, 'gridOrange', 0xcc7722, 3, 30);
      box(ctx, [-12, 15, 124], [3, 30, 3], colMat, { breakable: false });
      box(ctx, [12, 15, 130], [3, 30, 3], colMat, { breakable: false });
      box(ctx, [-16, 4, 145], [6, 8, 6], gm(ctx, 'gridOrange', 0xffffff, 6, 8));
      box(ctx, [16, 5, 150], [7, 10, 7], gm(ctx, 'gridOrange', 0xffffff, 7, 10));
      textSprite(ctx, 'FACTORY', [0, 25, 100], 1.4, '#ff8c1a');
      // boss pedestal
      box(ctx, [0, 3, 176], [6.5, 6, 6.5], gm(ctx, 'gridOrange', 0xffffff, 6, 6), { noNearMiss: true, breakable: false });
      bossTarget(ctx, [0, 6, 176]);
      const boss = textSprite(ctx, 'bOSS', [0, 15.5, 176], 1.1, '#ffd23f');
      ctx.dynamic.push(t => { boss.position.y = 15.5 + Math.sin(t * 2.4) * 0.6; });
    }
  },
  {
    id: 11, name: 'SEWER PIPES', par: 45,
    hint: 'TIGHT PIPES IN THE DARK — MIND THE GAPS',
    env: {
      bg: 0x05070c, fogNear: 26, fogFar: 200, hemiSky: 0x8898b8, hemiGround: 0x1e2a28, hemiInt: 1.3,
      sun: 0.6, groundTex: 'gridDark', groundColor: 0xffffff, groundSize: 900, groundRepeat: 220, groundY: 0
    },
    spawn: { pos: [0, 5, -16], dir: [0, 0, 1] },
    flight: { maxSpeed: 30, turnRate: 1.9 },
    targetColors: [0xff8c1a, 0xffd23f, 0xffffff],
    build(ctx) {
      const wallMat = gm(ctx, 'gridDark2', 0x3a4a48, 26, 16);
      launcherStand(ctx, [0, 3.2, -16]);
      corridor(ctx, { x: 13, y: 16, z0: -22, z1: 170, mat: wallMat });
      box(ctx, [0, 8, 169], [28, 16, 2], wallMat, { noNearMiss: true, breakable: false });
      const pm = gm(ctx, 'gridOrange', 0xffffff, 26, 3);
      pipeAcross(ctx, 6, 15, 1.5, 26, pm);
      pipeAcross(ctx, 10.5, 30, 1.5, 26, pm);
      pipeAcross(ctx, 4.5, 45, 1.4, 26, pm); pipeAcross(ctx, 11.5, 45, 1.4, 26, pm);
      pipeAcross(ctx, 7, 60, 1.6, 26, pm);
      pipeAcross(ctx, 3.5, 75, 1.2, 26, pm); pipeAcross(ctx, 12, 75, 1.5, 26, pm);
      pipeAcross(ctx, 8, 90, 1.5, 26, pm);
      pipeAcross(ctx, 4.5, 105, 1.4, 26, pm); pipeAcross(ctx, 11, 105, 1.4, 26, pm);
      pipeAcross(ctx, 9, 120, 1.6, 26, pm);
      pipeAcross(ctx, 5, 135, 1.4, 26, pm);
      pipeAcross(ctx, 10, 150, 1.5, 26, pm);
      // support columns to weave around
      const colMat = gm(ctx, 'gridOrange', 0xcc7722, 3, 16);
      box(ctx, [-6, 8, 52], [2.5, 16, 2.5], colMat, { breakable: false });
      box(ctx, [6, 8, 97], [2.5, 16, 2.5], colMat, { breakable: false });
      textSprite(ctx, 'SEWER', [0, 13, 80], 1.0, '#ff8c1a');
      // target valve
      box(ctx, [0, 4, 160], [4.5, 4.5, 4.5], gm(ctx, 'gridOrange', 0xff8c1a, 5, 5), { isTarget: true, targetMesh: true });
      box(ctx, [0, 4, 157.4], [6, 1.2, 1.2], gm(ctx, 'gridRed', 0xb8552f, 6, 1), { collide: false, targetMesh: true });
      scorchDecal(ctx, [0, 4, 157.5], [0, 0, -1], 3);
      ctx.target.pos = [0, 4, 160];
    }
  },
  {
    id: 12, name: 'ROOFTOP RUN', par: 48,
    hint: 'SKIM THE ROOFS — DIVE INTO THE COURTYARD',
    env: {
      bg: 0x0e2430, fogNear: 100, fogFar: 520, hemiSky: 0xaed4dd, hemiGround: 0x2e3a4a, hemiInt: 1.0,
      sun: 0.8, groundTex: 'gridDark2', groundColor: 0xffffff, groundSize: 1600, groundRepeat: 400, groundY: 0
    },
    spawn: { pos: [0, 8, -30], dir: [0, 0.14, 1] },
    flight: { maxSpeed: 46, turnRate: 1.6 },
    targetColors: [0x9aa7c0, 0xffffff, 0xff5a4e, 0x6a7590],
    build(ctx) {
      launcherStand(ctx, [0, 6, -30]);
      const bmat = gm(ctx, 'gridDark2', 0x9aa7c0, 16, 20);
      const bmat2 = gm(ctx, 'gridRed', 0xb0a0a0, 16, 20);
      const blds = [
        [-14, 10, 14], [14, 30, 18], [-12, 60, 16], [15, 90, 22], [-16, 120, 15],
        [13, 150, 24], [-14, 180, 18], [14, 210, 20], [-12, 240, 16]
      ];
      blds.forEach((b, i) => {
        box(ctx, [b[0], b[2] / 2, b[1]], [16, b[2], 18], i % 2 ? bmat : bmat2, { trick: 'ROOF SKIM' });
      });
      addGate(ctx, [0, 20, 75], [0, 0, 1], 8, 'ALLEY OOP', 150);
      addGate(ctx, [0, 22, 165], [0, 0, 1], 8, 'ALLEY OOP', 150);
      // courtyard: four walls, open top — dive in
      const cw = gm(ctx, 'gridLight2', 0xbfb5a4, 34, 20);
      box(ctx, [0, 10, 286], [34, 20, 3], cw, { noNearMiss: true, breakable: false });
      box(ctx, [0, 10, 314], [34, 20, 3], cw, { noNearMiss: true, breakable: false });
      box(ctx, [-15.5, 10, 300], [3, 20, 31], cw, { noNearMiss: true, breakable: false });
      box(ctx, [15.5, 10, 300], [3, 20, 31], cw, { noNearMiss: true, breakable: false });
      addGate(ctx, [0, 21, 300], [0, 1, 0], 10, 'COURTYARD DIVE', 300);
      model(ctx, {
        name: 'sedan', pos: [0, 0, 300], scale: 9, rotY: 0.4,
        collider: 'box', isTarget: true, targetMesh: true, tint: 0xff5a4e
      });
      scorchDecal(ctx, [0, 0.15, 293], [0, 1, 0], 4);
      ctx.target.pos = [0, 2.5, 300];
    }
  },
  {
    id: 13, name: 'THE GRINDER', par: 45,
    hint: 'ALTERNATING HOLES — WEAVE OR SMASH (ALL WALLS BREAK)',
    env: {
      bg: 0x140b12, fogNear: 40, fogFar: 280, hemiSky: 0xd0a8c0, hemiGround: 0x3a2a34, hemiInt: 1.2,
      sun: 0.8, groundTex: 'gridDark', groundColor: 0xffffff, groundSize: 900, groundRepeat: 220, groundY: 0
    },
    spawn: { pos: [0, 5, -18], dir: [0, 0, 1] },
    flight: { maxSpeed: 32, turnRate: 1.9 },
    targetColors: [0xffffff, 0xd9d9de, 0xff5a4e],
    build(ctx) {
      const wallMat = gm(ctx, 'gridDark2', 0x5a3a4a, 36, 26);
      const grind = gm(ctx, 'gridLight', 0xd07090, 36, 26);
      launcherStand(ctx, [0, 3.2, -18]);
      corridor(ctx, { x: 18, y: 26, z0: -24, z1: 230, mat: wallMat });
      box(ctx, [0, 13, 229], [38, 26, 2], wallMat, { noNearMiss: true, breakable: false });
      for (let k = 0; k < 8; k++) {
        const z = 15 + k * 24;
        wallHole(ctx, {
          pos: [0, 13, z], w: 36, h: 26, t: 1.5,
          hx: k % 2 ? 6 : -6, hy: (k % 3) * 2 - 6, hr: 4.6, mat: grind
        });
      }
      textSprite(ctx, 'THE GRINDER', [0, 22, 100], 1.2, '#d07090');
      blockTowerTarget(ctx, 212);
    }
  },
  {
    id: 14, name: 'GAUNTLET ROYALE', par: 90,
    hint: 'EVERYTHING AT ONCE — THE FINAL bOSS AWAITS',
    env: {
      bg: 0x0e1420, fogNear: 90, fogFar: 480, hemiSky: 0xaab8d8, hemiGround: 0x2a3040, hemiInt: 1.05,
      sun: 0.8, groundTex: 'gridDark', groundColor: 0xffffff, groundSize: 1600, groundRepeat: 400, groundY: 0
    },
    spawn: { pos: [0, 5, -20], dir: [0, 0.1, 1] },
    flight: { maxSpeed: 40, turnRate: 1.8 },
    targetColors: [0xff5a4e, 0xffd23f, 0x7dff8a, 0x6fd3ff, 0xffffff, 0xff8c1a],
    build(ctx) {
      launcherStand(ctx, [0, 3.2, -20]);
      // act 1: rings
      ring(ctx, { pos: [0, 14, 25], r: 4.8 });
      ring(ctx, { pos: [-8, 10, 55], r: 4.6 });
      ring(ctx, { pos: [8, 16, 85], r: 4.6 });
      // act 2: freestanding hole walls (breakable)
      const wmat = gm(ctx, 'gridLight', 0xef8168, 44, 24);
      wallHole(ctx, { pos: [0, 12, 115], w: 44, h: 24, t: 2, hx: -8, hy: -4, hr: 4.8, mat: wmat });
      wallHole(ctx, { pos: [0, 12, 145], w: 44, h: 24, t: 2, hx: 8, hy: 2, hr: 4.8, mat: wmat });
      wallHole(ctx, { pos: [0, 12, 175], w: 44, h: 24, t: 2, hx: 0, hy: -5, hr: 5.0, mat: wmat });
      // act 3: furniture
      model(ctx, { name: 'table', pos: [0, 0, 205], scale: 13, collider: 'table' });
      model(ctx, { name: 'bookcaseClosedWide', pos: [-12, 0, 235], scale: 13, collider: 'box' });
      model(ctx, { name: 'bookcaseClosedWide', pos: [12, 0, 235], scale: 13, collider: 'box' });
      addGate(ctx, [0, 6, 235], [0, 0, 1], 4.5);
      model(ctx, { name: 'bench', pos: [0, 0, 260], scale: 11, rotY: Math.PI / 2, collider: 'box' });
      // act 4: pipe frames
      const pm = gm(ctx, 'gridOrange', 0xffffff, 42, 3);
      const fm = gm(ctx, 'gridOrange', 0xcc7722, 3, 26);
      for (const [y, z] of [[6, 285], [14, 305], [8, 325]]) {
        box(ctx, [-21, 13, z], [3, 26, 3], fm, { breakable: false });
        box(ctx, [21, 13, z], [3, 26, 3], fm, { breakable: false });
        pipeAcross(ctx, y, z, 1.6, 42, pm);
      }
      // scenery
      model(ctx, { name: 'tree_pineTallA', pos: [-30, 0, 70], scale: 11, collider: 'sphere' });
      model(ctx, { name: 'tree_default', pos: [30, 0, 160], scale: 9, collider: 'sphere' });
      model(ctx, { name: 'tree_cone', pos: [-28, 0, 250], scale: 9, collider: 'sphere' });
      // final boss
      box(ctx, [0, 3, 370], [7, 6, 7], gm(ctx, 'gridOrange', 0xffffff, 7, 6), { noNearMiss: true, breakable: false });
      bossTarget(ctx, [0, 6, 370]);
      const boss = textSprite(ctx, 'FINAL bOSS', [0, 16, 370], 1.2, '#ff5a4e');
      ctx.dynamic.push(t => { boss.position.y = 16 + Math.sin(t * 2.4) * 0.6; });
    }
  }
];
