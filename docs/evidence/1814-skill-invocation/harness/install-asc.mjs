// Installs ASC into a sample project exactly as v05/USAGE.md「標準の導入先」documents for Claude Code, from a release
// tarball verified by sha256 (owner requirement: never copy Skills from this repository). No model call, no network
// (npm --offline; the package has no dependencies).
//   1. check the tarball sha256 against the expected digest (GitHub Release asset digest / SHA256SUMS)
//   2. npm install --prefix <new temp dir> --offline --ignore-scripts ... <tarball>
//   3. project-assets <project> --register-claude-skill            (plan, recorded)
//   4. project-assets <project> --register-claude-skill --apply
//   5. remove the temp prefix
// Then it verifies that every distributed Skill has a thin Claude Code entry .claude/skills/<name>/SKILL.md whose bytes
// are the ones recorded in .agent-skill-chain/distribution.json, that the entry links to the body
// .agent-skill-chain/skills/<name>/SKILL.md, and that the body equals the package's skills/<name>/SKILL.md (asc: the
// documented project rewrite, checked by recorded hash only).
// Usage: node install-asc.mjs <tarball> <expected-sha256> <project-dir> <temp-parent>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts});
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} ${args.slice(0, 2).join(' ')} failed (${r.status}): ${(r.stderr || r.stdout).slice(0, 400)}`);
  return r.stdout;
}

export function verifyEntries(project, pkgDir) {
  const skillsDir = path.join(pkgDir, 'skills');
  const distributed = fs.readdirSync(skillsDir).filter((d) => fs.existsSync(path.join(skillsDir, d, 'SKILL.md'))).sort();
  const record = JSON.parse(fs.readFileSync(path.join(project, '.agent-skill-chain/distribution.json'), 'utf8'));
  const entriesDir = path.join(project, '.claude/skills');
  const present = fs.existsSync(entriesDir) ? fs.readdirSync(entriesDir).sort() : [];
  const rows = distributed.map((name) => {
    const rel = `.claude/skills/${name}/SKILL.md`, bodyRel = `.agent-skill-chain/skills/${name}/SKILL.md`;
    const entry = fs.existsSync(path.join(project, rel)) ? fs.readFileSync(path.join(project, rel)) : null;
    const body = fs.existsSync(path.join(project, bodyRel)) ? fs.readFileSync(path.join(project, bodyRel)) : null;
    const pkgBody = fs.readFileSync(path.join(skillsDir, name, 'SKILL.md'));
    const linkOk = entry !== null && entry.toString().includes(`](../../../.agent-skill-chain/skills/${name}/SKILL.md)`);
    return {name, entrySha256: entry && sha(entry), entryMatchesRecord: entry !== null && record.files[rel] === sha(entry),
      entryIsThin: entry !== null && entry.length < 2048 && linkOk, bodyMatchesRecord: body !== null && record.files[bodyRel] === sha(body),
      bodyEqualsPackage: name === 'asc' ? null : body !== null && body.equals(pkgBody)};
  });
  const problems = [];
  if (JSON.stringify(present) !== JSON.stringify(distributed)) problems.push(`entries ${present.join(',')} != distributed ${distributed.join(',')}`);
  if (!record.registeredHosts?.includes('.claude')) problems.push('.claude not in registeredHosts');
  for (const r of rows) for (const k of ['entryMatchesRecord', 'entryIsThin', 'bodyMatchesRecord']) if (!r[k]) problems.push(`${r.name}: ${k}`);
  for (const r of rows) if (r.bodyEqualsPackage === false) problems.push(`${r.name}: body differs from package`);
  return {distributed, entries: rows, distributionSha256: sha(fs.readFileSync(path.join(project, '.agent-skill-chain/distribution.json'))), problems};
}

export function installAsc(tarball, expected, project, tempParent) {
  const bytes = fs.readFileSync(tarball);
  const digest = sha(bytes);
  if (digest !== expected.replace(/^sha256:/, '')) throw new Error(`tarball sha256 ${digest} != expected ${expected}`);
  const prefix = fs.mkdtempSync(path.join(tempParent, 'asc-bootstrap-'));
  const env = {PATH: process.env.PATH, HOME: prefix, npm_config_userconfig: path.join(prefix, 'npmrc'), npm_config_globalconfig: path.join(prefix, 'npmrc-global')};
  run('npm', ['install', '--prefix', prefix, '--cache', path.join(prefix, 'npm-cache'), '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--no-save', '--package-lock=false', path.resolve(tarball)], {env});
  const pkgDir = path.join(prefix, 'node_modules/agent-skill-chain');
  const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const cli = path.join(pkgDir, 'bin/asc-v05.mjs');
  const plan = JSON.parse(run(process.execPath, [cli, 'project-assets', project, '--register-claude-skill'], {cwd: project, env}));
  const applied = JSON.parse(run(process.execPath, [cli, 'project-assets', project, '--register-claude-skill', '--apply'], {cwd: project, env}));
  if (!applied.applied || applied.conflicts.length) throw new Error('project-assets --apply did not apply cleanly');
  const verify = verifyEntries(project, pkgDir);
  const runtime = JSON.parse(fs.readFileSync(path.join(project, '.agent-skill-chain/runtime.json'), 'utf8'));
  fs.rmSync(prefix, {recursive: true, force: true});
  if (verify.problems.length) throw new Error(`installed entries do not match the release: ${verify.problems.join('; ')}`);
  return {tarball: path.basename(tarball), tarballSha256: digest, packageVersion: pkg.version, runtimeVersion: runtime.version,
    planChanges: plan.changes.length, appliedChanges: applied.changes.length, registeredHosts: applied.registeredHosts,
    nodeVersion: process.version, npmVersion: run('npm', ['--version'], {env}).trim(), ...verify};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [tarball, expected, project, tempParent] = process.argv.slice(2);
  console.log(JSON.stringify(installAsc(path.resolve(tarball), expected, path.resolve(project), path.resolve(tempParent)), null, 1));
}
