// Three.js scene: owns renderer, camera, materials and the meshes built from parsed models.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { styleFor } from './colors.js';

const SKY_TOP = '#d9e1e9';
const SKY_BOTTOM = '#f0f2f4';
const HORIZON = 0xe6ebf0; // between the two, since the far grid edge can sit anywhere on screen

/** Soft vertical gradient used as the screen-space scene background. */
function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, SKY_TOP);
  grad.addColorStop(1, SKY_BOTTOM);
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Viewer {
  constructor(container) {
    this.container = container;
    this.models = [];
    this.materials = new Map();
    this.edgeMaterial = new THREE.LineBasicMaterial({ color: 0x1d2228, transparent: true, opacity: 0.35, fog: false });
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    this.clipEnabled = false;
    this.xray = false;
    this.showEdges = true;
    this.highlightGroup = new THREE.Group();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = skyTexture();
    // Fog only touches the grid (model materials opt out), so the ground fades out instead of ending in a hard edge.
    this.scene.fog = new THREE.Fog(HORIZON, 1, 1000);
    this.gridHalf = 100;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100000);
    this.camera.up.set(0, 0, 1); // CityGML is Z-up
    this.camera.position.set(60, -80, 60);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.requestRender());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6357, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.6, -0.8, 1.4);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-1, 0.7, 0.4);
    this.scene.add(fill);

    this.grid = new THREE.GridHelper(200, 40, 0xb8c0c8, 0xd2d8de);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);
    this.scene.add(this.highlightGroup);

    this.raycaster = new THREE.Raycaster();
    this._needsRender = true;

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      if (this._viewAnim) this._viewAnim(performance.now());
      if (this.controls.update() || this._needsRender) {
        this._needsRender = false;
        this.updateFog();
        this.renderer.render(this.scene, this.camera);
        this.onRender?.();
      }
    };
    loop();
  }

  requestRender() { this._needsRender = true; }

  /** Grid fades from the orbit target to its far edge, whatever the zoom. */
  updateFog() {
    const d = this.camera.position.distanceTo(this.controls.target);
    this.scene.fog.near = d;
    this.scene.fog.far = d + this.gridHalf;
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /** Active clipping planes for a model: global section plane + the model's storey band. */
  planesFor(model) {
    const planes = [];
    if (this.clipEnabled) planes.push(this.clipPlane);
    if (model?.band) planes.push(...model.band.planes);
    return planes.length ? planes : null;
  }

  // Materials are per model so each model can carry its own storey clipping band.
  materialFor(model, category) {
    const key = model.id + '|' + category;
    let m = this.materials.get(key);
    if (!m) {
      const st = styleFor(category);
      m = new THREE.MeshLambertMaterial({
        color: new THREE.Color(st.color),
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        fog: false,
      });
      m.userData.baseOpacity = st.opacity ?? 1;
      m.userData.model = model;
      this.materials.set(key, m);
      this.applyMaterialState(m);
    }
    return m;
  }

  applyMaterialState(m) {
    const base = m.userData.baseOpacity;
    const opacity = this.xray ? Math.min(base, 0.18) : base;
    m.opacity = opacity;
    m.transparent = opacity < 1;
    m.depthWrite = opacity >= 1;
    m.clippingPlanes = this.planesFor(m.userData.model);
    m.needsUpdate = true;
  }

  refreshClipping() {
    for (const m of this.materials.values()) this.applyMaterialState(m);
    for (const model of this.models) {
      model.edgeMaterial.clippingPlanes = this.planesFor(model);
      model.edgeMaterial.needsUpdate = true;
    }
    for (const c of this.highlightGroup.children) {
      c.material.clippingPlanes = this.planesFor(c.userData.model);
      c.material.needsUpdate = true;
    }
    this.requestRender();
  }

  /** Restricts a model to the world-Z band [bottom, top]; pass null to clear. */
  setModelBand(model, bottom, top) {
    model.band = bottom == null ? null : {
      bottom,
      top,
      planes: [
        new THREE.Plane(new THREE.Vector3(0, 0, 1), -bottom),
        new THREE.Plane(new THREE.Vector3(0, 0, -1), top),
      ],
    };
    this.refreshClipping();
  }

  /** Builds meshes for a parsed model. `origin` is subtracted to keep float32 precision. */
  addModel(model, origin) {
    const group = new THREE.Group();
    group.name = model.fileName;
    model.group = group;
    model.meshes = [];
    model.band = null;
    model.edgeMaterial = this.edgeMaterial.clone();
    model.edgeMaterial.clippingPlanes = this.planesFor(model);
    for (const b of model.buckets) {
      const n = b.positions.length;
      const pos = new Float32Array(n);
      for (let i = 0; i < n; i += 3) {
        pos[i] = b.positions[i] - origin[0];
        pos[i + 1] = b.positions[i + 1] - origin[1];
        pos[i + 2] = b.positions[i + 2] - origin[2];
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b.normals), 3));
      geom.computeBoundingBox();
      geom.computeBoundingSphere();
      const mesh = new THREE.Mesh(geom, this.materialFor(model, b.category));
      mesh.userData = { model, bucket: b };

      const e = new Float32Array(b.edges.length);
      for (let i = 0; i < e.length; i += 3) {
        e[i] = b.edges[i] - origin[0];
        e[i + 1] = b.edges[i + 1] - origin[1];
        e[i + 2] = b.edges[i + 2] - origin[2];
      }
      const lgeom = new THREE.BufferGeometry();
      lgeom.setAttribute('position', new THREE.BufferAttribute(e, 3));
      const lines = new THREE.LineSegments(lgeom, model.edgeMaterial);
      lines.visible = this.showEdges;

      // Positions are kept on the mesh; drop the large JS arrays.
      b.triObject = Int32Array.from(b.triObject);
      b.triPolygon = Int32Array.from(b.triPolygon);
      b.positions = null;
      b.normals = null;
      b.edges = null;

      group.add(mesh, lines);
      model.meshes.push({ mesh, lines, bucket: b });
    }
    this.scene.add(group);
    this.models.push(model);
    this.requestRender();
  }

  removeModel(model) {
    this.scene.remove(model.group);
    for (const { mesh, lines } of model.meshes) {
      mesh.geometry.dispose();
      lines.geometry.dispose();
    }
    for (const [key, m] of this.materials) {
      if (m.userData.model === model) { m.dispose(); this.materials.delete(key); }
    }
    model.edgeMaterial.dispose();
    this.models = this.models.filter((m) => m !== model);
    this.requestRender();
  }

  /** visibleFn(model, bucket) → boolean */
  updateVisibility(visibleFn) {
    for (const model of this.models) {
      for (const { mesh, lines, bucket } of model.meshes) {
        const v = visibleFn(model, bucket);
        mesh.visible = v;
        lines.visible = v && this.showEdges;
      }
    }
    this.requestRender();
  }

  setEdges(on) {
    this.showEdges = on;
    for (const model of this.models) for (const { mesh, lines } of model.meshes) lines.visible = on && mesh.visible;
    this.requestRender();
  }

  setXray(on) {
    this.xray = on;
    for (const model of this.models) model.edgeMaterial.opacity = on ? 0.2 : 0.35;
    for (const m of this.materials.values()) this.applyMaterialState(m);
    this.requestRender();
  }

  setClip(enabled, z) {
    this.clipEnabled = enabled;
    this.clipPlane.constant = z;
    this.refreshClipping();
  }

  setBackground(color) {
    this.scene.background = new THREE.Color(color);
    this.scene.fog.color.set(color);
    this.requestRender();
  }

  /** Local (origin-relative, unshifted) bounding box of all of a model's geometry. */
  modelLocalBox(model) {
    const box = new THREE.Box3();
    for (const { mesh } of model.meshes) box.union(mesh.geometry.boundingBox);
    return box;
  }

  /** Shifts a model in the scene (used for side-by-side layout). */
  setModelOffset(model, x, y, z = 0) {
    model.group.position.set(x, y, z);
    this.requestRender();
  }

  visibleBox() {
    const box = new THREE.Box3();
    for (const model of this.models) {
      for (const { mesh } of model.meshes) {
        if (mesh.visible && model.group.visible) {
          box.union(mesh.geometry.boundingBox.clone().translate(model.group.position));
        }
      }
    }
    if (box.isEmpty()) for (const model of this.models) box.expandByObject(model.group);
    return box;
  }

  updateGrid(box) {
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, 10) * 3;
    const step = Math.pow(10, Math.floor(Math.log10(extent / 10)));
    const divisions = Math.max(10, Math.round(extent / step));
    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    this.grid = new THREE.GridHelper(divisions * step, divisions, 0xb8c0c8, 0xd2d8de);
    this.grid.rotation.x = Math.PI / 2;
    this.gridHalf = (divisions * step) / 2;
    const c = box.getCenter(new THREE.Vector3());
    this.grid.position.set(c.x, c.y, box.min.z - 0.02);
    this.scene.add(this.grid);
    this.requestRender();
  }

  /** Swings the camera around the orbit target to look from `dir` (world space), keeping the distance. */
  viewFrom(dir, duration = 350) {
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    const dist = offset.length();
    const from = offset.normalize();
    const to = dir.clone().normalize();
    // Straight up/down is degenerate for a Z-up orbit; nudge it so north stays at the top of the screen.
    if (Math.abs(to.z) > 0.9999) to.set(0, -1e-4 * Math.sign(to.z), Math.sign(to.z)).normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(from, to);
    const start = performance.now();
    this._viewAnim = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const k = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease in-out
      const q = new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), turn, k);
      this.camera.position.copy(target).addScaledVector(from.clone().applyQuaternion(q), dist);
      this.requestRender();
      if (t >= 1) this._viewAnim = null;
    };
    this.requestRender();
  }

  /** view: 'iso' | 'top' | 'front' | 'keep' */
  fitTo(box, view = 'keep') {
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.5);
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.05;
    let dir;
    if (view === 'top') dir = new THREE.Vector3(0, -0.0001, 1);
    else if (view === 'front') dir = new THREE.Vector3(0, -1, 0.15);
    else if (view === 'iso' || this.models.length === 0) dir = new THREE.Vector3(0.8, -1, 0.75);
    else dir = this.camera.position.clone().sub(this.controls.target);
    dir.normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(dist / 1000, 0.01);
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
  }

  fitModel(model) {
    this.fitTo(new THREE.Box3().setFromObject(model.group));
  }

  /** Returns the nearest visible hit: { model, bucket, faceIndex, point } or null. */
  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets = [];
    for (const model of this.models) {
      if (!model.group.visible) continue;
      for (const { mesh } of model.meshes) if (mesh.visible) targets.push(mesh);
    }
    const hits = this.raycaster.intersectObjects(targets, false);
    for (const h of hits) {
      if (this.clipEnabled && h.point.z > this.clipPlane.constant) continue;
      const { model, bucket } = h.object.userData;
      if (model.band && (h.point.z < model.band.bottom || h.point.z > model.band.top)) continue;
      // Report the point in the model's own (unshifted) frame.
      return { model, bucket, faceIndex: h.faceIndex, point: h.point.clone().sub(model.group.position) };
    }
    return null;
  }

  clearHighlight() {
    for (const c of this.highlightGroup.children) {
      c.geometry.dispose();
      c.material.dispose();
    }
    this.highlightGroup.clear();
    this.requestRender();
  }

  /**
   * Highlights every triangle of `model` whose object index is in `objectSet`
   * (only in currently visible buckets unless `includeHidden`). Returns the bounding box.
   */
  highlight(model, objectSet, { includeHidden = false } = {}) {
    this.clearHighlight();
    const out = [];
    const box = new THREE.Box3();
    for (const { mesh, bucket } of model.meshes) {
      if (!includeHidden && !mesh.visible) continue;
      const src = mesh.geometry.attributes.position.array;
      const to = bucket.triObject;
      for (let t = 0; t < to.length; t++) {
        if (!objectSet.has(to[t])) continue;
        for (let k = 0; k < 9; k++) out.push(src[t * 9 + k]);
      }
    }
    if (!out.length) { this.requestRender(); return box; }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(out), 3));
    geom.computeBoundingBox();
    box.copy(geom.boundingBox);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xe040fb, // matches --sel; no semantic class colour is magenta
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthTest: !this.xray,
      depthWrite: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      clippingPlanes: this.planesFor(model),
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.model = model;
    mesh.renderOrder = 10;
    mesh.position.copy(model.group.position);
    this.highlightGroup.add(mesh);
    this.requestRender();
    return box.translate(model.group.position);
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }
}
