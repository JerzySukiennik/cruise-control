// Playground: between-levels toy scene — rings, breakable wall, soft crates,
// ramps, bouncy sphere and the leaderboard billboard. No death here, ever.
import * as THREE from 'three';
import { HELPERS } from './levels.js';

const { gm, box, ring, textSprite } = HELPERS;

export const PLAYGROUND = {
  id: -1, name: 'PLAYGROUND', par: 0,
  hint: 'WARM-UP ZONE — NOTHING HERE CAN KILL YOU',
  playground: true,
  env: {
    bg: 0x142f38, fogNear: 90, fogFar: 460, hemiSky: 0xbfd8e8, hemiGround: 0x3a5c3a, hemiInt: 0.95,
    sun: 0.75, groundTex: 'gridGreen', groundColor: 0xffffff, groundSize: 1400, groundRepeat: 340, groundY: 0
  },
  spawn: { pos: [0, 4, -30], dir: [0, 0.1, 1] },
  flight: { maxSpeed: 44, turnRate: 1.7 },
  targetColors: [0xffffff],
  build(ctx) {
    // rings to lace through
    ring(ctx, { pos: [-14, 10, 10], r: 5, color: 0xff8c1a });
    ring(ctx, { pos: [-20, 16, 45], r: 4.6 });
    ring(ctx, { pos: [-8, 8, 75], r: 4.6, color: 0x37c8c3 });

    // breakable wall (kamikaze is free here)
    const glass = gm(ctx, 'gridLight', 0x64c8c4, 6, 10);
    for (let i = 0; i < 5; i++) {
      box(ctx, [14 + (i - 2) * 6.2, 5.5, 30], [6, 11, 1], glass); // thin → breakable
    }
    textSprite(ctx, 'SMASH ME', [14, 14, 30], 1, '#37c8c3');

    // soft crate stack: bursts into debris when flown through, no crash
    const crate = gm(ctx, 'gridOrange', 0xcc8844, 3, 3);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4 - r; c++) {
      box(ctx, [26 + c * 3.2 + r * 1.6, 1.5 + r * 3.1, 62], [3, 3, 3], crate,
        { soft: true, breakable: false, noNearMiss: true });
    }

    // 2 ramps (visual toys, non-lethal, no collider)
    const rampMat = gm(ctx, 'gridDark', 0x8f8fa0, 10, 16);
    const r1 = box(ctx, [-30, 2.2, -5], [10, 1.2, 16], rampMat, { collide: false });
    r1.rotation.x = -0.42;
    const r2 = box(ctx, [30, 2.2, -5], [10, 1.2, 16], rampMat, { collide: false });
    r2.rotation.x = -0.42;
    r2.rotation.y = Math.PI;

    // bouncy sphere
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(4, 14, 10),
      ctx.assets.plainMaterial(0xff5a4e)
    );
    ball.position.set(0, 4, 55);
    ctx.group.add(ball);
    ctx.world.addSphere([0, 4, 55], 4, { bouncy: true, noNearMiss: true });
    ctx.dynamic.push(t => { ball.position.y = 4 + Math.abs(Math.sin(t * 1.8)) * 1.4; });

    // leaderboard billboard
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 384;
    const g = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 22.5),
      new THREE.MeshBasicMaterial({ map: tex })
    );
    board.position.set(0, 15, 105);
    board.rotation.y = Math.PI; // face the spawn (-z side)
    ctx.group.add(board);
    // posts + frame
    const post = gm(ctx, 'gridDark', 0x54586a, 2, 15);
    box(ctx, [-13, 4, 105.6], [1.6, 8, 1.6], post, { noNearMiss: true, breakable: false });
    box(ctx, [13, 4, 105.6], [1.6, 8, 1.6], post, { noNearMiss: true, breakable: false });

    const draw = rows => {
      g.fillStyle = '#10162e';
      g.fillRect(0, 0, 512, 384);
      g.strokeStyle = '#ffd23f'; g.lineWidth = 8;
      g.strokeRect(6, 6, 500, 372);
      g.fillStyle = '#ffd23f';
      g.font = '900 36px -apple-system, "Segoe UI", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillText('MOST LEVELS CLEARED', 256, 22);
      g.font = '800 28px -apple-system, "Segoe UI", Arial, sans-serif';
      if (!rows || rows.length === 0) {
        g.fillStyle = '#7f8db8';
        g.fillText('NO SCORES YET', 256, 170);
      } else {
        for (let i = 0; i < Math.min(8, rows.length); i++) {
          const y = 80 + i * 36;
          g.fillStyle = i === 0 ? '#ffd23f' : '#ffffff';
          g.textAlign = 'left';
          g.fillText(`${i + 1}. ${String(rows[i].name || '???').slice(0, 10)}`, 48, y);
          g.textAlign = 'right';
          g.fillText(String(rows[i].levels || 0), 464, y);
        }
        g.textAlign = 'center';
      }
      tex.needsUpdate = true;
    };
    draw([]);
    ctx.billboard = { draw };
  }
};
