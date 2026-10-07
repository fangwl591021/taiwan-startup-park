import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist/public', {recursive:true});
await cp('public', 'dist/public', {recursive:true});
await cp('dist/web/app.js', 'dist/public/app.js');
await cp('dist/web/line-workspace.js', 'dist/public/line-workspace.js');
console.log('Built Worker and responsive dashboard. No deployment performed.');
