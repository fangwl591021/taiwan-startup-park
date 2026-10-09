import { remapMenuAreas } from './rich-menu-chat-image.mjs';
import { MAX_RICH_MENU_AREAS, validateRichMenuAreas, validateRichMenuImageDimensions } from './rich-menu-layout.ts';

export const MENU_UPLOAD_LAYOUT_MAX_HEADER = 12_288;
/** @typedef {{version: 1, width: number, height: number, areas: {id: string, x: number, y: number, width: number, height: number}[]}} MenuUploadLayout */
const idValid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const geometryKeys = ['id', 'x', 'y', 'width', 'height'];
const fail = () => { throw new Error('MENU_UPLOAD_LAYOUT_INVALID'); };
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const geometry = area => ({ id: area.id, x: area.x, y: area.y, width: area.width, height: area.height });

// The published LINE dimensions own the existing bounds. Asset metadata can be
// from another image size even when DB and LINE bounds were verified identical.
export function menuUploadSessionAreas(snapshot) {
  const rows = snapshot.areas, live = snapshot.config?.areas, size = snapshot.config?.size;
  if (!Array.isArray(rows) || !Array.isArray(live) || !rows.length || rows.length > MAX_RICH_MENU_AREAS
    || rows.length !== live.length || ![size?.width, size?.height].every(value => Number.isSafeInteger(value) && value > 0)) throw Error('MENU_UPLOAD_LAYOUT_UNAVAILABLE');
  const seen = new Set();
  return rows.map((row, index) => {
    const id = row.id, label = row.label, bounds = live[index]?.bounds;
    if (!idValid(id) || seen.has(id) || typeof label !== 'string' || !label.trim() || label.length > 200
      || !bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isSafeInteger)
      || bounds.x < 0 || bounds.y < 0 || bounds.width < 1 || bounds.height < 1
      || bounds.x + bounds.width > size.width || bounds.y + bounds.height > size.height
      || ['x', 'y', 'width', 'height'].some(key => row[key] !== bounds[key])) throw Error('MENU_UPLOAD_LAYOUT_UNAVAILABLE');
    seen.add(id);
    return { id, label, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  });
}

// JSON.parse validates syntax; this token pass also rejects duplicate keys,
// including escaped spellings, rather than silently choosing their last value.
function strictJson(raw) {
  let value; try { value = JSON.parse(raw); } catch { fail(); }
  const stack = [];
  for (const token of raw.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g) || []) {
    if (token === '{') stack.push({ keys: new Set(), key: true });
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && stack.at(-1)) stack.at(-1).key = true;
    else if (token.startsWith('"') && stack.at(-1)?.key) {
      const key = JSON.parse(token), object = stack.at(-1);
      if (object.keys.has(key)) fail(); object.keys.add(key); object.key = false;
    }
  }
  return value;
}

/** @returns {MenuUploadLayout|null} */
export function parseMenuUploadLayout(raw, snapshot) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string' || !raw || raw.length > MENU_UPLOAD_LAYOUT_MAX_HEADER || /[^\x20-\x7e]/.test(raw)) fail();
  const value = strictJson(raw), expected = menuUploadSessionAreas(snapshot);
  if (!exactKeys(value, ['version', 'width', 'height', 'areas']) || value.version !== 1
    || !Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height)
    || !Array.isArray(value.areas) || value.areas.length !== expected.length) fail();
  try { validateRichMenuImageDimensions(value.width, value.height); } catch { fail(); }
  const areas = value.areas.map((area, index) => {
    if (!exactKeys(area, geometryKeys) || area.id !== expected[index].id || !idValid(area.id)
      || ![area.x, area.y, area.width, area.height].every(Number.isSafeInteger)) fail();
    return geometry(area);
  });
  try { validateRichMenuAreas(areas.map((area, index) => ({ ...area, label: expected[index].label })), value.width, value.height); }
  catch { fail(); }
  return { version: 1, width: value.width, height: value.height, areas };
}

export function menuUploadJobLayoutMatches(progressJson, layout) {
  const progress = progressJson ? JSON.parse(progressJson) : null;
  return JSON.stringify(progress?.menuUploadLayout ?? null) === JSON.stringify(layout);
}

export function menuUploadGeometry(snapshot, image, layout = /** @type {MenuUploadLayout|null} */ (null)) {
  const original = menuUploadSessionAreas(snapshot);
  if (layout && (layout.width !== image.width || layout.height !== image.height)) throw Error('MENU_UPLOAD_LAYOUT_DIMENSIONS_MISMATCH');
  // Explicit corrections already use new natural pixels: retain the aspect
  // guard without ever scaling those coordinates. Legacy bounds scale once.
  if (layout && Math.abs(image.width / image.height - snapshot.config.size.width / snapshot.config.size.height)
    > Math.max(1 / snapshot.config.size.height, 1 / image.height)) throw Error('IMAGE_RATIO_MISMATCH');
  const finalAreas = layout ? layout.areas : remapMenuAreas(original, snapshot.config.size, image);
  const mapped = finalAreas.map((area, index) => ({ ...snapshot.areas[index], ...geometry(area) }));
  const lineAreas = finalAreas.map((area, index) => ({ ...geometry(area), label: original[index].label, action: snapshot.config.areas[index].action }));
  validateRichMenuAreas(mapped, image.width, image.height);
  validateRichMenuAreas(lineAreas, image.width, image.height);
  return { mapped, lineAreas };
}
