# SPEC: 非coreのStrictゲートで独立レビュア2体を強制する

- Issue: `ISSUE-277`
- 作成者: `strict_reviewer_enforcement`
- 対象ブランチ: `bugfix/277-strict-reviewer-enforcement`

## 目的・背景

本Issueは、core監査以外の通常のゲート起動経路で、`review_profile: strict` が要求する2体の独立したread-onlyレビュアが1回の呼出しへ縮退し得る問題を解消する。対象はGitHubモードおよびローカルモードで共通利用される一般レビュア起動経路である。

Strictゲートは、2件の独立した判定を信頼境界内で集約し、必要な判定が全て揃った場合だけ成功できなければならない。レビュアの起動不能、判定不足、片方の失敗、同一判定の重複は成功へ倒してはならない。既定のStandardゲートは従来どおり1体がconformanceとfalsificationを順に判定する。

## 要求 → 要件 → 受入条件

### 要求

non-coreのStrictゲートでも、独立したread-onlyレビュー2件を機械的に強制し、不足や失敗を安全側で停止する。Codex、Claude Code、humanの実行能力の差は能力契約として扱い、存在しないモデル名や利用不能な呼出しを仮定しない。

### 要件

- `review_profile: strict` の一般ゲートは、互いの内部判断を共有しない2体のread-onlyレビュアによる判定を必要とする。
- 信頼された集約処理は、期待件数、レビュア識別子の一意性、各判定の完了状態を検査し、2件全てが承認の場合だけゲート成功を許可する。
- レビュアが1件しかない、識別子が重複する、またはいずれかが失敗・未完了・不正な場合は `human_required` とし、GitHub Check Runでは `action_required` に対応させる。
- Codex、Claude Code、humanの各adapterは、実際に提供できる起動能力だけを宣言・使用する。特定ベンダーのモデル名を他ベンダーへ類推してはならない。
- `review_profile: standard` のレビュア数、判定順序、成功条件は変更しない。
- Issue #271 / PR #274 が導入するcore監査専用経路とは責務を分離する。未マージ依存が必要な場合は、依存関係を追跡可能にし、依存なしに動作する変更を先に完成させる。

### 受入条件（Acceptance Criteria）

#### AC-1: Strictは独立した2件の承認を必要とする

- Given: core監査に分類されないIssueが`review_profile: strict`であり、2体のread-onlyレビュアを起動できる
- When: 任意のゲートを判定する
- Then: 一意なレビュア識別子を持つ2件の独立した完了判定が信頼された処理で集約され、両方が承認の場合だけゲートが成功する
- 検証方法見込み: `automated`

#### AC-2: 不足・重複・失敗は安全側で停止する

- Given: core監査に分類されないIssueが`review_profile: strict`である
- When: 判定が1件だけ、識別子が重複、片方が失敗、未完了、または不正な判定である
- Then: ゲートは成功せず`human_required`となり、GitHub Check Runは`action_required`になる
- 検証方法見込み: `automated`

#### AC-3: adapter能力差を再現可能に扱う

- Given: review adapterとしてCodex、Claude Code、またはhumanのいずれかが選択されている
- When: Strictゲートが2体の独立レビュアを要求する
- Then: adapterが実際に提供する能力だけで2件を起動し、能力または認証が不足する場合は架空のモデルや呼出しへ代替せず`human_required`で停止する
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

## スコープ外

- core監査で使用するCodexの具体的なモデルおよびreasoning effortの選択
- Standardゲートを複数レビュアへ変更すること
- GitHub Actions secret、Claude Code認証、Codex認証など外部credential値の作成・配布
- 4セグメント、4ゲート、Coordination Backend、writer leaseの状態モデル変更
- レビュアが指摘した成果物の自動修正
