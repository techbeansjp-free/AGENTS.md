// ISSUE-798 / ADR-0080: root成果物の3状態区分（削除対象・内容喪失リスクあり・不在）を決める
// 純関数の検証。入力は git の機械可読な出力そのものであり、解釈できない入力は fail-closed で
// 「内容喪失リスクあり」へ倒れることまでを対象にする。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRootArtifacts,
  splitNulRecords,
  type RootArtifactGitObservation,
  type RootArtifactState,
} from '../../src/lib/root-artifact-state.js';
import { ROOT_ARTIFACT_FILES } from '../../src/lib/root-artifacts.js';

const OID_HEAD = 'a'.repeat(40);
const OID_OTHER = 'b'.repeat(40);

/** `git ls-tree <tree> -z` 相当の出力を組み立てる。 */
function treeOutput(entries: { mode?: string; type?: string; oid?: string; path: string }[]): string {
  return entries
    .map((e) => `${e.mode ?? '100644'} ${e.type ?? 'blob'} ${e.oid ?? OID_HEAD}\t${e.path}\0`)
    .join('');
}

/** `git ls-files --stage -z` 相当の出力を組み立てる。 */
function indexOutput(entries: { mode?: string; oid?: string; stage?: number; path: string }[]): string {
  return entries
    .map((e) => `${e.mode ?? '100644'} ${e.oid ?? OID_HEAD} ${e.stage ?? 0}\t${e.path}\0`)
    .join('');
}

/** `git status --porcelain=v2 -z --untracked-files=all` 相当の出力を組み立てる。 */
function statusOutput(records: string[]): string {
  return records.map((r) => `${r}\0`).join('');
}

function stateOf(observation: RootArtifactGitObservation, file: string): RootArtifactState {
  const entry = classifyRootArtifacts(observation).find((e) => e.file === file);
  assert.ok(entry, `${file} の分類結果が返ること`);
  return entry.state;
}

function reasonOf(observation: RootArtifactGitObservation, file: string): string | undefined {
  return classifyRootArtifacts(observation).find((e) => e.file === file)?.reason;
}

/** 対象4ファイルすべてが HEAD・index に HEAD と同一内容で存在する観測。 */
function allTrackedClean(statusRecords: string[] = []): RootArtifactGitObservation {
  return {
    headTree: treeOutput(ROOT_ARTIFACT_FILES.map((path) => ({ path }))),
    index: indexOutput(ROOT_ARTIFACT_FILES.map((path) => ({ path }))),
    status: statusOutput(statusRecords),
  };
}

const EMPTY: RootArtifactGitObservation = { headTree: '', index: '', status: '' };

test('splitNulRecords: 終端NULの副産物である末尾の空要素だけを落とす', () => {
  assert.deepEqual(splitNulRecords('a\0b\0'), ['a', 'b']);
  assert.deepEqual(splitNulRecords(''), []);
  assert.deepEqual(splitNulRecords('a\0\0b\0'), ['a', '', 'b']);
});

test('分類は常に対象4ファイルちょうどを、相互排他な1区分ずつで返す', () => {
  const entries = classifyRootArtifacts(allTrackedClean());
  assert.deepEqual(entries.map((e) => e.file), [...ROOT_ARTIFACT_FILES]);
  for (const entry of entries) {
    assert.ok(['deletable', 'content_loss_risk', 'absent'].includes(entry.state), entry.state);
  }
});

// ---- 削除対象（AC-3） ----

test('作業ツリー上に存在し HEAD と一致するものは削除対象になる', () => {
  const observation = allTrackedClean();
  for (const file of ROOT_ARTIFACT_FILES) assert.equal(stateOf(observation, file), 'deletable');
  assert.ok(classifyRootArtifacts(observation).every((e) => e.inIndex));
});

test('index へ未記録の削除（作業ツリーから消えているだけ）は削除対象になる', () => {
  const observation = allTrackedClean([`1 .D N... 100644 100644 000000 ${OID_HEAD} ${OID_HEAD} SPEC.md`]);
  assert.equal(stateOf(observation, 'SPEC.md'), 'deletable');
  assert.equal(classifyRootArtifacts(observation).find((e) => e.file === 'SPEC.md')?.inIndex, true);
});

test('index へ記録済みの削除（HEADにのみ残る）は削除対象になり、index 不在として扱われる', () => {
  const observation: RootArtifactGitObservation = {
    headTree: treeOutput(ROOT_ARTIFACT_FILES.map((path) => ({ path }))),
    index: indexOutput(['DESIGN.md', 'PLAN.md', 'VALIDATION.md'].map((path) => ({ path }))),
    status: statusOutput([`1 D. N... 100644 000000 000000 ${OID_HEAD} ${'0'.repeat(40)} SPEC.md`]),
  };
  assert.equal(stateOf(observation, 'SPEC.md'), 'deletable');
  assert.equal(classifyRootArtifacts(observation).find((e) => e.file === 'SPEC.md')?.inIndex, false);
});

// ---- 内容喪失リスクあり（AC-6） ----

test('未追跡ファイルとして存在するものは内容喪失リスクありになる', () => {
  const observation: RootArtifactGitObservation = { headTree: '', index: '', status: statusOutput(['? SPEC.md']) };
  assert.equal(stateOf(observation, 'SPEC.md'), 'content_loss_risk');
  assert.match(reasonOf(observation, 'SPEC.md') ?? '', /未追跡/);
  assert.equal(stateOf(observation, 'DESIGN.md'), 'absent');
});

test('HEAD に存在せず index にのみ存在する（新規記録済み）ものは内容喪失リスクありになる', () => {
  const observation: RootArtifactGitObservation = {
    headTree: '',
    index: indexOutput([{ path: 'PLAN.md' }]),
    status: statusOutput([`1 A. N... 000000 100644 100644 ${'0'.repeat(40)} ${OID_HEAD} PLAN.md`]),
  };
  assert.equal(stateOf(observation, 'PLAN.md'), 'content_loss_risk');
  assert.match(reasonOf(observation, 'PLAN.md') ?? '', /HEAD に存在せず/);
});

test('index の内容が HEAD と異なるものは内容喪失リスクありになる', () => {
  const observation: RootArtifactGitObservation = {
    headTree: treeOutput([{ path: 'SPEC.md' }]),
    index: indexOutput([{ path: 'SPEC.md', oid: OID_OTHER }]),
    status: statusOutput([`1 M. N... 100644 100644 100644 ${OID_HEAD} ${OID_OTHER} SPEC.md`]),
  };
  assert.equal(stateOf(observation, 'SPEC.md'), 'content_loss_risk');
  assert.match(reasonOf(observation, 'SPEC.md') ?? '', /index の内容/);
});

test('index の file mode が HEAD と異なるものは内容喪失リスクありになる', () => {
  const observation: RootArtifactGitObservation = {
    headTree: treeOutput([{ path: 'SPEC.md' }]),
    index: indexOutput([{ path: 'SPEC.md', mode: '100755' }]),
    status: '',
  };
  assert.equal(stateOf(observation, 'SPEC.md'), 'content_loss_risk');
  assert.match(reasonOf(observation, 'SPEC.md') ?? '', /file mode/);
});

test('作業ツリーの内容変更・型変更は内容喪失リスクありになる', () => {
  for (const worktreeStatus of ['M', 'T']) {
    const observation = allTrackedClean([
      `1 .${worktreeStatus} N... 100644 100644 100644 ${OID_HEAD} ${OID_HEAD} DESIGN.md`,
    ]);
    assert.equal(stateOf(observation, 'DESIGN.md'), 'content_loss_risk', worktreeStatus);
  }
});

test('改名・複製は改名先・改名元の双方を内容喪失リスクありにする', () => {
  const record = `2 R. N... 100644 100644 100644 ${OID_HEAD} ${OID_OTHER} R100 SPEC.md`;
  const observation: RootArtifactGitObservation = {
    headTree: treeOutput([{ path: 'PLAN.md' }]),
    index: indexOutput([{ path: 'SPEC.md', oid: OID_OTHER }]),
    // `2` レコードは NUL 区切りの追加フィールドとして改名元パスを持つ。
    status: `${record}\0PLAN.md\0`,
  };
  assert.equal(stateOf(observation, 'SPEC.md'), 'content_loss_risk');
  assert.equal(stateOf(observation, 'PLAN.md'), 'content_loss_risk');
  assert.match(reasonOf(observation, 'PLAN.md') ?? '', /改名・複製/);
});

test('未マージエントリは内容喪失リスクありになる', () => {
  const observation: RootArtifactGitObservation = {
    headTree: treeOutput([{ path: 'SPEC.md' }]),
    index: indexOutput([
      { path: 'SPEC.md', stage: 1 },
      { path: 'SPEC.md', stage: 2, oid: OID_OTHER },
    ]),
    status: statusOutput([
      `u UU N... 100644 100644 100644 100644 ${OID_HEAD} ${OID_OTHER} ${OID_OTHER} SPEC.md`,
    ]),
  };
  assert.equal(stateOf(observation, 'SPEC.md'), 'content_loss_risk');
});

test('HEAD のエントリが通常ファイルでない場合は内容喪失リスクありになる', () => {
  const observation: RootArtifactGitObservation = {
    headTree: treeOutput([{ path: 'SPEC.md', mode: '040000', type: 'tree' }]),
    index: '',
    status: '',
  };
  assert.equal(stateOf(observation, 'SPEC.md'), 'content_loss_risk');
  assert.match(reasonOf(observation, 'SPEC.md') ?? '', /通常ファイルではありません/);
});

// ---- 不在（AC-5） ----

test('どこにも存在しないものは不在になる', () => {
  for (const file of ROOT_ARTIFACT_FILES) assert.equal(stateOf(EMPTY, file), 'absent');
  assert.ok(classifyRootArtifacts(EMPTY).every((e) => !e.inIndex));
});

// ---- fail-closed ----

test('解釈できない git 出力は対象4ファイルすべてを内容喪失リスクありへ倒す', () => {
  const broken: RootArtifactGitObservation[] = [
    { ...EMPTY, headTree: 'tab区切りのない壊れた行\0' },
    { ...EMPTY, index: '100644 oid\tSPEC.md\0' },
    { ...EMPTY, status: statusOutput(['x SPEC.md']) },
    { ...EMPTY, status: statusOutput(['1 .D N... 100644 100644']) },
    // 改名元パスのフィールドを欠く `2` レコード。
    { ...EMPTY, status: `2 R. N... 100644 100644 100644 ${OID_HEAD} ${OID_OTHER} R100 SPEC.md\0` },
  ];
  for (const observation of broken) {
    const entries = classifyRootArtifacts(observation);
    assert.equal(entries.length, ROOT_ARTIFACT_FILES.length);
    assert.ok(
      entries.every((e) => e.state === 'content_loss_risk' && e.reason),
      JSON.stringify(observation),
    );
  }
});

test('status のヘッダ行と対象外パスのレコードは分類へ影響しない', () => {
  const observation = allTrackedClean([
    '# branch.oid ' + OID_HEAD,
    '# branch.head main',
    '? untracked-note.txt',
    `1 .M N... 100644 100644 100644 ${OID_HEAD} ${OID_HEAD} src/other.ts`,
  ]);
  for (const file of ROOT_ARTIFACT_FILES) assert.equal(stateOf(observation, file), 'deletable');
});
