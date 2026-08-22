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
| 1 | `finding-severity` | `src/lib/gate-finding-severity.ts` を新設する。観点、`conformance_failure`、4昇格類型、類型別必須根拠、prompt入力閉包内の逐語引用、severity順序を実装する。立証合否との矛盾は受理拒否、単なるAC-ID言及はAC-2にしない。単体テストを同時追加する | AC-1, AC-2, AC-3, AC-4 | なし |
| 2 | `final-derivation` | `src/lib/gate-verdict-aggregation.ts` を改訂し、最終判定の導出を `SPEC.md` R2 の3規則と「基礎導出が `approved` でなく安全側停止事実のいずれかが真なら `human_required`」の単一適用規則へ置き換える。反証観点の合否値を型から削除する。`test/unit/gate-verdict-aggregation.test.ts` を全組合せの表駆動へ書き換える | AC-5, AC-6, AC-7 | #1 |
| 3 | `schemas-and-migration` | gate-report v2、state v2、config v2、evidence v4を新旧分岐で定義する。`src/lib/config.ts`はv1 triggerを読捨て、migrationは旧finalを再導出せず、v3 evidenceの同一attempt全slotの`profile`・`expected_count`からwire profileを復元する。単体テストを追加する | AC-10 | #1, #2 |
| 4 | `profile-core` | `review-profile.ts` を純粋なD3へ、`review-light.ts` をD4 facadeへ置換する。risk型・読取りを削除し、full/light双方の直近label eventをUser確認し、差分・コア・strict固定を解決する。`trusted-gate-recorder.ts` のAPI contextへIssue eventsを加え、risk式を削除する | AC-8, AC-9 | #3 |
| 5 | `profile-callers` | DESIGNのinventory全経路を改訂する。`gate review`・`verify-evidence`・`record-trusted-check`・v2 materializeだけがD4を呼ぶ。`buildVerifiedGateReport`は決定オブジェクトを受ける。launcher/adapter/submitはtoken値を運び一致検査だけ行う。`issue start`のprofile直書きを削除しstate v2を出力する | AC-8, AC-9, AC-10 | #3, #4 |
| 6 | `gate-v2-writers` | `gate.ts` のreview scaffold、`recordVerdict`、`publish`、verified report、evidence emitをv2/v4へ統一する。reconcileはdigest一致のv1承認を保持し、変更時だけv2 pendingへ移す。light上限の事後上書きはD2入力へ移す | AC-1, AC-5, AC-6, AC-7, AC-10 | #1〜#5 |
| 7 | `evidence-aggregation` | `review-evidence.ts` をD1/D2へ結線し、分類record不正・round打切りの事後上書きを停止事実へ移す。再分類は反証findingだけに限定する。`gate-round.ts` と`review-status.ts`はv3を履歴として読めるままv4探索記録を展開する | AC-2〜AC-7, AC-10 | #2, #3, #6 |
| 8 | `reviewer-prompt` | `buildReviewerPromptFromResolved` とLight追加ルーブリックを、探索維持・非二値・`conformance_failure`・4類型・類型別必須根拠・入力閉包内引用・v4出力へ置換する。digest/入力閉包テストを追随させる | AC-1〜AC-4, AC-6 | #1, #4 |
| 9 | `readers-and-doctor` | `verify gate-report`を版分岐へ、doctorをv1 configのtrigger読み捨て報告へ、bootstrapと残る反証合否参照を探索記録へ改訂する。全schema version literalのinventoryテストを追加する | AC-10 | #3, #6, #7 |
| 10 | `config-and-templates` | 実設定とstandard/lightweight templateをv2へ上げtriggerを削除し、init/upgradeのclean-template更新とv1 custom設定保持をテストする。`roles.yaml`出力契約と`gate-review/SKILL.md`のprofile定義・出力・手順・制約を置換しtemplate-syncを保つ | AC-8, AC-10, AC-11 | #4, #8, #9 |
| 11 | `normative-docs` | `AGENTS.md` I2へ反証非二値・4類型＋必須根拠・通過条件、I8とprofile節へR3順序を置換記載する。GLOSSARYのゲート行にも4類型＋必須根拠を記載し、専用統合テストを追加する | AC-11 | #10 |
| 12 | `integration-tests` | 4ゲートの3帰結、v3履歴、旧strict Check、コアstrict、risk 3値不変、inventory全経路、v2/v4 writer、規範契約を検査する。ADR statusはfinalization workerだけが更新する | AC-1〜AC-11 | #5〜#11 |

## 各変更単位の完了条件

すべての変更単位に共通して、`npm run build`（`tsc`）が成功し、当該単位が追加・改訂したテストが成功することを完了条件とする。加えて次を課す。

- #4・#5: `resolveReviewProfile`・risk型・trusted recorder/materializeのrisk式が0件で、inventory外にprofile導出がない。
- #6・#7: 最終判定導出はD2の1関数だけで、scaffold・reconcile・evidence emitを含む全writerが新版形状になる。
- #8: 同一入力のprompt digestが同じで、増分が`prompt_max_input_bytes`内に収まる。
- #10・#11: doc-length・template-sync・vocab・referencesと規範契約テストが成功する。
- #12: `npm test` 全件が成功する。

## 検証の実行順序

実装セグメントの各コミット時点では `npm run build` と当該単体テストを実行する。#10 以降は `verify doc-length`・`verify gate-report`・`verify template-sync`・`lint-vocab`・`lint-references`・`adr-lint`・`verify-adr`・`verify-ac-coverage` も実行する。全変更単位後に `npm test` を全件実行する。

`npm test` の実行が worktree root の `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` を削除する既知の挙動があるため、テスト実行の直後に `git status --short` を確認し、削除されていれば `git restore` で復元してから stage する。`git add -A` と `git add .` は使わない。

## 実装順序の見直しについて

実装中に上記の変更単位の並びのみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は `DESIGN.md` の更新と design-gate の再通過が必要になる。

順序を固定する境界は3つある。#1〜#4をprofile callerとwriterより先に置き、反証の旧値と新探索記録を同時に合格条件へしない。#3を#5より先に置き、state/evidence writerが未定義版を出さない。#8はD1とD4より後に置き、閉じた類型・必須根拠・profile決定とpromptを乖離させない。

## リスクと対処

| リスク | 対処 |
|---|---|
| 逐語引用の照合が厳しすぎ、正当な blocking が warning へ落ち続ける | #1 の単体テストで、実運用で観測済みの3件の実欠陥（ゲートを判定不能へ固定する機構の欠陥、終了コード0が成果物の残存を隠蔽する経路、存在しないテスト題名を pass として引用した検証結果）に相当する finding が `promoted` になることを固定する |
| 安全側停止事実の導入で ISSUE-786 のラウンド打ち切りが到達不能になる、または承認可能な attempt を止める | #2 の単体テストで、安全側停止事実3件 × 基礎導出3値の9通りを固定する。基礎導出が `approved` のときは3件いずれが真でも `approved` のまま、`rejected` のときは `human_required`、`human_required` のときは不変であること、および写像の像に `approved` が新たに現れないことを検査する |
| 旧版レコードの解釈が既存の承認を無効化する | #3 の単体テストで、v1 gate-report の `final: approved` が移行写像を通っても不変であることを固定する。移行写像は `final` を再導出しない |
| profile 決定の risk 非依存化が旧 Check の再構築を壊す | #3・#12でv3 evidenceのprofile/expected_countから復元しcanonical比較が一致すること、コア対象のstrict未満を拒否することを固定する |
| ローカルモードで明示オプトインの人間付与を確認できない | 未決事項として保持し、コア対象の経路でstrictが成立することを#12で確認する |
| 判定プロンプト変更により進行中のゲート反復がやり直しになる | ADR-0068 が既に受け入れている帰結と同型。既存の prompt digest 一致検査により `human_required` へ倒れるため、承認が黙って記録される経路は生じない |
