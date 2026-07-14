// Procedural missile mesh (+Z forward, ~4u long) and arcade flight model.
import * as THREE from 'three';

export function buildMissileMesh(tint = 0xf2f2f0) {
  const group = new THREE.Group();          // outer: position + flight quaternion
  const body = new THREE.Group();           // inner: cosmetic roll/bank
  group.add(body);
  body.name = 'bank';

  const white = new THREE.MeshLambertMaterial({ color: tint });
  const grey = new THREE.MeshLambertMaterial({ color: 0xb9bcc4 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x54586a });
  const red = new THREE.MeshLambertMaterial({ color: 0xd83a2a });

  // body cylinder along Z
  const bodyGeo = new THREE.CylinderGeometry(0.36, 0.36, 2.6, 12);
  bodyGeo.rotateX(Math.PI / 2);
  const bodyMesh = new THREE.Mesh(bodyGeo, white);
  bodyMesh.position.z = 0.1;
  body.add(bodyMesh);

  // nose cone
  const noseGeo = new THREE.ConeGeometry(0.36, 1.1, 12);
  noseGeo.rotateX(Math.PI / 2);
  const nose = new THREE.Mesh(noseGeo, white);
  nose.position.z = 1.95;
  body.add(nose);

  // nozzle
  const nozGeo = new THREE.CylinderGeometry(0.3, 0.24, 0.35, 10);
  nozGeo.rotateX(Math.PI / 2);
  const nozzle = new THREE.Mesh(nozGeo, dark);
  nozzle.position.z = -1.35;
  body.add(nozzle);

  // 4 tail fins
  const finGeo = new THREE.BoxGeometry(0.08, 0.85, 0.9);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(finGeo, grey);
    const a = i * Math.PI / 2;
    fin.position.set(Math.sin(a) * 0.62, Math.cos(a) * 0.62, -0.85);
    fin.rotation.z = -a;
    body.add(fin);
  }

  // 4 small grid fins near nose
  const gfGeo = new THREE.BoxGeometry(0.06, 0.34, 0.3);
  for (let i = 0; i < 4; i++) {
    const gf = new THREE.Mesh(gfGeo, dark);
    const a = i * Math.PI / 2 + Math.PI / 4;
    gf.position.set(Math.sin(a) * 0.5, Math.cos(a) * 0.5, 1.15);
    gf.rotation.z = -a;
    body.add(gf);
  }

  // red dot marking
  const dotGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.74, 8);
  dotGeo.rotateZ(Math.PI / 2);
  const dot = new THREE.Mesh(dotGeo, red);
  dot.position.set(0, 0.05, 0.6);
  dot.scale.set(1, 1, 0.35);
  body.add(dot);

  group.userData.bank = body;
  group.userData.tintMats = [white];
  return group;
}

const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
const _r = new THREE.Vector3();
const _du = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qDown = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);
const DOWN = new THREE.Vector3(0, -1, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class FlightModel {
  constructor() {
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.prevPos = new THREE.Vector3();
    this.speed = 0;
    this.gvel = 0;
    this.launched = false;
    this.roll = 0;
    this.pitchRate = 0;
    this.yawRate = 0;
    this.params = {
      accel: 30, maxSpeed: 55, drag: 9, gravity: 18,
      stallSpeed: 12, turnRate: 2.1, refSpeed: 22, bank: 0.85
    };
  }

  reset(pos, dir, up) {
    this.pos.copy(pos);
    this.prevPos.copy(pos);
    _f.copy(dir).normalize();
    if (Math.abs(_f.y) > 0.9) {
      // vertical spawn: build basis with explicit local up (course direction)
      _u.copy(up || Z).normalize();
      _r.crossVectors(_u, _f).normalize();
      const m = new THREE.Matrix4().makeBasis(_r, _u, _f);
      this.quat.setFromRotationMatrix(m);
    } else {
      this.quat.setFromUnitVectors(Z, _f);
    }
    this.speed = 0;
    this.gvel = 0;
    this.launched = false;
    this.roll = 0;
    this.pitchRate = 0;
    this.yawRate = 0;
  }

  forward(out) { return out.copy(Z).applyQuaternion(this.quat); }

  update(dt, steer, thrust) {
    this.prevPos.copy(this.pos);
    if (!this.launched) {
      if (thrust) this.launched = true;
      else return;
    }
    const p = this.params;

    // steering authority needs airflow
    const authority = Math.min(1, Math.max(0.18, this.speed / p.refSpeed));
    const damp = 1 - Math.exp(-dt * 5.5);
    this.pitchRate += (steer.y * p.turnRate * authority - this.pitchRate) * damp;
    this.yawRate += (steer.x * p.turnRate * authority - this.yawRate) * damp;

    _q.setFromAxisAngle(WORLD_UP, 0); // reuse
    // local pitch (nose up = negative angle around local X)
    _q.set(Math.sin(-this.pitchRate * dt / 2), 0, 0, Math.cos(-this.pitchRate * dt / 2));
    this.quat.multiply(_q);
    // local yaw (screen-right = negative angle around local Y)
    _q.set(0, Math.sin(-this.yawRate * dt / 2), 0, Math.cos(-this.yawRate * dt / 2));
    this.quat.multiply(_q);

    // speed
    if (thrust) {
      this.speed += p.accel * dt;
      if (this.speed > p.maxSpeed) this.speed = p.maxSpeed;
      this.gvel += (0 - this.gvel) * Math.min(1, dt * 4);
    } else {
      this.speed -= p.drag * dt;
      if (this.speed < 0) this.speed = 0;
      this.gvel = Math.min(30, this.gvel + p.gravity * dt);
    }

    // stall: nose drops when coasting too slow
    if (!thrust && this.speed < p.stallSpeed) {
      const k = 1 - this.speed / p.stallSpeed;
      _qDown.setFromUnitVectors(Z, DOWN);
      this.quat.rotateTowards(_qDown, k * 1.4 * dt);
    }

    // roll auto-level + bank into turns (cosmetic, applied to inner group)
    this.forward(_f);
    _u.set(0, 1, 0).applyQuaternion(this.quat);
    if (Math.abs(_f.y) < 0.92) {
      _du.copy(WORLD_UP).addScaledVector(_f, -_f.y).normalize();
      _r.crossVectors(_u, _du);
      const rollErr = Math.asin(Math.max(-1, Math.min(1, _r.dot(_f))));
      _q.set(0, 0, Math.sin(rollErr * Math.min(1, dt * 3) / 2), Math.cos(rollErr * Math.min(1, dt * 3) / 2));
      this.quat.multiply(_q);
    }
    const targetRoll = steer.x * p.bank;
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 6);

    // integrate
    this.quat.normalize();
    this.forward(_f);
    this.pos.addScaledVector(_f, this.speed * dt);
    this.pos.y -= this.gvel * dt;
  }

  applyTo(mesh) {
    mesh.position.copy(this.pos);
    mesh.quaternion.copy(this.quat);
    mesh.userData.bank.rotation.z = this.roll;
  }
}
