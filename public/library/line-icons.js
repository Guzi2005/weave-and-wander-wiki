// Small, single-stroke UI icons. Labels remain in the surrounding controls.
const paths={
  all:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  models:'<path d="m12 2 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V7M12 12v10"/>',
  images:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 3-3 4 4"/>',
  drawings:'<path d="M5 2h10l4 4v16H5zM15 2v5h4M8 11h8M8 15h8M8 19h5"/>',
  motifs:'<circle cx="12" cy="12" r="3"/><path d="M12 2c2 2 2 4 0 7M12 22c-2-2-2-4 0-7M2 12c2-2 4-2 7 0M22 12c-2 2-4 2-7 0M5 5c3 0 5 2 5 5M19 19c-3 0-5-2-5-5M19 5c0 3-2 5-5 5M5 19c0-3 2-5 5-5"/>',
  nodes:'<circle cx="5" cy="12" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M7 12h5m0 0V5h5m-5 7v7h5"/>',
  files:'<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 10h18"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-3 3-4 6-4 9s1 6 4 9M12 3c3 3 4 6 4 9s-1 6-4 9"/>',
  map:'<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16"/>',
};
export function lineIcon(name){
  const path=paths[name];
  if(!path)throw new Error(`Unknown line icon: ${name}`);
  return `<svg class="ui-line-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;
}
