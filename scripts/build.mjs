import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist/public', {recursive:true});
await cp('public', 'dist/public', {recursive:true});
await cp('dist/web/app.js', 'dist/public/app.js');
console.log('Built Worker and responsive dashboard. No deployment performed.');
