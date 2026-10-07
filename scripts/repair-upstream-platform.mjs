import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const area = process.argv[2];
if (!['backend', 'frontend'].includes(area)) throw new Error('Invalid dependency workspace');
const cwd = join(root, '.migration-build/smart-menu', area);
const fix = spawnSync('npm', ['audit', 'fix', '--ignore-scripts', '--json'], {
  cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
});
if (fix.error) throw fix.error;
const lockBytes = await readFile(join(cwd, 'package-lock.json'));
const lock = JSON.parse(lockBytes);
for (const item of Object.values(lock.packages || {})) {
  if (item.resolved && /^https?:/.test(item.resolved)) {
    const url = new URL(item.resolved);
    if (url.username || url.password || url.hostname !== 'registry.npmjs.org') throw new Error('Unexpected dependency registry');
  }
}
const pkg = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
const original = JSON.parse(await readFile(join(root, 'platform/upstream-smart-menu', area, 'package.json'), 'utf8'));
for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'overrides']) {
  if (JSON.stringify(pkg[field]) !== JSON.stringify(original[field])) {
    throw new Error('Audit fix requires dependency range changes; review explicitly instead of accepting a force fix');
  }
}
console.log('DEPENDENCY_LOCK_OVERLAY ' + JSON.stringify({
  area, source_commit: 'f69fd70a2ff91056bbac158a41e046ee35f10077',
  content_base64: lockBytes.toString('base64'),
}));
console.log('Compatible dependency lock repair completed for ' + area + '. No force or range changes.');
