import { git } from './exec.js';

// Issue #188 AC-7/AC-8: `adr finalize` CLI（src/commands/adr.ts finalize）を経ずに ADR の
// status を accepted へ書き換える「手順逸脱」を、git履歴の commit 署名から機械検出する。
// 対象は status: accepted の ADR のみ（DESIGN.md 論点4）。

const STATUS_LINE_RE = /^status:.*$/m;
const STATUS_VALUE_RE = /^status:\s*(\S+)/m;
const ID_RE = /^id:\s*(\S+)/m;

/**
 * 本チェック導入（Issue #188）より前に accepted 化された、手順逸脱が既知・既承認のADR。
 * 理由: ADR-0002 は Issue #178 で design/plan セグメントの直接編集により accepted 化された
 * （commit 1c21269）。内容面のscope制約（Context/Decision/Consequences/supersedes不変）は
 * 遵守済みで、この手順逸脱自体はIssue #178当時にVALIDATION.mdで確認・記録済み・修正しない
 * 判断が下されている。過去commitは書き換え不可なため、以後この特定ADR・commitの組は
 * 検査対象から除外する（新規のfinalizeには適用しない。worktree-naming-grandfather.txtと同型の
 * 追記専用の既知例外リスト）。
 *
 * ISSUE-539: ADR-0051（旧 ADR-0016-codex-exec-unsupported-flag-as-config-override.md）・
 * ADR-0052（旧 ADR-0016-reconcile-workflow-run-trust-boundary.md）は、ADR ID重複是正のための
 * 再採番（frontmatter `id:` とファイル名の変更のみ、status は accepted のまま不変）で
 * git mv された。両ファイルの真の accepted化commit（dfb6493dd8、リネーム前の旧ファイル名で
 * 追跡）は、ADR-0002 と同型の理由（squash merge運用によるhistory復元不能）で本チェック導入
 * 以前から手順逸脱の形になっており、リネーム前の旧ファイル名でも本チェックは同一の逸脱を検出する
 * （ISSUE-539のVALIDATION.mdで確認・記録済み・修正しない判断）。リネーム自体はこの既存の
 * 逸脱状態を新たに作るものではないため、リネーム後のファイル名でも同じ既知例外として扱う。
 */
const KNOWN_FINALIZE_DEVIATIONS: ReadonlySet<string> = new Set([
  'docs/adr/ADR-0002-github-lease-git-ref-cas.md:1c21269a40da4f342d076e176bca075e92ead95f',
  'docs/adr/ADR-0051-codex-exec-unsupported-flag-as-config-override.md:dfb6493dd85d9efefcfea1cafca1476be40ef22e',
  'docs/adr/ADR-0052-reconcile-workflow-run-trust-boundary.md:dfb6493dd85d9efefcfea1cafca1476be40ef22e',
]);

function extractFrontmatter(text: string): string | undefined {
  return /```yaml\n([\s\S]*?)```/.exec(text)?.[1];
}

function statusOf(text: string): string | undefined {
  const fm = extractFrontmatter(text);
  return fm ? STATUS_VALUE_RE.exec(fm)?.[1] : undefined;
}

function idOf(text: string): string | undefined {
  const fm = extractFrontmatter(text);
  return fm ? ID_RE.exec(fm)?.[1] : undefined;
}

/** status行全体を固定プレースホルダへ正規化する（インラインコメントの有無に関わらず1行まるごと比較するため）。 */
function normalizeStatusLine(text: string): string {
  return text.replace(STATUS_LINE_RE, 'status: <normalized>');
}

interface TransitionCommit {
  sha: string;
  /** 親commitが無い（=このcommitでファイルが新規追加された）場合は undefined。 */
  parentSha?: string;
  /** 遷移commit時点でのファイルパス（リネーム追跡時は現在のrelPathと異なりうる）。 */
  path: string;
  /** 親commit時点でのファイルパス（リネームで変わった直後のcommitではpathと異なる）。 */
  parentPath?: string;
}

interface FollowedEntry {
  sha: string;
  /** そのcommit時点でのファイルパス（`git log --follow` がリネームを追跡した結果）。 */
  path: string;
}

/**
 * `git log --follow --name-only` の出力を、リネーム追跡後も各commit時点で実際に使われていた
 * ファイルパスと組にして返す（新しい順）。`git show <sha>:<relPath>` を現在のrelPath固定で
 * 呼ぶと、リネーム発生前のcommitでは当時のパスと一致せず内容取得に失敗するため、
 * commitごとの実パスを別途保持する必要がある。
 */
function followedHistory(root: string, relPath: string): FollowedEntry[] {
  const log = git(['log', '--follow', '--format=%H', '--name-only', '--', relPath], root);
  if (log.status !== 0) return [];

  const entries: FollowedEntry[] = [];
  let currentSha: string | undefined;
  let currentPath: string | undefined;
  const shaRe = /^[0-9a-f]{40}$/;
  const flush = (): void => {
    if (currentSha && currentPath) entries.push({ sha: currentSha, path: currentPath });
  };
  for (const rawLine of log.stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (shaRe.test(line)) {
      flush();
      currentSha = line;
      currentPath = undefined;
    } else if (currentSha) {
      // --follow は追跡対象commitにつき1パスのみを返す。複数行が来た場合も最後の行（そのcommit
      // 時点での最終的なパス）を採用する。
      currentPath = line;
    }
  }
  flush();
  return entries;
}

/**
 * ADRファイルのリネーム履歴を辿り（`git log --follow`）、古い順に statusが accepted 以外から
 * accepted へ変わった最初のcommitを探す。見つからない場合は undefined を返す（squash/rebase等
 * で履歴署名が失われた、またはfollow対象のファイルが最初から accepted として追加された等）。
 *
 * リネーム発生時点で当時のファイルパスへ切り替えて `git show` するため、現在のrelPathとは
 * 異なるパスを持つ過去commit（リネーム前）でも内容取得に失敗しない（ISSUE-539: ADR再採番による
 * `git mv` 後もfinalize経路検査が正しく機能する）。
 */
function findAcceptedTransitionCommit(root: string, relPath: string): TransitionCommit | undefined {
  const oldestFirst = followedHistory(root, relPath).reverse();

  for (let i = 0; i < oldestFirst.length; i++) {
    const entry = oldestFirst[i];
    const current = git(['show', `${entry.sha}:${entry.path}`], root);
    if (current.status !== 0) continue;
    if (statusOf(current.stdout) !== 'accepted') continue;

    // 直前に追跡できているfollow履歴のエントリを「親」とみなす（リネームを跨ぐ場合はパスが
    // 異なる）。follow履歴に前エントリが無い場合は、そのファイルパス自体がまだ存在しない
    // 「新規追加」commitとして扱う（リテラルなgit親の有無ではなく、追跡対象ファイルの
    // 履歴上の直前状態が存在するかで判定する）。
    const previous = i > 0 ? oldestFirst[i - 1] : undefined;
    if (!previous) return { sha: entry.sha, path: entry.path };

    const parentContent = git(['show', `${previous.sha}:${previous.path}`], root);
    if (parentContent.status !== 0) return { sha: entry.sha, path: entry.path, parentSha: previous.sha, parentPath: previous.path };
    if (statusOf(parentContent.stdout) !== 'accepted') {
      return { sha: entry.sha, path: entry.path, parentSha: previous.sha, parentPath: previous.path };
    }
    // 親も既にaccepted（このcommitはstatus以外の変更）。より古いcommitでの遷移を探し続ける。
  }
  return undefined;
}

/**
 * 対象ADRが status: accepted の場合のみ、statusをacceptedへ遷移させたcommitが finalize経路の
 * 署名（DESIGN.md 論点4の3条件の論理積）を満たすかを検査する。
 *
 * 3条件: (a) commitメッセージが `chore(adr): <ADR-ID> を accepted へ更新` の固定形式と一致、
 * (b) そのcommitが当該ADRファイル1件のみを変更、(c) そのcommitの当該ファイル差分がstatus行の
 * みで本文を変更していない。いずれかを欠けば手順逸脱として finding を返す。
 *
 * status !== accepted、または遷移commitを履歴から特定できない場合（squash/rebase等）は
 * 検査対象外として空配列を返す（過剰検出しない。AC-8）。
 */
export function checkAdrFinalizePath(root: string, relPath: string, currentText: string): string[] {
  if (statusOf(currentText) !== 'accepted') return [];

  const transition = findAcceptedTransitionCommit(root, relPath);
  if (!transition) return [];

  if (KNOWN_FINALIZE_DEVIATIONS.has(`${relPath}:${transition.sha}`)) return [];

  const errors: string[] = [];
  // (a) の期待commitメッセージは、遷移commit時点でのファイル内容が持っていたidを使う（現在の
  // relPathの内容=currentTextではない）。ISSUE-539のようにaccepted後にidを再採番した場合、
  // finalize commit自体は当時の（変更前の）idで作られているため、currentTextのidと比較すると
  // 常に不一致になってしまう。
  const transitionContent = git(['show', `${transition.sha}:${transition.path}`], root);
  const id = (transitionContent.status === 0 ? idOf(transitionContent.stdout) : undefined) ?? idOf(currentText) ?? relPath;

  // (a) commitメッセージが固定形式と一致する。
  const subject = git(['log', '-1', '--format=%B', transition.sha], root).stdout.trim();
  const expectedMessage = `chore(adr): ${id} を accepted へ更新`;
  if (subject !== expectedMessage) {
    errors.push(
      `${relPath}: accepted化commit(${transition.sha})のcommitメッセージがfinalize手順の固定形式と一致しません（期待: "${expectedMessage}", 実際: "${subject}"）`,
    );
  }

  // (b) 単一ADRファイルのみを変更している（root commit含め、親の有無に関わらず動作するdiff-treeを使う）。
  // 遷移commit時点でのファイルパス（transition.path、リネームで現在のrelPathと異なりうる）と比較する。
  const changedFiles = git(['diff-tree', '--no-commit-id', '--name-only', '-r', transition.sha], root)
    .stdout.split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (changedFiles.length !== 1 || changedFiles[0] !== transition.path) {
    errors.push(
      `${relPath}: accepted化commit(${transition.sha})がADRファイル以外も変更しています（変更ファイル: ${changedFiles.join(', ') || '(取得不可)'}）`,
    );
  }

  // (c) status行のみの差分（本文不変）。親commitが無い（新規追加commitでいきなりacceptedになった）
  // 場合は、既存ADRのstatus更新ではなくファイル自体の新規追加であり、finalize経路の前提
  // （既存のproposed ADRのstatusのみを更新する）を満たさないため、そのまま逸脱として扱う。
  // 親・現在それぞれの時点でのファイルパス（transition.parentPath/transition.path）を使う
  // （リネームを跨ぐ遷移commitでは両者が異なりうる）。
  if (transition.parentSha && transition.parentPath) {
    const parentContent = git(['show', `${transition.parentSha}:${transition.parentPath}`], root);
    const currentContent = git(['show', `${transition.sha}:${transition.path}`], root);
    if (parentContent.status === 0 && currentContent.status === 0) {
      if (normalizeStatusLine(parentContent.stdout) !== normalizeStatusLine(currentContent.stdout)) {
        errors.push(`${relPath}: accepted化commit(${transition.sha})がstatus行以外の本文も変更しています`);
      }
    } else {
      errors.push(`${relPath}: accepted化commit(${transition.sha})の前後内容を取得できませんでした`);
    }
  } else {
    errors.push(
      `${relPath}: accepted化commit(${transition.sha})はADRファイルの新規追加commitです（既存ADRのstatus更新ではありません）`,
    );
  }

  if (errors.length > 0) {
    errors.unshift(
      `${relPath}: ADR finalize手順逸脱の疑いがあります（正規経路は 'adr finalize' CLI 経由でのstatus更新。accepted化commit: ${transition.sha}）`,
    );
  }
  return errors;
}
