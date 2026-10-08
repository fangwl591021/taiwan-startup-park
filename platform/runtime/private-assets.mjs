// Private small-image storage; shares no source project's R2 resources.
export function privateAssetBucket(db,workspaceId){
 function key(k){if(typeof k!=='string'||k.length>500||k.split('/')[1]!==workspaceId||k.split('/')[0]!=='templates')throw new Error('ASSET_SCOPE_DENIED');return k;}
 return {
  async put(k,value,options={}){
   key(k);const buffer=value instanceof ArrayBuffer?value:value instanceof Uint8Array?value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength):await new Response(value).arrayBuffer();
   if(!buffer.byteLength||buffer.byteLength>1048576)throw new Error('素材必須介於 1 byte 至 1 MB');
   const etag=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))).map(x=>x.toString(16).padStart(2,'0')).join('');
   await db.prepare('INSERT INTO startup_park_private_objects(workspace_id,storage_key,body,http_metadata,custom_metadata,etag) VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id,storage_key) DO UPDATE SET body=excluded.body,http_metadata=excluded.http_metadata,custom_metadata=excluded.custom_metadata,etag=excluded.etag,updated_at=CURRENT_TIMESTAMP').bind(workspaceId,k,buffer,JSON.stringify(options.httpMetadata||{}),JSON.stringify(options.customMetadata||{}),etag).run();
   return {key:k,etag,httpEtag:'"'+etag+'"'};
  },
  async get(k){
   key(k);const r=await db.prepare('SELECT body,http_metadata,custom_metadata,etag FROM startup_park_private_objects WHERE workspace_id=? AND storage_key=?').bind(workspaceId,k).first();
   if(!r)return null;
   const bytes=r.body instanceof ArrayBuffer?new Uint8Array(r.body):new Uint8Array(r.body);
   const meta=JSON.parse(r.http_metadata);
   const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
   return {body:new Response(buffer).body,size:bytes.byteLength,httpMetadata:meta,customMetadata:JSON.parse(r.custom_metadata),etag:r.etag,httpEtag:'"'+r.etag+'"',async arrayBuffer(){return buffer;},writeHttpMetadata(h){if(meta.contentType)h.set('Content-Type',meta.contentType);}};
  },
  async delete(k){for(const item of Array.isArray(k)?k:[k])await db.prepare('DELETE FROM startup_park_private_objects WHERE workspace_id=? AND storage_key=?').bind(workspaceId,key(item)).run();}
 };
}
