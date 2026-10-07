import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, lstat, cp, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(await readFile(join(root, 'config/platform-source-lock.json'), 'utf8'));
const source = join(root, lock.import_directory);
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--prepare')) throw new Error('Only --prepare is supported');
if (lock.status !== 'source_baseline_only' || lock.runtime_integrated !== false) throw new Error('Unexpected import state');
if (!/^[a-f0-9]{40}$/.test(lock.source_commit)) throw new Error('Invalid pinned source');
if (lock.import_directory !== 'platform/upstream-smart-menu') throw new Error('Unexpected source directory');
if (lock.files.length !== lock.file_count) throw new Error('Incomplete source manifest');

async function walk(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not allowed: ' + path);
    if (entry.isDirectory()) result.push(...await walk(join(directory, entry.name), path));
    else if (entry.isFile()) result.push(path);
    else throw new Error('Unsupported source entry: ' + path);
  }
  return result;
}

const actual = (await walk(source)).sort();
const expected = lock.files.map(file => file.path).sort();
if (new Set(expected).size !== expected.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error('Source file inventory differs from the pinned manifest');
}
const routes = [];
const sourceHosts = [];
for (const file of lock.files) {
  if (!file.path || file.path.startsWith('/') || file.path.split('/').some(part => part === '..' || part === '.' || !part)
      || file.path.includes('\\') || file.path.includes('\0') || file.mode !== '100644') throw new Error('Invalid source path');
  const bytes = await readFile(join(source, file.path));
  const sha = createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
  if (sha !== file.sha || bytes.length !== file.size) throw new Error('Source integrity mismatch: ' + file.path);
  if (/\.(?:ts|mjs|js|jsx|jsonc)$/.test(file.path)) {
    const text = bytes.toString('utf8');
    for (const match of text.matchAll(/https:\/\/[a-z0-9.-]+\.workers\.dev/gi)) {
      sourceHosts.push({ file: file.path, url: match[0] });
    }
    if (file.path.startsWith('backend/src/')) {
      for (const match of text.matchAll(/\bapp\.(get|post|patch|put|delete|use)\(\s*['"]([^'"]+)['"]/g)) {
        routes.push({ file: file.path, method: match[1].toUpperCase(), path: match[2] });
      }
    }
  }
}
const migrations = lock.files.filter(file => /^backend\/migrations\/.+\.sql$/.test(file.path));
if (migrations.length !== lock.migration_count) throw new Error('Incomplete migration inventory');
const report = {
  source_repository: lock.source_repository, source_commit: lock.source_commit,
  checked_files: actual.length, migration_files: migrations.length,
  modules: lock.modules, runtime_integrated: false,
  source_hosts_require_review: sourceHosts, routes,
  production_bindings_changed: false, remote_migrations_applied: false,
  acceptance: 'Source integrity only. Baseline tests/build are separate CI steps; business integration is pending.',
};
await writeFile(join(root, 'full-platform-source-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Verified ' + actual.length + ' pinned source files and ' + migrations.length + ' isolated migrations.');

if (args.includes('--prepare')) {
  const destination = join(root, '.migration-build/smart-menu');
  try {
    await lstat(destination);
    throw new Error('Build workspace already exists; use a fresh checkout');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: false, errorOnExist: true });
  for (const area of ['backend', 'frontend']) {
    const directory = join(destination, area);
    const configPath = join(directory, 'wrangler.jsonc');
    await cp(configPath, join(directory, 'wrangler.upstream-reference.jsonc.txt'));
    const packagePath = join(directory, 'package.json');
    const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
    pkg.scripts.deploy = "node -e \"throw new Error('Migration baseline cannot deploy; integration and resource verification are pending')\"";
    await writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n');
    const config = area === 'backend' ? {
      name: 'taiwan-startup-park-platform-local', main: 'src/index.ts',
      compatibility_date: '2026-08-07', compatibility_flags: ['nodejs_compat'],
      workers_dev: false, vars: { TENANT_MODE: 'session' },
      d1_databases: [{ binding: 'smart_menu_db', database_name: 'startup-park-platform-local-only',
        database_id: '00000000-0000-0000-0000-000000000000', remote: false }],
      r2_buckets: [{ binding: 'smart_menu_assets', bucket_name: 'startup-park-platform-local-only', remote: false }],
    } : {
      name: 'taiwan-startup-park-platform-ui-local', compatibility_date: '2026-08-07',
      workers_dev: false, assets: { directory: 'dist', not_found_handling: 'single-page-application' },
    };
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  }
  const frontend = join(destination, 'frontend');
  const appPath = join(frontend, 'src/App.jsx');
  const app = await readFile(appPath, 'utf8');
  const previous = "'https://smart-menu-backend.fangwl591021.workers.dev'";
  if (app.split(previous).length !== 2) throw new Error('Unexpected upstream API default; review source before adapting');
  await writeFile(appPath, app.replace(previous, "'http://127.0.0.1:8788'"));
  await writeFile(join(frontend, 'vite.config.js'),
    "import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\nexport default defineConfig({ plugins: [react()] });\n");
  console.log('Prepared isolated build workspace. No source D1/R2/service bindings, credentials or deployments are used.');
}
