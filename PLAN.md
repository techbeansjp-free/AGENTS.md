# PLAN: review:light ラベルによる軽量レビュープロファイルの導入

- Issue: `ISSUE-449`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | スキーマ拡張 | `.agent-skill-chain/schemas/gate-report.schema.yaml`へ`gate.light_review`（任意プロパティ：`requested`・`applied`・`disabled_reasons`・`remediation_round`）を追加。`.agent-skill-chain/schemas/state.schema.yaml`へ`review_intensity: light \| full`（既定`full`）を追加。両方とも既存`required`配列は変更しない | AC-1, AC-10, AC-12 | なし |
| 2 | ラベル定義追加 | `.agent-skill-chain/templates/github/provisioning/labels.yaml`へ`review:light`ラベルを追加（`size:quick`と同系統の説明文） | AC-1 | なし |
| 3 | ガードレール共有モジュール抽出 | `src/lib/quick-mode.ts`の`GUARDRAIL_PATHS`・`changedPaths()`を`src/lib/self-reference-guardrail.ts`へ移設し、`quick-mode.ts`はそこから import する形へリファクタ。既存の`quick-mode.test.ts`相当のテストが継続してpassすることを確認 | AC-5 | #1 |
| 4 | review-profile.ts 抽出 | `src/lib/review-profile.ts`を新規作成し、`resolveReviewProfile(risk, autonomy): 'standard' \| 'strict'`を実装。`src/commands/gate.ts`内のインライン式（`materialize-check-report`のtrusted-gate再構築コンテキスト、`!labels.includes('risk:normal') \|\| labels.includes('autonomy:full') ? 'strict' : 'standard'`）をこの関数呼び出しへ置換し、既存の回帰テストで判定結果が変化しないことを確認 | AC-4 | なし |
| 5 | review-light.ts 実装 | `src/lib/review-light.ts`に`resolveLightReview()`を実装。`review:light`ラベル／`review_intensity`読み取り（`quick-mode.ts`の`readSignalFromGitHub`/`readSignalFromLocalState`と同型のGitHub未認証・Issue不在時フォールバック）、`resolveReviewProfile()`・`classifyCoreReview()`・`self-reference-guardrail`の3判定合成、直前ラウンドの`reviewFilePath()`読み取りによる`remediation_round`導出（0始まり、直前ラウンド記録が無ければ0、あれば+1して確定。`LIGHT_REVIEW_MAX_REMEDIATION_ROUNDS = 1`を定数として定義）。結果はキャッシュしない（呼び出しの都度、最新の差分・ラベル状態で再計算する） | AC-2, AC-3, AC-5, AC-9, AC-11 | #1, #3, #4 |
| 6 | gate review 統合 | `src/commands/gate.ts`の`gate review`スキャフォールド生成処理で、各remediationラウンドのスキャフォールド生成のたびに`resolveLightReview()`を呼び出し、結果を新規生成する`GateReport.gate.light_review`へ埋め込む。前ラウンドで`applied=true`だった状態から今回`applied=false`（3層ガードレールへ新規該当）に変わった場合、同じラウンドの`gate.review_profile`を`strict`へ切り替え、以降のレビュアプロンプトを専任2名分生成する（前ラウンドのlight時1体レビュー結果は当該ラウンドのgate-reportに証跡として残すのみで、Strictレビューの合否判定入力としては使わない） | AC-2, AC-10 | #5 |
| 7 | record-verdict 打ち切り強制 | `src/commands/gate.ts`の`record-verdict`に、`light_review.applied && remediation_round >= LIGHT_REVIEW_MAX_REMEDIATION_ROUNDS && (hasBlocking \|\| conformance/falsificationがfail)`のとき`verdict.inconclusive`を強制`true`へ上書きしてから既存`deriveFinal()`へ渡すロジックを追加。record-verdict自体はガードレールを再評価せず、そのラウンド開始時に`gate review`が確定した`light_review`の値をそのまま参照する | AC-6, AC-7(既存ロジック維持), AC-8 | #6 |
| 8 | reviewer-prompt ルーブリック追記 | `gate reviewer-prompt`の出力に、`light_review.applied === true`のときだけ追記する3行のルーブリック（AC未達＝常時blocking／セキュリティ・データ喪失・互換性破壊・不変条件違反＝自動blocking昇格／それ以外のwarning以下は対応必須としない）を実装 | AC-6, AC-7 | #6 |
| 9 | AGENTS.md 正本更新 | §4セグメント・4ゲートの「レビュープロファイル：Standard／Strict」記述にLightを追加する短い1文を追記（既存2文型の踏襲、150行上限に収める） | 要件5（文書上の一貫性） | なし |
| 10 | 単体テスト | #3〜#7の新規・変更ロジックに対する単体テスト（3種のStrict強制条件それぞれの単独該当・非該当、`remediation_round`の導出（0始まり・+1確定タイミング）、打ち切り時の`human_required`帰結（`remediation_round=1`でblocking残存時に発動すること）、round1適用中にround2で新規に3層ガードレールへ該当した場合に`applied`が`false`へ切り替わり`review_profile`が`strict`へエスカレーションすること、既存Issue（`review:light`未指定）の判定が不変であることの回帰テスト） | AC-1, AC-3, AC-4, AC-5, AC-8, AC-9, AC-11, AC-12 | #1–#8 |
| 11 | proposed ADR 作成 | `docs/adr/ADR-0031-review-light-signal-and-remediation-cutoff.md`を`status: proposed`で作成（本design segmentの成果物として同時にcommit） | — | なし |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
