<!--
正本: AGENTS.md §ADR・テンプレート・テスト適用性
このファイルは Issue 毎（design セグメント）に複製して使う雛形である。docs/adr/ に保存する。
-->

# ADR

```yaml
id: ADR-0007
status: accepted
title: root直下へのIssueセグメント成果物の恒久混入は、Issueブランチ内削除ではなくmain post-merge cleanup自動化で解消する
tags: [artifacts, ci, merge, root-cleanup, github-workflow]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

AGENTS.md §ディレクトリ構成は、mainリポジトリルート直下を `AGENTS.md`・`CLAUDE.md`・`README.md`・`docs/`・`.github/`・`.worktrees/` のみに限定する。しかし各Issueのworktree直下で作業ワーカーが作成する `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` は、PRがsquash mergeされるたびにmainのルート直下へ持ち込まれ、次のIssueがマージされるまで恒久的に残存する。Issue #200はこの構造的原因（マージ時にこれらのファイルをmainから除外する仕組みが存在しないこと）への恒久対策を明示的に別Issueへ先送りしており、その別Issueが起票されないまま、以降にマージされた Issue #204・#202 は自身の4ファイルを削除せずにマージされ、mainルート直下にはIssue #202由来の内容が現在も残存している（Issue #208、本ADRの起点）。

恒久対策の実現方式として、以下3案を検討した。

1. **Issueブランチ内削除commit案**: validation_worker（またはいずれかのセグメント作業ワーカー）が、自身のPRブランチ上で検証完了後に4ファイルを`git rm`する最終commitをpushする。squash mergeの性質上、mainとの差分は正味ゼロになりmainに一切現れなくなる。
2. **main post-merge cleanup自動化案**: マージ後のmainへのpushを契機に、CI自動化が短命ブランチ上で4ファイルを削除するPRを作成し、admin mergeでmainへ反映する。
3. **5番目のcleanupセグメント/ゲート新設案**: 4セグメント・4ゲートモデルに、マージ前の後処理を担う新セグメントを追加する。

案1は、実装調査の過程で致命的な技術的欠陥が判明した。`.github/workflows/agent-skill-chain-reconcile.yml`は`branches-ignore: [main]`でありIssueブランチへの全pushを対象に`gate-reconcile.sh`を実行する。このスクリプトはpushごとに`gate-report`の`approved_artifacts`（各ゲートが承認したファイルパスとdigestの一覧。`SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`はいずれかのゲートで承認済み成果物として記録される）を現在のファイルと照合し、`src/commands/verify.ts`の`gateReport()`はファイルが削除されていれば「digest不一致」として扱い、当該ゲートと全下流ゲートを無効化する（`gate-report.schema.yaml`末尾の無効化ルール）。したがって案1の最終commitは、マージに必要な全ゲート成功状態そのものを自己破壊してしまい、実行不能である。

案3は、`.agent-skill-chain/config/segments.yaml`の`outputs`の意味変更を伴う破壊的変更であり、AGENTS.mdの規約によりADR＋AGENTS.md改定＋schema_version更新＋migrationを要する重い変更である。本件は立証(conformance)/反証(falsification)の2観点レビューを要する判断ではなく、機械的なhousekeepingであり、この重さに見合わない。

案2はmainのbranch protection（`pull_request`ルール・`required_status_checks`）を`gh pr merge --admin`でbypassする必要がある。既に`release bump`（Issue #196、ADR-0005）が同種のbypassを行っており、ADR-0005はこれがAGENTS.md I8「安全側ラチェット」（autonomyの昇格は人間の明示行為のみ）に抵触しないという境界解釈を、design-gate strictレビューでの規範解釈対立を経てリポジトリオーナーの明示確認により確定済みである。本ADRの決定はこの既存の境界解釈を、より狭いスコープの新しい適用対象へ拡張適用するものであり、本Issueのdesign-gate strictレビューでも同様の論点が指摘されたため、Decision内で明示的に扱う。

## Decision

案2（main post-merge cleanup自動化）を採用する。CI自動化（`root-cleanup run`。git commitの著者名義は`github-actions[bot]`、push・PR作成・admin merge操作の認証は既存リリース自動化（`release bump`）と同一の`secrets.RELEASE_MAIN_PAT`——既定の`GITHUB_TOKEN`ではadmin bypassができないため専用のPATを要する。新規credentialは追加せず既存PATを再利用する）が、mainへのpush（`[skip ci]`を含まないもの）を契機に、repoRoot直下の`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`（コード内リテラル4件、設定化しない）の存在を検出し、1件以上あれば短命ブランチ`chore/root-cleanup-*`上で該当ファイルのみを`git rm`し、既存の`release bump`（Issue #196、ADR-0005）と同型のPR作成→スコープ検査→`gh pr merge --admin --squash --subject`によりmainへ反映する。この方式はIssueのブランチ・worktree・gate-reconcileの対象範囲に一切触れないため、案1が抱える自己破壊問題が構造的に発生しない。ただし`agent-skill-chain-reconcile.yml`は`branches-ignore: [main]`（main以外の全ブランチへのpushが対象）であるため、`chore/root-cleanup-*`ブランチへのpushはこのジョブの対象に含まれ、ブランチ名から`ISSUE-<数字>`形式のissue_idを抽出できず`exit 1`で失敗する。このジョブは`main.json`の`required_status_checks`に含まれないためcleanup PRのマージ可否には影響しないが、CIノイズとして蓄積することを避けるため、`agent-skill-chain-reconcile.yml`の`branches-ignore`に`chore/root-cleanup-*`を追加する対応を本ADRの決定に含める（DESIGN.md参照）。

対象ファイル名を設定可能にする案は採用しない。ADR-0006が同種の判断（`unit_test_results`のテストディレクトリパス）で示した理由（プロジェクト単位で変わる具体的必要性が本Issue時点で提示できないこと）をそのまま踏襲する。将来、他のディレクトリ配置規約を持つconsumer projectからの実需が生じた場合に、そのときの新たなADR＋config schema更新として再検討する。

**I8「昇格workflow」禁止規定との関係と人間承認**: `root-cleanup run`のadmin merge（`gh pr merge --admin`）はmainのbranch protectionをbypassする特権行使であり、無人workflowによる自動発動がI8の禁ずる「autonomyレベルそのものを人間の関与なく引き上げる昇格workflow」に該当し得るかが論点になる。この境界解釈はADR-0005（release自動化、accepted）が既に確定している——「既に人間が承認済みで恒久的に存在する`bypass_actor`（admin）の固定特権を、機械検査可能な狭スコープに限って自動発動すること」は昇格workflowに該当しないというものであり、ADR-0005はこれをリポジトリオーナーの明示確認により確定し、適用範囲を「head=`release/bump-v*` かつ変更=`package.json`（±`package-lock.json`）のみ」に限定した。本ADRはこの確定済み境界解釈を、以下の狭スコープへ適用する: 自動発動条件は「(a) headブランチ名が`chore/root-cleanup-*`に一致し、かつ (b) 変更内容がrepoRoot直下の`SPEC.md`/`DESIGN.md`/`PLAN.md`/`VALIDATION.md`の**削除のみ**（追加・変更・他パスへの変更を一切含まない）」の両方を機械的に満たす場合に限り、いずれか一方でも満たさない場合は`human_required`として停止する。ADR-0005の対象（`package.json`の内容書き換え）が値の書き込みを伴うのに対し、本決定の対象は4件の固定ファイル名への削除操作のみであり、書き込む内容が存在しない分、境界はADR-0005よりも狭い。

本Issueのdesign-gate strictレビュー（2名独立）でこの論点がinconclusive（human_required）として指摘されたことを受け、進行役がリポジトリオーナーへ、上記(a)(b)の自動発動条件の適用可否を確認し、明示的な承認を得た。**判断内容: 「既に承認済みのbypass_actors（admin）能力を、狭いスコープ（`chore/root-cleanup-*`ブランチ・上記4ファイルの削除のみへの変更に限定）に限って自動発動するものとして許容する。design-gateを承認扱いとし実装フェーズへ進めてよい」。** すなわち本決定が発動するのはautonomyレベルそのものを機械が自律的に引き上げる「昇格workflow」ではなく、既に人間が承認済みで恒久的に存在する固定特権を、機械検査可能な狭スコープに限定して発動する執行機構であり、I8が禁ずる自律的autonomy昇格には該当しない、という境界解釈をリポジトリオーナーが確定した。I8が要求する「人間の明示行為」は、まさにこの進行役からリポジトリオーナーへの確認と、それに対する上記の明示的承認によって充足されている。本ADR（design-gate承認プロセスを経てacceptedへ遷移する成果物）自体がこの人間の明示行為の証跡であり、今後この構造に対しI8抵触の疑義が再燃した場合は本節が確定した境界解釈と人間承認の記録を参照して決着させる。

## Consequences

- 利点: `checkOutputExists()`/`wasEverAddedOrModified()`（Issue #200・#202導入分）・`segments.yaml`・`roles.yaml`を一切変更せずに実現でき、既存の4セグメント・4ゲートフロー、および進行中の他Issueのブランチ・gate-reconcileには構造的に影響を与えない。既存のリリース自動化（Issue #196/#198/#204）と同一のCI bot主体・`secrets.RELEASE_MAIN_PAT`・admin mergeパターンを再利用するため、新規の権限モデル・新規credentialを追加しない。副次効果として、現在mainルート直下に残存しているIssue #202由来の4ファイルも、本対策適用後の次回mainへのpush（本Issue自身のマージを含む）で自動的に解消される。
- 欠点・フォローアップ: マージ完了からcleanup PRのマージ完了までの間、短時間ではあるがmainルート直下に当該4ファイルが存在する window が生じる（完全な即時性は持たない）。近接する複数マージが競合した場合のpush再試行、および削除以外の変更を検出した場合の`human_required`停止は`root-cleanup run`の責務としてDESIGN.md/PLAN.mdで具体化する。対象ファイル名のハードコードは、他のディレクトリ配置規約を持つプロジェクトへ配布する段階になった場合、設定可能化を別ADRとして再検討する必要がある。
- I8関連の残余リスク: 本決定は、ADR-0005が確定した「既に承認済みのbypass_actor能力を狭スコープに限り自動発動する」境界解釈を新しい適用対象へ拡張する。スコープ判定（headブランチ名パターン・変更内容が削除のみか）に実装上の欠陥があれば、本来`human_required`とすべきケースを誤って自動admin mergeしてしまうリスクが残る。この残余リスクは、スコープ判定ロジック自体の単体テスト（PLAN.md）と、スコープ逸脱時に安全側（`human_required`）へ倒す設計（DESIGN.md）で軽減する。`secrets.RELEASE_MAIN_PAT`の最小権限管理・失効時再登録運用はADR-0005の前提をそのまま引き継ぐ。
- `agent-skill-chain-reconcile.yml`の`branches-ignore`への`chore/root-cleanup-*`追加は、既存トリガ条件への1行追加のみで`gate-reconcile.sh`のロジックには影響しない。同種の非Issueブランチ（`release/bump-v*`等）に残る同型のCIノイズは本Issueのスコープ外として据え置く。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |

本文（Context / Decision / Consequences）の変更が必要になった場合は、新しい ADR を作成し `supersedes` / `superseded-by` で旧 ADR との関係を記録する。既存 ADR の本文を書き換えてはならない。
