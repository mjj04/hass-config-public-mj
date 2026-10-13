// 3D view of the house from an OBJ (+ MTL) model. Floor meshes named
// room_<id> are the rooms: tap one to select it, and they glow when
// their lights are on. Loaded only when the 3D tab is opened.

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const WARM = new THREE.Color(0xffa62b);
const SELECT = new THREE.Color(0x4f7dff);

// camera: direction to look from, [x, y, z]. The default matches the
// isometric plans (front of the house towards the bottom right).
export async function mountHouse3D(container, { obj, mtl, camera: dir = [-1, 1.6, 1.1], chipFor, onSelect }) {
  const size = () => [Math.max(1, container.clientWidth), Math.max(1, container.clientHeight)];
  let [w, hgt] = size();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, hgt);
  renderer.domElement.style.touchAction = 'none';
  const labels = new CSS2DRenderer();
  labels.setSize(w, hgt);
  Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  container.append(renderer.domElement, labels.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a44, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(6, 12, 4);
  scene.add(sun);

  const loader = new OBJLoader();
  if (mtl) {
    const materials = await new MTLLoader().loadAsync(mtl);
    materials.preload();
    loader.setMaterials(materials);
  }
  const model = await loader.loadAsync(obj);
  scene.add(model);

  // Give every mesh its own material so rooms can be tinted separately.
  const rooms = new Map(); // id -> { mesh, chip }
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    if (!o.name.startsWith('room_')) return;
    const id = o.name.slice(5);
    const box = new THREE.Box3().setFromObject(o);
    const label = new CSS2DObject(chipFor(id));
    label.position.copy(box.getCenter(new THREE.Vector3())).setY(box.max.y + 0.3);
    scene.add(label);
    rooms.set(id, { mesh: o, chip: label.element });
  });

  const bounds = new THREE.Box3().setFromObject(model);
  const centre = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getSize(new THREE.Vector3()).length() / 2;
  const camera = new THREE.PerspectiveCamera(35, w / hgt, 0.1, 200);
  camera.position.copy(centre).add(new THREE.Vector3(...dir).normalize().multiplyScalar(radius * 3.4));

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(centre);
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI * 0.46;
  controls.minDistance = radius * 1.4;
  controls.maxDistance = radius * 6;
  controls.update();

  const render = () => {
    renderer.render(scene, camera);
    labels.render(scene, camera);
  };
  controls.addEventListener('change', render);

  // A tap (not a drag) selects the room under the finger.
  const ray = new THREE.Raycaster();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObject(model, true).find((i) => i.object.name.startsWith('room_'));
    onSelect(hit ? hit.object.name.slice(5) : null);
  });

  const ro = new ResizeObserver(() => {
    [w, hgt] = size();
    renderer.setSize(w, hgt);
    labels.setSize(w, hgt);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
    render();
  });
  ro.observe(container);

  return {
    // states: Map id -> { lit, selected }
    update(states) {
      for (const [id, { mesh }] of rooms) {
        const s = states.get(id) || {};
        const mat = mesh.material;
        if (!mat.emissive) continue;
        if (s.lit) { mat.emissive.copy(WARM); mat.emissiveIntensity = s.selected ? 0.75 : 0.55; }
        else if (s.selected) { mat.emissive.copy(SELECT); mat.emissiveIntensity = 0.45; }
        else { mat.emissive.setRGB(0, 0, 0); }
      }
      render();
    },
    chips: () => [...rooms].map(([id, r]) => [id, r.chip]),
    dispose() {
      ro.disconnect();
      controls.dispose();
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        [].concat(o.material).forEach((m) => m.dispose());
      });
      renderer.dispose();
      container.replaceChildren();
    },
  };
}
