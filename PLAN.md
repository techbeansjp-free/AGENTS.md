# PLAN: 反証観点をゲートの合否条件から外し、finding のトリアージへ置き換える

- Issue: `ISSUE-808`
- 対応する DESIGN: `DESIGN.md`

## 目的・前提

`DESIGN.md` が定めた設計要素 D1〜D7 を、どの順序で・どの変更単位に分割して実装するかを確定させる。前提は次のとおり。

- 本 Issue はコア対象（`AGENTS.md`・`.agent-skill-chain/schemas/` 配下を変更する）であり、implementation-gate と validation-gate は strict 2体で判定される。
- 4スキーマの版更新を含む破壊的変更であり、旧版レコードの解釈規則を同一 PR で実装する。
- 実装は単一ブランチ `process/808-falsification-not-binary-gate` の単一 PR（#809）で行う。変更単位はコミット境界であり、PR を分割しない。分割すると中間状態で「反証の合否値が残ったまま探索記録も要求される」という二重の合格条件が成立し、既存ゲートが通らなくなるため。
- 各変更単位は単独で `npm run build`（`tsc`）が成功する粒度に切る。特に `resolveReviewProfile` の削除は、その呼び出し側（`src/lib/review-light.ts`・`src/commands/gate.ts` の `materializeCheckReport`・`test/unit/review-light.test.ts`）と同一の変更単位に置く。

## 実装順序・変更単位

各変更単位は対応する AC-ID を明示する。依存は上流の変更単位が完了していなければ当該単位のビルドまたはテストが成立しない関係を指す。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `finding-severity` | `src/lib/gate-finding-severity.ts` を新設する。観点の閉じた列挙、昇格類型4件の閉じた列挙、類型ごとの必須根拠の形式検査、`quote_path` を target SHA の git tree から読む逐語引用の照合、severity 決定の4規則を実装する。形状受理拒否は最終判定を確定させず、当該 slot を未確定として返す。単体テスト `test/unit/gate-finding-severity.test.ts` を同時に追加する | AC-1, AC-2, AC-3, AC-4 | なし |
| 2 | `final-derivation` | `src/lib/gate-verdict-aggregation.ts` を改訂し、最終判定の導出を `SPEC.md` R2 の3規則と「基礎導出が `approved` でなく安全側停止事実のいずれかが真なら `human_required`」の単一適用規則へ置き換える。反証観点の合否値を型から削除する。`test/unit/gate-verdict-aggregation.test.ts` を全組合せの表駆動へ書き換える | AC-5, AC-6, AC-7 | #1 |
| 3 | `schemas-and-migration` | `.agent-skill-chain/schemas/{gate-report,state,config}.schema.yaml` と review evidence の `schema_version` を新版へ更新し、`oneOf` で新旧2版を受理する。state v2 は `review_profile` を必須から外し `gate.profile` を任意にする。`src/lib/gate-record-migration.ts` を新設し、旧版レコードの解釈写像と `decodeRecordedReviewProfile`（記録済み wire profile の復元。決定規則を再適用しない）を実装する。`test/unit/gate-record-migration.test.ts` を新設する | AC-10 | #1, #2 |
| 4 | `profile-decision` | `src/lib/review-profile.ts` を全面改訂し、`ReviewRisk`・`ReviewAutonomy` 型と `resolveReviewProfile` を削除して `decideReviewProfile` を実装する。同一単位で呼び出し側3箇所を置き換える：(a) `src/lib/review-light.ts` を決定入力の解決へ責務変更し、`risk` シグナルの読み取りを削除し、`full` 明示オプトインへも付与主体の人間確認を課し、`strict_locked` ラチェットを規則2の成立で立てる、(b) `src/commands/issue.ts` の `config.risk.default` を用いた profile 直書きと `review_profile` の書き込みを削除する、(c) `src/commands/gate.ts` の `materializeCheckReport` の profile 解決を、gate-report v2 は `decideReviewProfile`、v1 は `decodeRecordedReviewProfile` とする版分岐へ置き換え、v1 経路に `expected_count`・slot 数の整合検査とコア対象時の `strict` 検査を置く。`test/unit/review-profile.test.ts` を新設し、`test/unit/review-light.test.ts` を追随させ、`risk:high` で `strict` として記録された v1 Check output が引き続き再構築できる回帰テストを追加する | AC-8, AC-9 | #3 |
| 5 | `wire-up-local` | `src/commands/gate.ts` の `recordVerdict` を #1・#2・#3 の実装へ結線し、light 再是正上限の事後上書きを安全側停止事実の入力へ置き換える。`gate review` の profile 引数を #4 の決定結果と一致することの検査へ変える。`gate publish` の整合検査（`final=approved` の条件）を v2 の形へ更新する | AC-1, AC-5, AC-6, AC-7, AC-9 | #1, #2, #3, #4 |
| 6 | `wire-up-evidence` | `src/lib/review-evidence.ts` の集約を #2 の単一導出箇所へ結線し、分類record不正・ラウンド打ち切り・最終round の事後上書きを安全側停止事実の入力へ置き換える。有効sub-verdict導出は当該モジュールに残し、その結果を D2 の `conformance` 入力として渡す。ISSUE-786 の finding 分類record の対象を `perspective: falsification` へ限定する。`src/lib/gate-round.ts` の過去ラウンド展開から反証の合否値を外し、探索記録と昇格評価結果を展開する | AC-2, AC-5, AC-6, AC-7 | #2, #3, #5 |
| 7 | `reviewer-prompt` | `src/commands/gate.ts` の `buildReviewerPromptFromResolved` の反証ルーブリックを改訂する。探索指示を保ち、合否値の要求を削除し、昇格類型・引用元パス・逐語引用・必須根拠の申告要求と探索記録の出力を指示する。出力 JSON 契約を v4 へ更新する。profile 決定結果と適用規則番号をプロンプトへ記載する。`test/integration/gate-reviewer-prompt-determinism.test.ts` と `test/integration/gate-reviewer-prompt-input-closure.test.ts` を追随させる | AC-3, AC-4, AC-6, AC-8 | #1, #2, #4 |
| 8 | `verify-and-doctor` | `src/commands/verify.ts` の `verify gate-report` を版判別へ改訂する。`src/commands/doctor.ts` に v1 config の `review.strict.trigger` 読み捨ての報告を追加する。`src/commands/bootstrap.ts`・`src/lib/review-status.ts` の反証合否値参照を探索記録参照へ置き換える | AC-10 | #3 |
| 9 | `config-and-templates` | `.agent-skill-chain/config/agent-skill-chain.yaml` と `.agent-skill-chain/templates/{standard,lightweight}/agent-skill-chain.yaml` から `review.strict.trigger` を削除する。`.agent-skill-chain/config/roles.yaml` のゲートレビュア契約の出力記述を改訂する。`.agent-skill-chain/templates/claude/skills/gate-review/SKILL.md` を #7 と同一内容へ改訂する | AC-8, AC-11 | #4, #7 |
| 10 | `normative-docs` | `AGENTS.md` の不変条件 I2・I8 とレビュープロファイル節、`docs/GLOSSARY.md` の「ゲート」行を改訂する。`AGENTS.md` は150行上限を守り、既存記述の置換のみで行う | AC-11 | #9 |
| 11 | `integration-tests` | ADR-0081 の `status` は design-gate 承認時に finalization ワーカーが `accepted` へ更新する（本単位では触れない）。統合テストを追加する：4ゲート1周の3帰結、v3 証跡のラウンド計数算入、コア対象での strict 2体要求、`risk:high` での `standard` 決定、`DESIGN.md` の実装経路全数表が挙げる4経路のいずれにも `risk` 由来の入力が無いことの grep 検査 | AC-8, AC-9, AC-10, AC-11 | #5, #6, #7, #8, #9, #10 |

## 各変更単位の完了条件

すべての変更単位に共通して、`npm run build`（`tsc`）が成功し、当該単位が追加・改訂したテストが成功することを完了条件とする。加えて次を課す。

- #1〜#4: 単体テストのみで完結する。既存の統合テストを壊さないことは #5 以降で確認する。
- #4: `resolveReviewProfile` の削除と呼び出し側3箇所の置換が同一コミットに入り、その時点で `tsc` が成功する。`grep -rn "resolveReviewProfile\|ReviewRisk\|ReviewAutonomy" src test` が0件になる。
- #5・#6: 最終判定を導出する箇所が `src/lib/gate-verdict-aggregation.ts` の1関数だけであることを、`final =` の代入と `'approved'` 文字列リテラルの grep で確認する。
- #7: 判定プロンプトの生成が決定的であること（同一入力に対して同一 digest）を既存テストで確認する。プロンプトの増分が `prompt_max_input_bytes` の既定値を超えないことを確認する。
- #9・#10: `verify doc-length`・`verify template-sync`・`lint-vocab`・`lint-references` が成功する。
- #11: `npm test` の全件が成功する。

## 検証の実行順序

実装セグメントの各コミット時点では、対象が TypeScript とスキーマであるため `npm run build` と当該単体テストを実行する。#9 以降で Markdown・YAML の配布物へ到達した時点で、CI 相当の機械検査（`verify doc-length`・`verify gate-report`・`verify template-sync`・`lint-vocab`・`lint-references`・`adr-lint`・`verify-adr`・`verify-ac-coverage`）を実行する。全変更単位の完了後に `npm test` を全件実行し、implementation-gate へ進む。

`npm test` の実行が worktree root の `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` を削除する既知の挙動があるため、テスト実行の直後に `git status --short` を確認し、削除されていれば `git restore` で復元してから stage する。`git add -A` と `git add .` は使わない。

## 実装順序の見直しについて

実装中に上記の変更単位の並びのみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は `DESIGN.md` の更新と design-gate の再通過が必要になる。

ただし次の3つの順序は入れ替えられない。第一に #1〜#3 を #5・#6 より先に置く順序——判定ロジックとスキーマが揃う前に呼び出し側を結線すると、中間コミットで反証の合否値と探索記録の双方を要求する状態が生じ既存ゲートが通らなくなる。第二に #3 を #4 より先に置く順序——#4 の `src/commands/issue.ts` は `review_profile` を持たない `state.yaml` を書くため、state v2 スキーマが先に存在しなければスキーマ検査に落ち、`materializeCheckReport` の v1 分岐も `decodeRecordedReviewProfile` を前提とする。第三に #7 を #1・#2・#4 より後に置く順序——判定プロンプトが昇格類型と必須根拠の閉じた列挙と profile 決定結果を参照するため、それらの確定より前に文面を書くと両者が乖離する。

## リスクと対処

| リスク | 対処 |
|---|---|
| 逐語引用の照合が厳しすぎ、正当な blocking が warning へ落ち続ける | #1 の単体テストで、実運用で観測済みの3件の実欠陥（ゲートを判定不能へ固定する機構の欠陥、終了コード0が成果物の残存を隠蔽する経路、存在しないテスト題名を pass として引用した検証結果）に相当する finding が `promoted` になることを固定する |
| 安全側停止事実の導入で ISSUE-786 のラウンド打ち切りが到達不能になる、または承認可能な attempt を止める | #2 の単体テストで、安全側停止事実3件 × 基礎導出3値の9通りを固定する。基礎導出が `approved` のときは3件いずれが真でも `approved` のまま、`rejected` のときは `human_required`、`human_required` のときは不変であること、および写像の像に `approved` が新たに現れないことを検査する |
| 旧版レコードの解釈が既存の承認を無効化する | #3 の単体テストで、v1 gate-report の `final: approved` が移行写像を通っても不変であることを固定する。移行写像は `final` を再導出しない |
| profile 決定の risk 非依存化が、`risk:high` 由来で strict として記録された旧 Check の再構築を壊す | #4 の回帰テストで、v1 Check output が `decodeRecordedReviewProfile` 経由で再構築でき、`canonicalJson` 比較が一致することを固定する。あわせてコア対象の差分で `strict` 未満の記録が拒否されることを固定する |
| `full` 明示オプトインへの人間確認追加で、ローカルモードの `autonomy: full` が strict を要求しなくなる | `DESIGN.md` の未決事項として明記済み。コア対象の経路で strict が成立することを #11 の統合テストで確認する |
| 判定プロンプト変更により進行中のゲート反復がやり直しになる | ADR-0068 が既に受け入れている帰結と同型。既存の prompt digest 一致検査により `human_required` へ倒れるため、承認が黙って記録される経路は生じない |
