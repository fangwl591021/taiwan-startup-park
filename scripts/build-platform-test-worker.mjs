import {build} from 'esbuild';
import {readFile,mkdir} from 'node:fs/promises';
await mkdir('reports',{recursive:true});
await build({entryPoints:['platform/runtime/worker.mjs'],outfile:'reports/platform-test-worker.mjs',bundle:true,format:'esm',platform:'node',target:'node22',plugins:[{name:'test-wasm',setup(b){b.onLoad({filter:/\.wasm$/},async args=>({contents:'export default new WebAssembly.Module(new Uint8Array('+JSON.stringify(Array.from(await readFile(args.path)))+'));',loader:'js'}));}}]});
console.log('Built actual trusted source routes for isolated HTTP tests.');
