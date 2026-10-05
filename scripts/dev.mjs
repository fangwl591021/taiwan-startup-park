import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {database,seed} from './database.mjs';
import worker from '../dist/worker.js';
mkdirSync('.local',{recursive:true});
const db=database(process.env.DEMO_DB||'.local/demo.sqlite');seed(db);
const port=Number(process.env.PORT||8787);
const root=resolve('dist/public');
const assets={async fetch(req){
 const path=new URL(req.url).pathname;
 const file=resolve(root,'.'+decodeURIComponent(path==='/'?'/index.html':path));
 if(file!==root&&!file.startsWith(root+'/'))return new Response('Not found',{status:404});
 try{return new Response(await readFile(file),{headers:{'Content-Type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.mp4':'video/mp4','.vtt':'text/vtt; charset=utf-8','.jpg':'image/jpeg','.json':'application/json'})[extname(file)]||'application/octet-stream'}});}
 catch{return new Response('Not found',{status:404});}
}};
const server=http.createServer(async(req,res)=>{
 try{
 const chunks=[];for await(const c of req)chunks.push(c);
 const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
 const response=await worker.fetch(request,{DB:db,APP_ENV:'local',DEMO_MODE:'on',ASSETS:assets});
 res.writeHead(response.status,Object.fromEntries(response.headers));
 res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){console.error(e);res.writeHead(500);res.end('Local server error');}
});
server.listen(port,'127.0.0.1',()=>console.log('Local fictional demo: http://127.0.0.1:'+port));
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0);}));
