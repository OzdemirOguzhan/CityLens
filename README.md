# CityGML Viewer

Browser-based 3D viewer for CityGML 1.0 / 2.0 / 3.0 files (LOD 0–4), built with Vite + Three.js.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

## Features
- Open files via **Open…**, drag & drop, or **Samples…** (any `.gml` in `samples/`; see `samples/SOURCES.md`).
  Local test files in `GMLs/` are also listed during `npm run dev`, but are never part of the build
- Semantic colouring (Roof / Wall / Floor / Ceiling / Door / Window / Room …), xlink-referenced geometry is drawn once
- Toggle by **LOD** and by **class** (Alt+click = show only that one)
- Object tree with search (id, name, attribute values)
- Click to pick: properties, generic attributes, group relations, polygon id, area and point in the source CRS
- **Storey filter**: one floor at a time, from storey CityObjectGroups (MAKS `Kat`, or any group with a
  `storeyNumber`) or CityGML 3.0 `Storey` objects. Each file is clipped to its own storey's height band;
  picking a storey switches to LOD 4 and hides ceilings, and "All" restores the previous LODs and ceilings
- Horizontal **section** plane for interiors (LOD4), **X-ray**, edges, Top/Front/Iso views, PNG screenshot
- **Side by side** layout for files that are far apart or in different CRSs

Shortcuts: `F` zoom to selection · `Esc` clear · `Home` fit · `X` X-ray · `E` edges · `PageUp`/`PageDown` storey up/down

## Code
- `src/parser.js` – DOM-based CityGML parser + earcut triangulation into LOD/class buckets
- `src/viewer.js` – Three.js scene, materials, picking, highlighting, clipping
- `src/main.js` – UI: panels, tree, properties, loading
- `src/colors.js` – semantic colour scheme

## License
The code is MIT licensed, see [LICENSE](LICENSE). The sample files in `samples/` are third-party data under their own
terms (Apache-2.0, or no licence stated by the source); sources and details are in [samples/SOURCES.md](samples/SOURCES.md).
