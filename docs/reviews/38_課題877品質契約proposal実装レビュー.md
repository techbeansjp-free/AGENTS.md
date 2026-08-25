# 課題877 品質契約proposal 実装レビュー

> 状態: `ready-for-pr`。Issue #877が必要とする品質契約変更のproposalをbaseへ先行登録する変更を、merge済みdefault branch headを比較基点として固定した内部監査証拠である。独立reviewの承認は自己申告せず、CIとPR reviewの外部証拠で確定する。

## 判定

| 項目 | 値 |
|---|---|
| 状態 | ready-for-pr |
| 比較基点 | `5d0984cb4c9dffac46ef4456dafb2e34274c9fa3` |
| H_impl | `34fcb2c0f95c836b6796472153206148e281771c` |
| H_impl tree | `a8a167f8f28fe4493fd7388c22b0d59f222f60f4` |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| role分離 | coordinatorとreviewerはClaude Opus 5。本変更はgovernance registryのみで製品code・test・仕様を含まない |

## 背景

`trusted-quality.yml`のbase validatorは、candidateがprotected fileと`agentSkillChain.qualityContractVersion`を変更する場合、**baseへ事前登録されたproposal**を要求する。

PR #889（Issue #877）が次で拒否された。

```
"valid": false,
"errors": [
  "prepack scriptを自己緩和できません",
  "candidateのtrusted品質契約変更はbaseで事前登録済み…proposalが必要"
]
```

## 二段階が必要な理由

base validatorはcandidateの変更を**baseの内容と照合する。** したがってproposalはbaseに存在していなければならない。同一PRでproposalと変更を同時に入れると、照合時点でproposalがbaseに無いため必ず拒否される。

同じ制約は#857（`TQP-QUALITY-SCAN-BOUNDARY-001`）でも発生した。**本repositoryにおける品質契約変更の標準手順である。**

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/trusted-quality-proposals.json` | M | repository maintainer | governance registry | `TQP-WORKFLOW-STEP-GATE-001`を`staged`で登録し、`scripts/check_project_quality.ts`の内容変更と`qualityContractVersion` 2→3を宣言する | registryからprotected fileへの片方向参照。runtimeへの依存はない | AC-877-09 | `status`は`staged`であり本PRだけでは何も有効化しない。proposalをregistryから取り消せばprepack 10 gate構成のまま維持される | pass |

Gitの`5d0984cb4c9dffac46ef4456dafb2e34274c9fa3..34fcb2c0f95c836b6796472153206148e281771c`に含まれる1 pathと表の1行は重複なし・欠落なしで一致する。

## 宣言内容

| 対象 | 種別 | 変更前 | 変更後 |
|---|---|---|---|
| `scripts/check_project_quality.ts` | file | `ce1f94b90a8ed03214f0c955abaa032df535ddeeb4897439a5eb110369d08d27` | `89fc0ff5165719e6284050a5dac57676d166d60df0379b30dfb77285da09d865` |
| `agentSkillChain.qualityContractVersion` | packageField | 値2のSHA-256 `d4735e3a265e16eee03f59718b9b5d03019c07d8b6c51f90da3a666eec13ab35` | 値3のSHA-256 `4e07408562bedb8b60ce05c1decfe3ad16b72230967de01f640b7e4729b49fce` |

`afterSha256`はPR #889のbranch上の実内容から算出した。**#889側で当該fileを1バイトでも変更すると照合が失敗する。** その制約は#889のimplementer契約へ明記した。

## 品質強度への影響

**緩和ではない。** `prepack`連鎖は10本から11本へ増える（`workflow:check`を追加）。既存10 gateの内容は変更しない。

`workflow:check`の実測所要は0秒であり、gate合計106秒に対する増分は測定限界以下である。

## 肯定・敵対レビュー

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | before hashがbaseの実内容、after hashが#889 branchの実内容と一致する |
| 価値・実現可能性 | pass | #889がCIを通過するための必要条件であり、他に手段がない |
| 整合性 | pass | 既存proposal `TQP-QUALITY-SCAN-BOUNDARY-001`と同じschemaに従う |
| 保守性 | pass | registryの追記のみ。既存entryを変更していない |
| 反例・失敗経路 | pass | hash不一致なら照合が失敗し、gate追加は成立しない。fail-closedである |
| 境界値・悪用 | pass | `status: staged`であり本PR単独では何も有効化しない |
| 安全性・データ損失 | pass | JSONの追記のみ。既存の品質強度を下げない |
| rollback | pass | proposalをregistryから取り消せば旧構成のまま維持される |
| 範囲漏れ | pass | 製品code、test、仕様、`package.json`を変更していない |

### 敵対観点の残論点

**proposalが登録されたまま#889がmergeされない可能性がある。** その場合registryに未使用のstaged proposalが残る。`status: staged`は何も有効化しないため実害はないが、放置すると意図が読めなくなる。#889がcloseされた場合はproposalも取り消す。

**review artifactの採番がmerge順に依存する。** `latestAuditPath`は番号が最大のものを選ぶため、merge順と採番順が一致しないと後続PRの`audit:check`が誤った成果物を参照する。本PRを38、#889を39、#891を40へ採番し直した。並行PRが3本以上ある場合、この採番調整は毎回必要になる。
