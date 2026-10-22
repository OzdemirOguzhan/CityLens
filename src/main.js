import { Viewer } from './viewer.js';
import { parseCityGML } from './parser.js';
import { styleFor, LOD_LABELS } from './colors.js';
import { renderMarkdown } from './markdown.js';
import sourcesMd from '/samples/SOURCES.md?raw';
import apacheLicenseUrl from '/samples/LICENSE-Apache-2.0.txt?url';

const $ = (id) => document.getElementById(id);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const viewer = new Viewer($('viewport'));

const state = {
  models: [],
  origin: null,
  lodVisible: new Map(),
  catVisible: new Map(),
  selection: null, // { model, obj, poly, point }
  sideBySide: false,
  storey: null, // active storey key (storey number as string) or null for all
  savedLods: null, // LOD visibility to restore when leaving floor mode
  ceilingsHidden: false, // floor mode hid CeilingSurface and should restore it on leaving
  expanded: new Set(), // tree node keys `${modelId}:${objIndex}`
};
let modelSeq = 0;

// ---------------------------------------------------------------- loading

async function loadText(text, fileName) {
  showLoading(`Parsing ${fileName}…`);
  await new Promise((r) => setTimeout(r, 30)); // let the overlay paint
  try {
    const t0 = performance.now();
    const model = parseCityGML(text, fileName);
    model.id = ++modelSeq;
    model.visible = true;
    model.parseMs = performance.now() - t0;
    if (!model.polygons.length) throw new Error('No polygon geometry found in this file.');

    if (!state.origin) {
      const b = model.bbox;
      state.origin = [0, 1, 2].map((i) => Math.round((b.min[i] + b.max[i]) / 2));
    }
    // Reverse lookup for group membership.
    model.memberOf = new Map();
    for (const o of model.objects) {
      for (const ref of o.members) {
        const idx = model.idMap.get(ref);
        if (idx == null) continue;
        if (!model.memberOf.has(idx)) model.memberOf.set(idx, []);
        model.memberOf.get(idx).push(o.index);
      }
    }
    model.triangleCount = model.buckets.reduce((s, b) => s + b.triObject.length, 0);
    model.storeys = extractStoreys(model);
    applyLodDefaults(model);
    for (const b of model.buckets) if (!state.catVisible.has(b.category)) state.catVisible.set(b.category, true);

    viewer.addModel(model, state.origin);
    state.models.push(model);
    for (const r of model.roots) state.expanded.add(`${model.id}:${r}`);

    if (!state.sideBySide && state.models.length > 1 && modelsFarApart()) state.sideBySide = true;
    refreshVisibility();
    refreshAll();
    relayout(state.models.length === 1 ? 'iso' : 'keep');
  } catch (err) {
    console.error(err);
    alert(`Could not load ${fileName}:\n${err.message}`);
  } finally {
    hideLoading();
  }
}

function applyLodDefaults(model) {
  const lods = new Set(model.buckets.map((b) => b.lod));
  const exterior = ['3', '2', '1'].find((l) => lods.has(l));
  const highest = ['4', '3', '2', '1', '0'].find((l) => lods.has(l));
  const preferred = exterior || highest;
  for (const l of lods) {
    if (state.lodVisible.has(l)) continue;
    let on = l === preferred;
    if (l === '?') on = true;
    if (!preferred && l === 'G') on = true;
    state.lodVisible.set(l, on);
  }
}

async function loadFiles(files) {
  for (const f of files) await loadText(await f.text(), f.name);
}

function showLoading(text) {
  $('loading-text').textContent = text;
  $('loading').hidden = false;
}
function hideLoading() { $('loading').hidden = true; }

function removeModel(model) {
  viewer.removeModel(model);
  state.models = state.models.filter((m) => m !== model);
  if (state.selection?.model === model) select(null);
  // Leave floor mode if no remaining file has the active storey; otherwise every file stays hidden
  // and the storey chips (the only way out) disappear with the list.
  if (state.storey != null && !storeyList().some((s) => s.key === state.storey)) setStorey(null);
  if (!state.models.length) {
    state.origin = null;
    state.lodVisible.clear();
    state.catVisible.clear();
    state.storey = null;
    state.savedLods = null;
    state.ceilingsHidden = false;
  }
  refreshVisibility();
  refreshAll();
  if (state.models.length) relayout();
  updateClipRange();
}

// ---------------------------------------------------------------- visibility

function refreshVisibility() {
  // In floor mode, files that don't have the chosen storey are hidden.
  for (const m of state.models) m.group.visible = m.visible && (state.storey == null || !!storeyOf(m));
  viewer.updateVisibility((model, b) =>
    model.visible && state.lodVisible.get(b.lod) !== false && state.catVisible.get(b.category) !== false);
  if (state.selection) highlightSelection(false);
}

// ---------------------------------------------------------------- panels

function refreshAll() {
  renderFiles();
  renderLods();
  renderStoreys();
  renderClasses();
  renderTree();
  renderStatus();
  $('empty-state').hidden = state.models.length > 0;
}

function renderFiles() {
  const ul = $('file-list');
  ul.replaceChildren();
  $('file-count').textContent = state.models.length ? state.models.length : '';
  if (!state.models.length) { ul.append(h('li', { class: 'empty' }, 'No files loaded')); return; }
  for (const m of state.models) {
    ul.append(h('li', { class: m.visible ? '' : 'off' },
      h('input', {
        type: 'checkbox', checked: m.visible, title: 'Show / hide',
        onchange: (e) => { m.visible = e.target.checked; refreshVisibility(); renderFiles(); },
      }),
      h('span', { class: 'fname', title: m.fileName }, m.fileName),
      h('span', { class: 'muted small' }, `v${m.version}`),
      h('button', { class: 'icon', title: 'Zoom to file', onclick: () => viewer.fitModel(m) }, '⌖'),
      h('button', { class: 'icon', title: 'Remove', onclick: () => removeModel(m) }, '×'),
    ));
  }
}

function countBy(keyFn) {
  const counts = new Map();
  for (const m of state.models) {
    if (!m.visible) continue;
    for (const b of m.buckets) counts.set(keyFn(b), (counts.get(keyFn(b)) || 0) + b.polygonCount);
  }
  return counts;
}

function renderLods() {
  const div = $('lod-list');
  div.replaceChildren();
  const counts = countBy((b) => b.lod);
  const order = ['0', '1', '2', '3', '4', 'G', '?'];
  for (const l of order) {
    if (!counts.has(l)) continue;
    const on = state.lodVisible.get(l) !== false;
    div.append(h('button', {
      class: 'chip' + (on ? ' on' : ''),
      title: `${counts.get(l)} polygons — click to toggle, Alt+click to show only this`,
      onclick: (e) => {
        if (e.altKey) for (const k of state.lodVisible.keys()) state.lodVisible.set(k, k === l);
        else state.lodVisible.set(l, !on);
        state.savedLods = null; // a manual choice wins over the floor-mode restore
        refreshVisibility(); renderLods();
      },
    }, LOD_LABELS[l] || l, h('span', { class: 'count' }, counts.get(l))));
  }
  if (!div.children.length) div.append(h('span', { class: 'muted small' }, '–'));
}

// ---------------------------------------------------------------- storeys

const STOREY_CLASS = /^(kat|storey|floor|etage|geschoss|stockwerk)$/i;
const STOREY_EPS = 0.05; // metres; keeps coplanar slabs of the next storey out of the band

/**
 * Finds storeys: CityGML 3.0 bldg:Storey objects, or CityObjectGroups whose class is a storey
 * (e.g. MAKS "Kat") or that carry a storeyNumber attribute. Each storey gets a Z band from its
 * own geometry (or its members'), running up to the next storey's floor.
 */
function extractStoreys(model) {
  const objZ = new Map();
  for (const p of model.polygons) {
    if (p.object < 0) continue;
    const z = objZ.get(p.object);
    if (z) { z[0] = Math.min(z[0], p.zMin); z[1] = Math.max(z[1], p.zMax); }
    else objZ.set(p.object, [p.zMin, p.zMax]);
  }
  const rangeOf = (idx) => {
    if (objZ.has(idx)) return objZ.get(idx);
    let lo = Infinity, hi = -Infinity;
    for (const d of descendants(model, idx)) {
      const z = objZ.get(d);
      if (z) { lo = Math.min(lo, z[0]); hi = Math.max(hi, z[1]); }
    }
    return lo <= hi ? [lo, hi] : null;
  };

  const storeys = [];
  for (const o of model.objects) {
    const cls = o.attributes.find((a) => a.name === 'class')?.value || '';
    const numAttr = o.attributes.find((a) => /^storey_?(number|no)$/i.test(a.name));
    const isStorey = o.type === 'Storey'
      || (o.type === 'CityObjectGroup' && (STOREY_CLASS.test(cls) || numAttr));
    if (!isStorey) continue;
    const range = rangeOf(o.index);
    if (!range) continue;
    let num = numAttr ? parseFloat(numAttr.value) : NaN;
    if (Number.isNaN(num)) {
      const m = (o.name || '').match(/(-?\d+)(?!.*\d)/);
      if (m) num = parseInt(m[1], 10);
    }
    storeys.push({ obj: o.index, num, label: (o.name || '').replace(/_/g, ' ').trim(), zMin: range[0], zMax: range[1] });
  }
  storeys.sort((a, b) => a.zMin - b.zMin);
  storeys.forEach((s, i) => {
    if (Number.isNaN(s.num)) s.num = i;
    s.key = String(s.num);
    if (!s.label) s.label = `Storey ${s.num}`;
    const next = storeys.slice(i + 1).find((n) => n.zMin > s.zMin + STOREY_EPS);
    s.bottom = s.zMin - STOREY_EPS;
    s.top = next ? next.zMin - STOREY_EPS : s.zMax + STOREY_EPS;
  });
  return storeys;
}

function storeyOf(model) {
  return state.storey == null ? null : model.storeys.find((s) => s.key === state.storey) || null;
}

/** Unified storey list across loaded files, sorted by storey number. */
function storeyList() {
  const map = new Map();
  for (const m of state.models) {
    for (const s of m.storeys) {
      if (!map.has(s.key)) map.set(s.key, { key: s.key, num: s.num, label: s.label, files: 0 });
      map.get(s.key).files++;
    }
  }
  return [...map.values()].sort((a, b) => a.num - b.num);
}

/** Pushes each model's storey band (in world Z) to the viewer. */
function applyStoreyFilter() {
  for (const m of state.models) {
    const s = storeyOf(m);
    if (!s) { viewer.setModelBand(m, null); continue; }
    const dz = m.group.position.z - state.origin[2];
    viewer.setModelBand(m, s.bottom + dz, s.top + dz);
  }
}

function setStorey(key) {
  const entering = key != null && state.storey == null;
  const leaving = key == null && state.storey != null;
  state.storey = key;
  if (entering && state.lodVisible.has('4')) {
    // Floor mode: interiors are what make a single storey readable.
    state.savedLods = new Map(state.lodVisible);
    for (const k of state.lodVisible.keys()) state.lodVisible.set(k, k === '4');
  } else if (leaving && state.savedLods) {
    state.lodVisible = state.savedLods;
    state.savedLods = null;
  }
  // Ceilings cover the plan when looking down on a single storey.
  if (entering && state.catVisible.get('CeilingSurface')) {
    state.catVisible.set('CeilingSurface', false);
    state.ceilingsHidden = true;
  } else if (leaving && state.ceilingsHidden) {
    state.catVisible.set('CeilingSurface', true);
    state.ceilingsHidden = false;
  }
  applyStoreyFilter();
  refreshVisibility();
  renderLods();
  renderClasses();
  renderStoreys();
  renderStatus();
}

function stepStorey(dir) {
  const list = storeyList();
  if (!list.length) return;
  const i = list.findIndex((s) => s.key === state.storey);
  if (i < 0) setStorey(list[dir > 0 ? 0 : list.length - 1].key);
  else setStorey(list[Math.min(list.length - 1, Math.max(0, i + dir))].key);
}

function renderStoreys() {
  const list = storeyList();
  $('storey-section').hidden = !list.length;
  const div = $('storey-list');
  div.replaceChildren();
  if (!list.length) return;
  const multi = state.models.length > 1;
  div.append(
    h('button', { class: 'chip' + (state.storey == null ? ' on' : ''), onclick: () => setStorey(null) }, 'All'),
    ...list.map((s) => h('button', {
      class: 'chip' + (state.storey === s.key ? ' on' : ''),
      title: multi ? `${s.label} — present in ${s.files} of ${state.models.length} files` : s.label,
      onclick: () => setStorey(state.storey === s.key ? null : s.key),
    }, s.label, multi && s.files < state.models.length && h('span', { class: 'count' }, `${s.files}/${state.models.length}`))),
  );
}

function renderClasses() {
  const ul = $('class-list');
  ul.replaceChildren();
  const counts = countBy((b) => b.category);
  const cats = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
  for (const c of cats) {
    const on = state.catVisible.get(c) !== false;
    ul.append(h('li', { class: on ? '' : 'off' },
      h('label', { title: 'Alt+click to show only this class' },
        h('input', {
          type: 'checkbox', checked: on,
          onclick: (e) => {
            if (e.altKey) {
              e.preventDefault();
              for (const k of state.catVisible.keys()) state.catVisible.set(k, k === c);
            } else state.catVisible.set(c, e.target.checked);
            state.ceilingsHidden = false; // a manual choice wins over the floor-mode restore
            refreshVisibility(); renderClasses();
          },
        }),
        h('span', { class: 'swatch', style: `background:${styleFor(c).color}` }),
        h('span', { class: 'cname' }, c),
        h('span', { class: 'count' }, counts.get(c)),
      ),
    ));
  }
}

function renderStatus() {
  const sb = $('statusbar');
  if (!state.models.length) { sb.textContent = ''; return; }
  const objs = state.models.reduce((s, m) => s + m.objects.length, 0);
  const polys = state.models.reduce((s, m) => s + m.polygons.length, 0);
  const tris = state.models.reduce((s, m) => s + m.triangleCount, 0);
  const srs = [...new Set(state.models.map((m) => m.srsName).filter(Boolean))].join(', ') || 'unknown CRS';
  const crsCount = new Set(state.models.map((m) => m.srsName)).size;
  sb.replaceChildren(...[
    h('span', { class: crsCount > 1 ? 'warn' : '', title: crsCount > 1 ? 'Files use different coordinate reference systems' : '' },
      (crsCount > 1 ? '⚠ ' : '') + srs),
    state.sideBySide && h('span', { class: 'note' }, 'Side-by-side layout (not georeferenced)'),
    state.storey != null && h('span', { class: 'note' },
      `Storey: ${storeyList().find((s) => s.key === state.storey)?.label ?? state.storey}`),
    h('span', {}, `${objs.toLocaleString()} objects`),
    h('span', {}, `${polys.toLocaleString()} polygons`),
    h('span', {}, `${tris.toLocaleString()} triangles`),
    h('span', { id: 'pick-coord', class: 'mono' }, state.selection?.point ? fmtPoint(state.selection.point) : ''),
    state.selection && h('button', {
      class: 'sel-chip', title: 'Show properties', onclick: () => setPanel('right', true),
    }, objLabel(state.selection.model.objects[state.selection.obj])),
  ].filter(Boolean));
}

// ---------------------------------------------------------------- side-by-side layout

const FAR_APART = 2000; // metres; beyond this, files are auto-arranged side by side

function applyArrangement() {
  if (!state.sideBySide) {
    for (const m of state.models) viewer.setModelOffset(m, 0, 0);
    return;
  }
  const boxes = state.models.map((m) => viewer.modelLocalBox(m));
  const maxSize = Math.max(...boxes.map((b) => Math.max(b.max.x - b.min.x, b.max.y - b.min.y)), 1);
  const gap = Math.max(5, maxSize * 0.3);
  let cursor = boxes.length ? boxes[0].min.x : 0;
  const base = boxes.length ? boxes[0].min.z : 0;
  state.models.forEach((m, i) => {
    const b = boxes[i];
    // Put every model on the first model's base elevation.
    viewer.setModelOffset(m, cursor - b.min.x, -(b.min.y + b.max.y) / 2, base - b.min.z);
    cursor += b.max.x - b.min.x + gap;
  });
}

function modelsFarApart() {
  const boxes = state.models.map((m) => viewer.modelLocalBox(m));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[i].distanceToPoint(boxes[j].getCenter(boxes[j].min.clone())) > FAR_APART) return true;
    }
  }
  return new Set(state.models.map((m) => m.srsName)).size > 1;
}

function relayout(view = 'keep') {
  applyArrangement();
  applyStoreyFilter(); // bands are in world Z, which the arrangement may have shifted
  if (state.selection) highlightSelection(false);
  const box = viewer.visibleBox();
  viewer.updateGrid(box);
  viewer.fitTo(box, view);
  $('chk-side').checked = state.sideBySide;
  renderStatus();
  updateClipRange();
}

// ---------------------------------------------------------------- panel toggles

const narrowQuery = window.matchMedia('(max-width: 900px)');

function panelOpen(side) {
  return narrowQuery.matches
    ? document.body.classList.contains(`show-${side}`)
    : !document.body.classList.contains(`hide-${side}`);
}

function setPanel(side, open) {
  if (narrowQuery.matches) {
    document.body.classList.toggle(`show-${side}`, open);
    // Only one floating panel at a time on narrow screens.
    if (open) document.body.classList.remove(`show-${side === 'left' ? 'right' : 'left'}`);
  } else {
    document.body.classList.toggle(`hide-${side}`, !open);
  }
  syncPanelButtons();
}

function syncPanelButtons() {
  $('toggle-left').classList.toggle('active', panelOpen('left'));
  $('toggle-right').classList.toggle('active', panelOpen('right'));
}

function fmtPoint(p) {
  const o = state.origin;
  return `X ${(p.x + o[0]).toFixed(3)}  Y ${(p.y + o[1]).toFixed(3)}  Z ${(p.z + o[2]).toFixed(3)}`;
}

// ---------------------------------------------------------------- tree

const TYPE_ICON = {
  Building: '🏢', BuildingPart: '🏢', Room: '▢', BuildingRoom: '▢', CityObjectGroup: '◫',
  Door: '🚪', Window: '🪟', DoorSurface: '🚪', WindowSurface: '🪟',
  BuildingInstallation: '⌂', IntBuildingInstallation: '⌂', GenericCityObject: '◇',
};

function objLabel(o) {
  return o.name || o.id || `(${o.type})`;
}

function renderTree() {
  const tree = $('tree');
  const q = $('search').value.trim().toLowerCase();
  tree.replaceChildren();
  if (q) return renderSearch(tree, q);
  for (const m of state.models) {
    const ul = h('ul', { class: 'tree-root' });
    for (const r of m.roots) ul.append(treeNode(m, r));
    tree.append(h('div', { class: 'tree-file' }, m.fileName), ul);
  }
}

function treeNode(model, idx) {
  const o = model.objects[idx];
  const key = `${model.id}:${idx}`;
  const open = state.expanded.has(key);
  const sel = state.selection && state.selection.model === model && state.selection.obj === idx;
  const li = h('li', { 'data-key': key });
  const row = h('div', {
    class: 'tree-row' + (sel ? ' selected' : ''),
    onclick: () => select({ model, obj: idx }, { zoom: false, fromTree: true }),
    ondblclick: () => select({ model, obj: idx }, { zoom: true, fromTree: true }),
  },
  h('span', {
    class: 'twisty' + (o.children.length ? '' : ' leaf'),
    onclick: (e) => {
      e.stopPropagation();
      if (open) state.expanded.delete(key); else state.expanded.add(key);
      renderTree();
    },
  }, o.children.length ? (open ? '▾' : '▸') : ''),
  h('span', { class: 'swatch', style: `background:${styleFor(o.type).color}` }),
  h('span', { class: 'tlabel', title: `${o.type}  ${o.id || ''}` },
    TYPE_ICON[o.type] ? TYPE_ICON[o.type] + ' ' : '', objLabel(o)),
  h('span', { class: 'ttype' }, o.type),
  );
  li.append(row);
  if (open && o.children.length) {
    const ul = h('ul');
    for (const c of o.children) ul.append(treeNode(model, c));
    li.append(ul);
  }
  return li;
}

function renderSearch(tree, q) {
  const ul = h('ul', { class: 'tree-root flat' });
  let n = 0;
  outer: for (const m of state.models) {
    for (const o of m.objects) {
      const hay = [o.id, o.name, o.type, ...o.attributes.map((a) => a.value)].join(' ').toLowerCase();
      if (!hay.includes(q)) continue;
      ul.append(h('li', {}, h('div', {
        class: 'tree-row' + (state.selection?.model === m && state.selection.obj === o.index ? ' selected' : ''),
        onclick: () => select({ model: m, obj: o.index }, { zoom: true, fromTree: true }),
      },
      h('span', { class: 'swatch', style: `background:${styleFor(o.type).color}` }),
      h('span', { class: 'tlabel' }, objLabel(o)),
      h('span', { class: 'ttype' }, o.type))));
      if (++n >= 300) break outer;
    }
  }
  tree.append(n ? ul : h('p', { class: 'muted small' }, 'No matches'));
  if (n >= 300) tree.append(h('p', { class: 'muted small' }, 'Showing first 300 matches'));
}

function revealInTree(model, idx) {
  let p = model.objects[idx].parent;
  while (p >= 0) { state.expanded.add(`${model.id}:${p}`); p = model.objects[p].parent; }
  renderTree();
  const row = $('tree').querySelector(`li[data-key="${model.id}:${idx}"] > .tree-row`);
  row?.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------- selection

function descendants(model, idx, out = new Set()) {
  out.add(idx);
  for (const c of model.objects[idx].children) descendants(model, c, out);
  // Groups: include their members too.
  for (const ref of model.objects[idx].members) {
    const m = model.idMap.get(ref);
    if (m != null && !out.has(m)) descendants(model, m, out);
  }
  return out;
}

function highlightSelection(zoom) {
  const s = state.selection;
  if (!s) { viewer.clearHighlight(); return; }
  const box = viewer.highlight(s.model, descendants(s.model, s.obj));
  if (zoom && !box.isEmpty()) viewer.fitTo(box);
}

function select(sel, { zoom = false, fromTree = false } = {}) {
  state.selection = sel;
  highlightSelection(zoom);
  renderProps();
  renderStatus();
  if (sel && !fromTree && !$('search').value) revealInTree(sel.model, sel.obj);
  else renderTree();
}

function renderProps() {
  const div = $('props');
  div.replaceChildren();
  const s = state.selection;
  if (!s) { div.append(h('p', { class: 'muted' }, 'Click an object in the view or the tree.')); return; }
  const { model } = s;
  const o = model.objects[s.obj];
  const link = (idx) => h('a', {
    href: '#', onclick: (e) => { e.preventDefault(); select({ model, obj: idx }, { zoom: true }); },
  }, objLabel(model.objects[idx]), h('span', { class: 'muted small' }, ` ${model.objects[idx].type}`));

  div.append(h('div', { class: 'prop-head' },
    h('span', { class: 'swatch big', style: `background:${styleFor(o.type).color}` }),
    h('div', {}, h('div', { class: 'ptype' }, `${o.prefix ? o.prefix + ':' : ''}${o.type}`),
      h('div', { class: 'pname' }, o.name || o.id || '(unnamed)'))));

  div.append(h('div', { class: 'prop-actions' },
    h('button', { class: 'btn small', onclick: () => highlightSelection(true) }, 'Zoom to'),
    o.parent >= 0 && h('button', { class: 'btn small', onclick: () => select({ model, obj: o.parent }) }, 'Select parent'),
    h('button', { class: 'btn small', onclick: () => navigator.clipboard?.writeText(o.id || '') }, 'Copy id'),
  ));

  const rows = [
    ['gml:id', o.id || '–'],
    ['File', model.fileName],
    o.parent >= 0 && ['Parent', link(o.parent)],
    ['LODs', [...o.lods].sort().map((l) => LOD_LABELS[l] || l).join(', ') || '–'],
    ['Polygons', `${o.polygonCount} own · ${o.polygonCount + (o.descendantPolygons || 0)} total`],
    o.children.length && ['Children', String(o.children.length)],
  ].filter(Boolean);
  div.append(table('General', rows));

  if (o.attributes.length) div.append(table('Attributes', o.attributes.map((a) => [a.name, a.value])));

  const rel = [];
  if (o.groupParent) {
    const gp = model.idMap.get(o.groupParent);
    rel.push(['Group parent', gp != null ? link(gp) : o.groupParent]);
  }
  for (const ref of o.members) {
    const mi = model.idMap.get(ref);
    rel.push(['Member', mi != null ? link(mi) : ref]);
  }
  for (const gi of model.memberOf.get(o.index) || []) rel.push(['Member of', link(gi)]);
  if (rel.length) div.append(table('Relations', rel));

  if (s.poly != null) {
    const p = model.polygons[s.poly];
    div.append(table('Picked surface', [
      ['Polygon id', p.id || '–'],
      ['LOD', LOD_LABELS[p.lod] || p.lod],
      ['Area', `${p.area.toFixed(3)} m²`],
      s.point && ['Point', h('span', { class: 'mono' }, fmtPoint(s.point))],
    ].filter(Boolean)));
  }

  const kids = o.children.map((c) => model.objects[c]);
  if (kids.length) {
    const byType = new Map();
    for (const k of kids) byType.set(k.type, (byType.get(k.type) || 0) + 1);
    div.append(table('Child summary', [...byType].map(([t, n]) => [t, String(n)])));
  }
}

function table(title, rows) {
  return h('details', { class: 'ptable', open: true },
    h('summary', {}, title),
    h('table', {}, rows.map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v)))));
}

// ---------------------------------------------------------------- clipping

function updateClipRange() {
  const range = $('clip-range');
  if (!state.models.length) {
    range.disabled = true; $('chk-clip').checked = false; viewer.setClip(false, 0);
    $('clip-value').textContent = '–';
    return;
  }
  // World-space Z range (accounts for side-by-side shifts).
  let min = Infinity, max = -Infinity;
  for (const m of state.models) {
    const b = viewer.modelLocalBox(m);
    min = Math.min(min, b.min.z + m.group.position.z);
    max = Math.max(max, b.max.z + m.group.position.z);
  }
  state.clipBase = min;
  range.min = (min - 0.01).toFixed(2);
  range.max = (max + 0.01).toFixed(2);
  range.disabled = !$('chk-clip').checked;
  if (+range.value > +range.max || +range.value < +range.min) range.value = range.max;
  applyClip();
}

function applyClip() {
  const on = $('chk-clip').checked && state.models.length > 0;
  const z = +$('clip-range').value;
  $('clip-range').disabled = !on;
  $('clip-value').textContent = !on ? '–'
    : state.sideBySide ? `+${(z - state.clipBase).toFixed(2)} m` : `Z ${(z + state.origin[2]).toFixed(2)} m`;
  viewer.setClip(on, z);
}

// ---------------------------------------------------------------- events

$('file-input').addEventListener('change', async (e) => {
  await loadFiles([...e.target.files]);
  e.target.value = '';
});

// samples/ ships with the build. GMLs/ holds personal test files: listed in dev only, never bundled
// (the lazy glob sits in a branch the production build drops).
const sampleEntries = Object.entries(
  import.meta.glob('/samples/*.{gml,xml}', { query: '?url', import: 'default', eager: true }),
).map(([path, url]) => [path, async () => url]);
if (import.meta.env.DEV) {
  sampleEntries.push(...Object.entries(import.meta.glob('/GMLs/*.{gml,xml}', { query: '?url', import: 'default' })));
}
const sampleSelect = $('sample-select');
if (sampleEntries.length) {
  sampleSelect.hidden = false;
  for (const [path] of sampleEntries) {
    const label = path.startsWith('/GMLs/') ? `GMLs/${path.split('/').pop()}` : path.split('/').pop();
    sampleSelect.append(h('option', { value: path }, label));
  }
  sampleSelect.append(h('option', { value: '*' }, 'Load all'));
  $('btn-credits').hidden = false;
}

// Sources & licences dialog, rendered from samples/SOURCES.md on first open.
const SAMPLE_LINKS = { 'LICENSE-Apache-2.0.txt': apacheLicenseUrl };
$('btn-credits').onclick = () => {
  const body = $('credits-body');
  if (!body.childElementCount) {
    // The dialog has its own title, so drop the file's top-level heading.
    body.append(renderMarkdown(sourcesMd.replace(/^﻿?#\s.*\n/, ''), (href) => SAMPLE_LINKS[href] || null));
  }
  $('credits').showModal();
};
$('credits').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
sampleSelect.addEventListener('change', async () => {
  const v = sampleSelect.value;
  sampleSelect.value = '';
  if (!v) return;
  const list = v === '*' ? sampleEntries : sampleEntries.filter(([path]) => path === v);
  for (const [path, getUrl] of list) {
    const name = path.split('/').pop();
    showLoading(`Downloading ${name}…`);
    let text;
    try {
      const res = await fetch(await getUrl());
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`.trim());
      text = await res.text();
    } catch (err) {
      console.error(err);
      hideLoading();
      alert(`Could not download ${name}:\n${err.message}`);
      continue;
    }
    await loadText(text, name);
  }
});

const vp = $('viewport');
let dragDepth = 0;
vp.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; vp.classList.add('dragging'); });
vp.addEventListener('dragover', (e) => e.preventDefault());
vp.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; vp.classList.remove('dragging'); } });
vp.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  vp.classList.remove('dragging');
  await loadFiles([...e.dataTransfer.files]);
});

// Click (without dragging) picks; double-click zooms.
const canvas = viewer.renderer.domElement;
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, button: e.button }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || down.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
  const hit = viewer.pick(e.clientX, e.clientY);
  if (!hit) { select(null); return; }
  const obj = hit.bucket.triObject[hit.faceIndex];
  const poly = hit.bucket.triPolygon[hit.faceIndex];
  if (obj < 0) return;
  select({ model: hit.model, obj, poly, point: hit.point.clone() });
});
canvas.addEventListener('dblclick', () => { if (state.selection) highlightSelection(true); });

$('toggle-left').onclick = () => setPanel('left', !panelOpen('left'));
$('toggle-right').onclick = () => setPanel('right', !panelOpen('right'));
narrowQuery.addEventListener('change', syncPanelButtons);
syncPanelButtons();

$('btn-fit').onclick =() => viewer.fitTo(viewer.visibleBox());
$('btn-top').onclick = () => viewer.fitTo(viewer.visibleBox(), 'top');
$('btn-front').onclick = () => viewer.fitTo(viewer.visibleBox(), 'front');
$('btn-iso').onclick = () => viewer.fitTo(viewer.visibleBox(), 'iso');
$('chk-edges').onchange = (e) => viewer.setEdges(e.target.checked);
$('chk-xray').onchange = (e) => { viewer.setXray(e.target.checked); highlightSelection(false); };
$('storey-up').onclick = () => stepStorey(1);
$('storey-down').onclick = () => stepStorey(-1);
$('chk-side').onchange =(e) => { state.sideBySide = e.target.checked; relayout(); };
$('chk-clip').onchange = applyClip;
$('clip-range').oninput = applyClip;
$('search').addEventListener('input', () => renderTree());
$('btn-shot').onclick = () => {
  const a = h('a', { href: viewer.screenshot(), download: 'citylens-view.png' });
  a.click();
};

window.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input[type=search], input[type=text]') || $('credits').open) return;
  if (e.key === 'Escape') select(null);
  else if (e.key === 'f' || e.key === 'F') { if (state.selection) highlightSelection(true); }
  else if (e.key === 'Home') viewer.fitTo(viewer.visibleBox());
  else if (e.key === 'x' || e.key === 'X') $('chk-xray').click();
  else if (e.key === 'e' || e.key === 'E') $('chk-edges').click();
  else if (e.key === 'PageUp') { e.preventDefault(); stepStorey(1); }
  else if (e.key === 'PageDown') { e.preventDefault(); stepStorey(-1); }
});

refreshAll();

// Handy for debugging from the console.
window.cityViewer = { viewer, state, loadText };
