import { remapReplacementGeometry } from './utils/richMenuImageReplacement.js';

export const MENU_UPLOAD_LAYOUT_HEADER = 'X-Menu-Upload-Layout';
export const MENU_UPLOAD_LAYOUT_MAX_LENGTH = 12_288;
const coordinates = ['x', 'y', 'width', 'height'];
const fail = code => { throw Object.assign(new Error('Menu upload geometry is invalid'), { code }); };
const validDimensions = value => value && [value.width, value.height].every(number => Number.isSafeInteger(number) && number > 0 && number <= 2500);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);

// New-image natural pixels are authoritative. Reject invalid edits rather than
// silently rounding/clipping at submission or deriving coordinates from CSS.
function validateAreas(areas, dimensions, publishReady) {
  if (!validDimensions(dimensions) || !Array.isArray(areas) || areas.length < 1 || areas.length > 20) fail('MENU_UPLOAD_LAYOUT_INVALID');
  const seen = new Set();
  const validated = areas.map(area => {
    if (!area || typeof area !== 'object' || !validId(area.id) || seen.has(area.id)
      || coordinates.some(key => !Number.isSafeInteger(area[key]))) fail('MENU_UPLOAD_LAYOUT_INVALID');
    seen.add(area.id);
    if (area.x < 0 || area.y < 0 || area.width < 1 || area.height < 1
      || area.x + area.width > dimensions.width || area.y + area.height > dimensions.height) fail('MENU_UPLOAD_LAYOUT_BOUNDS');
    if (publishReady && (area.width < 8 || area.height < 8 || area.width * area.height < 256)) fail('MENU_UPLOAD_LAYOUT_TINY');
    return { id: area.id, ...(typeof area.label === 'string' ? { label: area.label } : {}), x: area.x, y: area.y, width: area.width, height: area.height };
  });
  for (let first = 0; publishReady && first < validated.length; first++) {
    for (let second = first + 1; second < validated.length; second++) {
      const a = validated[first], b = validated[second];
      const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
        * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      if (intersection / Math.min(a.width * a.height, b.width * b.height) >= 0.2) fail('MENU_UPLOAD_LAYOUT_OVERLAP');
    }
  }
  return validated;
}

export function validateMenuUploadLayout(areas, dimensions) {
  return validateAreas(areas, dimensions, true);
}

export function validateMenuUploadSessionAreas(session) {
  // Backward-compatible with the already deployed image-only API. Partially
  // advertised editing support, however, must not silently fall back.
  if (session.areaEditVersion === undefined && session.areas === undefined) return null;
  if (session.areaEditVersion !== 1 || !Array.isArray(session.areas) || session.areas.length !== session.areaCount
    || session.areas.some(area => !area || typeof area.label !== 'string' || !area.label.trim() || area.label.length > 200)) fail('MENU_UPLOAD_RESPONSE_INVALID');
  try {
    return validateAreas(session.areas, { width: session.originalWidth, height: session.originalHeight }, false);
  } catch { fail('MENU_UPLOAD_RESPONSE_INVALID'); }
}

// Convert original edges exactly once on file selection. Edits made afterward
// remain in the new image's coordinates, including on submit and resize.
export function createMenuUploadAreas(session, dimensions) {
  const source = validateMenuUploadSessionAreas(session);
  if (!source) return null;
  if (!validDimensions(dimensions)) fail('MENU_UPLOAD_LAYOUT_INVALID');
  const original = { width: session.originalWidth, height: session.originalHeight };
  try {
    // Validate the layout ratio independently of tiny original boxes. A box
    // whose rounded edges collapse still needs a selectable repair placeholder.
    remapReplacementGeometry([], null, original, dimensions);
  } catch { fail('MENU_UPLOAD_LAYOUT_DIMENSIONS_MISMATCH'); }
  const mapped = source.map(area => {
    const left = Math.min(dimensions.width - 1, Math.round(area.x * dimensions.width / original.width));
    const top = Math.min(dimensions.height - 1, Math.round(area.y * dimensions.height / original.height));
    const right = Math.round((area.x + area.width) * dimensions.width / original.width);
    const bottom = Math.round((area.y + area.height) * dimensions.height / original.height);
    // One-pixel placeholders are editor-only: publish validation rejects them
    // until the operator repairs the range. Valid mapped boxes are unchanged.
    return { ...area, x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
  });
  // Existing invalid target sizes/overlaps remain visible for manual repair.
  // Final validation blocks publication but must not block entering the editor.
  return validateAreas(mapped, dimensions, false);
}

export function serializeMenuUploadLayout(areas, dimensions) {
  const validated = validateMenuUploadLayout(areas, dimensions);
  // Only geometry and stable ASCII IDs leave the editor. Labels/actions and
  // source authority always come from the server's original snapshot.
  const value = JSON.stringify({ version: 1, width: dimensions.width, height: dimensions.height,
    areas: validated.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })) });
  if (value.length > MENU_UPLOAD_LAYOUT_MAX_LENGTH || /[^\x20-\x7e]/.test(value)) fail('MENU_UPLOAD_LAYOUT_INVALID');
  return value;
}
