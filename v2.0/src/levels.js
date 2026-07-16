// Level data + builders: walls with holes, rings, furniture, city, pipes, boss factory.
import * as THREE from 'three';

const _v = new THREE.Vector3();
// Shared unit-cube geometry for movers — every movingBox scales this instead of
// allocating a fresh BoxGeometry (fewer GPU buffers, cheaper on the Intel MBP/XR).
const _unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);

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

// ---------- moving obstacles (v2.0 foundation) ----------
// A box whose mesh + collider are kept in sync every frame via ctx.dynamic.
// path(t) -> [x,y,z] absolute world position at elapsed time t (required).
// rotYPath(t) -> optional yaw in radians; only for SLOW rotators (2 trig calls/frame
// is cheap, but per the brief we move rather than spin fast colliders).
// opts.decorative: true -> the mover is skipped entirely on LOW-perf devices (ctx.low)
// so flavour movers never eat into the <12-mover-per-level budget on weak hardware.
function movingBox(ctx, o) {
  if (o.decorative && ctx.low) return null;
  const mesh = new THREE.Mesh(_unitBoxGeo, o.mat);
  mesh.scale.set(o.size[0], o.size[1], o.size[2]);
  const rotY = o.rotY || 0;
  mesh.rotation.y = rotY;
  ctx.group.add(mesh);
  const col = ctx.world.addBox(o.pos, o.size, {
    rotY,
    isTarget: !!o.isTarget,
    breakable: o.breakable !== undefined ? !!o.breakable : false,
    soft: !!o.soft,
    bouncy: !!o.bouncy,
    mesh,
    trick: o.trick || 'CLOSE CALL',
    noNearMiss: !!o.noNearMiss
  });
  const path = o.path, rotYPath = o.rotYPath;
  ctx.dynamic.push(t => {
    const p = path(t);
    mesh.position.set(p[0], p[1], p[2]);
    col.cx = p[0]; col.cy = p[1]; col.cz = p[2];
    if (rotYPath) {
      const ry = rotYPath(t);
      mesh.rotation.y = ry;
      col.rotY = ry; col.cos = Math.cos(ry); col.sin = Math.sin(ry);
    }
  });
  return { mesh, col };
}

// Same sync pattern as movingBox, for pendulum bobs / wrecking balls.
function movingSphere(ctx, o) {
  if (o.decorative && ctx.low) return null;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(o.r, 10, 8), o.mat);
  ctx.group.add(mesh);
  const col = ctx.world.addSphere(o.pos, o.r, {
    isTarget: !!o.isTarget, breakable: !!o.breakable, soft: !!o.soft, bouncy: !!o.bouncy,
    mesh, trick: o.trick || 'CLOSE CALL', noNearMiss: !!o.noNearMiss
  });
  const path = o.path;
  ctx.dynamic.push(t => {
    const p = path(t);
    mesh.position.set(p[0], p[1], p[2]);
    col.cx = p[0]; col.cy = p[1]; col.cz = p[2];
  });
  return { mesh, col };
}

// Thin guide line through a list of [x,y,z] points — route readability aid
// (e.g. the TOWER CLIMB helix) so a spiral/curve path reads at a glance.
function guideLine(ctx, points, color = 0xffd23f) {
  const pts = points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(pts);
  const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(pts.length * 8));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 });
  ctx.group.add(new THREE.Line(geo, mat));
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
  launcherStand, scorchDecal, pipeAcross, movingBox, movingSphere, guideLine
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
    id: 1, name: 'SLIPSTREAM', par: 32,
    hint: 'RIDE THE WIND LANE FAST — OR FLY SAFE AND SLOW',
    env: {
      bg: 0x16303a, fogNear: 100, fogFar: 480, hemiSky: 0xbfd8e8, hemiGround: 0x3a5c3a, hemiInt: 0.95,
      sun: 0.8, groundTex: 'gridGreen', groundColor: 0xffffff, groundSize: 1400, groundRepeat: 340, groundY: 0
    },
    spawn: { pos: [0, 5, -20], dir: [0, 0.1, 1] },
    flight: { maxSpeed: 46, turnRate: 1.6 },
    targetColors: [0xffffff, 0xd0d0d6, 0x8899aa, 0xff8c1a],
    build(ctx) {
      launcherStand(ctx, [0, 3.2, -20]);
      // canyon mesas — wide left channel = WIND TUNNEL (fast lane, tighter obstacles),
      // right channel = safe slow lane with generous gaps (route choice)
      const mesa = gm(ctx, 'gridRed', 0xcf9070, 14, 26);
      const hs = [24, 28, 22, 30, 26, 24];
      for (let i = 0; i < 6; i++) {
        const z = 15 + i * 30;
        box(ctx, [-25, hs[i] / 2, z], [14, hs[i], 18], mesa, { noNearMiss: true, breakable: false });
        box(ctx, [25, hs[(i + 3) % 6] / 2, z + 15], [14, hs[(i + 3) % 6], 18], mesa, { noNearMiss: true, breakable: false });
      }
      // wind tunnel band: inside it the missile gets +40% speed + FOV kick (game.js
      // reads ctx.windZones every frame). It runs down the left half of the canyon.
      ctx.windZones.push({ cx: -9, cz: 95, hx: 9, hz: 90, y0: 0, y1: 30, mul: 1.4 });
      textSprite(ctx, 'WIND LANE', [-9, 20, 20], 1.0, '#37c8c3');
      // fast lane: tighter rings, close together
      ring(ctx, { pos: [-9, 11, 30], r: 4.6, color: 0x37c8c3 });
      ring(ctx, { pos: [-9, 14, 55], r: 4.4, color: 0x37c8c3 });
      ring(ctx, { pos: [-9, 10, 80], r: 4.4, color: 0x37c8c3 });
      ring(ctx, { pos: [-9, 15, 110], r: 4.6, color: 0x37c8c3 });
      // slow lane: wider rings, spaced further apart
      ring(ctx, { pos: [11, 13, 45], r: 5.4 });
      ring(ctx, { pos: [11, 12, 100], r: 5.4 });
      ring(ctx, { pos: [0, 11, 150], r: 4.8 });
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
    spawn: { pos: [0, 5, -14], dir: [0, 0, 1] },   // camera must clear the -25 entry cap
    flight: { maxSpeed: 32, turnRate: 1.9 },
    targetColors: [0xffffff, 0xd0d0d6, 0x333340, 0x8899aa],
    build(ctx) {
      const wallMat = gm(ctx, 'gridDark', 0x8f8fa0, 60, 40);
      launcherStand(ctx, [0, 3.2, -14]);
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
    id: 4, name: 'PISTON PRESS', par: 40,
    hint: 'PULSE THE THRUST — TIME THE CRUSHERS',
    env: {
      bg: 0x0c1a22, fogNear: 50, fogFar: 300, hemiSky: 0xa8d4d8, hemiGround: 0x28444a, hemiInt: 1.2,
      sun: 0.85, groundTex: 'gridDark2', groundColor: 0xffffff, groundSize: 900, groundRepeat: 220, groundY: 0
    },
    // spawn far enough from the entry cap (-23) that the chase camera (-9 behind)
    // starts INSIDE the corridor — was showing the wall instead of the missile
    spawn: { pos: [0, 5, -12], dir: [0, 0, 1] },
    flight: { maxSpeed: 34, turnRate: 1.9 },
    targetColors: [0xffffff, 0xcc7722, 0xd9d9de],
    build(ctx) {
      const wallMat = gm(ctx, 'gridDark2', 0x3a5a5e, 40, 28);
      const pistonMat = gm(ctx, 'gridOrange', 0xcc7722, 40, 8);
      launcherStand(ctx, [0, 3.2, -12]);
      corridor(ctx, { x: 20, y: 28, z0: -24, z1: 210, mat: wallMat });
      box(ctx, [0, 14, -23], [42, 28, 2], wallMat, { noNearMiss: true, breakable: false });
      box(ctx, [0, 14, 209], [42, 28, 2], wallMat, { noNearMiss: true, breakable: false });
      textSprite(ctx, 'PISTON PRESS', [0, 24, 10], 1.1, '#cc7722');
      // 6 crusher pistons hanging from the ceiling, sine phase offsets — hold back
      // and burst through the gap when each one retracts (fuel score synergy:
      // pulsing the thrust instead of holding it full gives more room to react)
      const gapFloor = 2, gapCeil = 26; // corridor clear range
      for (let k = 0; k < 6; k++) {
        const z = 20 + k * 32;
        const phase = k * (Math.PI * 2 / 6);
        movingBox(ctx, {
          pos: [0, gapCeil, z], size: [40, 9, 4], mat: pistonMat, trick: 'CLOSE CALL',
          path: t => [0, gapCeil - (Math.sin(t * 1.15 + phase) * 0.5 + 0.5) * (gapCeil - gapFloor - 2), z]
        });
      }
      blockTowerTarget(ctx, 195);
    }
  },
  {
    id: 5, name: 'DRAWBRIDGE', par: 36,
    hint: 'TIME THE BRIDGES — DIVE UNDER OR CLEAR OVER',
    env: {
      bg: 0x143528, fogNear: 90, fogFar: 440, hemiSky: 0xcfe8c8, hemiGround: 0x2e5c3a, hemiInt: 1.0,
      sun: 0.85, groundTex: 'gridGreen', groundColor: 0xffffff, groundSize: 1400, groundRepeat: 340, groundY: 0
    },
    spawn: { pos: [0, 5, -22], dir: [0, 0.08, 1] },
    flight: { maxSpeed: 46, turnRate: 1.6 },
    targetColors: [0xd8cfc0, 0xb8552f, 0xffffff, 0x8a8378],
    build(ctx) {
      launcherStand(ctx, [0, 3.2, -22]);
      // river town: 3 drawbridge decks that slide up/down on timers (vertical
      // movingBox), plus boat masts (thin static poles) as slalom between them
      const bankMat = gm(ctx, 'gridLight2', 0xbfb5a4, 30, 10);
      const deckMat = gm(ctx, 'gridDark2', 0x8a6b4a, 26, 3);
      const mastMat = gm(ctx, 'gridOrange', 0xcc7722, 1.4, 16);
      for (const x of [-16, 16]) {
        box(ctx, [x, 4, 0], [10, 8, 900], bankMat, { noNearMiss: true, breakable: false, collide: false });
      }
      const bridgeZ = [40, 110, 180];
      bridgeZ.forEach((z, i) => {
        const phase = i * (Math.PI * 2 / 3);
        // deck slides between "up" (blocks the low corridor, dive over it near
        // the top) and "down" (folds toward the water, dive straight under)
        movingBox(ctx, {
          pos: [0, 12, z], size: [26, 3, 6], mat: deckMat, trick: 'CLOSE CALL',
          path: t => [0, 2 + (Math.sin(t * 0.9 + phase) * 0.5 + 0.5) * 18, z]
        });
        textSprite(ctx, 'BRIDGE', [0, 24, z - 8], 0.9, '#ffd23f');
      });
      // boat masts: slalom poles between the bridges, breakable (thin)
      const mastX = [-9, 9, -6, 6];
      const mastZ = [70, 95, 145, 160];
      for (let i = 0; i < mastX.length; i++) {
        box(ctx, [mastX[i], 8, mastZ[i]], [1.4, 16, 1.4], mastMat);
      }
      model(ctx, { name: 'tree_default', pos: [-24, 0, 210], scale: 9, collider: 'sphere' });
      model(ctx, { name: 'tree_cone', pos: [22, 0, 220], scale: 9, collider: 'sphere' });
      // target barn (river town warehouse)
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
      // fix: moving cars crossing the street between the brick slalom blocks —
      // slow + generous gaps, flavour + near-miss fodder, not a wall
      {
        const carMat = gm(ctx, 'gridDark', 0xffd23f, 8, 3);
        movingBox(ctx, {
          pos: [0, 2, 202], size: [8, 3.4, 3.6], mat: carMat, trick: 'CLOSE CALL',
          path: t => [((t * 9 + 5) % 60) - 30, 2, 202]
        });
        const carMat2 = gm(ctx, 'gridDark', 0x37c8c3, 8, 3);
        movingBox(ctx, {
          pos: [0, 2, 240], size: [8, 3.4, 3.6], mat: carMat2, trick: 'CLOSE CALL',
          path: t => [30 - ((t * 7 + 15) % 60), 2, 240]
        });
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
    id: 7, name: 'FAN VAULT', par: 46,
    hint: 'CLIMB THE SHAFT — DODGE THE FAN BLADES — BURST THE ROOF',
    env: {
      bg: 0x0b1020, fogNear: 46, fogFar: 300, hemiSky: 0xaab8e0, hemiGround: 0x2a3050, hemiInt: 1.15,
      sun: 0.85, groundTex: 'gridDark', groundColor: 0xffffff, groundSize: 900, groundRepeat: 220, groundY: 0
    },
    spawn: { pos: [0, 6, -6], dir: [0, 0.3, 1] },  // camera must clear the -17 entry cap
    flight: { maxSpeed: 32, turnRate: 1.9 },
    targetColors: [0xffffff, 0x6fd3ff, 0x333340],
    build(ctx) {
      const wallMat = gm(ctx, 'gridDark2', 0x506080, 32, 30);
      launcherStand(ctx, [0, 3.2, -6]);
      // entry hall leading into the vertical shaft
      corridor(ctx, { x: 16, y: 22, z0: -18, z1: 22, mat: wallMat });
      box(ctx, [0, 11, -17], [33, 22, 2], wallMat, { noNearMiss: true, breakable: false });
      // vertical shaft: 4 walls climbing from the hall floor to the roof exit
      const shaftMat = gm(ctx, 'gridLight2', 0x8090b0, 16, 130);
      const sx = 8, shaftTop = 130, shaftZ = 30;
      box(ctx, [-sx, shaftTop / 2, shaftZ], [1.5, shaftTop, 16], shaftMat, { noNearMiss: true, breakable: false });
      box(ctx, [sx, shaftTop / 2, shaftZ], [1.5, shaftTop, 16], shaftMat, { noNearMiss: true, breakable: false });
      box(ctx, [0, shaftTop / 2, shaftZ - 8], [17, shaftTop, 1.5], shaftMat, { noNearMiss: true, breakable: false });
      box(ctx, [0, shaftTop / 2, shaftZ + 8], [17, shaftTop, 1.5], shaftMat, { noNearMiss: true, breakable: false });
      textSprite(ctx, 'FAN VAULT', [0, 20, shaftZ], 1.1, '#6fd3ff');
      // giant slow rotating fan blades at two heights — 3 arms each, generous gaps
      const bladeMat = gm(ctx, 'gridOrange', 0xffffff, 12, 2);
      for (const fanY of [50, 95]) {
        const spinDir = fanY === 50 ? 1 : -1;
        for (let a = 0; a < 3; a++) {
          const basePhase = a * (Math.PI * 2 / 3);
          movingBox(ctx, {
            pos: [0, fanY, shaftZ], size: [11, 1.6, 2], mat: bladeMat, trick: 'FLYBY',
            path: () => [0, fanY, shaftZ],
            rotYPath: t => basePhase + t * 0.7 * spinDir
          });
        }
      }
      // roof exit: thin ceiling (kamikaze/impact punches through) into a rooftop dish
      box(ctx, [0, shaftTop, shaftZ], [17, 1.5, 16], gm(ctx, 'gridOrange', 0xcc7722, 17, 16));
      box(ctx, [0, shaftTop + 4.5, shaftZ], [9, 6, 9], gm(ctx, 'gridLight', 0xd0d0d6, 9, 6), { isTarget: true, targetMesh: true });
      const dish = box(ctx, [0, shaftTop + 8.5, shaftZ], [7, 1.6, 7], gm(ctx, 'gridDark', 0x37c8c3, 7, 2), { isTarget: true, targetMesh: true });
      dish.rotation.x = Math.PI / 5;
      scorchDecal(ctx, [0, shaftTop + 0.8, shaftZ], [0, 1, 0], 4);
      ctx.target.pos = [0, shaftTop + 6, shaftZ];
    }
  },
  {
    id: 8, name: 'TRAIN YARD', par: 46,
    hint: 'THREAD THE MOVING TRAINS — DELIVER TO THE DEPOT',
    env: {
      // dusk rail hall — brighter than the old WAREHOUSE murk so trains read at 400px
      bg: 0x121a2e, fogNear: 60, fogFar: 380, hemiSky: 0xb8c4e8, hemiGround: 0x323a54, hemiInt: 1.25,
      sun: 0.9, groundTex: 'gridDark2', groundColor: 0xffffff, groundSize: 900, groundRepeat: 220, groundY: 0
    },
    spawn: { pos: [0, 5, -16], dir: [0, 0, 1] },   // camera must clear the -27 entry cap
    flight: { maxSpeed: 33, turnRate: 1.9 },
    targetColors: [0xffd23f, 0xffffff, 0x333340, 0xff8c1a],
    build(ctx) {
      const wallMat = gm(ctx, 'gridDark', 0x707585, 52, 34);
      launcherStand(ctx, [0, 3.2, -16]);
      corridor(ctx, { x: 26, y: 34, z0: -28, z1: 220, mat: wallMat });
      box(ctx, [0, 17, -27], [54, 34, 2], wallMat, { noNearMiss: true, breakable: false });
      box(ctx, [0, 17, 219], [54, 34, 2], wallMat, { noNearMiss: true, breakable: false });
      textSprite(ctx, 'TRAIN YARD', [0, 26, 30], 1.3, '#ffd23f');
      // rail ballast strips (visual only, no collider) mark each crossing lane
      const railMat = gm(ctx, 'gridDark', 0x3a3a44, 52, 3);
      for (const z of [60, 115, 170]) box(ctx, [0, 0.15, z], [52, 0.3, 5], railMat, { collide: false });
      // 3 long trains crossing perpendicular at different speeds — thread the gaps
      const trainMat = gm(ctx, 'gridOrange', 0xcc8844, 18, 6);
      const trainMat2 = gm(ctx, 'gridRed', 0xb8552f, 14, 6);
      const trainMat3 = gm(ctx, 'gridDark2', 0x506080, 16, 6);
      movingBox(ctx, {
        pos: [0, 3, 60], size: [18, 6, 5], mat: trainMat, trick: 'CLOSE CALL',
        path: t => [((t * 11 + 5) % 74) - 37, 3, 60]
      });
      movingBox(ctx, {
        pos: [0, 3, 115], size: [14, 6, 5], mat: trainMat2, trick: 'CLOSE CALL',
        path: t => [37 - ((t * 8 + 30) % 74), 3, 115]
      });
      movingBox(ctx, {
        pos: [0, 3, 170], size: [16, 6, 5], mat: trainMat3, trick: 'CLOSE CALL',
        path: t => [((t * 14 + 55) % 74) - 37, 3, 170]
      });
      // crate stacks between the crossings for cover / weave practice
      const crate = gm(ctx, 'gridOrange', 0xcc8844, 4, 4);
      box(ctx, [-11, 2, 85], [4, 4, 4], crate);
      box(ctx, [-11, 6, 85], [4, 4, 4], crate);
      box(ctx, [12, 2, 140], [4, 4, 4], crate);
      box(ctx, [12, 6, 140], [4, 4, 4], crate);
      model(ctx, {
        name: 'taxi', pos: [0, 0, 200], scale: 9, rotY: Math.PI / 2,
        collider: 'box', isTarget: true, targetMesh: true
      });
      ctx.target.pos = [0, 2.5, 200];
    }
  },
  {
    id: 9, name: 'TOWER CLIMB', par: 60,
    hint: 'FOLLOW THE HELIX LINE UP — TARGET ON TOP',
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
      // spiral of rings — widened radius + fewer rings so the chase camera can
      // keep up with the turn (fix: was R22/9 rings, too disorienting)
      const R = 30, RINGS = 7;
      const guidePts = [[0, 4, 20]];
      for (let i = 0; i < RINGS; i++) {
        const a = Math.PI + i * 0.82;
        const x = Math.sin(a) * R;
        const z = 110 + Math.cos(a) * R;
        const y = 12 + i * 14;
        // ring rotY matches the flight tangent at this point on the spiral
        ring(ctx, { pos: [x, y, z], r: 5.3, rotY: a + Math.PI / 2, color: i % 2 ? 0xff8c1a : 0x3a3f4a });
        guidePts.push([x, y, z]);
      }
      guidePts.push([0, 12 + RINGS * 14, 110]);
      guideLine(ctx, guidePts, 0xffd23f);
      // scenery
      model(ctx, { name: 'tree_pineTallA', pos: [-34, 0, 60], scale: 11, collider: 'sphere' });
      model(ctx, { name: 'tree_default', pos: [32, 0, 80], scale: 9, collider: 'sphere' });
      model(ctx, { name: 'tree_cone', pos: [-30, 0, 150], scale: 9, collider: 'sphere' });
      box(ctx, [34, 4, 140], [8, 8, 8], gm(ctx, 'gridLight2', 0xd0cabd, 8, 8));
      // rooftop target hut
      const topY = 12 + RINGS * 14;
      box(ctx, [0, topY + 2.5, 110], [9, 5, 9], gm(ctx, 'gridOrange', 0xffffff, 9, 5), { isTarget: true, targetMesh: true });
      box(ctx, [0, topY + 6.4, 110], [4, 2.8, 4], gm(ctx, 'gridRed', 0xb8552f, 4, 3), { isTarget: true, targetMesh: true });
      scorchDecal(ctx, [0, topY + 5.2, 110], [0, 1, 0], 4);
      ctx.target.pos = [0, topY + 3, 110];
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
    id: 11, name: 'PENDULUM CAVE', par: 46,
    hint: 'DARK CAVE — SWINGING BALLS, FLY TIGHT',
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
      // stalactites: static cone-tipped hangers, torch-glow feel via emissive tips
      const stalMat = gm(ctx, 'gridOrange', 0x2a2a30, 3, 6);
      const stalPositions = [[-6, 40], [5, 55], [-4, 90], [7, 110], [-6, 130], [4, 150]];
      for (const [x, z] of stalPositions) box(ctx, [x, 14, z], [2, 5, 2], stalMat, { breakable: false });
      // swinging wrecking balls on sine pendulum paths — cheap emissive glow reads
      // as a torch-lit cave without any real lights
      const ballMat = gm(ctx, 'gridOrange', 0xff8c1a, 3, 3);
      const pendulums = [
        { x: -3, y: 11, z: 30, len: 6, amp: 1.0, freq: 1.1, phase: 0 },
        { x: 4, y: 9, z: 60, len: 7, amp: 1.1, freq: 0.9, phase: 1.4 },
        { x: -4, y: 10, z: 90, len: 6, amp: 1.0, freq: 1.0, phase: 2.6 },
        { x: 3, y: 8, z: 120, len: 7, amp: 1.1, freq: 1.2, phase: 0.8 },
        { x: -3, y: 9, z: 150, len: 6, amp: 1.0, freq: 1.0, phase: 3.4 }
      ];
      for (const p of pendulums) {
        movingSphere(ctx, {
          pos: [p.x, p.y - p.len, p.z], r: 2.4, mat: ballMat, trick: 'CLOSE CALL',
          path: t => {
            const th = Math.sin(t * p.freq + p.phase) * p.amp;
            return [p.x + Math.sin(th) * p.len, p.y - Math.cos(th) * p.len, p.z];
          }
        });
      }
      textSprite(ctx, 'PENDULUM CAVE', [0, 13, 80], 1.0, '#ff8c1a');
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
    id: 13, name: 'SKY SERPENT', par: 48,
    hint: 'FLOW THE UNDULATING RINGS — SHORTCUTS AVAILABLE',
    env: {
      // open-air flow level: bright teal sky + meadow, not the old GRINDER murk
      bg: 0x1c4152, fogNear: 110, fogFar: 540, hemiSky: 0xcfe4ee, hemiGround: 0x3a5c4a, hemiInt: 1.05,
      sun: 0.9, groundTex: 'gridGreen', groundColor: 0xffffff, groundSize: 1400, groundRepeat: 340, groundY: 0
    },
    spawn: { pos: [0, 8, -18], dir: [0, 0.1, 1] },
    flight: { maxSpeed: 42, turnRate: 1.7 },
    targetColors: [0xffffff, 0xd9d9de, 0xff5a4e],
    build(ctx) {
      launcherStand(ctx, [0, 3.2, -18]);
      // an open-air rollercoaster of rings: the path undulates in 3D (vertical
      // dips + banked horizontal weave) — pure flow-state, no walls to punch
      const RINGS = 14, z0 = 20, dz = 16;
      const guidePts = [];
      for (let i = 0; i < RINGS; i++) {
        const z = z0 + i * dz;
        const y = 16 + Math.sin(i * 0.55) * 9;
        const x = Math.sin(i * 0.4 + 0.6) * 12;
        // banked turn: rotY leans the ring toward the horizontal weave direction
        const bank = Math.cos(i * 0.4 + 0.6) * 0.5;
        ring(ctx, { pos: [x, y, z], r: 4.8, rotY: bank, color: i % 2 ? 0xd07090 : 0x3a3f4a });
        guidePts.push([x, y, z]);
      }
      guideLine(ctx, guidePts, 0xd07090);
      // two optional shortcut gaps through breakable billboard walls — route choice
      const bill = gm(ctx, 'gridLight', 0xd07090, 20, 16);
      wallHole(ctx, { pos: [-16, 20, 20 + 4 * dz + dz / 2], w: 20, h: 16, t: 1.2, hx: 0, hy: 0, hr: 4.6, mat: bill });
      textSprite(ctx, 'SHORTCUT', [-16, 30, 20 + 4 * dz + dz / 2], 0.8, '#d07090');
      wallHole(ctx, { pos: [16, 20, 20 + 9 * dz + dz / 2], w: 20, h: 16, t: 1.2, hx: 0, hy: 0, hr: 4.6, mat: bill });
      textSprite(ctx, 'SHORTCUT', [16, 30, 20 + 9 * dz + dz / 2], 0.8, '#d07090');
      textSprite(ctx, 'SKY SERPENT', [0, 32, z0 + RINGS * dz * 0.5], 1.2, '#d07090');
      blockTowerTarget(ctx, z0 + RINGS * dz + 20);
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
      // act 2 (fix): moving-obstacle act — two sliding PISTON PRESS walls instead
      // of the old repeated hole-wall pattern, so the finale truly is "everything"
      const pistonMat = gm(ctx, 'gridOrange', 0xcc7722, 44, 8);
      textSprite(ctx, 'PISTONS', [0, 22, 130], 1.0, '#ff8c1a');
      movingBox(ctx, {
        pos: [0, 20, 130], size: [44, 8, 4], mat: pistonMat, trick: 'CLOSE CALL',
        path: t => [0, 20 - (Math.sin(t * 1.3) * 0.5 + 0.5) * 16, 130]
      });
      movingBox(ctx, {
        pos: [0, 20, 160], size: [44, 8, 4], mat: pistonMat, trick: 'CLOSE CALL',
        path: t => [0, 20 - (Math.sin(t * 1.3 + Math.PI) * 0.5 + 0.5) * 16, 160]
      });
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
