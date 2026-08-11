import * as issueCmd from '../commands/issue.js';
import * as lease from '../commands/lease.js';
import * as segment from '../commands/segment.js';
import * as gate from '../commands/gate.js';
import * as pr from '../commands/pr.js';
import * as adr from '../commands/adr.js';
import * as checkpoint from '../commands/checkpoint.js';
import * as cleanup from '../commands/cleanup.js';
import * as doctor from '../commands/doctor.js';
import * as reconcile from '../commands/reconcile.js';
import * as setup from '../commands/setup.js';
import * as init from '../commands/init.js';
import * as upgrade from '../commands/upgrade.js';
import * as uninstall from '../commands/uninstall.js';
import * as enforce from '../commands/enforce.js';
import * as sync from '../commands/sync.js';
import * as lint from '../commands/lint.js';
import * as verify from '../commands/verify.js';
import * as report from '../commands/report.js';
import * as testing from '../commands/testing.js';
import * as worker from '../commands/worker.js';
import * as release from '../commands/release.js';
import * as rootCleanup from '../commands/root-cleanup.js';
import * as bootstrap from '../commands/bootstrap.js';

export type Handler = (args: string[]) => Promise<number> | number;

/**
 * CLIディスパッチテーブルの正本。`src/agents-md.ts`（副作用として`main(...)`を実行するエントリ
 * ポイントモジュール）から分離することで、`lint.ts`のようなCLIサブコマンド一覧を参照したい側が
 * `agents-md.ts`を直接importして意図せずCLIを実行してしまう事態を避ける（ISSUE-178 DESIGN.md
 * 「A-3」verbホワイトリストの正本化）。
 */
export const routes: Record<string, Handler> = {
  // 実際のCLIサブコマンド名（例: `agent-skill-chain issue start`）そのものを表す route key。
  // バッククォート付き computed property name で表記する（実行時の文字列キーの値は不変）。
  // これらは実行可能なCLIインターフェースの一部であり改名不可のため、vocab lintの識別子文脈
  // 判定を通す手段としてバッククォート表記（コード参照として正当な除外の既存規則）を用いる。
  [`issue start`]: issueCmd.start,
  [`issue resume`]: issueCmd.resume,
  'lease acquire': lease.acquire,
  'lease release': lease.release,
  'lease renew': lease.renew,
  'lease resume': lease.resume,
  'lease reclaim': lease.reclaim,
  'lease status': lease.status,
  'segment start': segment.start,
  'gate review': gate.review,
  'gate publish': gate.publish,
  'gate reconcile': gate.reconcile,
  'gate record-verdict': gate.recordVerdict,
  'gate submit-evidence': gate.submitEvidence,
  'gate verify-evidence': gate.verifyEvidence,
  'gate record-trusted-check': gate.recordTrustedCheck,
  'gate materialize-check-report': gate.materializeCheckReport,
  'gate bootstrap-ledger': bootstrap.ledger,
  'gate mark-human-required': gate.markHumanRequired,
  'gate reviewer-context': gate.reviewerContext,
  'gate reviewer-prompt': gate.reviewerPrompt,
  'pr create': pr.create,
  'pr merge': pr.merge,
  'adr finalize': adr.finalize,
  'report status': report.status,
  'report latest': report.latest,
  'worker context': worker.context,
  'release resolve-version': release.resolveVersion,
  'release bump': release.bump,
  'release tag': release.tag,
  'release publish': release.publish,
  'root-cleanup run': rootCleanup.run,
  'test run': testing.run,
  'lint vocab': lint.vocab,
  'lint references': lint.references,
  'lint adr': lint.adr,
  'lint secrets': lint.secrets,
  'verify ac-coverage': verify.acCoverage,
  'verify adr': verify.adr,
  'verify artifacts': verify.artifacts,
  'verify branch-name': verify.branchName,
  'verify config-doc-sync': verify.configDocSync,
  'verify doc-length': verify.docLength,
  'verify spec-bdd': verify.specBdd,
  'verify design-diagram': verify.designDiagram,
  'verify gate-report': verify.gateReport,
  'verify root-clean': verify.rootClean,
  'verify template-sync': verify.templateSync,
  'verify worktree-path': verify.worktreePath,
  setup: setup.setup,
  'setup github': setup.github,
  'setup labels': setup.labels,
  'setup ruleset': setup.ruleset,
  'sync templates': sync.templates,
  checkpoint: checkpoint.run,
  cleanup: cleanup.run,
  doctor: doctor.run,
  reconcile: reconcile.run,
  init: init.init,
  upgrade: upgrade.upgrade,
  uninstall: uninstall.uninstall,
  enforce: enforce.enforce,
};
