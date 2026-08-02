# ADR

```yaml
id: ADR-0019
status: proposed
title: gate-reportのpending扱いはhuman_requiredが実運用上の唯一の駆動値であることを明文化し、Publish Check Runのskip条件・reconcile()のconclusion導出是正を決定に含める
tags: [ci, gate, check-run]
supersedes: [ADR-0018]
superseded-by: null
deprecated-reason: null
```

## Context

`ADR-0018-gate-report-pending-as-action-required.md`（status: accepted）は、`.github/workflows/agent-skill-chain-gate.yml`の`verify-and-publish`ジョブが、レビュー未了という正常状態を`verify gate-report`（`src/commands/verify.ts`の`gateReport()`）の単一exit 1（スキーマ違反等の真の違反と区別しない）で表現し、`agent-skill-chain/<gate>-gate`のCheck Runを一度も発行しないままFAILUREで終了していた問題を解決した。ADR-0018のDecisionは、`gateReport()`の違反集計を`otherErrors`（スキーマ・digest・target_sha検証）と`pendingErrors`（`conformance`/`falsification`/`final`のpending検出）へ分離し、`otherErrors`が0件で`pendingErrors`が1件以上の場合に限り新設のexit 2を返す、という設計を確定させた。

Issue #349のstrictレビュアによるblocking findingで、ADR-0018のDecision文言が実装の実際の挙動と完全には一致していないことが指摘された。具体的には以下3点である。

1. **`human_required`が実運用上の唯一の駆動値であること**: ADR-0018のDecisionは`pendingErrors`の計上基準を「`conformance`/`falsification`/`final`のpending検出」とのみ記述しており、`final`のいずれの値がpending扱いを実際に駆動するかに言及していない。しかし`gate verify-evidence`（`src/commands/gate.ts`の`verifyGithubReviewEvidence()`、実運用でこのコマンドへ渡るgate-reportを生成する唯一の経路）は、`final`として`approved`/`rejected`/`human_required`の3値のみを返し、リテラル`pending`を返す経路を持たない。`pending`は`gate review`が生成する白紙スキャフォールド（`gate.ts`の`review()`関数）にのみ残る値であり、`verify gate-report`が検証する現実の入力（`gate verify-evidence`の出力）には現れない。つまり実運用上、pending扱い（exit 2）を駆動する唯一の実際の条件は`final === 'human_required'`である。
2. **Publish Check Runステップのskip条件**: ADR-0018のDecisionは「`Verify gate report schema`ステップがexit code 2を検出した場合のみaction_required Check Runを発行したうえでジョブ自体はexit 0で終了する」とのみ記述しており、同一ジョブ内の後続`Publish Check Run`ステップが二重発行や`gate publish`のpending拒否ガードによる失敗を避けるためにskipされる、という具体的な制御機構に触れていない。
3. **`gate reconcile`の`unchanged`分岐のconclusion導出是正**: ADR-0018のDecision・Consequencesは、`.github/workflows/agent-skill-chain-reconcile.yml`（`on: push`で`agent-skill-chain-gate.yml`と並行起動し得る）が呼び出す`gate reconcile`（`src/commands/gate.ts`の`reconcile()`関数）の挙動に一切言及していない。しかしIssue #349の実装では、`reconcile()`の`unchanged`分岐（承認済み成果物のdigestが新SHAでも不変な場合）のCheck Run conclusionを、従来の無条件`'success'`固定から、`report.gate.final`（`human_required`・`rejected`を含む）に整合した値へ是正する変更（blocking finding: `human-required-publish-clobbers-reconciled-gate`への対応）が行われている。これはADR-0018が対象とした「pendingの表現」と表裏一体の問題（`human_required`のままpushされた場合に、reconcileが誤って`success`のCheck Runで上書きしてしまうrace）であるにもかかわらず、ADR-0018の決定事項として記録されていない。

AGENTS.md「I1 追跡可能性」は「要求→設計(ADR)→実装→レビューの証跡がGit履歴に残り、現在有効な決定を指し続ける」ことを求めており、acceptedなADRが実装の実際の挙動と食い違ったまま放置されることはI1に抵触する。ADR-0018本文は`.agent-skill-chain/templates/adr/ADR.md`の「accepted 後の不変項目・可変項目」規約によりaccepted後は書き換え禁止であるため、本ADR（ADR-0019）を新設し`supersedes: [ADR-0018]`で置き換える。

検討した代替案:

- **ADR-0018の`status`のみを`deprecated`にして本文はそのまま残す案**: 「前提が消滅し後継が無い場合」というdeprecatedの遷移条件（`.agent-skill-chain/templates/adr/ADR.md`）に合致しない。本ADRが正確な後継として存在するため、`superseded`が正しい遷移である。
- **ADR-0018の本文を直接書き換える案**: `.agent-skill-chain/templates/adr/ADR.md`「accepted 後の不変項目・可変項目」規約が禁止しており、機械検査（`.agent-skill-chain/scripts/adr-lint.sh check`相当）が前提とする不変性を破壊するため採用しない。
- **新ADRを作成せずDESIGN.mdやコードコメントにのみ正確な挙動を追記する案（不採用）**: ADRは「なぜその判断をしたか」を記録する成果物であり、Decision文言と実装が乖離した状態を放置したままDESIGN.mdやコメントで別途正確性を担保するのは、I1が求める「ADRが現在有効な決定を指し続ける」ことを満たさない。

## Decision

`docs/adr/ADR-0018-gate-report-pending-as-action-required.md`を`supersedes: [ADR-0018]`として置き換え、以下の点を明文化する。ADR-0018が確定させた基本設計（`otherErrors`/`pendingErrors`分離、`otherErrors`が1件でも存在すれば無条件exit 1、`otherErrors`が0件で`pendingErrors`が1件以上ならexit 2、`Verify gate report schema`ステップでのaction_required Check Run発行）は変更しない。

1. **`pendingErrors`計上基準と実運用上の駆動値**: `verify gate-report`（`src/commands/verify.ts`の`gateReport()`）は、`report.gate.final === 'pending' || report.gate.final === 'human_required'`をpendingErrors計上のトリガー条件とする（コード上はこの2値のいずれかで分岐する）。ただし`gate verify-evidence`（`gate.ts`の`verifyGithubReviewEvidence()`）は`fail()`経路・確定計算経路のいずれにおいても`final`として`approved`/`rejected`/`human_required`の3値のみを返し、リテラル`pending`を返す経路を持たない。したがって実運用上、pending扱い（exit 2）を駆動する唯一の実際の値は`human_required`である。リテラル`pending`分岐はコード上は維持し続けるが、これは`gate review`が生成する白紙スキャフォールドに対する安全側の二重の備えであり、`verify-and-publish`ジョブが検証する現実の入力では到達しない。`final`が`pending`・`human_required`いずれの場合も、`conformance`/`falsification`個別のpendingチェックを追加で行う（`verifyGithubReviewEvidence()`の`fail()`ヘルパー・確定計算経路のいずれも、`human_required`のとき`conformance`/`falsification`を`pending`のまま返すため）。`final`がpending/human_required以外（`approved`/`rejected`）に確定している場合は、`conformance`/`falsification`が個別に`pending`のまま提出されていても`gateReport()`はその2フィールドを一切チェックしない（`gate.final`という単一の権威あるフィールドのみを判定基準とする）。
2. **Publish Check Runステップのskip条件**: `.github/workflows/agent-skill-chain-gate.yml`の`verify-and-publish`ジョブにおいて、`Verify gate report schema`ステップ（`id: schema`）はexit code 2を検出した場合、action_required Check Runを発行したうえで`echo "pending=true" >> "$GITHUB_OUTPUT"`してからexit 0する。exit code 0の場合は`echo "pending=false" >> "$GITHUB_OUTPUT"`してから素通りする。後続の`Publish Check Run`ステップは`if: steps.schema.outputs.pending != 'true'`を条件に持ち、pending時はこのステップ自体をskipする。これは、`Verify gate report schema`ステップが既にaction_required Check Runを発行済みであることに加え、`gate publish`（`src/commands/gate.ts`の`publish()`関数）が`report.gate.final === 'pending'`（真に未レビュー）を明示的に拒否し非0で終了する実装であるため、skipしないと二重発行・後続ジョブ失敗を招くことによる。
3. **`gate reconcile`の`unchanged`分岐のconclusion導出**: `src/commands/gate.ts`の`reconcile()`関数は、承認済み成果物のdigestが新SHAでも不変な`unchanged`分岐のCheck Run conclusionを、`publish()`と共通のヘルパー`checkRunConclusionForFinal(report.gate.final)`（`final`が`approved`なら`success`、`rejected`なら`failure`、それ以外（`human_required`・`pending`）なら`action_required`）から導出する。無条件の`'success'`固定は用いない。これは、`approved_artifacts`のdigestが不変であることは「レビュー当時の成果物から変化していない」ことのみを意味し、当該gateが`approved`だったことを意味しないためである。`human_required`（レビュー未確定）や`rejected`のままpushされた場合に無条件`success`を発行すると、`agent-skill-chain-gate.yml`側の`verify-and-publish`ジョブが同一SHAへ発行したaction_required/failureのCheck Runを、実行順序次第で`reconcile`が上書きしてしまうrace（blocking finding: `human-required-publish-clobbers-reconciled-gate`）を生む。

   この導出是正は、`reconcile()`自身が生成するリテラル`pending`が`unchanged`分岐へ流入するケースにも適用される。`reconcile()`のchanged分岐（承認済み成果物のdigestが変化した場合）は`report.gate.conformance`/`falsification`/`final`をリテラル`'pending'`へ書き換えて`reviews/<gate>.yaml`へ永続化するが、`approved_artifacts`のdigest自体は更新しない。したがって一度invalidateされたgateは、後続pushで対象成果物が承認時のdigestと一致する内容へ復元されても、`unchanged`分岐が`checkRunConclusionForFinal('pending')`＝`action_required`を発行するため、従来のように`success`を自動再発行しない。これはAGENTS.md「ゲートの継承・無効化」の「変化なしなら最新SHAへ成功を再発行」という文言を字義通りに読んだ場合の継承挙動からの変更（invalidate後に承認時点の内容へ復元されたケースに限る）だが、一度invalidateされたgateを再レビュー無しに`success`へ自動復帰させることはI8安全側ラチェット（降格は自動、昇格は人間の明示行為のみ）が禁じる自動昇格に該当するため、意図した挙動変化として採用する。継承規定は承認状態が維持されているgateのCheck RunをSHA間で引き継ぐためのものであり、invalidate（降格）を跨いだ`success`復活まで保証するものではないと解する（AGENTS.md当該文言との字面上の緊張は残るため本ADRに明記し追跡可能とする）。invalidate後の`success`復帰経路は再レビュー（`gate verify-evidence`→`gate publish`）のみである。

`agent-skill-chain-gate.yml`の`detect-segments`ジョブへのdependabot/自動化ブランチskip分岐追加（ADR-0018決定事項）は変更しない。

## Consequences

- ADR-0018が解決した効果（レビュー未了であるだけの正常な状態のPRで`verify-and-publish`ジョブが恒常的にFAILUREになる問題の解消、`agent-skill-chain/<gate>-gate`のCheck Runがaction_requiredとして常に発行される）は引き続き有効である。
- 本ADRにより、ADRのDecision文言と`src/commands/verify.ts`・`.github/workflows/agent-skill-chain-gate.yml`・`src/commands/gate.ts`の実際の挙動が完全に一致する。今後`verify gate-report`・`Publish Check Runステップのskip条件`・`gate reconcile`のいずれかの挙動を変更する場合は、本ADRをsupersedeする新しいADRの作成が必要になる（`.agent-skill-chain/templates/adr/ADR.md`の不変項目規約）。
- `checkRunConclusionForFinal()`（`src/commands/gate.ts`）は`publish()`・`reconcile()`の両方から呼ばれる共通ヘルパーとして今後も維持する必要がある。どちらか一方のみを個別に変更すると、`human_required`・`rejected`のconclusion導出が`publish()`経路と`reconcile()`経路とで再び乖離しうる。
- `verify gate-report`の呼び出し元が増えた場合、`human_required`が実運用上の唯一の駆動値であるという前提（`gate verify-evidence`が`pending`を返さないこと）に暗黙に依存しているコードは、新しい呼び出し元がリテラル`pending`を実際に渡すケースでも正しく動作することを別途確認する必要がある。
- 未解消の残留リスク（ADR-0018から継続、別Issueとして切り出し済み）: `agent-skill-chain-gate.yml`の`verify-and-publish`ジョブと`agent-skill-chain-reconcile.yml`は同一push eventから並行起動し得り、両者の完了順序を保証する仕組みが存在しない。本ADRの決定（`reconcile()`のconclusion導出是正）はrace自体の発生確率・実行順序を制御するものではなく、無条件`success`による誤った昇格を防ぐものに留まる。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |

本文（Context / Decision / Consequences）の変更が必要になった場合は、新しい ADR を作成し `supersedes` / `superseded-by` で旧 ADR との関係を記録する。既存 ADR の本文を書き換えてはならない。

## ライフサイクル

```text
DESIGNワーカー   → ADR を proposed で作成
設計レビュア     → ADR 本文をレビュー（read-only）→ content digest を承認
進行役           → adr-finalize.sh を起動
ADR finalization → writer lease を取得 → status を accepted へ更新
ワーカー           → commit・push → content digest を再検査
```
