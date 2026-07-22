import { git } from './exec.js';

// Issue #188 AC-7/AC-8: `adr finalize` CLI（src/commands/adr.ts finalize）を経ずに ADR の
// status を accepted へ書き換える「手順逸脱」を、git履歴の commit 署名から機械検出する。
// 対象は status: accepted の ADR のみ（DESIGN.md 論点4）。

const STATUS_LINE_RE = /^status:.*$/m;
const STATUS_VALUE_RE = /^status:\s*(\S+)/m;
const ID_RE = /^id:\s*(\S+)/m;

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
}

/**
 * ADRファイルのgit履歴を古い順に辿り、statusが accepted 以外から accepted へ変わった
 * 最初のcommitを探す。見つからない場合は undefined を返す（squash/rebase等で履歴署名が
 * 失われた、またはfollow対象のファイルが最初から accepted として追加された等）。
 */
function findAcceptedTransitionCommit(root: string, relPath: string): TransitionCommit | undefined {
  const log = git(['log', '--follow', '--format=%H', '--', relPath], root);
  if (log.status !== 0) return undefined;
  const oldestFirst = log.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .reverse();

  for (const sha of oldestFirst) {
    const current = git(['show', `${sha}:${relPath}`], root);
    if (current.status !== 0) continue;
    if (statusOf(current.stdout) !== 'accepted') continue;

    const parentRev = git(['rev-parse', `${sha}^`], root);
    const parentSha = parentRev.status === 0 ? parentRev.stdout.trim() : undefined;
    if (!parentSha) return { sha };

    const parentContent = git(['show', `${parentSha}:${relPath}`], root);
    if (parentContent.status !== 0) return { sha, parentSha };
    if (statusOf(parentContent.stdout) !== 'accepted') return { sha, parentSha };
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

  const errors: string[] = [];
  const id = idOf(currentText) ?? relPath;

  // (a) commitメッセージが固定形式と一致する。
  const subject = git(['log', '-1', '--format=%B', transition.sha], root).stdout.trim();
  const expectedMessage = `chore(adr): ${id} を accepted へ更新`;
  if (subject !== expectedMessage) {
    errors.push(
      `${relPath}: accepted化commit(${transition.sha})のcommitメッセージがfinalize手順の固定形式と一致しません（期待: "${expectedMessage}", 実際: "${subject}"）`,
    );
  }

  // (b) 単一ADRファイルのみを変更している（root commit含め、親の有無に関わらず動作するdiff-treeを使う）。
  const changedFiles = git(['diff-tree', '--no-commit-id', '--name-only', '-r', transition.sha], root)
    .stdout.split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (changedFiles.length !== 1 || changedFiles[0] !== relPath) {
    errors.push(
      `${relPath}: accepted化commit(${transition.sha})がADRファイル以外も変更しています（変更ファイル: ${changedFiles.join(', ') || '(取得不可)'}）`,
    );
  }

  // (c) status行のみの差分（本文不変）。親commitが無い（新規追加commitでいきなりacceptedになった）
  // 場合は、既存ADRのstatus更新ではなくファイル自体の新規追加であり、finalize経路の前提
  // （既存のproposed ADRのstatusのみを更新する）を満たさないため、そのまま逸脱として扱う。
  if (transition.parentSha) {
    const parentContent = git(['show', `${transition.parentSha}:${relPath}`], root);
    const currentContent = git(['show', `${transition.sha}:${relPath}`], root);
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
