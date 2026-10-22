// CityGML parser: turns a CityGML document (1.0 / 2.0 / 3.0) into a flat list of
// city objects plus triangulated geometry buckets grouped by LOD and semantic class.
// Namespaces are matched loosely by localName so any CityGML flavour works.
import earcut from 'earcut';

const SURFACE_TAGS = new Set(['Polygon', 'Triangle', 'PolygonPatch', 'Rectangle']);
const NON_OBJECT_TAGS = new Set([
  'CityModel', 'Address', 'ImplicitGeometry', 'ExternalReference', 'ExternalObject',
  'Appearance', 'Envelope',
  // CityGML 3.0 data types that sit inside property elements like features do.
  'StringAttribute', 'IntAttribute', 'DoubleAttribute', 'DateAttribute', 'UriAttribute',
  'MeasureAttribute', 'CodeAttribute', 'GenericAttributeSet', 'Height', 'CityObjectRelation',
  'Occupancy', 'ConstructionEvent', 'Elevation', 'RoomHeight', 'QualifiedArea', 'QualifiedVolume',
  'Dimensions',
]);
const GENERIC_ATTR_TAGS = new Set([
  'stringAttribute', 'intAttribute', 'doubleAttribute', 'dateAttribute',
  'uriAttribute', 'measureAttribute', 'genericAttribute',
]);

const isGml = (el) => /opengis\.net\/gml/.test(el.namespaceURI || '');
const isUpper = (s) => s.charCodeAt(0) >= 65 && s.charCodeAt(0) <= 90;
const XLINK = 'http://www.w3.org/1999/xlink';

function gmlId(el) {
  return el.getAttributeNS('http://www.opengis.net/gml', 'id')
    || el.getAttributeNS('http://www.opengis.net/gml/3.2', 'id')
    || el.getAttribute('gml:id') || el.getAttribute('id') || null;
}

function isCityObject(el) {
  const ln = el.localName;
  if (!isUpper(ln) || NON_OBJECT_TAGS.has(ln) || isGml(el)) return false;
  const ns = el.namespaceURI || '';
  if (/xAL|appearance|xlink/i.test(ns)) return false;
  const parent = el.parentElement;
  // A feature always sits inside a (lowercase) property element.
  return !!parent && !isUpper(parent.localName);
}

function childText(el) {
  return (el.textContent || '').trim();
}

/** Collects the simple, non-geometric properties that sit directly under a city object. */
function readAttributes(el, obj) {
  for (const c of el.children) {
    const ln = c.localName;
    if (isGml(c)) {
      if (ln === 'name') obj.name = obj.name ? obj.name + ', ' + childText(c) : childText(c);
      else if (ln === 'description') obj.attributes.push({ name: 'description', value: childText(c) });
      continue;
    }
    if (GENERIC_ATTR_TAGS.has(ln)) {
      readGenericAttribute(c, obj.attributes, '');
    } else if (ln === 'genericAttributeSet') {
      const setName = c.getAttribute('name') || 'set';
      for (const a of c.children) readGenericAttribute(a, obj.attributes, setName + '.');
    } else if (ln === 'groupMember') {
      const href = c.getAttributeNS(XLINK, 'href');
      if (href) obj.members.push(href.replace(/^#/, ''));
    } else if (ln === 'parent' && c.getAttributeNS(XLINK, 'href')) {
      obj.groupParent = c.getAttributeNS(XLINK, 'href').replace(/^#/, '');
    } else if (ln === 'height' && c.firstElementChild?.localName === 'Height') {
      // CityGML 3.0: <con:height><con:Height><con:highReference/><con:lowReference/><con:value/>
      const f = {};
      for (const p of c.firstElementChild.children) f[p.localName] = p;
      if (!f.value) continue;
      const uom = (f.value.getAttribute('uom') || '').replace(/^#/, '');
      const refs = f.highReference && f.lowReference
        ? ` (${childText(f.lowReference)} → ${childText(f.highReference)})` : '';
      obj.attributes.push({ name: 'height' + refs, value: `${childText(f.value)}${uom ? ' ' + uom : ''}` });
    } else if (c.children.length === 0) {
      const v = childText(c);
      if (!v) continue;
      const uom = (c.getAttribute('uom') || '').replace(/^#/, '');
      obj.attributes.push({ name: ln, value: uom ? `${v} ${uom}` : v });
    }
  }
}

function readGenericAttribute(el, out, prefix) {
  if (el.localName === 'genericAttribute') {
    // CityGML 3.0: <gen:genericAttribute><gen:StringAttribute><gen:name/><gen:value/>
    const inner = el.firstElementChild;
    if (!inner) return;
    let name = '', value = '';
    for (const c of inner.children) {
      if (c.localName === 'name') name = childText(c);
      else if (c.localName === 'value') value = childText(c);
    }
    out.push({ name: prefix + name, value });
    return;
  }
  let value = '';
  for (const c of el.children) if (c.localName === 'value') value = childText(c);
  out.push({ name: prefix + (el.getAttribute('name') || el.localName), value });
}

function srsDimOf(el, fallback) {
  let e = el;
  while (e && e.nodeType === 1) {
    const d = e.getAttribute('srsDimension');
    if (d) return parseInt(d, 10);
    if (e.localName === 'Polygon' || e.localName === 'Triangle') break;
    e = e.parentElement;
  }
  return fallback;
}

/** Returns a flat [x,y,z, x,y,z, ...] array for a LinearRing (closing point removed). */
function readRing(ringEl) {
  if (!ringEl) return null;
  const pts = [];
  for (const c of ringEl.children) {
    const ln = c.localName;
    if (ln === 'posList') {
      const dim = srsDimOf(c, 3);
      const nums = childText(c).split(/\s+/).map(Number);
      for (let i = 0; i + dim - 1 < nums.length; i += dim) {
        pts.push(nums[i], nums[i + 1], dim >= 3 ? nums[i + 2] : 0);
      }
    } else if (ln === 'pos') {
      const nums = childText(c).split(/\s+/).map(Number);
      pts.push(nums[0], nums[1], nums.length > 2 ? nums[2] : 0);
    } else if (ln === 'coordinates') {
      // GML 2 style: "x,y,z x,y,z"
      for (const tuple of childText(c).split(/\s+/)) {
        const n = tuple.split(',').map(Number);
        if (n.length >= 2) pts.push(n[0], n[1], n.length > 2 ? n[2] : 0);
      }
    } else if (ln === 'pointProperty' || ln === 'pointRep') {
      const pos = c.getElementsByTagNameNS('*', 'pos')[0];
      if (pos) {
        const nums = childText(pos).split(/\s+/).map(Number);
        pts.push(nums[0], nums[1], nums.length > 2 ? nums[2] : 0);
      }
    }
  }
  const n = pts.length;
  if (n >= 6 && pts[0] === pts[n - 3] && pts[1] === pts[n - 2] && pts[2] === pts[n - 1]) {
    pts.length = n - 3;
  }
  for (let i = 0; i < pts.length; i++) if (!Number.isFinite(pts[i])) return null;
  return pts.length >= 9 ? pts : null;
}

function ringOf(boundaryEl) {
  if (!boundaryEl) return null;
  for (const c of boundaryEl.children) if (c.localName === 'LinearRing') return c;
  return null;
}

/** In place: p' = M·p + ref for a flat xyz array (implicit geometry placement). */
function applyTransform(pts, { m, ref }) {
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1], z = pts[i + 2];
    pts[i] = m[0] * x + m[1] * y + m[2] * z + m[3] + ref[0];
    pts[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7] + ref[1];
    pts[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11] + ref[2];
  }
}

/** Newell's method: robust normal for (possibly non-convex) planar polygons. */
function newellNormal(pts) {
  let nx = 0, ny = 0, nz = 0;
  const n = pts.length / 3;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = pts[i * 3], y0 = pts[i * 3 + 1], z0 = pts[i * 3 + 2];
    const x1 = pts[j * 3], y1 = pts[j * 3 + 1], z1 = pts[j * 3 + 2];
    nx += (y0 - y1) * (z0 + z1);
    ny += (z0 - z1) * (x0 + x1);
    nz += (x0 - x1) * (y0 + y1);
  }
  const len = Math.hypot(nx, ny, nz);
  return len > 0 ? [nx / len, ny / len, nz / len, len / 2] : null;
}

/**
 * Triangulates a polygon with holes. Returns { verts: number[], tris: number[], normal, area }.
 * verts is the concatenation of all rings, tris indexes into it.
 */
function triangulate(rings) {
  const outer = rings[0];
  const nrm = newellNormal(outer);
  if (!nrm) return null;
  const [nx, ny, nz, outerArea] = nrm;
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  // Drop the dominant axis and triangulate in the remaining plane.
  let u = 0, v = 1;
  if (ax >= ay && ax >= az) { u = 1; v = 2; } else if (ay >= az) { u = 0; v = 2; }
  const flat2d = [];
  const holes = [];
  const verts = [];
  let holeArea = 0;
  rings.forEach((r, ri) => {
    if (ri > 0) {
      holes.push(verts.length / 3);
      const hn = newellNormal(r);
      if (hn) holeArea += hn[3];
    }
    for (let i = 0; i < r.length; i += 3) {
      flat2d.push(r[i + u], r[i + v]);
      verts.push(r[i], r[i + 1], r[i + 2]);
    }
  });
  const tris = earcut(flat2d, holes.length ? holes : undefined, 2);
  if (!tris.length) return null;
  return { verts, tris, normal: [nx, ny, nz], area: Math.max(0, outerArea - holeArea) };
}

class Bucket {
  constructor(lod, category) {
    this.lod = lod;
    this.category = category;
    this.positions = [];   // absolute coordinates (float64 until the viewer re-centres them)
    this.normals = [];
    this.triObject = [];   // per triangle: object index
    this.triPolygon = [];  // per triangle: polygon index
    this.edges = [];       // line segment endpoints (absolute)
    this.polygonCount = 0;
  }
}

export function parseCityGML(text, fileName = 'file.gml') {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const perr = doc.getElementsByTagName('parsererror')[0];
  if (perr) throw new Error('XML parse error: ' + perr.textContent.slice(0, 300));
  const root = doc.documentElement;

  const objects = [];
  const polygons = [];
  const buckets = new Map();
  const bbox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let srsName = null;
  let version = 'unknown';
  for (const a of [{ value: root.namespaceURI || '' }, ...root.attributes]) {
    const m = a.value.match(/citygml\/(\d\.\d)$/);
    if (m) { version = m[1]; break; }
  }

  const envSrs = root.querySelector('*|Envelope[srsName]');
  if (envSrs) srsName = envSrs.getAttribute('srsName');

  function bucketFor(lod, category) {
    const key = lod + '|' + category;
    let b = buckets.get(key);
    if (!b) { b = new Bucket(lod, category); buckets.set(key, b); }
    return b;
  }

  function addPolygon(el, ctx) {
    let exterior = null;
    const interiors = [];
    for (const c of el.children) {
      const ln = c.localName;
      if (ln === 'exterior' || ln === 'outerBoundaryIs') exterior = ringOf(c);
      else if (ln === 'interior' || ln === 'innerBoundaryIs') interiors.push(ringOf(c));
    }
    const outer = readRing(exterior);
    if (!outer) return;
    const rings = [outer];
    for (const r of interiors) {
      const pts = readRing(r);
      if (pts) rings.push(pts);
    }
    if (ctx.xf) for (const r of rings) applyTransform(r, ctx.xf);
    const tri = triangulate(rings);
    if (!tri) return;
    if (!srsName) srsName = el.getAttribute('srsName') || null;

    const obj = ctx.obj >= 0 ? objects[ctx.obj] : null;
    const category = obj ? obj.type : 'Unknown';
    const lod = ctx.lod ?? (ctx.groupGeom ? 'G' : '?');
    const b = bucketFor(lod, category);
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 2; i < outer.length; i += 3) {
      if (outer[i] < zMin) zMin = outer[i];
      if (outer[i] > zMax) zMax = outer[i];
    }
    const polyIndex = polygons.length;
    polygons.push({ id: gmlId(el), object: ctx.obj, area: tri.area, lod, zMin, zMax });
    b.polygonCount++;
    if (obj) { obj.lods.add(lod); obj.polygonCount++; }

    const { verts, tris, normal } = tri;
    for (let i = 0; i < tris.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const vi = tris[i + k] * 3;
        b.positions.push(verts[vi], verts[vi + 1], verts[vi + 2]);
        b.normals.push(normal[0], normal[1], normal[2]);
      }
      b.triObject.push(ctx.obj);
      b.triPolygon.push(polyIndex);
    }
    // TIN patches are a mesh, not modelled faces: their edges would just darken the terrain.
    const edges = el.localName !== 'Triangle';
    for (const r of rings) {
      const n = r.length / 3;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (edges) b.edges.push(r[i * 3], r[i * 3 + 1], r[i * 3 + 2], r[j * 3], r[j * 3 + 1], r[j * 3 + 2]);
        const x = r[i * 3], y = r[i * 3 + 1], z = r[i * 3 + 2];
        if (x < bbox.min[0]) bbox.min[0] = x; if (x > bbox.max[0]) bbox.max[0] = x;
        if (y < bbox.min[1]) bbox.min[1] = y; if (y > bbox.max[1]) bbox.max[1] = y;
        if (z < bbox.min[2]) bbox.min[2] = z; if (z > bbox.max[2]) bbox.max[2] = z;
      }
    }
  }

  // gml:id → element, built on first use (only xlinked implicit geometry templates need it).
  let idIndex = null;
  function byId(id) {
    if (!idIndex) {
      idIndex = new Map();
      for (const e of doc.getElementsByTagName('*')) {
        const gid = gmlId(e);
        if (gid) idIndex.set(gid, e);
      }
    }
    return idIndex.get(id) || null;
  }

  /**
   * ImplicitGeometry: a template geometry (inline or xlinked, shared between instances) placed by
   * transformationMatrix (4×4, row-major) and then shifted by referencePoint.
   */
  function addImplicit(el, ctx) {
    let template = null, matrix = null, ref = [0, 0, 0];
    for (const c of el.children) {
      const ln = c.localName;
      if (ln === 'relativeGMLGeometry' || ln === 'relativeGeometry') {
        const href = c.getAttributeNS(XLINK, 'href');
        template = c.firstElementChild || (href ? byId(href.replace(/^#/, '')) : null);
      } else if (ln === 'transformationMatrix') {
        const m = childText(c).split(/\s+/).map(Number);
        if (m.length >= 12 && m.every(Number.isFinite)) matrix = m;
      } else if (ln === 'referencePoint') {
        const pos = c.getElementsByTagNameNS('*', 'pos')[0] || c.getElementsByTagNameNS('*', 'coordinates')[0];
        if (pos) {
          const n = childText(pos).split(/[\s,]+/).map(Number);
          ref = [n[0] || 0, n[1] || 0, n[2] || 0];
        }
      }
    }
    if (template) walk(template, { ...ctx, xf: { m: matrix || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], ref } });
  }

  function walk(el, ctx) {
    const ln = el.localName;
    if (ln === 'Appearance' || ln === 'appearance' || ln === 'appearanceMember') return;
    // CRS definitions and GML metadata can contain foreign upper-case elements that aren't features.
    if (isGml(el) && (ln === 'metaDataProperty' || ln.endsWith('CRS'))) return;

    if (isGml(el) && SURFACE_TAGS.has(ln)) {
      addPolygon(el, ctx);
      return;
    }
    if (ln === 'ImplicitGeometry' && !isGml(el)) {
      addImplicit(el, ctx);
      return;
    }

    if (isCityObject(el)) {
      const idx = objects.length;
      const obj = {
        index: idx,
        id: gmlId(el),
        type: ln,
        prefix: el.prefix || '',
        name: '',
        attributes: [],
        members: [],
        groupParent: null,
        parent: ctx.obj,
        children: [],
        lods: new Set(),
        polygonCount: 0,
      };
      readAttributes(el, obj);
      objects.push(obj);
      if (ctx.obj >= 0) objects[ctx.obj].children.push(idx);
      ctx = { obj: idx, lod: null, groupGeom: false, xf: ctx.xf };
    } else if (!isGml(el)) {
      const lm = ln.match(/^lod([0-4])/);
      if (lm) ctx = { ...ctx, lod: lm[1] };
      else if (ln === 'geometry' && ctx.obj >= 0 && objects[ctx.obj].type === 'CityObjectGroup') {
        ctx = { ...ctx, groupGeom: true };
      }
    }

    for (const c of el.children) walk(c, ctx);
  }

  walk(root, { obj: -1, lod: null, groupGeom: false, xf: null });
  if (!srsName) srsName = root.querySelector('[srsName]')?.getAttribute('srsName') || null;

  // Roll each object's LODs up to its ancestors so filtering by object works intuitively.
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (o.parent >= 0) {
      const p = objects[o.parent];
      for (const l of o.lods) p.lods.add(l);
      p.descendantPolygons = (p.descendantPolygons || 0) + (o.descendantPolygons || 0) + o.polygonCount;
    }
  }

  const idMap = new Map();
  for (const o of objects) if (o.id) idMap.set(o.id, o.index);

  return {
    fileName,
    version,
    srsName,
    objects,
    polygons,
    idMap,
    buckets: [...buckets.values()],
    bbox,
    roots: objects.filter((o) => o.parent < 0).map((o) => o.index),
  };
}
