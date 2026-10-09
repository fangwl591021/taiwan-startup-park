// Ported from Sakura Welfare's byte inspector; no AI, resizing or recompression.
export const MENU_IMAGE_MAX_BYTES = 1_000_000;
export function inspectMenuImage(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length >= MENU_IMAGE_MAX_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, contentType;
  if (bytes.length >= 45 && [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) {
    let at = 8, data = false, ended = false;
    while (at + 12 <= bytes.length) {
      const length = view.getUint32(at), end = at + length + 12;
      if (end > bytes.length) return null;
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      if (at === 8) {
        if (type !== 'IHDR' || length !== 13) return null;
        width = view.getUint32(at + 8); height = view.getUint32(at + 12);
      } else if (type === 'IHDR') return null;
      if (type === 'IDAT' && length) data = true;
      if (type === 'IEND') { if (length || end !== bytes.length || !data) return null; ended = true; break; }
      at = end;
    }
    if (!ended) return null;
    contentType = 'image/png';
  } else if (bytes.length >= 20 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    let at = 2, scan = false;
    while (at + 4 <= bytes.length) {
      if (bytes[at++] !== 255) return null;
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 217 || marker === 0 || at + 2 > bytes.length) return null;
      const length = view.getUint16(at);
      if (length < 2 || at + length > bytes.length) return null;
      if ([192,193,194].includes(marker)) {
        if (length < 8 || width) return null;
        height = view.getUint16(at + 3); width = view.getUint16(at + 5);
      }
      if (marker === 218) { scan = Boolean(width && height); break; }
      at += length;
    }
    if (!scan) return null;
    contentType = 'image/jpeg';
  } else return null;
  return width >= 800 && width <= 2500 && height >= 250 && width / height >= 1.45
    ? { width, height, contentType } : null;
}
export async function readMenuImage(token, messageId, fetcher = fetch) {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(String(messageId || ''))) throw new Error('IMAGE_UNAVAILABLE');
  const signal = AbortSignal.timeout(8000);
  const response = await fetcher(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
    headers: { Authorization: 'Bearer ' + token }, signal,
  });
  if (!response.ok || !response.body) throw new Error('IMAGE_UNAVAILABLE');
  if (Number(response.headers.get('content-length')) >= MENU_IMAGE_MAX_BYTES) { await response.body.cancel(); return null; }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size >= MENU_IMAGE_MAX_BYTES) return null; chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  const info = inspectMenuImage(bytes); return info ? { bytes, ...info } : null;
}
// Direct LIFF uploads bypass LINE's message-content transformation. Bound the
// actual stream, not just Content-Length; preserve received bytes unchanged.
async function readMenuUploadBytes(request,maximumWaitMs,discard=false) {
  const fail=(code,status=400,details={})=>{throw Object.assign(new Error(code),{code,status,details});};
  if(!request.body)return new Uint8Array();
  const declared=Number(request.headers.get('content-length'));
  if(declared>=MENU_IMAGE_MAX_BYTES){void request.body.cancel().catch(()=>{});fail('IMAGE_TOO_LARGE',413,{...(Number.isSafeInteger(declared)?{actualSize:declared}:{}),maximumBytes:MENU_IMAGE_MAX_BYTES-1});}
  const reader=request.body.getReader(),chunks=[],deadline=Date.now()+maximumWaitMs;let size=0;
  const read=()=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{reject(Object.assign(new Error('IMAGE_UPLOAD_TIMEOUT'),{code:'IMAGE_UPLOAD_TIMEOUT',status:408,details:{actualSize:size}}));
      void reader.cancel().catch(()=>{});},Math.max(0,deadline-Date.now()));
    reader.read().then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});
  });
  try{for(;;){const {done,value}=await read();if(done)break;size+=value.byteLength;
    if(size>=MENU_IMAGE_MAX_BYTES)fail('IMAGE_TOO_LARGE',413,{actualSize:size,maximumBytes:MENU_IMAGE_MAX_BYTES-1});if(!discard)chunks.push(value);
  }}finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
  if(discard)return new Uint8Array();
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  return bytes;
}
// Drain valid-sized replay bodies without retaining or decoding them. Some HTTP
// runtimes close large inbound uploads if a response leaves the body unread.
export async function discardMenuUploadBody(request,maximumWaitMs=20_000) {
  await readMenuUploadBytes(request,maximumWaitMs,true);
}
export async function readMenuUploadImage(request,maximumWaitMs=20_000) {
  const fail=(code,status=400,details={})=>{throw Object.assign(new Error(code),{code,status,details});};
  const contentType=(request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(!['image/jpeg','image/png'].includes(contentType))fail('IMAGE_FORMAT_UNSUPPORTED');
  const bytes=await readMenuUploadBytes(request,maximumWaitMs);
  const info=inspectMenuImage(bytes);
  if(!info)fail('IMAGE_INVALID',400,{actualSize:bytes.length});
  if(info.contentType!==contentType)fail('IMAGE_FORMAT_MISMATCH',400,{actualSize:bytes.length});
  return {bytes,...info};
}
// Source-pixel edges are converted once. IDs, labels and actions are untouched.
export function remapMenuAreas(areas, original, next) {
  if (![original.width,original.height,next.width,next.height].every(v => Number.isSafeInteger(v) && v > 0)
    || Math.abs(next.width / next.height - original.width / original.height) > Math.max(1 / original.height,1 / next.height)) throw new Error('IMAGE_RATIO_MISMATCH');
  return areas.map(area => {
    const { x,y,width,height } = area;
    if (![x,y,width,height].every(Number.isSafeInteger) || x < 0 || y < 0 || width < 1 || height < 1 || x + width > original.width || y + height > original.height) throw new Error('AREA_INVALID');
    const left = Math.round(x * next.width / original.width), right = Math.round((x + width) * next.width / original.width);
    const top = Math.round(y * next.height / original.height), bottom = Math.round((y + height) * next.height / original.height);
    if (right <= left || bottom <= top) throw new Error('AREA_INVALID');
    return { ...area, x:left, y:top, width:right-left, height:bottom-top };
  });
}
