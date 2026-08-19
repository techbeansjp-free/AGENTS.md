import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../helpers/cli.js';
import { validateAgainstSchema } from '../../src/lib/schema.js';
import { readYamlFile } from '../../src/lib/yaml-io.js';

// Issue #169 T2: init コマンドの結合テスト（bin/agents-md.js 経由でsubprocess実行）。
// GitHub API（labels/ruleset）には触れないため、gh-stubは不要。

const packageRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

function mkScratch(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agent-skill-chain-${prefix}-`));
}

test('init --dry-run: 実ファイルは一切作成されず、作成予定一覧のみが標準出力に表示される', (t) => {
  const targetDir = path.join(mkScratch('init-dry-parent'), 'target');
  t.after(() => fs.rmSync(path.dirname(targetDir), { recursive: true, force: true }));

  const result = runCli(['init', targetDir, '--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /planned created:/);
  assert.equal(fs.existsSync(targetDir), false, 'target_dir自体が作成されないこと');
});

test('init: 標準資産・Claude worker agentを実体化し、GitHub Actionsは展開しない', (t) => {
  const targetDir = mkScratch('init-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['init', targetDir]);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(targetDir, 'AGENTS.md')));
  assert.ok(fs.existsSync(path.join(targetDir, 'CLAUDE.md')));
  assert.ok(fs.existsSync(path.join(targetDir, 'docs', 'GLOSSARY.md')));
  assert.ok(fs.existsSync(path.join(targetDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml')));
  assert.ok(
    fs.existsSync(path.join(targetDir, '.agent-skill-chain', 'hooks', 'claude-pretooluse.sh')),
    'hooks/ 名前空間もinitで導入されること',
  );
  assert.equal(fs.existsSync(path.join(targetDir, '.github')), false);
  const workerAgent = path.join(targetDir, '.claude', 'agents', 'agent-skill-chain-worker.md');
  assert.ok(fs.existsSync(workerAgent), 'Claude custom subagent種別をinit時に展開すること');
  const workerAgentText = fs.readFileSync(workerAgent, 'utf8');
  assert.match(workerAgentText, /tools: Read, Grep, Glob, Edit, Write, MultiEdit, Bash/);
  assert.doesNotMatch(workerAgentText, /tools:.*\bAgent\b/, '再帰dispatch可能なAgent toolを許可しないこと');
  assert.match(result.stdout, /GitHub workflowは未展開/);

  const installedVersion = fs.readFileSync(
    path.join(targetDir, '.agent-skill-chain', '.installed_version'),
    'utf8',
  );
  const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as { version: string };
  assert.equal(installedVersion.trim(), pkg.version);
});

test('init: 導入されたAGENTS.mdに実際のupgrade起動コマンド構文が記載されている（Issue #298）', (t) => {
  const targetDir = mkScratch('init-upgrade-doc-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['init', targetDir]);

  assert.equal(result.status, 0, result.stderr);
  const agentsMd = fs.readFileSync(path.join(targetDir, 'AGENTS.md'), 'utf8');
  assert.match(
    agentsMd,
    /npx github:techbeansjp-free\/AGENTS\.md upgrade/,
    'consumerが導入後に自リポジトリ内だけでアップグレード起動コマンドを再発見できること',
  );
});

test('init: 既存docs資産と衝突する場合は非破壊で停止し、終了コードが0以外になる', (t) => {
  const targetDir = mkScratch('init-conflict-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(targetDir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(targetDir, 'docs', 'GLOSSARY.md'), '# 別内容のGLOSSARY.md（衝突させるため）\n');

  const result = runCli(['init', targetDir]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /導入先に既存の異なる内容のファイルがあるため展開を中断しました/);
});

test('init: 既存docs資産と衝突する場合、衝突より前に処理される他のファイルも一切書き込まれない（部分適用しない）', (t) => {
  const targetDir = mkScratch('init-conflict-no-partial-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(targetDir, 'docs'), { recursive: true });
  const originalGlossary = '# 別内容のGLOSSARY.md（衝突させるため）\n';
  fs.writeFileSync(path.join(targetDir, 'docs', 'GLOSSARY.md'), originalGlossary);

  const result = runCli(['init', targetDir]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /導入先に既存の異なる内容のファイルがあるため展開を中断しました/);
  assert.equal(
    fs.existsSync(path.join(targetDir, 'AGENTS.md')),
    false,
    'AGENTS.mdも作成されないこと（ROOT_LEVEL_ENTRIESの中でGLOSSARY.mdより先に処理されるため、対策前は書き込まれてしまっていた）',
  );
  assert.equal(fs.existsSync(path.join(targetDir, 'CLAUDE.md')), false, 'CLAUDE.mdも作成されないこと');
  assert.equal(
    fs.existsSync(path.join(targetDir, '.agent-skill-chain')),
    false,
    '.agent-skill-chain名前空間も一切作成されないこと',
  );
  assert.equal(fs.existsSync(path.join(targetDir, '.github')), false, '.githubも作成されないこと');
  assert.equal(
    fs.readFileSync(path.join(targetDir, 'docs', 'GLOSSARY.md'), 'utf8'),
    originalGlossary,
    '衝突した既存ファイル自体の内容も変更されないこと',
  );
});

test('init: 所有権記録(.owned-files.json)が新規作成され、書き込んだファイル一覧を復元できる（Issue #492 AC-1）', (t) => {
  const targetDir = mkScratch('init-ownership-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['init', targetDir]);

  assert.equal(result.status, 0, result.stderr);
  const recordPath = path.join(targetDir, '.agent-skill-chain', '.owned-files.json');
  assert.ok(fs.existsSync(recordPath));
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as {
    version: string;
    files: Record<string, string>;
  };
  assert.ok(Object.prototype.hasOwnProperty.call(record.files, 'AGENTS.md'));
  assert.ok(
    Object.prototype.hasOwnProperty.call(record.files, '.agent-skill-chain/config/agent-skill-chain.yaml'),
  );
  assert.match(record.files['AGENTS.md'] ?? '', /^sha256:[0-9a-f]{64}$/);
});

test('init --dry-run: 所有権記録は作成されない', (t) => {
  const targetDir = mkScratch('init-ownership-dry-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['init', targetDir, '--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(targetDir, '.agent-skill-chain', '.owned-files.json')), false);
});

test('init: 同一target_dirへの2回目の実行は冪等に成功する（unchanged）', (t) => {
  const targetDir = mkScratch('init-idempotent-target');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const first = runCli(['init', targetDir]);
  assert.equal(first.status, 0, first.stderr);

  const second = runCli(['init', targetDir]);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /unchanged: /);
});

// ADR-0023（Issue #503）AC-2/AC-3: プロファイルを問わず.claude/skills/配下に5スキルが配置される。
test('init: プロファイル未指定（既定）でも.claude/skills/配下に5つのSKILL.mdが配置され、profile: standardになる（AC-2, AC-3, AC-4）', (t) => {
  const targetDir = mkScratch('init-skills-standard');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['init', targetDir]);
  assert.equal(result.status, 0, result.stderr);

  for (const skill of ['issue-start', 'segment-work', 'gate-review', 'pr-merge', 'cleanup']) {
    const skillPath = path.join(targetDir, '.claude', 'skills', skill, 'SKILL.md');
    assert.ok(fs.existsSync(skillPath), `${skill}/SKILL.md が配置されること`);
    const text = fs.readFileSync(skillPath, 'utf8');
    assert.match(text, /^name: /m);
    assert.match(text, /^description: /m);
    assert.match(text, /^when_to_use: /m);
  }
  assert.equal(
    fs.existsSync(path.join(targetDir, '.claude', 'skills', 'DESCRIPTION_BUDGET.md')),
    false,
    'DESCRIPTION_BUDGET.mdはスキルではない開発者向けメタデータのため.claude/skills/へ配布されないこと' +
      '（手動implementation-gateレビュー指摘: non-skill-doc-distributed-into-claude-skills）',
  );

  const configText = fs.readFileSync(
    path.join(targetDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml'),
    'utf8',
  );
  assert.match(configText, /^profile: standard/m);

  const claudeMd = fs.readFileSync(path.join(targetDir, 'CLAUDE.md'), 'utf8');
  assert.match(claudeMd, /@AGENTS\.md/, '既定プロファイルはCLAUDE.mdの@AGENTS.md常時importを維持すること（AC-6）');
  assert.doesNotMatch(result.stdout, /軽量プロファイルで導入しました/);
  const gateSkill = fs.readFileSync(path.join(targetDir, '.claude', 'skills', 'gate-review', 'SKILL.md'), 'utf8');
  assert.match(gateSkill, /最終round 4、最大5回/);
  assert.match(gateSkill, /gate-declare-final-round\.sh/);
  const roles = fs.readFileSync(path.join(targetDir, '.agent-skill-chain', 'config', 'roles.yaml'), 'utf8');
  assert.equal((roles.match(/blockingを局所的な条項・例外・分岐・フラグ/g) ?? []).length, 4);
  assert.match(fs.readFileSync(path.join(targetDir, '.agent-skill-chain', 'schemas', 'worker-report.schema.yaml'), 'utf8'), /required_addition/);
});

// ISSUE-522: profile: standard（既定）で導入したconsumer projectに、このリポジトリ自身の
// dogfooding専用設定（config・CLAUDE.mdとも）が混入しないことの回帰テスト。
test('init --profile=standard（既定含む）: config/agent-skill-chain.yaml・CLAUDE.mdに本リポジトリ自身のdogfooding専用設定が混入しないこと（ISSUE-522）', (t) => {
  const targetDir = mkScratch('init-standard-no-dogfooding-leak');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['init', targetDir]);
  assert.equal(result.status, 0, result.stderr);

  const configText = fs.readFileSync(
    path.join(targetDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml'),
    'utf8',
  );
  assert.match(configText, /^profile: standard/m);
  assert.doesNotMatch(
    configText,
    /autonomous:\s*true/,
    'このリポジトリ限定のmerge.autonomous: trueが混入してはならない',
  );
  assert.doesNotMatch(
    configText,
    /before_implementation:\s*false/,
    'このリポジトリ限定のhuman_confirmation.before_implementation: falseが混入してはならない',
  );
  assert.doesNotMatch(
    configText,
    /segment_overrides/,
    'このリポジトリ限定のworker.segment_overrides（codex固定）が混入してはならない',
  );
  assert.doesNotMatch(configText, /ISSUE-307/, 'このリポジトリ自身のIssue番号コメントが混入してはならない');
  assert.match(
    configText,
    /issue_sync:\n {2}enabled: true/,
    'GitHubモード向け配布テンプレートのissue_sync.enabledは既定でtrueであること（ISSUE-567 AC-2）',
  );

  const claudeMd = fs.readFileSync(path.join(targetDir, 'CLAUDE.md'), 'utf8');
  assert.match(claudeMd, /@AGENTS\.md/, '既定プロファイルのCLAUDE.mdは@AGENTS.md常時importを維持すること');
  assert.doesNotMatch(
    claudeMd,
    /応答は日本語とする/,
    'このリポジトリ開発チーム固有の応答言語指定が混入してはならない',
  );
});

test('init --profile=lightweight: CLAUDE.mdが@AGENTS.md importを含まず、coordination.backend: local・profile: lightweightになり、機械的阻止が無い旨のメッセージが出る（AC-4, AC-5）', (t) => {
  const targetDir = mkScratch('init-lightweight');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['init', targetDir, '--profile=lightweight']);
  assert.equal(result.status, 0, result.stderr);

  assert.ok(fs.existsSync(path.join(targetDir, 'AGENTS.md')), 'AGENTS.md自体は軽量プロファイルでも生成されること');
  const claudeMd = fs.readFileSync(path.join(targetDir, 'CLAUDE.md'), 'utf8');
  assert.doesNotMatch(claudeMd, /@AGENTS\.md/, '軽量プロファイルは@AGENTS.md常時importを含まないこと');

  const configText = fs.readFileSync(
    path.join(targetDir, '.agent-skill-chain', 'config', 'agent-skill-chain.yaml'),
    'utf8',
  );
  assert.match(configText, /^profile: lightweight/m);
  assert.match(configText, /backend: local/);

  for (const skill of ['issue-start', 'segment-work', 'gate-review', 'pr-merge', 'cleanup']) {
    assert.ok(
      fs.existsSync(path.join(targetDir, '.claude', 'skills', skill, 'SKILL.md')),
      `軽量プロファイルでも${skill}/SKILL.mdが配置されること`,
    );
  }
  const lightweightGateSkill = fs.readFileSync(path.join(targetDir, '.claude', 'skills', 'gate-review', 'SKILL.md'), 'utf8');
  assert.match(lightweightGateSkill, /最終round 4、最大5回/);
  assert.match(lightweightGateSkill, /通常のblocking差し戻し/);
  assert.match(fs.readFileSync(path.join(targetDir, '.agent-skill-chain', 'schemas', 'state.schema.yaml'), 'utf8'), /round_budget_declaration/);

  assert.match(
    result.stdout,
    /機械的に阻止する手段は現状ありません/,
    '逸脱の機械的阻止が無い旨を標準出力へ明示すること（AC-5）',
  );
});

test('init --profile=不正な値: エラー終了する', (t) => {
  const targetDir = path.join(mkScratch('init-invalid-profile-parent'), 'target');
  t.after(() => fs.rmSync(path.dirname(targetDir), { recursive: true, force: true }));

  const result = runCli(['init', targetDir, '--profile=turbo']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--profile は standard または lightweight/);
  assert.equal(fs.existsSync(targetDir), false, '不正なprofile指定時は何も書き込まれないこと');
});

test('init --profile lightweight（スペース区切り・target_dir省略）: "--profile"自体がpositional引数(導入先ディレクトリ)と誤解釈されずエラー終了する（手動implementation-gateレビュー指摘: init-profile-flag-parsing-edge）', (t) => {
  const cwd = mkScratch('init-profile-space-separated-cwd');
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  const result = runCli(['init', '--profile', 'lightweight'], { cwd });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--profile は --profile=<値>.*の形式で指定してください/);
  assert.equal(fs.existsSync(path.join(cwd, '--profile')), false, '"--profile"という名前のディレクトリが作成されないこと');
});

test('init --profile（値なし・単体）: positional引数と誤解釈せずエラー終了する（手動implementation-gateレビュー指摘: init-profile-flag-parsing-edge）', (t) => {
  const targetDir = mkScratch('init-profile-bare-flag');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['init', targetDir, '--profile']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--profile は --profile=<値>.*の形式で指定してください/);
});

test('init --profile=lightweight: 既存の.claude/skillsと内容衝突する場合はpre-flightで停止し、プロファイルを問わず非破壊方針を維持する（AC-9）', (t) => {
  const targetDir = mkScratch('init-lightweight-conflict');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(targetDir, '.claude', 'skills', 'issue-start'), { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, '.claude', 'skills', 'issue-start', 'SKILL.md'),
    '# 別内容のSKILL.md（衝突させるため）\n',
  );

  const result = runCli(['init', targetDir, '--profile=lightweight']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /導入先に既存の異なる内容のファイルがあるため展開を中断しました/);
  assert.equal(fs.existsSync(path.join(targetDir, 'AGENTS.md')), false, '衝突時は他ファイルも一切書き込まれないこと');
});

test('init: 既存所有権記録にretainedとして残っていたエントリは、再実行後も消失しない（手動implementation-gateレビュー指摘: init-rerun-drops-prior-ownership-entries）', (t) => {
  const targetDir = mkScratch('init-retains-prior-ownership');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  assert.equal(runCli(['init', targetDir]).status, 0);

  // upgradeが「配布元で廃止されたが導入先で変更が検出された」等の理由でretained保持していた
  // 状況を模す: 現行配布元には存在しないファイルのエントリを所有権記録へ直接追加する。
  const recordPath = path.join(targetDir, '.agent-skill-chain', '.owned-files.json');
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as { version: string; files: Record<string, string> };
  const retainedKey = '.agent-skill-chain/standards/RETIRED_STANDARD_STILL_EDITED_BY_USER.md';
  record.files[retainedKey] = `sha256:${'0'.repeat(64)}`;
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));

  const second = runCli(['init', targetDir]);
  assert.equal(second.status, 0, second.stderr);

  const afterRecord = JSON.parse(fs.readFileSync(recordPath, 'utf8')) as { files: Record<string, string> };
  assert.equal(
    Object.prototype.hasOwnProperty.call(afterRecord.files, retainedKey),
    true,
    '過去にretainedとして保持されていたエントリが2回目のinit実行で失われないこと',
  );
});

// ISSUE-586 AC-1・AC-2: initが新規に.agent-skill-chain/project/の作り方を具体的な導線として提供する。
test('init: 新規導入時に.agent-skill-chain/project/manifest.yaml・RULES.mdが自動生成され、案内メッセージが出力される（ISSUE-586 AC-1）', (t) => {
  const targetDir = mkScratch('init-project-policy-scaffold');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['init', targetDir]);

  assert.equal(result.status, 0, result.stderr);
  const manifestPath = path.join(targetDir, '.agent-skill-chain', 'project', 'manifest.yaml');
  const rulesPath = path.join(targetDir, '.agent-skill-chain', 'project', 'RULES.md');
  assert.ok(fs.existsSync(manifestPath), '.agent-skill-chain/project/manifest.yamlが生成されること');
  assert.ok(fs.existsSync(rulesPath), '.agent-skill-chain/project/RULES.mdが生成されること');
  assert.match(
    result.stdout,
    /docs\/PROJECT_POLICY\.md/,
    '案内メッセージがdocs\\/PROJECT_POLICY.mdへの参照を含むこと',
  );
  assert.match(
    result.stdout,
    /project-policy\.schema\.yaml/,
    '案内メッセージがスキーマパスへの参照を含むこと',
  );
});

test('init: 生成された.agent-skill-chain/project/manifest.yamlはproject-policy.schema.yamlの必須フィールドを満たす（ISSUE-586 AC-2）', (t) => {
  const targetDir = mkScratch('init-project-policy-schema-valid');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['init', targetDir]);
  assert.equal(result.status, 0, result.stderr);

  const manifest = readYamlFile<Record<string, unknown>>(
    path.join(targetDir, '.agent-skill-chain', 'project', 'manifest.yaml'),
  );
  const outcome = validateAgainstSchema('project-policy', manifest, targetDir);
  assert.equal(outcome.valid, true, outcome.errors.join('; '));
});

test('init --dry-run: .agent-skill-chain/project/配下は一切作成されない（ISSUE-586）', (t) => {
  const targetDir = mkScratch('init-project-policy-dry-run');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));

  const result = runCli(['init', targetDir, '--dry-run']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(targetDir, '.agent-skill-chain', 'project')), false);
});

test('init: 既に.agent-skill-chain/project/manifest.yamlが存在する状態で再実行しても、既存のRULES.md・manifest.yamlの内容を変更しない（ISSUE-586 要件6・AC-6）', (t) => {
  const targetDir = mkScratch('init-project-policy-rerun-noop');
  t.after(() => fs.rmSync(targetDir, { recursive: true, force: true }));
  const first = runCli(['init', targetDir]);
  assert.equal(first.status, 0, first.stderr);

  const manifestPath = path.join(targetDir, '.agent-skill-chain', 'project', 'manifest.yaml');
  const rulesPath = path.join(targetDir, '.agent-skill-chain', 'project', 'RULES.md');
  const customManifest = fs.readFileSync(manifestPath, 'utf8').replace(/policy_version: 1/, 'policy_version: 7');
  const customRules = '# consumer project独自のRULES.md\n';
  fs.writeFileSync(manifestPath, customManifest);
  fs.writeFileSync(rulesPath, customRules);

  const second = runCli(['init', targetDir]);

  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), customManifest, 'manifest.yamlの独自内容が変更されないこと');
  assert.equal(fs.readFileSync(rulesPath, 'utf8'), customRules, 'RULES.mdの独自内容が変更されないこと');
  assert.match(second.stdout, /unchanged:.*manifest\.yaml/);
});
