# 課題894 schema先行 実装レビュー

> 状態: `ready-for-pr`。Issue #894が必要とするproject policy manifestの新fieldを、schemaとruntime検証だけbaseへ先行登録する変更の内部監査証拠である。独立reviewの承認は自己申告せず、CIとPR reviewの外部証拠で確定する。

## 判定

| 項目 | 値 |
|---|---|
| 状態 | ready-for-pr |
| 比較基点 | `01cfba6f55799142939ac4f171a37fd3b2636c02` |
| H_impl | `7c94d84c0e8e6498c01748de1015a385dd7c2167` |
| H_impl tree | `9750a42fa5a24ddc0fac218572cc526fe1029e5a` |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| role分離 | coordinatorとreviewerはClaude Opus 5。実装内容はIssue #894のimplementer（Codex `gpt-5.6-sol`）成果からschema・runtime層だけを抽出したものである |

## 二段階が必要な理由

`trusted-quality.yml`のbase validatorは、**baseのvalidatorでcandidate全体を検証する。**

PR #900が次で拒否された。

```
Error: project policy manifestが不正です: manifest.policy…未知fieldです
  at requireManifest → loadProjectPolicySet → checkSourceQuality
```

candidateがmanifestへ新fieldを追加しても、**baseのruntime検証はそのfieldを知らない。** したがって新fieldはbaseへ先に入っていなければならない。

同型の二段階分割は#832（project rule台帳）と#846（worktree policy）でも必要であった。**本repositoryにおけるschema拡張の標準手順である。**

## 分割の境界

当初はschema 2件と`policy.ts`・`types.ts`だけを先行させたが、`trace:check`が失敗した。

```
ERR_MODULE_NOT_FOUND: src/domain/worktree-removal-safety.js
```

`policy.ts`のruntime検証がpackage既定allowlistの定義を参照するため、判定moduleも先行分に含める必要があった。

**このmoduleは純関数であり副作用を持たない。** 先行分だけでは誰も呼ばないため挙動は変わらない。PR #900が`finalize.ts`と`worktree-survey.ts`から接続して初めて有効になる。

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/schemas/project-policy-manifest.schema.json` | M | package maintainer | schema | manifestへ`finalizeIgnoredPathAllowlist`をoptionalで追加する | schemaからruntimeへの参照はない | AC-894-06 | optionalのため既存project policyは変更なしで妥当。定義を戻せば旧schemaへ復帰する | pass |
| `.agent-skill-chain/schemas/project-policy.schema.json` | M | package maintainer | schema | 組立済みpolicyへ同fieldを追加する | 同上 | AC-894-06 | 同上 | pass |
| `.agent-skill-chain/schemas/00_利用案内.md` | M | package maintainer | schema案内 | allowlistの意味と制約を記載する | 案内からschemaへの片方向参照 | AC-894-06 | 行を戻せば旧案内へ復帰する | pass |
| `src/domain/policy.ts` | M | package maintainer | domain | allowlistのruntime検証と未知field許可集合を更新する | `src/lib/*`と判定moduleへ依存。循環なし | AC-894-06 | **schemaだけ更新してruntimeを忘れる欠陥（#832）を回避した。** 差分revertで旧検証へ戻る | pass |
| `src/domain/worktree-removal-safety.ts` | A | package maintainer | domain | package既定allowlistと共通の削除安全判定を純関数で提供する | 標準moduleのみ。gitもfile systemも触らない | AC-894-01、AC-894-10 | 既定は`node_modules/`と`dist/`のみ。**利用者所有物を1件も含めない。** 先行分では誰も呼ばない | pass |
| `src/types.ts` | M | package maintainer | 型 | policy型へallowlistを追加する | 型定義のみ | AC-894-06 | 型追加のみで挙動を変えない | pass |

Gitの`01cfba6f55799142939ac4f171a37fd3b2636c02..7c94d84c0e8e6498c01748de1015a385dd7c2167`に含まれる6 pathと表の6行は重複なし・欠落なしで一致する。

## 挙動を変えないことの確認

- `.agent-skill-chain/project-policy.json`を変更していない。したがって本repositoryのpolicyは新fieldを宣言しない
- schemaはoptionalであり、既存policyは無変更で合格する
- 判定moduleは先行分では呼び出し元を持たない
- `finalize.ts`と`worktree-survey.ts`を変更していない

## ゲート実測

coordinator環境（sandbox外）で実行した。

| コマンド | 結果 |
|---|---|
| `npm run project:quality` | 合格 |
| `npm run quality` | 合格 |
| `npm run trace:check` | 合格 |
| `npm run conformance:check` | 合格 |
| `npm run docs:format` | 合格 |
| `npm run test:format` | 合格 |
| `npm run architecture:check` | 合格 |
| `npm run package:check` | 合格 |
| `npm run workflow:check` | 合格 |

`npm test`は**611 scenarios (611 passed)**。既存件数から増減していない。**先行分がtestの期待を変えていないことの裏付けである。**

## 肯定・敵対レビュー

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | schemaとruntimeを同時に更新し、#832の欠陥類型を回避した |
| 価値・実現可能性 | pass | PR #900がCIを通過するための必要条件であり、他に手段がない |
| 整合性 | pass | 既存policyは無変更で合格する。挙動を変えていない |
| 保守性 | pass | 判定定義を1箇所へ置き、後続PRが接続する形にした |
| 反例・失敗経路 | pass | 過度に広いpatternの拒否はPR #900の反例testが固定する |
| 境界値・悪用 | pass | directory prefixのみ許可し、絶対path・`..`・`.git`・glob・正規表現メタ文字を拒否する |
| 安全性・データ損失 | pass | 既定allowlistに利用者所有物を含めない。先行分では誰も呼ばない |
| rollback | pass | 差分revertで旧schemaとruntimeへ戻る |
| 範囲漏れ | pass | `project-policy.json`、protected file、`package.json`、`docs/reviews/`以外を変更していない |

### 敵対観点の残論点

**先行分だけがmergeされPR #900がmergeされない可能性がある。** その場合、schemaに宣言できるが誰も参照しないfieldが残る。optionalであり実害はないが、意図が読めなくなる。#900がcloseされた場合は本変更も取り消す。

**判定moduleが先行分では未使用である。** `architecture:check`と`source:check`は通るが、到達不能コードとして残る期間が生じる。#900のmergeまでの短期間に限る。
