# 課題920 品質契約proposal登録レビュー

> 状態: `ready-for-pr`。登録済み品質proposalの記述field更新を許可するための、versioned staged proposal登録だけを行う変更の内部監査証拠である。独立reviewの承認は自己申告せず、CIとPR reviewの外部証拠で確定する。

## 判定

| 項目 | 値 |
|---|---|
| 状態 | ready-for-pr |
| 比較基点 | `2c5de01cf4e0f7c18b294b3cb6170f76639b1d44` |
| H_impl | `2b6abcf497f9615dbc14a9a5d553771c6f11a306` |
| H_impl tree | `8b5cc715110c417bc7cda1771d61ed70f9c75a5a` |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| role分離 | implementer・coordinator・reviewerはいずれもClaude Opus 5だが、実装、監査、反例設計を別contextで行った。identityは同一である |

## 経緯

PR #919のCodeRabbitレビューで、登録したproposalの`rollback`手順が**validatorで実行できない**と指摘された。事実であり是正したが、**merge済みの`TQP-LOCKFILE-VERSION-NORMALIZATION-001`には同じ誤った文言が残っている。**

`validateTrustedQualityMigration`はtrusted registryのproposalとcandidate側の内容を`stableJson`で全field比較するため、記述だけのfieldでも訂正が拒否される。

## 本PRの範囲

是正対象の`scripts/check_project_quality.ts`自身が`PROTECTED_FILES`である。**本PRは1段階目、registryへの登録だけである。挙動は変わらない。**

| proposal識別子 | 契約versionの遷移 | 対象 |
|---|---|---|
| `TQP-PROPOSAL-DESCRIPTION-FIELDS-001` | 4から5へ | `scripts/check_project_quality.ts`、`agentSkillChain.qualityContractVersion` |

**本proposalの`rollback`は前進手順で記述した。** #919で学んだ内容を反映している。

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/trusted-quality-proposals.json` | M | repository maintainer | 品質契約 | 記述field更新許可のstaged proposalを1件追加する | registryから各所への片方向参照 | REQ-SQ-012 | 前進proposalでのみ戻せる。protected fileは変更していない | pass |

Gitの`2c5de01cf4e0f7c18b294b3cb6170f76639b1d44..2b6abcf497f9615dbc14a9a5d553771c6f11a306`に含まれる1 pathと表の1行は重複なし・欠落なしで一致する。

## ゲート実測

coordinator環境（sandbox外）で実行した。`origin/main`をdetached worktreeへ展開し、それをtrusted rootとしてcandidateを評価した。

| コマンド | 結果 |
|---|---|
| `node --import tsx scripts/check_project_quality.ts --root=. --trusted-root=<mainの検出tree>` | 合格。`valid: true`、`errors: []` |

## 外部レビューの状態

本PRのCodeRabbitレビュー状態はmerge時に記録する。`rate limited`の場合、checkは`pass`と表示されるがレビューは実行されない。

### `rate limited`時のmerge例外

| 項目 | 値 |
|---|---|
| 承認元 | repository ownerの明示指示 |
| 対象scope | 本repositoryのPR全般 |
| 承認者 | repository owner |
| 理由 | `rate limited`中は待機してもレビューが実行される保証がない |
| 承認日時 | 2026-08-26 |
| 失効日時 | 未設定 |
| 記録先 | 各PRのreview artifactの本節 |

この例外を正本へ移す作業はIssue #921で扱う。

## 肯定・敵対レビュー

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | before hashがmainの実値と一致し、fromVersion・toVersionが現行契約versionと1段階後を満たす |
| 価値・実現可能性 | pass | 登録だけでは挙動を変えない。次PRで初めて有効になる |
| 整合性 | pass | 既存4件のproposalを変更・削除していない |
| 安全性 | pass | protected fileを1件も変更していない |
| 保守性 | pass | rollbackを前進手順で記述した。実行可能である |

## 対象外

- 比較対象の限定そのもの。次PRで適用する。
- `TQP-LOCKFILE-VERSION-NORMALIZATION-001`の文言訂正。適用後の3本目のPRで行う。
