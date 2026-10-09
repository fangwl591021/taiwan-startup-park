import React, { useEffect, useRef, useState } from 'react';
import { moveAreaByPreviewDelta, originalAreaToPreviewStyle, resizeAreaByPreviewDelta } from '../utils/richMenuGeometry.js';
import { menuUploadErrorMessage, validateMenuUploadLayout } from '../menu-upload.js';
import './MenuUploadAreaEditor.css';

const handles = [
  ['top-left', '左上'], ['top-right', '右上'], ['bottom-left', '左下'], ['bottom-right', '右下'],
];
const fields = [['x', 'X'], ['y', 'Y'], ['width', '寬度'], ['height', '高度']];
const cloneAreas = areas => areas.map(area => ({ ...area }));
const drawable = (area, dimensions) => [area?.x, area?.y, area?.width, area?.height].every(Number.isSafeInteger)
  && area.x >= 0 && area.y >= 0 && area.width > 0 && area.height > 0
  && area.x + area.width <= dimensions.width && area.y + area.height <= dimensions.height;

// Controlled source-pixel rectangles only. No image transformation, area
// detection, action editing, renaming, creation or deletion happens here.
export default function MenuUploadAreaEditor({ imageUrl, dimensions, areas, initialAreas, disabled = false, onChange }) {
  const [selectedId, setSelectedId] = useState(areas[0]?.id || '');
  const preview = useRef(null), gesture = useRef(null), live = useRef(null);
  live.current = { imageUrl, dimensions, areas, disabled, onChange };
  const active = areas.find(area => area.id === selectedId) || areas[0];
  const activeIndex = active ? areas.findIndex(area => area.id === active.id) : -1;
  let geometryError = null;
  try { validateMenuUploadLayout(areas, dimensions); } catch (error) { geometryError = error; }

  const release = current => {
    try { current?.target?.releasePointerCapture?.(current.pointerId); } catch { /* A cancelled/removed target may already have released capture. */ }
  };
  useEffect(() => {
    const current = gesture.current;
    gesture.current = null;
    release(current);
    return () => { const pending = gesture.current; gesture.current = null; release(pending); };
  }, [imageUrl, disabled, dimensions.width, dimensions.height]);

  const changeArea = (id, patch) => {
    const current = live.current;
    if (current.disabled) return;
    const previous = current.areas;
    const next = previous.map(area => area.id === id ? { ...area, ...patch } : area);
    current.areas = next;
    if (current.onChange(next) === false) current.areas = previous;
  };
  const select = id => { if (!live.current.disabled) setSelectedId(id); };
  const begin = (event, id, handle = '') => {
    const current = live.current;
    if (current.disabled || gesture.current || (event.button != null && event.button !== 0)) return;
    const area = current.areas.find(item => item.id === id);
    const bounds = preview.current?.getBoundingClientRect();
    if (!area || !drawable(area, current.dimensions) || !bounds || bounds.width <= 0 || bounds.height <= 0) return;
    event.preventDefault(); event.stopPropagation();
    setSelectedId(id);
    const start = { pointerId: event.pointerId, target: event.currentTarget, id, handle, area: { ...area },
      startX: event.clientX, startY: event.clientY, bounds, dimensions: { ...current.dimensions }, imageUrl: current.imageUrl };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { return; }
    gesture.current = start;
  };
  const move = event => {
    const start = gesture.current, current = live.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (current.disabled || current.imageUrl !== start.imageUrl) { gesture.current = null; release(start); return; }
    event.preventDefault(); event.stopPropagation();
    const delta = { x: event.clientX - start.startX, y: event.clientY - start.startY };
    const area = start.handle
      ? resizeAreaByPreviewDelta(start.area, delta, start.bounds, start.dimensions, { handle: start.handle })
      : moveAreaByPreviewDelta(start.area, delta, start.bounds, start.dimensions);
    changeArea(start.id, { x: area.x, y: area.y, width: area.width, height: area.height });
  };
  const finish = (event, cancelled = false) => {
    const start = gesture.current, current = live.current;
    if (!start || start.pointerId !== event.pointerId) return;
    gesture.current = null; release(start);
    if (cancelled && !current.disabled && current.imageUrl === start.imageUrl) changeArea(start.id,
      { x: start.area.x, y: start.area.y, width: start.area.width, height: start.area.height });
  };
  const resetCurrent = () => {
    if (!active || live.current.disabled) return;
    const original = initialAreas.find(area => area.id === active.id);
    if (original) changeArea(active.id, { x: original.x, y: original.y, width: original.width, height: original.height });
  };
  const resetAll = () => {
    const current = live.current;
    if (!current.disabled) {
      const previous = current.areas, next = cloneAreas(initialAreas);
      current.areas = next;
      if (current.onChange(next) === false) current.areas = previous;
    }
  };

  return <section className="menu-upload-area-editor" aria-label="按鈕範圍微調">
    <h3>按鈕範圍微調</h3>
    <p className="menu-upload-area-help">拖曳框線移動，拉動四個角落調整大小，也可直接修改原圖像素。只調整範圍，不改按鈕名稱與功能。</p>
    <div className="menu-upload-area-tabs" aria-label="選擇既有按鈕">
      {areas.map((area, index) => <button key={area.id} type="button" disabled={disabled} aria-pressed={area.id === active?.id}
        onClick={() => select(area.id)}>{index + 1}. {area.label}</button>)}
    </div>
    <div className="menu-upload-area-preview-shell">
      <div className="menu-upload-area-preview" ref={preview} style={{ aspectRatio: `${dimensions.width} / ${dimensions.height}` }}>
        <img src={imageUrl} alt="待上傳原圖與既有按鈕範圍" draggable={false} />
        {areas.filter(area => drawable(area, dimensions)).map(area => {
          const index = areas.findIndex(item => item.id === area.id), selected = area.id === active?.id;
          return <div key={area.id} role="group" tabIndex={disabled ? -1 : 0}
            className={'menu-upload-area-frame' + (selected ? ' is-selected' : '') + (disabled ? ' is-locked' : '')}
            style={originalAreaToPreviewStyle(area, dimensions)} aria-label={`按鈕 ${index + 1} ${area.label}，拖曳移動`}
            aria-current={selected ? 'true' : undefined} aria-disabled={disabled} onClick={() => select(area.id)}
            onKeyDown={event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); select(area.id); } }}
            onPointerDown={event => begin(event, area.id)} onPointerMove={move} onPointerUp={event => finish(event)}
            onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)}>
            <span className="menu-upload-area-label">{index + 1}. {area.label}</span>
            {selected && !disabled && handles.map(([handle, label]) => <button key={handle} type="button"
              className={'menu-upload-area-handle ' + handle} aria-label={`按鈕 ${index + 1} ${label}角調整大小`}
              onPointerDown={event => begin(event, area.id, handle)} onPointerMove={move} onPointerUp={event => finish(event)}
              onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)} />)}
          </div>;
        })}
      </div>
    </div>
    {active && <fieldset className="menu-upload-area-fields" disabled={disabled}>
      <legend>{activeIndex + 1}. {active.label} · 原圖 {dimensions.width} × {dimensions.height} 像素</legend>
      <div className="menu-upload-area-coordinate-grid">
        {fields.map(([key, label]) => <label key={key}>{label}<input type="number" step="1" inputMode="numeric"
          min={key === 'x' || key === 'y' ? 0 : 1} max={key === 'x' || key === 'width' ? dimensions.width : dimensions.height}
          aria-label={`按鈕 ${activeIndex + 1} ${label}`} value={Number.isFinite(active[key]) ? String(active[key]) : ''}
          onChange={event => changeArea(active.id, { [key]: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>)}
      </div>
      <div className="menu-upload-area-reset"><button type="button" onClick={resetCurrent}>還原此按鈕範圍</button>
        <button type="button" onClick={resetAll}>還原全部範圍</button></div>
    </fieldset>}
    {geometryError && <p className="menu-upload-area-error" role="alert">{menuUploadErrorMessage(geometryError)} 請修正範圍後再部署。</p>}
    <p className="menu-upload-area-help">按鈕重疊、超出圖片或尺寸過小時，會停止部署。框線以外仍可滑動頁面。</p>
  </section>;
}
