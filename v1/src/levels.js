// Level data + builders: walls with holes, rings, furniture, city, boss factory.
import * as THREE from 'three';

const _v = new THREE.Vector3();

// ---------- shared helpers ----------

function gm(ctx, tex, color, a, b) {
  return ctx.assets.gridMaterial(tex, color, Math.max(1, a / 2.5), Math.max(1, b / 2.5));
}

function box(ctx, pos, size, mat, opts = {}) {
  const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(pos[0], pos[1], pos[2]);
  if (opts.rotY) mesh.rotation.y = opts.rotY;
  ctx.group.add(mesh);
  let col = null;
  if (opts.collide !== false) {
    col = ctx.world.addBox(pos, size, {
      rotY: opts.rotY || 0,
      isTarget: !!opts.isTarget,
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
    box(ctx, [wx, pos[1] + ly, wz], [sw, sh, t], mat, { rotY, noNearMiss: o.noNearMiss });
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
  // side walls + ceiling for indoor levels
  const { x, y, z0, z1, mat, ceilMat } = o;
  const len = z1 - z0, zc = (z0 + z1) / 2;
  box(ctx, [-x, y / 2, zc], [1.5, y, len], mat, { noNearMiss: true });
  box(ctx, [x, y / 2, zc], [1.5, y, len], mat, { noNearMiss: true });
  box(ctx, [0, y + 0.75, zc], [x * 2 + 1.5, 1.5, len], ceilMat || mat, { noNearMiss: true });
}

function launcherStand(ctx, pos) {
  box(ctx, [pos[0], pos[1] / 2, pos[2]], [2.2, pos[1], 2.2],
    ctx.assets.gridMaterial('gridDark', 0xffffff, 1, 2), { noNearMiss: true });
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

// ---------- levels ----------

export const LEVELS = [
  {
    id: 0, name: 'LAUNCH PAD', par: 24,
    hint: 'HOLD THRUST TO LAUNCH — STEER THROUGH THE RINGS',
    env: {
      bg: 0x142f38, fogNear: 90, fogFar: 460, hemiSky: 0xbfd8e8, hemiGround: 0x3a5c3a, hemiInt: 0.95,
      sun: 0.75, groundTex: 'gridGreen', groundColor: 0xffffff, groundSize: 1400, groundRepeat: 340, groundY: 0
    },
    spawn: { pos: [0, 3.4, -20], dir: [0, 1, 0], up: [0, 0, 1] },
    flight: { maxSpeed: 55, turnRate: 2.1 },
    targetColors: [0xd8cfc0, 0x8a8378, 0xffffff, 0xb8552f],
    build(ctx) {
      const A = ctx.assets;
      box(ctx, [0, 0.9, -20], [7, 1.8, 7], gm(ctx, 'gridDark', 0xffffff, 7, 7), { noNearMiss: true });
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
    id: 1, name: 'SALMON MAZE', par: 32,
    hint: 'PULSE THE THRUST — FUEL IS SCORED',
    env: {
      bg: 0x0d0d18, fogNear: 40, fogFar: 260, hemiSky: 0xc4c8e0, hemiGround: 0x4a4058, hemiInt: 1.35,
      sun: 0.9, groundTex: 'gridDark', groundColor: 0xffffff, groundSize: 900, groundRepeat: 220, groundY: 0
    },
    spawn: { pos: [0, 5, -14], dir: [0, 0, 1] },
    flight: { maxSpeed: 38, turnRate: 2.5 },
    targetColors: [0xffffff, 0xd9d9de, 0xa8a8b2],
    build(ctx) {
      const salmon = gm(ctx, 'gridLight', 0xef8168, 36, 26);
      const salmonDark = gm(ctx, 'gridLight2', 0xb86050, 26, 26);
      launcherStand(ctx, [0, 3.2, -14]);
      corridor(ctx, { x: 18, y: 26, z0: -22, z1: 172, mat: salmonDark, ceilMat: gm(ctx, 'gridDark2', 0x6a6a78, 36, 190) });
      wallHole(ctx, { pos: [0, 13, 20], w: 36, h: 26, t: 2, hx: 0, hy: -5, hr: 3.6, mat: salmon });
      wallHole(ctx, { pos: [0, 13, 50], w: 36, h: 26, t: 2, hx: -8, hy: -7, hr: 3.2, mat: salmon });
      wallHole(ctx, { pos: [0, 13, 80], w: 36, h: 26, t: 2, hx: 8, hy: -3, hr: 3.2, mat: salmon });
      // clock tower wall: 3 stacked holes at x=0 (y=5,12,19), pick one
      {
        const t = 2.5, z = 110, hw = 3.0;
        const side = gm(ctx, 'gridLight', 0xef8168, 15, 26);
        box(ctx, [-(2.8 + (18 - 2.8) / 2), 13, z], [18 - 2.8, 26, t], side);
        box(ctx, [2.8 + (18 - 2.8) / 2, 13, z], [18 - 2.8, 26, t], side);
        const seg = gm(ctx, 'gridLight2', 0xcc7060, 6, 5);
        box(ctx, [0, 1.1, z], [2 * hw, 2.2, t], seg);
        box(ctx, [0, 8.5, z], [2 * hw, 1.4, t], seg);
        box(ctx, [0, 15.5, z], [2 * hw, 1.4, t], seg);
        box(ctx, [0, 23.9, z], [2 * hw, 4.2, t], seg);
        for (const hy of [5, 12, 19]) {
          scorchDecal(ctx, [0, hy, z - t / 2 - 0.2], [0, 0, -1], 2.6);
          scorchDecal(ctx, [0, hy, z + t / 2 + 0.2], [0, 0, 1], 2.6);
          addGate(ctx, [0, hy, z], [0, 0, 1], 3.1);
        }
      }
      wallHole(ctx, { pos: [0, 13, 140], w: 36, h: 26, t: 2, hx: 0, hy: -7, hr: 3.6, mat: salmon });
      // end wall + block tower target
      box(ctx, [0, 13, 171], [36, 26, 2], salmon, { noNearMiss: true });
      const white = ctx.assets.plainMaterial(0xf0f0f2);
      const grey = ctx.assets.plainMaterial(0xc7c7cf);
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        box(ctx, [(c - 1) * 1.7, 0.85 + r * 1.7, 158], [1.6, 1.6, 1.6],
          (r + c) % 2 ? white : grey, { collide: false, targetMesh: true });
      }
      ctx.world.addBox([0, 4.3, 158], [5.2, 8.6, 2.2], { isTarget: true });
      ctx.target.pos = [0, 4.3, 158];
    }
  },
  {
    id: 2, name: 'FURNITURE ROOM', par: 34,
    hint: 'GIANT FURNITURE — WEAVE UNDER AND HIT THE CAR',
    env: {
      bg: 0x0a0a14, fogNear: 50, fogFar: 320, hemiSky: 0xaab4dc, hemiGround: 0x2e2a44, hemiInt: 1.1,
      sun: 0.85, groundTex: 'gridDark2', groundColor: 0xffffff, groundSize: 900, groundRepeat: 220, groundY: 0
    },
    spawn: { pos: [0, 5, -20], dir: [0, 0, 1] },
    flight: { maxSpeed: 40, turnRate: 2.5 },
    targetColors: [0xffffff, 0xd0d0d6, 0x333340, 0x8899aa],
    build(ctx) {
      const wallMat = gm(ctx, 'gridDark', 0x8f8fa0, 60, 40);
      launcherStand(ctx, [0, 3.2, -20]);
      corridor(ctx, { x: 30, y: 40, z0: -26, z1: 216, mat: wallMat });
      box(ctx, [0, 20, -25], [60, 40, 2], wallMat, { noNearMiss: true });
      box(ctx, [0, 20, 215], [60, 40, 2], wallMat, { noNearMiss: true });
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
    id: 3, name: 'CITY RUN', par: 50,
    hint: 'FULL SEND — FINISH WITH A DIVE INTO THE ROOF',
    env: {
      bg: 0x102e36, fogNear: 110, fogFar: 560, hemiSky: 0xaed4dd, hemiGround: 0x2e4a30, hemiInt: 1.0,
      sun: 0.8, groundTex: 'gridGreen', groundColor: 0xffffff, groundSize: 1600, groundRepeat: 400, groundY: 0
    },
    spawn: { pos: [0, 6, -34], dir: [0, 0.18, 1] },
    flight: { maxSpeed: 60, turnRate: 2.0 },
    targetColors: [0x9aa7c0, 0x6a7590, 0xffffff, 0xff8c1a],
    build(ctx) {
      const A = ctx.assets;
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
      box(ctx, [0, 35, 305], [18, 70, 18], gm(ctx, 'gridDark2', 0x9aa7c0, 18, 70), { noNearMiss: true });
      box(ctx, [0, 71, 305], [18, 2, 18], gm(ctx, 'gridDark', 0x666f85, 18, 18), { isTarget: true, targetMesh: true });
      const frameMat = gm(ctx, 'gridOrange', 0xffffff, 18, 1);
      for (const s of [[-8.2, 0], [8.2, 0], [0, -8.2], [0, 8.2]]) {
        const fr = box(ctx, [s[0], 72.4, 305 + s[1]], s[1] === 0 ? [1.6, 0.8, 18] : [18, 0.8, 1.6],
          frameMat, { collide: false, targetMesh: true });
      }
      scorchDecal(ctx, [0, 72.3, 305], [0, 1, 0], 5);
      ctx.target.pos = [0, 71, 305];
    }
  },
  {
    id: 4, name: 'bOSS FACTORY', par: 42,
    hint: 'PIPE GAUNTLET — TAKE OUT THE bOSS',
    env: {
      bg: 0x0b0912, fogNear: 36, fogFar: 300, hemiSky: 0xa8a8d0, hemiGround: 0x342a3a, hemiInt: 1.1,
      sun: 0.8, groundTex: 'gridDark', groundColor: 0xffffff, groundSize: 900, groundRepeat: 220, groundY: 0
    },
    spawn: { pos: [0, 5, -16], dir: [0, 0, 1] },
    flight: { maxSpeed: 42, turnRate: 2.5 },
    targetColors: [0xff5a4e, 0xffd23f, 0x7dff8a, 0x6fd3ff, 0xffffff, 0xff8c1a],
    build(ctx) {
      const A = ctx.assets;
      const wallMat = gm(ctx, 'gridDark2', 0x565064, 40, 30);
      launcherStand(ctx, [0, 3.2, -16]);
      corridor(ctx, { x: 20, y: 30, z0: -22, z1: 192, mat: wallMat });
      box(ctx, [0, 15, 191], [42, 30, 2], wallMat, { noNearMiss: true });
      // pipe gauntlet: horizontal cylinders across the corridor
      const pipeMat = gm(ctx, 'gridOrange', 0xffffff, 40, 3);
      const pipe = (y, z, r) => {
        const geo = new THREE.CylinderGeometry(r, r, 40, 12);
        const mesh = new THREE.Mesh(geo, pipeMat);
        mesh.rotation.z = Math.PI / 2;
        mesh.position.set(0, y, z);
        ctx.group.add(mesh);
        ctx.world.addBox([0, y, z], [40, r * 2, r * 2], {});
      };
      pipe(6, 25, 1.6);
      pipe(15, 45, 1.8);
      pipe(8, 65, 1.6); pipe(20, 65, 1.6);
      pipe(5, 85, 1.4); pipe(16, 85, 1.8);
      pipe(10, 100, 1.6); pipe(22, 100, 1.4);
      // conveyors + columns
      const beltMat = gm(ctx, 'gridDark', 0x3a3a44, 10, 3);
      box(ctx, [-9, 1.6, 115], [12, 3.2, 5], beltMat);
      box(ctx, [9, 1.6, 122], [12, 3.2, 5], beltMat);
      box(ctx, [-4, 1.6, 132], [12, 3.2, 5], beltMat);
      const colMat = gm(ctx, 'gridOrange', 0xcc7722, 3, 30);
      box(ctx, [-12, 15, 124], [3, 30, 3], colMat);
      box(ctx, [12, 15, 130], [3, 30, 3], colMat);
      box(ctx, [-16, 4, 145], [6, 8, 6], gm(ctx, 'gridOrange', 0xffffff, 6, 8));
      box(ctx, [16, 5, 150], [7, 10, 7], gm(ctx, 'gridOrange', 0xffffff, 7, 10));
      textSprite(ctx, 'FACTORY', [0, 25, 100], 1.4, '#ff8c1a');
      // boss pedestal
      box(ctx, [0, 3, 176], [6.5, 6, 6.5], gm(ctx, 'gridOrange', 0xffffff, 6, 6), { noNearMiss: true });
      const fallback = proceduralCharacter(ctx, [0, 6, 176], 1.8);
      ctx.target.meshes.push(fallback);
      ctx.world.addBox([0, 9.6, 176], [4.5, 7.2, 4.5], { isTarget: true });
      ctx.target.pos = [0, 9.5, 176];
      const boss = textSprite(ctx, 'bOSS', [0, 15.5, 176], 1.1, '#ffd23f');
      ctx.dynamic.push(t => { boss.position.y = 15.5 + Math.sin(t * 2.4) * 0.6; });
      // lazy FBX swap-in
      A.loadCharacter().then(fbx => {
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
        ch.position.set(0, 6 - bb.min.y * s, 176);
        ctx.group.add(ch);
        ctx.group.remove(fallback);
        const i = ctx.target.meshes.indexOf(fallback);
        if (i >= 0) ctx.target.meshes[i] = ch;
      });
    }
  }
];
