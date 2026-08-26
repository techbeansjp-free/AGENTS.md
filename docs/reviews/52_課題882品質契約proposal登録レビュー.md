# 課題882 品質契約proposal登録レビュー

> 状態: `ready-for-pr`。製品自身のlifecycle健全性をCIで検証するための、versioned staged proposal登録だけを行う変更の内部監査証拠である。独立reviewの承認は自己申告せず、CIとPR reviewの外部証拠で確定する。

## 判定

| 項目 | 値 |
|---|---|
| 状態 | ready-for-pr |
| 比較基点 | `d269935abe82dec0393ff30b9baf39efa8a461cc` |
| H_impl | `a12a5f507460bfdae5c0634913ecb3245e11c54f` |
| H_impl tree | `4f1e8b5836b0a67cf1b8b3e131543b97bb3eaa1f` |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| role分離 | implementer・coordinator・reviewerはいずれもClaude Opus 5だが、実装、監査、反例設計を別contextで行った。identityは同一である |

## 経緯

**製品自身のrepositoryが、製品自身の`doctor`に合格しない。** 実測。

| 対象 | 結果 |
|---|---|
| 現在のmainのclean checkout | `healthy: false`、`installed: false` |
| 同checkoutへ`install --apply`した後 | `healthy: true`、`installed: true` |

**CIが`doctor`を実行しないため無音で通っていた。**

## なぜPRを2本に分けるか

CIへstepを足すには`.github/workflows/ci.yml`を変更する。これは`PROTECTED_FILES`である。したがって次の順でしか適用できない。

1. **本PR。** baseへversioned staged proposalを登録する。protected fileは変更しないため既存validatorで合格する
2. 次のPR。`ci.yml`と`agentSkillChain.qualityContractVersion`を変更する

**本proposalは品質検査の追加であり緩和ではない。** それでも同じ2段階を要求するのが本機構の設計である。

## 登録内容

| 項目 | 値 |
|---|---|
| proposal識別子 | `TQP-DOGFOODING-DOCTOR-CI-001` |
| 契約versionの遷移 | 3から4へ |
| 対象1 | `file:.github/workflows/ci.yml` |
| 対象2 | `packageField:agentSkillChain.qualityContractVersion` |

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/trusted-quality-proposals.json` | M | repository maintainer | 品質契約 | 製品自身のdoctor検証のstaged proposalを1件追加する | registryから各所への片方向参照 | REQ-LC-011 | **取り消しでは戻せない。** 登録済みproposalの削除・変更はvalidatorが拒否し、契約versionの減少も受理されない。rollbackは次版への前進proposalで行う | pass |

Gitの`d269935abe82dec0393ff30b9baf39efa8a461cc..a12a5f507460bfdae5c0634913ecb3245e11c54f`に含まれる1 pathと表の1行は重複なし・欠落なしで一致する。

## ゲート実測

coordinator環境（sandbox外）で実行した。`origin/main`をdetached worktreeへ展開し、それをtrusted rootとしてcandidateを評価した。

| コマンド | 結果 |
|---|---|
| `node --import tsx scripts/check_project_quality.ts --root=. --trusted-root=<mainの検出tree>` | 合格。`valid: true`、`errors: []` |

## rollbackの制約

**登録済みのtrusted proposalは訂正できない。** `validateTrustedQualityMigration`は、trusted registryに存在するproposalとcandidate側の内容が`stableJson`で一致しない場合を「削除・変更できません」として拒否する。したがってmerge済みの`TQP-LOCKFILE-VERSION-NORMALIZATION-001`が持つ「registryから取り消してversionを戻す」というrollback文言も、後から訂正できない。

同文言は実行不可能である。正しい手順は本PRの`rollback`に記載した前進proposalであり、この事実を本証拠で記録する。registryの記述を後から訂正できない点は本機構の制約として別Issueで扱う。

## 外部レビューの状態

CodeRabbitは本PRをレビューし、Major 2件を指摘した。**いずれも事実であり是正した。**

| 指摘 | 検証 | 対応 |
|---|---|---|
| validatorで受理できないrollback手順である | 事実。登録済みproposalの削除・変更は拒否され、契約versionの減少も受理されない | rollbackを次版への前進proposalとして定義し直し、監査表の該当欄も更新した |
| `rate limited`のmerge例外に承認元と記録項目がない | 事実。例外の根拠が本文中の一文だけで、対象・承認者・日時が構造化されていなかった | 下表の記録項目を追加した |

### `rate limited`時のmerge例外

| 項目 | 値 |
|---|---|
| 承認元 | repository ownerの明示指示。AskUserQuestionへの回答「待たずにマージし記録する」 |
| 対象scope | 本repositoryのPR全般 |
| 承認者 | repository owner |
| 理由 | `rate limited`中は待機してもレビューが実行される保証がなく、実測でPR #884・#891・#897・#898・#903・#904がいずれもreview comment 0件のまま推移した |
| 承認日時 | 2026-08-26 |
| 失効日時 | **未設定。** ownerが撤回するまで有効である。ownerは期限を指定していないため、こちらで期限を創作しない |
| 記録先 | 各PRのreview artifactの本節 |

この例外は`exact-head review`の外部証拠要件を満たさない。**満たさないことを承知のうえで、ownerの判断として運用する。** 例外をproject policyの正本へ移す作業は別Issueで扱う。

## 肯定・敵対レビュー

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | before hashがmainの実値と一致し、fromVersion・toVersionが現行契約versionと1段階後を満たす |
| 価値・実現可能性 | pass | 登録だけでは挙動を変えない。次PRで初めて有効になる |
| 整合性 | pass | 既存3件のproposalを変更・削除していない |
| 安全性 | pass | protected fileを1件も変更していない |
| 保守性 | pass | rollbackは前進proposalとして定義した。validatorが受理できる手順である |

## 対象外

- CI stepそのものの追加。次PRで適用する。
- 検出したworktreeの削除。破壊的操作は`worktree finalize`と`worktree hygiene`のpreview・承認hash経路に限る。
