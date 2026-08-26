# 65 課題962 既定branch追随実装レビュー

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象Issue | #962 |
| 比較基点 | `7fe0f78ff37eed300ceabc8e56a84badd4e82530` |
| H_impl | `cc84b4041878249ead61e5f94f35e470435fefef` |
| reviewer | codex（実装担当と別identity、別context） |
| 実施日 | 2026-08-27 |
| ラウンド数 | 3＋予算超過後の確認1 |

### 0.1 routing入力契約

reviewerへは承認済み要件の抜粋、変更前の関連実装、新規moduleの全文、差分、テスト結果だけを渡した。repository探索は最小限に制限した。実装担当の判断や意図は入力へ含めていない。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | https://github.com/techbeansjp-free/AGENTS.md/issues/962 | FR-01〜13、AC-01〜28、INV-01〜06 | 人間判断 |
| 差分 | `7fe0f78ff37eed300ceabc8e56a84badd4e82530`..`cc84b4041878249ead61e5f94f35e470435fefef` | 13 file | 既存コード |
| テスト | `npm test` | 863 scenario全通過、4600 step全通過 | テスト出力 |
| 静的検査 | project:quality、lint、format:check、typecheck、source:check、docs:format、test:format、trace:check、architecture:check、conformance:check、package:check | 11種すべてexit 0 | テスト出力 |
| 仕様 | `docs/specs/` 5 file | updated | 既存文書 |
| 実装前の欠陥再現 | 隔離repository | 追随mergeでREQ-WF-010を落としても変更前は合格した | 実行観測 |
| 実装前の手順成立 | 隔離repository | `impl…, S, A'`の形は変更前から合格した | 実行観測 |
| 変異試験 | 5経路 | 判定を外すと対応scenarioが失敗する | 実行観測 |

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/docs/02_品質基準.md` | M | package owner | 配布正本 | 既定branch追随手順の正本 | 参照のみ | REQ-SQ-018、SCN-UNIT-MERGEINT-014、016 | 追記の除去で戻る | pass |
| `.agent-skill-chain/templates/issue/04_レビュー.md` | M | package owner | 配布template | 追随時の確認項目 | 参照のみ | REQ-SQ-018、SCN-UNIT-MERGEINT-015 | 追記の除去で戻る | pass |
| `.agent-skill-chain/templates/issue/11_プルリクエスト事前確認.md` | M | package owner | 配布template | 追随時の確認項目 | 参照のみ | REQ-SQ-018、SCN-UNIT-MERGEINT-015 | 追記の除去で戻る | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | change owner | 仕様 | TERM-ASC-068、TERM-ASC-069の登録 | 参照のみ | REQ-SQ-018 | 行の除去で戻る | pass |
| `docs/specs/02_要件/00_要件一覧.md` | M | change owner | 仕様 | REQ-SQ-018の登録 | 参照のみ | REQ-SQ-018 | 行の除去で戻る | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | change owner | 仕様 | REQ-SQ-018の定義 | 参照のみ | REQ-SQ-018 | 節の除去で戻る | pass |
| `docs/specs/11_非機能/01_品質要件.md` | M | change owner | 仕様 | QLT-MERGEINT-001〜005 | 参照のみ | REQ-SQ-018 | 行の除去で戻る | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | change owner | 仕様 | REQ-SQ-018の追跡 | 参照のみ | REQ-SQ-018 | 行の除去で戻る | pass |
| `scripts/check_file_audit.ts` | M | package owner | gate script | Git観測と判定の合成 | `src/domain/merge-integrity.ts`へ単方向 | REQ-SQ-018、SCN-INT-MERGEINT-001〜012 | 合成箇所の除去で戻る | pass |
| `src/domain/merge-integrity.ts` | A | package owner | domain | 損失検知tokenの判定規則とmerge損失判定 | I/O依存なし | REQ-SQ-018、SCN-UNIT-MERGEINT-001〜024 | fileの削除で戻る | pass |
| `test/features/integration/merge-integrity.feature` | A | package owner | test | 隔離repositoryでの受け入れ例 | 実装へ単方向 | SCN-INT-MERGEINT-001〜012 | fileの削除で戻る | pass |
| `test/features/unit/merge-integrity.feature` | A | package owner | test | 観測値からの受け入れ例 | 実装へ単方向 | SCN-UNIT-MERGEINT-001〜024 | fileの削除で戻る | pass |
| `test/steps/merge-integrity.steps.ts` | A | package owner | test | step定義とfixture構築 | 実装へ単方向 | SCN-UNIT・SCN-INT-MERGEINT全件 | fileの削除で戻る | pass |

## 2. 受け入れ条件の確認

| AC | 結果 | 証拠 |
|---|---|---|
| AC-01〜AC-02 | 充足 | token抽出のscenario SCN-UNIT-MERGEINT-001、002 |
| AC-03〜AC-08g | 充足 | 損失とrename判定のscenario SCN-UNIT-MERGEINT-003〜008、018、020〜024 |
| AC-09〜AC-13 | 充足 | 判定不能と件数のscenario SCN-UNIT-MERGEINT-009〜013、019 |
| AC-14〜AC-22 | 充足 | 隔離repositoryのscenario SCN-INT-MERGEINT-001〜010 |
| AC-23〜AC-26 | 充足 | 配布文書のscenario SCN-UNIT-MERGEINT-014〜017 |
| AC-27〜AC-28 | 充足 | renameのscenario SCN-INT-MERGEINT-011、012 |

### 2.1 開発考慮事項の適用判定（必須）

| ID | 判定 | 確認 |
|---|---|---|
| DC-PRIVACY | applicable | 判定不能7種をすべてerror側で固定した。迂回optionは実装に存在しない |
| DC-OBSERVABILITY | applicable | commit短縮SHA、path、失われたtoken、安全な次操作をerrorへ含める |
| DC-UX | not-applicable | `checkFileAudit`の戻り値key集合はSCN-INT-MERGEINT-010で不変を確認した |
| DC-TOKENS | not-applicable | UI要素を持たない |

## 3. 肯定的評価

- `required(p)`の集合演算がFR-03とINV-06に整合し、片方の親だけの削除を保持必須にしない。
- 2親・単一merge-baseの拒否、release bumpを除外しない列挙、件数を公開戻り値へ追加しない構成、判定規則の一元化が要件どおりである。
- 判定を純関数へ、Git観測をscriptへ分け、依存方向が単方向で循環しない。
- 実装前に欠陥の通過と正常形の合格を観測し、是正後に変異試験で各判定の有効性を確認している。

## 4. 敵対的評価

reviewerが提出した反例と結果。

| 反例 | 結果 |
|---|---|
| `git diff --name-only`はrename検出時に移動元pathを列挙せず、移動元が対象集合から漏れる | 成立。隔離repositoryで実測し是正した |
| 解決できた親のrename候補だけを積むと、片方だけ解決した場合に未解決が消える | 成立。是正した |
| 異なる2つの移動元が同じ移動先へ解決されると、1個のtokenで双方を保持したと誤認する | 成立。是正した |
| rename先が元から存在する別pathの場合も同じ誤認が起きる | 成立。是正した |
| unit testがrenameTargetsを直接与えており、observerを通らない | 成立。実repositoryのrename scenarioを2件追加した |

## 5. 指摘

| ID | 深刻度 | 内容 | 状態 |
|---|---|---|---|
| S10-H-01 | High | `--name-only`のrename検出で移動元pathが対象集合から漏れるfail-open | 是正済み。`--no-renames`版を損失検知専用に分離。変異試験でSCN-INT-MERGEINT-011が検出 |
| S10-H-02 | High | 解決できた親のrename候補だけを積み、片方だけ解決した場合に未解決が消える | 是正済み。`RenameResolution`で未解決を明示保持。変異試験でSCN-UNIT-MERGEINT-021が検出 |
| S10-M-01 | Medium | unit testがrenameTargetsを直接与え、observerを通らない | 是正済み。SCN-INT-MERGEINT-011、012を追加 |
| S10-L-01 | Low | 内容観測失敗時のerrorに具体的な安全な次操作が無い | 是正済み |
| S10-H-03 | High | 異なる移動元が同じ移動先へ解決されると1個のtokenで双方を保持したと誤認する | 是正済み。`collidingRenameTargets`を追加。変異試験でSCN-UNIT-MERGEINT-022が検出 |
| S10-H-04 | High | rename先が元から存在する別pathの場合も同じ誤認が起きる | 是正済み。`occupied`判定を追加。変異試験でSCN-UNIT-MERGEINT-023が検出 |

### 上流へ戻した変更

実装中に2件を上流成果物へ戻した。

- **AC-20が充足判定不能であった。** `hasReleaseBumpChanges`が変更pathをpackage.jsonとpackage-lock.jsonへ限定し、`packageJsonOnlyChangesVersion`がversion以外の一致を要求するため、release bump除外条件を満たすmergeでは損失を構成できない。AC-20を「除外条件を参照せず観測対象として列挙する」ことの判定へ改めた。
- **FR-02にrename検出の無効化を追記した。** 差分列挙の方式が判定の正しさを決めるため、要件として固定した。

## 6. ラウンド固有の確認

### ラウンド1

High 2、Medium 1、Low 1。判定 rejected。

### ラウンド2

H-01、H-02、M-01、L-01を解消。新規High 1（H-03）。判定 rejected。

### ラウンド3

H-03を解消。新規High 1（H-04）。判定 rejected。**ラウンド予算3を使い切った。**

### 予算超過後の確認

H-04はデータ喪失に該当するため是正した。reviewerが「目的阻害・データ喪失・回帰に該当する新規問題は認めない」として **approved**。

## 7. テスト結果

| コマンド | 結果 |
|---|---|
| `npm test` | 863 scenario全通過、4600 step全通過 |
| `npm run project:quality` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run source:check` | exit 0 |
| `npm run docs:format` | exit 0 |
| `npm run test:format` | exit 0 |
| `npm run trace:check` | exit 0 |
| `npm run architecture:check` | exit 0 |
| `npm run conformance:check` | exit 0 |
| `npm run package:check` | exit 0 |

変異試験。

| 変異 | 検出したscenario |
|---|---|
| `changedPathsWithoutRenames`を`changedPaths`へ戻す | SCN-INT-MERGEINT-011 |
| 一部の親でだけ解決した場合の判定不能分岐を削る | SCN-UNIT-MERGEINT-021 |
| 移動先の多対一検出を削る | SCN-UNIT-MERGEINT-022 |
| `occupied`判定を削る | SCN-UNIT-MERGEINT-023 |
| `claimsTarget`判定を削る | SCN-INT-MERGEINT-012、SCN-UNIT-MERGEINT-024 |

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/merge-integrity.ts` | 入る（`dist/src/`） | export 3件と型4件の追加。既存exportの削除・改名・意味変更なし |
| `.agent-skill-chain/docs/02_品質基準.md` | 入る（`.agent-skill-chain/docs/`） | 既定branch追随の節を追記。既存記述の削除・改変なし |
| `.agent-skill-chain/templates/issue/04_レビュー.md` | 入る（`.agent-skill-chain/templates/`） | 確認項目を1行追記 |
| `.agent-skill-chain/templates/issue/11_プルリクエスト事前確認.md` | 入る（`.agent-skill-chain/templates/`） | 確認項目を3行追記 |
| `scripts/check_file_audit.ts` | 入らない | repository局所の検査 |
| `test/**` | 入らない | test資産 |
| `docs/specs/**` | 入らない | 製品仕様 |

判断: 配布物を更新した

根拠: `package.json`の`files`が列挙する`dist/src/`へ`src/domain/merge-integrity.ts`が新規exportとして現れる。`LOSS_TOKEN_PATTERN`、`extractLossTokens`、`evaluateMergeIntegrity`と関連型の追加のみで既存exportを変更・削除しない。あわせて`.agent-skill-chain/docs/`と`.agent-skill-chain/templates/`の3 fileへ追随手順を追記した。`scripts/`は`files`に含まれず配布されない。`npm run package:check`がexit 0である。

## 9. 独立reviewの成立

| 条件 | 充足 |
|---|---|
| reviewerが実装担当と別identityである | 充足。codexを別contextで起動した |
| reviewerが実装担当の判断を入力に持たない | 充足 |
| 各ラウンドの判定と根拠が原文引用を伴う | 充足 |
| 有限ラウンドで終了する | 充足。予算3＋データ喪失1件の是正確認で終了 |

## 10. 仕様整合性

`docs/specs/`の5 fileを更新した。REQ-SQ-018、AC-SQ-018、QLT-MERGEINT-001〜005、TERM-ASC-068、TERM-ASC-069を採番し、追跡表でSCN-UNIT-MERGEINT-001〜024とSCN-INT-MERGEINT-001〜012へ結び付けた。`npm run trace:check`と`npm run conformance:check`がexit 0である。

## 11. 総合判定と再開地点

**判定: approved**

- 未解決Critical: 0件
- 未解決High: 0件
- 分離: 1件（`比較基点`が申告値である弱点 → Issue #966）

再開地点: ステップ11（PR作成）
