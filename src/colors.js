// Semantic colour scheme for CityGML classes. Unknown classes get a stable hashed colour.
export const CATEGORY_STYLE = {
  RoofSurface: { color: '#c4553b' },
  WallSurface: { color: '#e9e3d5' },
  GroundSurface: { color: '#6f6252' },
  ClosureSurface: { color: '#9fb4b8', opacity: 0.35 },
  OuterCeilingSurface: { color: '#d9cfbf' },
  OuterFloorSurface: { color: '#b9ab94' },
  FloorSurface: { color: '#b89a6a' },
  CeilingSurface: { color: '#dcdde6' },
  InteriorWallSurface: { color: '#d2c9b6' },
  Door: { color: '#8b5a2b' },
  DoorSurface: { color: '#8b5a2b' }, // CityGML 3.0
  Window: { color: '#6fb6e6', opacity: 0.5 },
  WindowSurface: { color: '#6fb6e6', opacity: 0.5 }, // CityGML 3.0
  Room: { color: '#9cc39a' },
  BuildingRoom: { color: '#9cc39a' }, // CityGML 3.0
  Building: { color: '#d8d2c4' },
  BuildingPart: { color: '#cfc7b6' },
  // 3.0 storeys / units are aggregations whose geometry repeats the rooms' surfaces.
  Storey: { color: '#8e7cc3', opacity: 0.25 },
  BuildingUnit: { color: '#7c9cc3', opacity: 0.25 },
  BuildingInstallation: { color: '#a9b4c0' },
  IntBuildingInstallation: { color: '#8fa3b3' },
  BuildingConstructiveElement: { color: '#bdb2a0' },
  BuildingFurniture: { color: '#b48c6e' },
  GenericCityObject: { color: '#9a8cc6' },
  CityObjectGroup: { color: '#f2b134', opacity: 0.35 },
  TINRelief: { color: '#8aab6a' },
  ReliefFeature: { color: '#8aab6a' },
  WaterBody: { color: '#4a8fc8', opacity: 0.8 },
  WaterSurface: { color: '#4a8fc8', opacity: 0.8 },
  WaterGroundSurface: { color: '#5d6f7a' },
  WaterClosureSurface: { color: '#4a8fc8', opacity: 0.3 },
  PlantCover: { color: '#5c9e57' },
  SolitaryVegetationObject: { color: '#4b8f46' },
  LandUse: { color: '#c6d39d' },
  Road: { color: '#8a8a8a' },
  Railway: { color: '#8c7b6b' },
  Track: { color: '#9a8f83' },
  Square: { color: '#a6a39b' },
  Section: { color: '#8a8a8a' }, // CityGML 3.0 transportation
  Intersection: { color: '#949494' },
  TrafficArea: { color: '#7a7a7a' },
  AuxiliaryTrafficArea: { color: '#a3b18a' },
  Bridge: { color: '#b3a48c' },
  BridgePart: { color: '#ab9c84' },
  BridgeInstallation: { color: '#a9b4c0' },
  BridgeConstructionElement: { color: '#9e917c' },
  BridgeConstructiveElement: { color: '#9e917c' },
  Tunnel: { color: '#8e8e8e' },
  TunnelPart: { color: '#868686' },
  TunnelInstallation: { color: '#a9b4c0' },
  CityFurniture: { color: '#b07f5a' },
};

const fallbackCache = new Map();

export function styleFor(category) {
  if (CATEGORY_STYLE[category]) return CATEGORY_STYLE[category];
  if (!fallbackCache.has(category)) {
    let h = 0;
    for (const ch of category) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    fallbackCache.set(category, { color: `hsl(${h % 360}, 45%, 62%)` });
  }
  return fallbackCache.get(category);
}

export const LOD_LABELS = {
  0: 'LOD 0', 1: 'LOD 1', 2: 'LOD 2', 3: 'LOD 3', 4: 'LOD 4', G: 'Group geometry', '?': 'No LOD',
};
