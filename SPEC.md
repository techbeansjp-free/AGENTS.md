# SPEC: 非coreのStrictゲートで独立レビュア2体を強制する

- Issue: `ISSUE-277`
- 作成者: `strict_reviewer_enforcement`
- 対象ブランチ: `bugfix/277-strict-reviewer-enforcement`

## 目的・背景

本Issueは、core監査以外の通常のゲート起動経路で、`review_profile: strict` が要求する2体の独立したread-onlyレビュアが1回の呼出しへ縮退し得る問題を解消する。対象はGitHubモードおよびローカルモードで共通利用される一般レビュア起動経路である。

Strictゲートは、2件の独立した判定を信頼境界内で集約し、必要な判定が全て揃った場合だけ成功できなければならない。レビュアの起動不能、判定不足、片方の失敗、同一判定の重複は成功へ倒してはならない。既定のStandardゲートは従来どおり1体がconformanceとfalsificationを順に判定する。

## 前提・用語・入出力

- 前提: 起動・集約を行うプロセスは信頼境界内にあり、レビュアは成果物に対してread-onlyである。
- trusted launcher: レビュアへ対象成果物だけを渡し、期待slotと一回限りの`invocation_id`を発行する信頼された起動処理。
- trusted aggregation: launcherが回収したsub-verdictを検証し、最終判定と検証証跡を生成する信頼された集約処理。
- 独立レビュー: `reviewer-1`と`reviewer-2`の別slot・別invocationとして起動され、相手のsub-verdictを入力に含めない判定。自己申告IDだけの違い、既存結果の再利用、同一invocationの複製は独立と扱わない。
- 入力: `issue_id`、`gate_id`、`target_sha`、`profile`、対象成果物、選択adapterの起動能力。
- sub-verdict: launcherが結線する`issue_id`、`gate_id`、`target_sha`、`profile`、`reviewer_slot`、`invocation_id`、判定状態、findingsを持つ1回の判定。
- 出力: 2件のsub-verdictを保持した最終gate report、およびGitHubモードでは同一`target_sha`に結線されたCheck Run。

## 要求 → 要件 → 受入条件

### 要求

non-coreのStrictゲートでも、独立したread-onlyレビュー2件を機械的に強制し、不足や失敗を安全側で停止する。Codex、Claude Code、humanの実行能力の差は能力契約として扱い、存在しないモデル名や利用不能な呼出しを仮定しない。

### 要件

- `review_profile: strict` の一般ゲートは、互いの内部判断を共有しない2体のread-onlyレビュアによる判定を必要とする。
- trusted launcherはStrictごとに固定slot集合`reviewer-1`・`reviewer-2`を別invocationとして起動し、片方のsub-verdictを他方の入力から隔離する。
- trusted aggregationは、期待slot集合、異なる一回限りの`invocation_id`、同一の`issue_id`・`gate_id`・`target_sha`・`profile: strict`、各判定の完了状態を検査する。
- 集約は先に入力妥当性を判定する。起動不能、欠落、重複、結線不一致、未完了、不正、またはいずれかの`human_required`があれば、他方の判定にかかわらず最終`human_required`とし、GitHub Check Runでは`action_required`に対応させる。
- 入力妥当性を満たす2件だけを判定集約へ進め、いずれかが`rejected`またはblocking findingを持つ場合は`rejected`、2件とも`approved`かつblocking findingなしの場合だけ`approved`とする。それ以外の組合せは`human_required`とする。
- Codex、Claude Code、humanの各adapterは、実際に提供できる起動能力だけを宣言・使用する。特定ベンダーのモデル名を他ベンダーへ類推してはならない。
- `review_profile: standard` のレビュア数、判定順序、成功条件は変更しない。
- Issue #271 / PR #274 が導入するcore監査専用経路とは責務を分離する。未マージ依存が必要な場合は、依存関係を追跡可能にし、依存なしに動作する変更を先に完成させる。

### 受入条件（Acceptance Criteria）

#### AC-1: Strictは独立した2件の承認を必要とする

- Given: core監査に分類されないIssueが`review_profile: strict`であり、2体のread-onlyレビュアを起動できる
- When: 任意のゲートを判定する
- Then: trusted launcherが`reviewer-1`と`reviewer-2`を別invocation・相互の判定非共有で起動し、同一`issue_id`・`gate_id`・`target_sha`・`profile: strict`へ結線された2件を集約し、両方が`approved`かつblocking findingなしの場合だけ成功する
- 検証方法見込み: `automated`

#### AC-2: 不足・重複・失敗は安全側で停止する

- Given: core監査に分類されないIssueが`review_profile: strict`である
- When: sub-verdictが1件だけ、slotまたはinvocationが重複、結果が再利用、対象結線が不一致、片方が起動失敗・未完了・不正・`human_required`のいずれかである（他方が`approved`または`rejected`の場合を含む）
- Then: 判定内容の集約より入力妥当性が優先され、ゲートは`human_required`となり、証跡に原因を保持し、GitHub Check Runは`action_required`になる
- 検証方法見込み: `automated`

#### AC-3: adapter能力差を再現可能に扱う

- Given: review adapterとしてCodex、Claude Code、またはhumanのいずれかが選択されている
- When: Strictゲートが2体の独立レビュアを要求する
- Then: adapterが実際に提供する能力だけで別slot・別invocationの2件を起動し、能力または認証が不足する場合は架空のモデルや呼出しへ代替せず`human_required`で停止する
- 検証方法見込み: `automated`

#### AC-4: Standardの既定動作を維持する

- Given: core監査に分類されないIssueが`review_profile: standard`である
- When: 任意のゲートを判定する
- Then: 既定の1体がconformanceとfalsificationを順に判定する従来の起動・成功条件が維持される
- 検証方法見込み: `automated`

#### AC-5: core専用経路との境界を維持する

- Given: Issue #271 / PR #274 のcore監査専用レビュア経路が存在する、または未マージである
- When: 本Issueの一般Strict経路を導入する
- Then: core専用のモデル選択責務を複製せず、一般経路の独立性・件数・集約責務だけを自己完結して提供し、依存がある場合は追跡可能な形で明示する
- 検証方法見込み: `hybrid`

## 制約・完了条件・検証方法・未決事項

- 制約: trusted aggregation以外のadapter出力や自己申告IDだけで成功状態を確定しない。成果物branchへのレビュア書込みを許可しない。
- 制約: sub-verdictは今回の集約に発行された一回限りのinvocationへ結線し、過去または他対象の結果を再利用しない。
- 完了条件: AC-1〜AC-5の証跡、正常2件、1件のみ、重複、対象不一致、片方起動失敗、片方reject、`rejected`と`human_required`の混合、各adapter能力不足、Standard回帰の自動テスト結果を`VALIDATION.md`へ記録する。
- 検証方法: 自動テストを主とし、AC-5のPR #274との責務境界だけを差分確認と自動回帰のhybridで検証する。
- 未決事項: なし。

## スコープ外

- core監査で使用するCodexの具体的なモデルおよびreasoning effortの選択
- Standardゲートを複数レビュアへ変更すること
- GitHub Actions secret、Claude Code認証、Codex認証など外部credential値の作成・配布
- 4セグメント、4ゲート、Coordination Backend、writer leaseの状態モデル変更
- レビュアが指摘した成果物の自動修正
