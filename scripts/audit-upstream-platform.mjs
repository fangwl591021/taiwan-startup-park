import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
let blocked = false;
for (const area of ['backend', 'frontend']) {
  const result = spawnSync('npm', ['audit', '--json'], {
    cwd: join(root, '.migration-build/smart-menu', area),
    encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  let report;
  try { report = JSON.parse(result.stdout); } catch { throw new Error(area + ' dependency audit returned no valid report'); }
  if (report.error || !report.metadata?.vulnerabilities || !report.vulnerabilities) {
    throw new Error(area + ' dependency audit was unavailable');
  }
  await writeFile(join(root, 'full-platform-' + area + '-audit.json'), JSON.stringify(report, null, 2) + '\n');
  const findings = Object.values(report.vulnerabilities).filter(item => ['high', 'critical'].includes(item.severity));
  console.log(JSON.stringify({
    area, counts: report.metadata.vulnerabilities,
    findings: findings.map(item => ({
      name: item.name, severity: item.severity, range: item.range,
      isDirect: item.isDirect, fixAvailable: item.fixAvailable,
      advisories: item.via.filter(item => typeof item === 'object').map(item => ({ title: item.title, url: item.url })),
    })),
  }));
  if (findings.length) blocked = true;
}
if (blocked) {
  console.error('Imported baseline has high/critical dependency findings. Runtime integration/release remains blocked until reviewed fixes pass.');
  process.exitCode = 1;
}
