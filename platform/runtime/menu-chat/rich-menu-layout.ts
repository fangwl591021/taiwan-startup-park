export type RichMenuLayoutType = 'TALL' | 'COMPACT';

export const LEGACY_RICH_MENU_WIDTH = 2500;
export const LEGACY_RICH_MENU_HEIGHT = 1686;
export const COMPACT_RICH_MENU_HEIGHT = 843;
export const MAX_RICH_MENU_AREAS = 20;
// A one-pixel rectangle is technically in bounds, but it cannot be a usable
// Rich Menu target. Keep these named so the detector and publish validation
// share a reviewable minimum rather than scattered magic numbers.
export const MIN_RICH_MENU_AREA_SIDE = 8;
export const MIN_RICH_MENU_AREA_PIXELS = 256;
export const SIGNIFICANT_RICH_MENU_AREA_OVERLAP_RATIO = 0.2;

export type RichMenuSemanticAnchor = {
  label: string;
  x: number;
  y: number;
};

export type RichMenuGridInference = {
  kind: 'REGULAR_GRID';
  rows: number;
  columns: number;
  confidence: number;
  columnGuides: number[];
  rowGuides: number[];
  areas: Array<{
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
  }>;
};

const integer = (value: unknown) => Math.round(Number(value));
const confidencePercent = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : 0;
};

/**
 * A successful provider HTTP response is not a successful layout detection.
 * Only a non-empty list of structurally usable hit-area candidates may reach
 * the editor as an AI result.
 */
export function hasDetectedRichMenuCandidates(value: unknown): boolean {
  const areas = value && typeof value === 'object'
    ? (value as { areas?: unknown }).areas
    : null;
  if (!Array.isArray(areas)) return false;
  return areas.some((area) => {
    if (!area || typeof area !== 'object') return false;
    const candidate = area as Record<string, unknown>;
    return Boolean(String(candidate.label || '').trim())
      && [candidate.x, candidate.y, candidate.width, candidate.height].every((coordinate) => Number.isFinite(Number(coordinate)))
      && Number(candidate.width) > 0
      && Number(candidate.height) > 0;
  });
}

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const guidesFromCenters = (centers: number[], limit: number) => {
  if (centers.length < 2) return [];
  const guides = [Math.max(0, Math.round(centers[0] - (centers[1] - centers[0]) / 2))];
  for (let index = 1; index < centers.length; index += 1) {
    guides.push(Math.max(0, Math.min(limit, Math.round((centers[index - 1] + centers[index]) / 2))));
  }
  guides.push(Math.min(limit, Math.round(centers.at(-1)! + (centers.at(-1)! - centers.at(-2)!) / 2)));
  if (guides[0] >= guides[1] || guides.at(-1)! <= guides.at(-2)!) return [];
  return guides;
};

/**
 * Turns semantic centers from a regular menu band into complete hit areas.
 * The vision model only identifies the intended menu-cell centers; the grid
 * geometry itself is deterministic so labels and icons never become hitboxes.
 */
export function inferRegularRichMenuGrid(
  rawAnchors: RichMenuSemanticAnchor[],
  width: number,
  height: number,
): RichMenuGridInference | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;

  const seenLabels = new Set<string>();
  const anchors = rawAnchors
    .map((anchor) => ({
      label: String(anchor?.label || '').trim(),
      x: Math.round(Number(anchor?.x)),
      y: Math.round(Number(anchor?.y)),
    }))
    .filter((anchor) => {
      const duplicate = seenLabels.has(anchor.label);
      if (anchor.label) seenLabels.add(anchor.label);
      return Boolean(anchor.label) && !duplicate && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)
        && anchor.x >= 0 && anchor.x < width && anchor.y >= 0 && anchor.y < height;
    });
  if (anchors.length < 6) return null;

  const rowTolerance = Math.max(36, Math.round(height * 0.075));
  const rows: Array<{ center: number; anchors: RichMenuSemanticAnchor[] }> = [];
  for (const anchor of [...anchors].sort((left, right) => left.y - right.y)) {
    const current = rows.at(-1);
    if (!current || Math.abs(anchor.y - current.center) > rowTolerance) {
      rows.push({ center: anchor.y, anchors: [anchor] });
      continue;
    }
    current.anchors.push(anchor);
    current.center = average(current.anchors.map((item) => item.y));
  }

  const countFrequency = new Map<number, number>();
  for (const row of rows) {
    const count = row.anchors.length;
    if (count >= 3 && count <= 5) countFrequency.set(count, (countFrequency.get(count) || 0) + 1);
  }
  const columns = Array.from(countFrequency.entries())
    .sort((left, right) => right[1] - left[1] || right[0] - left[0])[0]?.[0];
  if (!columns || (countFrequency.get(columns) || 0) < 2) return null;

  const candidateRows = rows
    .filter((row) => row.anchors.length === columns)
    .map((row) => ({ ...row, anchors: [...row.anchors].sort((left, right) => left.x - right.x) }));
  if (candidateRows.length < 2) return null;

  const columnCenters = Array.from({ length: columns }, (_, column) => average(candidateRows.map((row) => row.anchors[column].x)));
  const columnGaps = columnCenters.slice(1).map((center, index) => center - columnCenters[index]);
  const averageColumnGap = average(columnGaps);
  if (averageColumnGap <= 0 || columnGaps.some((gap) => Math.abs(gap - averageColumnGap) > averageColumnGap * 0.22)) return null;

  const positionTolerance = Math.max(42, Math.round(averageColumnGap * 0.22));
  const alignedRows = candidateRows.filter((row) => row.anchors.every((anchor, column) => (
    Math.abs(anchor.x - columnCenters[column]) <= positionTolerance
  )));
  if (alignedRows.length < 2) return null;

  const rowCenters = alignedRows.map((row) => Math.round(average(row.anchors.map((anchor) => anchor.y))));
  const columnGuides = guidesFromCenters(columnCenters, width);
  const rowGuides = guidesFromCenters(rowCenters, height);
  if (columnGuides.length !== columns + 1 || rowGuides.length !== alignedRows.length + 1) return null;

  const rowGaps = rowCenters.slice(1).map((center, index) => center - rowCenters[index]);
  const averageRowGap = average(rowGaps);
  if (averageRowGap <= 0 || rowGaps.some((gap) => Math.abs(gap - averageRowGap) > averageRowGap * 0.35)) return null;

  const spacingPenalty = (
    average(columnGaps.map((gap) => Math.abs(gap - averageColumnGap) / averageColumnGap))
    + average(rowGaps.map((gap) => Math.abs(gap - averageRowGap) / averageRowGap))
  ) / 2;
  const confidence = Math.max(70, Math.min(95, Math.round(94 - spacingPenalty * 100)));
  const areas = alignedRows.flatMap((row, rowIndex) => row.anchors.map((anchor, columnIndex) => ({
    label: anchor.label,
    x: columnGuides[columnIndex],
    y: rowGuides[rowIndex],
    width: columnGuides[columnIndex + 1] - columnGuides[columnIndex],
    height: rowGuides[rowIndex + 1] - rowGuides[rowIndex],
    confidence,
  })));

  return {
    kind: 'REGULAR_GRID',
    rows: alignedRows.length,
    columns,
    confidence,
    columnGuides,
    rowGuides,
    areas,
  };
}

export function resolveRichMenuDimensions(width: unknown, height: unknown) {
  const resolvedWidth = integer(width);
  const resolvedHeight = integer(height);
  return {
    width: Number.isFinite(resolvedWidth) && resolvedWidth > 0 ? resolvedWidth : LEGACY_RICH_MENU_WIDTH,
    height: Number.isFinite(resolvedHeight) && resolvedHeight > 0 ? resolvedHeight : LEGACY_RICH_MENU_HEIGHT,
  };
}

export function classifyRichMenuLayout(width: number, height: number): RichMenuLayoutType {
  const ratio = width / height;
  const tallRatio = LEGACY_RICH_MENU_WIDTH / LEGACY_RICH_MENU_HEIGHT;
  const compactRatio = LEGACY_RICH_MENU_WIDTH / COMPACT_RICH_MENU_HEIGHT;
  return Math.abs(ratio - compactRatio) < Math.abs(ratio - tallRatio) ? 'COMPACT' : 'TALL';
}

export function validateRichMenuImageDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 800 || width > 2500 || height < 250 || width / height < 1.45) {
    throw new Error('RICH_MENU_IMAGE_DIMENSIONS_INVALID');
  }
  return { width, height, layoutType: classifyRichMenuLayout(width, height) };
}

export function richMenuAreaStyle(area: Record<string, unknown>, width: number, height: number) {
  return {
    left: `${(Number(area.x) / width) * 100}%`,
    top: `${(Number(area.y) / height) * 100}%`,
    width: `${(Number(area.width) / width) * 100}%`,
    height: `${(Number(area.height) / height) * 100}%`,
  };
}

export function normalizeDetectedRichMenuAreas(areas: unknown[], width: number, height: number) {
  return areas.slice(0, MAX_RICH_MENU_AREAS).map((value, index) => {
    const area = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const rawCoordinates = [area.x, area.y, area.width, area.height];
    const finiteCoordinates = rawCoordinates.every((coordinate) => Number.isFinite(Number(coordinate)));
    const x = Math.min(width - 1, Math.max(0, integer(area.x) || 0));
    const y = Math.min(height - 1, Math.max(0, integer(area.y) || 0));
    const areaWidth = Math.min(width - x, Math.max(1, integer(area.width) || 1));
    const areaHeight = Math.min(height - y, Math.max(1, integer(area.height) || 1));
    const label = String(area.label || '').trim();
    const normalized = {
      id: Number.isFinite(Number(area.id)) ? Number(area.id) : index + 1,
      label: label || `區塊 ${index + 1}`,
      x,
      y,
      width: areaWidth,
      height: areaHeight,
      confidence: confidencePercent(area.confidence),
      detectionMode: String(area.detectionMode || 'inferred_grid'),
      // Normalising is intentionally not validation. Preserve a visible review
      // marker rather than silently turning invalid provider output into a
      // publishable result.
      needsReview: Boolean(area.needsReview || !finiteCoordinates || !label
        || areaWidth < MIN_RICH_MENU_AREA_SIDE || areaHeight < MIN_RICH_MENU_AREA_SIDE
        || areaWidth * areaHeight < MIN_RICH_MENU_AREA_PIXELS),
    };
    return { ...normalized, style: richMenuAreaStyle(normalized, width, height) };
  });
}

export function validateRichMenuAreas(areas: unknown[], width: number, height: number) {
  if (!Array.isArray(areas) || areas.length < 1 || areas.length > MAX_RICH_MENU_AREAS) {
    throw new Error('RICH_MENU_AREA_COUNT_INVALID');
  }
  const seenIds = new Set<string>();
  const validated = areas.map((value, index) => {
    const area = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const id = String(area.id ?? index + 1).trim();
    const label = String(area.label || '').trim();
    if (!id || seenIds.has(id)) throw new Error(`RICH_MENU_AREA_ID_DUPLICATE:${index + 1}`);
    seenIds.add(id);
    if (!label) throw new Error(`RICH_MENU_AREA_LABEL_EMPTY:${index + 1}`);
    if ([area.x, area.y, area.width, area.height].some((coordinate) => !Number.isFinite(Number(coordinate)))) {
      throw new Error(`RICH_MENU_AREA_COORDINATE_INVALID:${index + 1}`);
    }
    const x = integer(area.x);
    const y = integer(area.y);
    const areaWidth = integer(area.width);
    const areaHeight = integer(area.height);
    if (![x, y, areaWidth, areaHeight].every(Number.isInteger)
      || x < 0 || y < 0 || areaWidth < 1 || areaHeight < 1
      || x + areaWidth > width || y + areaHeight > height) {
      throw new Error(`RICH_MENU_AREA_OUT_OF_BOUNDS:${index + 1}`);
    }
    if (areaWidth < MIN_RICH_MENU_AREA_SIDE || areaHeight < MIN_RICH_MENU_AREA_SIDE
      || areaWidth * areaHeight < MIN_RICH_MENU_AREA_PIXELS) {
      throw new Error(`RICH_MENU_AREA_TOO_SMALL:${index + 1}`);
    }
    if (area.reviewRequired && !area.reviewed) throw new Error(`RICH_MENU_AREA_NEEDS_REVIEW:${index + 1}`);
    return { ...area, id, label, x, y, width: areaWidth, height: areaHeight };
  });
  for (let left = 0; left < validated.length; left += 1) {
    for (let right = left + 1; right < validated.length; right += 1) {
      const first = validated[left];
      const second = validated[right];
      const overlapWidth = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
      const overlapHeight = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
      const overlap = overlapWidth * overlapHeight;
      const smallerArea = Math.min(first.width * first.height, second.width * second.height);
      if (smallerArea > 0 && overlap / smallerArea >= SIGNIFICANT_RICH_MENU_AREA_OVERLAP_RATIO) {
        throw new Error(`RICH_MENU_AREA_OVERLAP_SIGNIFICANT:${left + 1}:${right + 1}`);
      }
    }
  }
  return validated;
}

const uint24le = (bytes: Uint8Array, offset: number) => (
  bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
);

export function readImageDimensions(buffer: ArrayBuffer, mimeType: string) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (mimeType === 'image/png' && bytes.length >= 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  if (mimeType === 'image/jpeg' && bytes.length >= 10 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    for (let offset = 2; offset + 8 < bytes.length;) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if (sofMarkers.has(marker)) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      }
      offset += 2 + length;
    }
  }

  if (mimeType === 'image/webp' && bytes.length >= 30
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === 'VP8X') return { width: uint24le(bytes, 24) + 1, height: uint24le(bytes, 27) + 1 };
    if (chunk === 'VP8 ' && bytes.length >= 30) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      return {
        width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
        height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
      };
    }
  }

  throw new Error('RICH_MENU_IMAGE_DIMENSIONS_UNREADABLE');
}
