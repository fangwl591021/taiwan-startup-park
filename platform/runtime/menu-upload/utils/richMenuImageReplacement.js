import { richMenuImageDimensions } from './richMenuGeometry.js';

export function assertReplacementDimensions(actual, expected) {
  let next, original;
  try { next = richMenuImageDimensions(actual); original = richMenuImageDimensions(expected); }
  catch { throw new Error('無法確認新圖片尺寸，原圖片與按鈕均未變更。'); }
  if (next.imageWidth !== original.imageWidth || next.imageHeight !== original.imageHeight) {
    throw new Error(`新圖尺寸為 ${next.imageWidth} × ${next.imageHeight}；請使用與原圖相同的 ${original.imageWidth} × ${original.imageHeight} 圖片。原圖片與按鈕均未變更。`);
  }
  return next;
}

export function compatibleReplacementDimensions(actual, expected) {
  let next, original;
  try { next = richMenuImageDimensions(actual); original = richMenuImageDimensions(expected); }
  catch { throw new Error('無法確認新圖片尺寸，原圖片與按鈕均未變更。'); }
  // Tolerate a one-pixel rounding difference in exported/scaled originals.
  // In particular, 1527x1030 and 2500x1686 are the same tall layout.
  const tolerance = Math.max(1 / original.imageHeight, 1 / next.imageHeight);
  if (Math.abs(next.imageWidth / next.imageHeight - original.imageWidth / original.imageHeight) > tolerance) {
    throw new Error(`新圖為 ${next.imageWidth} × ${next.imageHeight}，與原版型比例不同；請選擇同比例圖片（例如原版型為大版時使用 2500 × 1686）。原圖片與按鈕均未變更。`);
  }
  return next;
}

// Convert original-pixel edges exactly once. Scaling right/bottom edges rather
// than widths independently keeps adjacent cells joined after integer rounding.
// IDs, labels, actions, review flags and corrected grid membership are untouched.
export function remapReplacementGeometry(areas, guides, expected, actual) {
  const original = richMenuImageDimensions(expected), next = compatibleReplacementDimensions(actual, original);
  if (original.imageWidth === next.imageWidth && original.imageHeight === next.imageHeight) return { areas, guides };
  const scaleX = value => Math.round(value * next.imageWidth / original.imageWidth);
  const scaleY = value => Math.round(value * next.imageHeight / original.imageHeight);
  const invalid = () => new Error('無法保留目前按鈕範圍，原圖片與按鈕均未變更；請確認原版型座標或使用較大的同比例圖片。');
  const mapped = areas.map(area => {
    const { x, y, width, height } = area;
    if (![x, y, width, height].every(Number.isSafeInteger) || x < 0 || y < 0 || width < 1 || height < 1
      || x + width > original.imageWidth || y + height > original.imageHeight) throw invalid();
    const left = scaleX(x), top = scaleY(y), right = scaleX(x + width), bottom = scaleY(y + height);
    if (right <= left || bottom <= top) throw invalid();
    return { ...area, x: left, y: top, width: right - left, height: bottom - top };
  });
  const mapGuides = (values, scale, originalLimit) => {
    if (!Array.isArray(values)) throw invalid();
    if (values.some(value => !Number.isSafeInteger(value) || value < 0 || value > originalLimit)) throw invalid();
    const mapped = values.map(scale);
    if (mapped.some((value, index) => !Number.isSafeInteger(value) || (index > 0 && value <= mapped[index - 1]))) throw invalid();
    return mapped;
  };
  return { areas: mapped, guides: guides ? { ...guides, columnGuides: mapGuides(guides.columnGuides, scaleX, original.imageWidth), rowGuides: mapGuides(guides.rowGuides, scaleY, original.imageHeight) } : null };
}

async function decodeDimensions(file) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    try { return { imageWidth: bitmap.width, imageHeight: bitmap.height }; }
    finally { bitmap.close(); }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ imageWidth: image.naturalWidth, imageHeight: image.naturalHeight });
      image.onerror = () => reject(new Error('無法讀取新圖片，原圖片與按鈕均未變更。'));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

// Decode local pixels, check the existing upload contract and layout ratio.
// Never run AI, infer new areas, resize artwork or upload while selecting.
export async function validateReplacementImage(file, expected, { decode = decodeDimensions } = {}) {
  if (!file || !['image/png', 'image/jpeg'].includes(file.type)) {
    throw new Error('換圖只支援 JPG／PNG，原圖片與按鈕均未變更。');
  }
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > 1024 * 1024) {
    throw new Error('圖片大小需介於 1 byte 與 1MB，原圖片與按鈕均未變更。');
  }
  let actual;
  try { actual = await decode(file); }
  catch { throw new Error('無法讀取新圖片，原圖片與按鈕均未變更。'); }
  const next = compatibleReplacementDimensions(actual, expected);
  if (next.imageWidth < 800 || next.imageWidth > 2500 || next.imageHeight < 250 || next.imageWidth / next.imageHeight < 1.45) {
    throw new Error('新圖尺寸不符合圖文選單規格（寬 800–2500 像素、高至少 250 像素），原圖片與按鈕均未變更。');
  }
  return next;
}
