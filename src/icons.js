// Small line icons (24×24 grid, drawn with currentColor) so every platform renders the same shapes.
const PATHS = {
  'panel-left': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  'panel-right': '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  focus: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="2.5"/>',
  'chevron-up': '<path d="m6 15 6-6 6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  warning: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  // object types in the tree
  building: '<path d="M5 21V3h9v18M14 8h5v13M3 21h18M8 7h3M8 11h3M8 15h3"/>',
  room: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 14h6v6"/>',
  door: '<path d="M6 21V3h12v18M3 21h18"/><path d="M14.5 12v.5"/>',
  window: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16M4 12h16"/>',
  group: '<rect x="3" y="7" width="12" height="12" rx="1"/><path d="M9 7V3h12v12h-6"/>',
  installation: '<path d="m3 11 9-7 9 7M5 9.5V20h14V9.5"/>',
  generic: '<path d="M12 3 21 12 12 21 3 12z"/>',
};

export function icon(name, size = 16) {
  const span = document.createElement('span');
  span.className = `ic ic-${name}`;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
  return span;
}

// Fills every <… data-icon="name"> in the static markup.
export function fillIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) el.prepend(icon(el.dataset.icon, +el.dataset.iconSize || 16));
}
