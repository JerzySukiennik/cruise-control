// Asset loading: textures, OBJ+MTL models, FBX character, cached grid materials.
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

const TEX_NAMES = {
  gridDark: 'grid_dark.png',
  gridDark2: 'grid_dark2.png',
  gridLight: 'grid_light.png',
  gridLight2: 'grid_light2.png',
  gridOrange: 'grid_orange.png',
  gridGreen: 'grid_green.png',
  gridRed: 'grid_red.png',
  scorch: 'scorch.png',
  flame: 'flame.png',
  smoke: 'smoke.png'
};

const MODEL_NAMES = [
  'table', 'tableCross', 'chair', 'chairRounded', 'desk', 'bookcaseClosedWide',
  'lampSquareTable', 'loungeChairRelax', 'sideTable', 'bench', 'cabinetTelevision',
  'sedan', 'sedanSports', 'taxi', 'van',
  'tree_default', 'tree_small', 'tree_cone', 'tree_pineTallA'
];

const SOUND_NAMES = [
  'space_engine_000', 'space_engine_002', 'engine_circular_000',
  'explosion_crunch_000', 'explosion_crunch_001', 'explosion_crunch_002',
  'low_frequency_explosion_000', 'low_frequency_explosion_001',
  'impact_metal', 'impact_generic', 'impact_plate',
  'near_miss', 'powerup', 'whoosh', 'ui_click', 'ui_confirm'
];

export class Assets {
  constructor() {
    this.textures = {};
    this.models = {};
    this.sounds = {};
    this.matCache = new Map();
    this.character = undefined;
  }

  async loadAll(onProgress) {
    const total = Object.keys(TEX_NAMES).length + MODEL_NAMES.length + SOUND_NAMES.length;
    let done = 0;
    const tick = () => { done++; if (onProgress) onProgress(done / total); };

    const texLoader = new THREE.TextureLoader();
    const texJobs = Object.entries(TEX_NAMES).map(([key, file]) =>
      texLoader.loadAsync('./assets/textures/' + file).then(t => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.magFilter = THREE.NearestFilter;
        t.minFilter = THREE.NearestMipmapNearestFilter;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        this.textures[key] = t;
        tick();
      }).catch(e => { console.warn('texture failed', file, e); tick(); })
    );

    const modelJobs = MODEL_NAMES.map(name => this._loadObj(name).then(g => {
      this.models[name] = g;
      tick();
    }).catch(e => { console.warn('model failed', name, e); tick(); }));

    const audioLoader = new THREE.AudioLoader();
    const soundJobs = SOUND_NAMES.map(name =>
      audioLoader.loadAsync('./assets/sounds/' + name + '.ogg').then(buf => {
        this.sounds[name] = buf;
        tick();
      }).catch(e => { console.warn('sound failed', name, e); tick(); })
    );

    await Promise.all([...texJobs, ...modelJobs, ...soundJobs]);
  }

  async _loadObj(name) {
    const mtlLoader = new MTLLoader();
    mtlLoader.setPath('./assets/models/');
    mtlLoader.setResourcePath('./assets/models/');
    const materials = await mtlLoader.loadAsync(name + '.mtl');
    materials.preload();
    const objLoader = new OBJLoader();
    objLoader.setMaterials(materials);
    objLoader.setPath('./assets/models/');
    const group = await objLoader.loadAsync(name + '.obj');
    group.traverse(child => {
      if (child.isMesh) {
        const src = Array.isArray(child.material) ? child.material : [child.material];
        const conv = src.map(m => {
          const lam = new THREE.MeshLambertMaterial({ color: m.color ? m.color.clone() : new THREE.Color(0xcccccc) });
          lam.name = m.name || '';
          return lam;
        });
        child.material = Array.isArray(child.material) ? conv : conv[0];
        child.userData.noDispose = true;
      }
    });
    return group;
  }

  // Deep clone that shares geometry/material with the cached original.
  getModel(name) {
    const src = this.models[name];
    if (!src) return null;
    const clone = src.clone(true);
    clone.traverse(c => { if (c.isMesh) c.userData.noDispose = true; });
    return clone;
  }

  // Cached tinted grid material with per-key texture repeat.
  gridMaterial(texKey, color, repeatX, repeatY) {
    const rx = Math.max(1, Math.round(repeatX));
    const ry = Math.max(1, Math.round(repeatY));
    const key = `${texKey}|${color}|${rx}x${ry}`;
    if (this.matCache.has(key)) return this.matCache.get(key);
    const base = this.textures[texKey];
    let map = null;
    if (base) {
      map = base.clone();
      map.repeat.set(rx, ry);
      map.needsUpdate = true;
    }
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), map });
    this.matCache.set(key, mat);
    return mat;
  }

  plainMaterial(color) {
    const key = `plain|${color}`;
    if (this.matCache.has(key)) return this.matCache.get(key);
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
    this.matCache.set(key, mat);
    return mat;
  }

  // Lazy FBX character for the boss level; returns null on failure.
  async loadCharacter() {
    if (this.character !== undefined) return this.character;
    try {
      const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
      const loader = new FBXLoader();
      const fbx = await loader.loadAsync('./assets/models/basicCharacter.fbx');
      const skin = await new THREE.TextureLoader().loadAsync('./assets/models/skin_man.png');
      skin.colorSpace = THREE.SRGBColorSpace;
      skin.magFilter = THREE.NearestFilter;
      skin.minFilter = THREE.NearestFilter;
      fbx.traverse(c => {
        if (c.isMesh) {
          c.material = new THREE.MeshLambertMaterial({ map: skin });
          c.userData.noDispose = true;
        }
      });
      this.character = fbx;
    } catch (e) {
      console.warn('FBX character failed, using fallback', e);
      this.character = null;
    }
    return this.character;
  }
}
