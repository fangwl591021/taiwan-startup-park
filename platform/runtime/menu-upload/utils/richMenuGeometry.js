/**
 * Rich Menu geometry always lives in original image pixels.  The preview may
 * be any CSS size, but these helpers deliberately never return CSS pixels as
 * persisted coordinates.
 */

export const RICH_MENU_MIN_AREA_SIZE = 1;
export const RICH_MENU_DEFAULT_GRID_SNAP_TOLERANCE = 18;
export const RICH_MENU_DEFAULT_GRID_MIN_CELL_SIZE = 1;

const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const positiveInteger = (value, fallback = RICH_MENU_MIN_AREA_SIZE) => {
  const number = Math.round(finiteNumber(value, fallback));
  return number > 0 ? number : fallback;
};

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

/**
 * Accept either the API's imageWidth/imageHeight shape or a native
 * width/height image-like shape.  A caller must provide real dimensions;
 * silently falling back to a legacy Rich Menu size would corrupt coordinates.
 */
export const richMenuImageDimensions = (value = {}) => {
  const imageWidth = positiveInteger(value.imageWidth ?? value.width, 0);
  const imageHeight = positiveInteger(value.imageHeight ?? value.height, 0);
  if (!imageWidth || !imageHeight) {
    throw new Error('RICH_MENU_IMAGE_DIMENSIONS_REQUIRED');
  }
  return { imageWidth, imageHeight };
};

export const normalizeOriginalArea = (area = {}, dimensions, options = {}) => {
  const { imageWidth, imageHeight } = richMenuImageDimensions(dimensions);
  const minimumSize = Math.max(RICH_MENU_MIN_AREA_SIZE, positiveInteger(options.minimumSize, RICH_MENU_MIN_AREA_SIZE));
  const width = clamp(positiveInteger(area.width, minimumSize), minimumSize, imageWidth);
  const height = clamp(positiveInteger(area.height, minimumSize), minimumSize, imageHeight);
  const x = clamp(Math.round(finiteNumber(area.x)), 0, imageWidth - width);
  const y = clamp(Math.round(finiteNumber(area.y)), 0, imageHeight - height);
  return { ...area, x, y, width, height };
};

export const originalAreaToPreviewRect = (area, previewBounds, dimensions) => {
  const normalized = normalizeOriginalArea(area, dimensions);
  const { imageWidth, imageHeight } = richMenuImageDimensions(dimensions);
  const width = finiteNumber(previewBounds?.width);
  const height = finiteNumber(previewBounds?.height);
  if (width <= 0 || height <= 0) return null;
  const left = finiteNumber(previewBounds?.left);
  const top = finiteNumber(previewBounds?.top);
  return {
    left: left + normalized.x / imageWidth * width,
    top: top + normalized.y / imageHeight * height,
    width: normalized.width / imageWidth * width,
    height: normalized.height / imageHeight * height,
  };
};

export const originalAreaToPreviewStyle = (area, dimensions) => {
  const normalized = normalizeOriginalArea(area, dimensions);
  const { imageWidth, imageHeight } = richMenuImageDimensions(dimensions);
  return {
    left: `${normalized.x / imageWidth * 100}%`,
    top: `${normalized.y / imageHeight * 100}%`,
    width: `${normalized.width / imageWidth * 100}%`,
    height: `${normalized.height / imageHeight * 100}%`,
  };
};

export const previewPointToOriginal = (point, previewBounds, dimensions) => {
  const { imageWidth, imageHeight } = richMenuImageDimensions(dimensions);
  const width = finiteNumber(previewBounds?.width);
  const height = finiteNumber(previewBounds?.height);
  if (width <= 0 || height <= 0) return null;
  const pointX = finiteNumber(point?.clientX ?? point?.x);
  const pointY = finiteNumber(point?.clientY ?? point?.y);
  return {
    x: clamp(Math.round((pointX - finiteNumber(previewBounds?.left)) / width * imageWidth), 0, imageWidth),
    y: clamp(Math.round((pointY - finiteNumber(previewBounds?.top)) / height * imageHeight), 0, imageHeight),
  };
};

export const originalPointToPreview = (point, previewBounds, dimensions) => {
  const { imageWidth, imageHeight } = richMenuImageDimensions(dimensions);
  const width = finiteNumber(previewBounds?.width);
  const height = finiteNumber(previewBounds?.height);
  if (width <= 0 || height <= 0) return null;
  return {
    x: finiteNumber(previewBounds?.left) + clamp(finiteNumber(point?.x), 0, imageWidth) / imageWidth * width,
    y: finiteNumber(previewBounds?.top) + clamp(finiteNumber(point?.y), 0, imageHeight) / imageHeight * height,
  };
};

const previewDeltaToOriginal = (delta = {}, previewBounds, dimensions) => {
  const { imageWidth, imageHeight } = richMenuImageDimensions(dimensions);
  const width = finiteNumber(previewBounds?.width);
  const height = finiteNumber(previewBounds?.height);
  if (width <= 0 || height <= 0) return null;
  return {
    x: Math.round(finiteNumber(delta.x ?? delta.clientX) / width * imageWidth),
    y: Math.round(finiteNumber(delta.y ?? delta.clientY) / height * imageHeight),
  };
};

export const moveAreaByPreviewDelta = (area, previewDelta, previewBounds, dimensions) => {
  const delta = previewDeltaToOriginal(previewDelta, previewBounds, dimensions);
  if (!delta) return normalizeOriginalArea(area, dimensions);
  return normalizeOriginalArea({
    ...area,
    x: finiteNumber(area?.x) + delta.x,
    y: finiteNumber(area?.y) + delta.y,
  }, dimensions);
};

/**
 * Resize an original-coordinate area from a CSS-pixel drag.  `handle` may be
 * a corner or an edge, so the UI can use this for four-side/four-corner
 * controls without inventing a second coordinate system.
 */
export const resizeAreaByPreviewDelta = (area, previewDelta, previewBounds, dimensions, options = {}) => {
  const normalized = normalizeOriginalArea(area, dimensions, options);
  const delta = previewDeltaToOriginal(previewDelta, previewBounds, dimensions);
  if (!delta) return normalized;
  const handle = String(options.handle || 'bottom-right').toLowerCase();
  const minimumSize = Math.max(RICH_MENU_MIN_AREA_SIZE, positiveInteger(options.minimumSize, RICH_MENU_MIN_AREA_SIZE));
  const { imageWidth, imageHeight } = richMenuImageDimensions(dimensions);
  let left = normalized.x;
  let top = normalized.y;
  let right = normalized.x + normalized.width;
  let bottom = normalized.y + normalized.height;

  if (handle.includes('left')) left = clamp(left + delta.x, 0, right - minimumSize);
  if (handle.includes('right')) right = clamp(right + delta.x, left + minimumSize, imageWidth);
  if (handle.includes('top')) top = clamp(top + delta.y, 0, bottom - minimumSize);
  if (handle.includes('bottom')) bottom = clamp(bottom + delta.y, top + minimumSize, imageHeight);

  return normalizeOriginalArea({
    ...normalized,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }, dimensions, { minimumSize });
};

const normalizeGuideArray = (values, limit, minimumCellSize) => {
  if (!Array.isArray(values) || values.length < 2) return null;
  const guides = values.map(value => Math.round(finiteNumber(value, Number.NaN)));
  if (guides.some((value, index) => !Number.isFinite(value)
    || value < 0 || value > limit || (index > 0 && value - guides[index - 1] < minimumCellSize))) return null;
  return guides;
};

export const normalizeGridGuides = (guides, dimensions, options = {}) => {
  const { imageWidth, imageHeight } = richMenuImageDimensions(dimensions);
  const minimumCellSize = Math.max(RICH_MENU_DEFAULT_GRID_MIN_CELL_SIZE, positiveInteger(options.minimumCellSize, RICH_MENU_DEFAULT_GRID_MIN_CELL_SIZE));
  const columnGuides = normalizeGuideArray(guides?.columnGuides, imageWidth, minimumCellSize);
  const rowGuides = normalizeGuideArray(guides?.rowGuides, imageHeight, minimumCellSize);
  if (!columnGuides || !rowGuides) return null;
  return {
    ...guides,
    columnGuides,
    rowGuides,
  };
};

export const createRegularGridGuides = (columns, rows, dimensions) => {
  const { imageWidth, imageHeight } = richMenuImageDimensions(dimensions);
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) {
    throw new Error('RICH_MENU_GRID_DIMENSIONS_INVALID');
  }
  return {
    columnGuides: Array.from({ length: columns + 1 }, (_, index) => Math.round(imageWidth * index / columns)),
    rowGuides: Array.from({ length: rows + 1 }, (_, index) => Math.round(imageHeight * index / rows)),
  };
};

export const areaForGridCell = (guides, row, column, dimensions, extras = {}) => {
  const normalized = normalizeGridGuides(guides, dimensions);
  if (!normalized || !Number.isInteger(row) || !Number.isInteger(column)
    || row < 0 || column < 0 || row >= normalized.rowGuides.length - 1 || column >= normalized.columnGuides.length - 1) return null;
  const x = normalized.columnGuides[column];
  const y = normalized.rowGuides[row];
  return normalizeOriginalArea({
    ...extras,
    x,
    y,
    width: normalized.columnGuides[column + 1] - x,
    height: normalized.rowGuides[row + 1] - y,
    gridCell: { row, column },
  }, dimensions);
};

export const gridCellForArea = (area, guides, dimensions, tolerance = RICH_MENU_MIN_AREA_SIZE) => {
  const normalized = normalizeGridGuides(guides, dimensions);
  if (!normalized) return null;
  const target = normalizeOriginalArea(area, dimensions);
  const allowed = Math.max(RICH_MENU_MIN_AREA_SIZE, finiteNumber(tolerance, RICH_MENU_MIN_AREA_SIZE));
  for (let row = 0; row < normalized.rowGuides.length - 1; row += 1) {
    for (let column = 0; column < normalized.columnGuides.length - 1; column += 1) {
      const cell = areaForGridCell(normalized, row, column, dimensions);
      if (cell && Math.abs(target.x - cell.x) <= allowed && Math.abs(target.y - cell.y) <= allowed
        && Math.abs(target.width - cell.width) <= allowed && Math.abs(target.height - cell.height) <= allowed) {
        return { row, column };
      }
    }
  }
  return null;
};

// Stored templates keep source rectangles, not editor-only guide metadata.
// Restore only complete, exactly adjoining rows; never move a saved rectangle.
export const recoverGridGuidesFromAreas = (areas = [], dimensions) => {
  const { imageWidth, imageHeight } = richMenuImageDimensions(dimensions);
  const rows = new Map();
  for (const area of areas) {
    const { x, y, width, height } = area;
    if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0
      || width < 1 || height < 1 || x + width > imageWidth || y + height > imageHeight) continue;
    const key = `${y}:${height}`;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(area);
  }
  const groups = new Map();
  for (const cells of rows.values()) {
    cells.sort((a, b) => a.x - b.x);
    if (cells.length < 2 || cells.some((cell, index) => index > 0
      && cells[index - 1].x + cells[index - 1].width !== cell.x)) continue;
    const columns = [...cells.map(cell => cell.x), cells.at(-1).x + cells.at(-1).width];
    const key = columns.join(',');
    if (!groups.has(key)) groups.set(key, { columns, rows: [] });
    groups.get(key).rows.push({ top: cells[0].y, bottom: cells[0].y + cells[0].height });
  }
  let best = null;
  let bestCount = 0;
  for (const group of groups.values()) {
    const sorted = group.rows.sort((a, b) => a.top - b.top);
    let rowGuides = [];
    for (const row of sorted) {
      rowGuides = rowGuides.at(-1) === row.top ? [...rowGuides, row.bottom] : [row.top, row.bottom];
      const count = (group.columns.length - 1) * (rowGuides.length - 1);
      if (count > bestCount) {
        bestCount = count;
        best = { columnGuides: group.columns, rowGuides, confidence: null };
      }
    }
  }
  return best;
};

const nearestGuide = (value, guides, tolerance) => {
  let closest = null;
  for (const guide of guides) {
    const distance = Math.abs(value - guide);
    if (distance <= tolerance && (!closest || distance < closest.distance)) closest = { value: guide, distance };
  }
  return closest?.value ?? value;
};

/**
 * Snaps the four edges independently to nearby row/column guides.  It keeps
 * the original rectangle if snapping both sides would invert it.
 */
export const snapAreaToGridGuides = (area, guides, dimensions, options = {}) => {
  const normalizedGuides = normalizeGridGuides(guides, dimensions, options);
  const normalized = normalizeOriginalArea(area, dimensions, options);
  if (!normalizedGuides) return normalized;
  const tolerance = Math.max(RICH_MENU_MIN_AREA_SIZE, finiteNumber(options.tolerance, RICH_MENU_DEFAULT_GRID_SNAP_TOLERANCE));
  const minimumSize = Math.max(RICH_MENU_MIN_AREA_SIZE, positiveInteger(options.minimumSize, RICH_MENU_MIN_AREA_SIZE));
  const left = nearestGuide(normalized.x, normalizedGuides.columnGuides, tolerance);
  const top = nearestGuide(normalized.y, normalizedGuides.rowGuides, tolerance);
  const right = nearestGuide(normalized.x + normalized.width, normalizedGuides.columnGuides, tolerance);
  const bottom = nearestGuide(normalized.y + normalized.height, normalizedGuides.rowGuides, tolerance);
  const snapped = (right - left >= minimumSize && bottom - top >= minimumSize)
    ? normalizeOriginalArea({ ...normalized, x: left, y: top, width: right - left, height: bottom - top }, dimensions, { minimumSize })
    : normalized;
  return { ...snapped, gridCell: gridCellForArea(snapped, normalizedGuides, dimensions, options.tolerance) };
};
