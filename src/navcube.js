// View cube in the viewport corner: a CSS 3D cube that turns with the camera. Each face is a 3×3 grid of hit
// areas, so the middle looks straight at that face, an edge looks along the 45° between two faces and a corner
// gives the isometric view between three. World axes: X east, Y north, Z up.
import * as THREE from 'three';

const SIZE = 64; // px, edge length of the cube

// n: outward normal; u / w: the label's right and up directions on that face (n = u × w).
const FACES = [
  { label: 'Top', n: [0, 0, 1], u: [1, 0, 0], w: [0, 1, 0] },
  { label: 'Bottom', n: [0, 0, -1], u: [-1, 0, 0], w: [0, 1, 0] },
  { label: 'South', n: [0, -1, 0], u: [1, 0, 0], w: [0, 0, 1] },
  { label: 'North', n: [0, 1, 0], u: [-1, 0, 0], w: [0, 0, 1] },
  { label: 'East', n: [1, 0, 0], u: [0, 1, 0], w: [0, 0, 1] },
  { label: 'West', n: [-1, 0, 0], u: [0, -1, 0], w: [0, 0, 1] },
];

const add = (...vs) => vs.reduce((a, v) => a.map((x, i) => x + v[i]));
const scale = (v, k) => v.map((x) => x * k);

function describe([x, y, z]) {
  return [z > 0 && 'top', z < 0 && 'bottom', y > 0 && 'north', y < 0 && 'south', x > 0 && 'east', x < 0 && 'west']
    .filter(Boolean).join(' ');
}

export function createNavCube(viewer, parent) {
  const root = document.createElement('div');
  root.className = 'navcube';
  const cube = document.createElement('div');
  cube.className = 'navcube-cube';
  root.append(cube);

  for (const f of FACES) {
    const face = document.createElement('div');
    face.className = `navcube-face face-${f.label.toLowerCase()}`;
    // Columns are u, -w (CSS y points down) and n, moved out by half the edge. With the reflection in the cube's
    // own transform (see update) the label reads the right way round from outside.
    const v = scale(f.w, -1);
    const t = scale(f.n, SIZE / 2);
    face.style.transform = `matrix3d(${[...f.u, 0, ...v, 0, ...f.n, 0, ...t, 1].join(',')})`;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const dir = add(f.n, scale(f.u, col - 1), scale(f.w, 1 - row));
        const name = `View from ${describe(dir)}`;
        const cell = document.createElement('button');
        cell.className = 'navcube-cell';
        cell.title = name;
        cell.setAttribute('aria-label', name);
        cell.onclick = () => viewer.viewFrom(new THREE.Vector3(...dir));
        face.append(cell);
      }
    }
    const label = document.createElement('span');
    label.className = 'navcube-label';
    label.textContent = f.label;
    face.append(label);
    cube.append(face);
  }
  parent.append(root);

  // CSS space is world space seen by the camera with Y flipped (screen y points down).
  const m = new THREE.Matrix4();
  const update = () => {
    const e = m.extractRotation(viewer.camera.matrixWorldInverse).elements.slice();
    e[1] = -e[1]; e[5] = -e[5]; e[9] = -e[9];
    cube.style.transform = `matrix3d(${e.join(',')})`;
  };
  viewer.onRender = update;
  update();
  return root;
}
