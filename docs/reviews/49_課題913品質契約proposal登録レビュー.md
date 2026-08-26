# 課題913 品質契約proposal登録レビュー

> 状態: `ready-for-pr`。lockfile保護の正規化を適用するための、versioned staged proposal登録だけを行う変更の内部監査証拠である。独立reviewの承認は自己申告せず、CIとPR reviewの外部証拠で確定する。

## 判定

| 項目 | 値 |
|---|---|
| 状態 | ready-for-pr |
| 比較基点 | `4758b6bd0ab7fd5116835d49c90fdae7ddf28f2f` |
| H_impl | `d329b2c8bf42d59936997ebb5f93042f49429db6` |
| H_impl tree | `cf42507ce9f38e0e4847cbc3ff1036e7642b6de2` |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| role分離 | implementer・coordinator・reviewerはいずれもClaude Opus 5だが、実装、監査、反例設計を別contextで行った。identityは同一である |

## 経緯

**自動releaseがmainのversionを上げると、その時点でopenな全PRの`base validatorで品質自己緩和を拒否`が失敗する。**

`scripts/check_project_quality.ts`の`PROTECTED_FILES`に`package-lock.json`が含まれ、`protectedSnapshot`が全内容のSHA-256を取る。release bump commitは`package.json`と`package-lock.json`の両方のversionを書き換えるため、追随していない全PRで`file:package-lock.json`のhashがtrustedと不一致になる。

実測（PR #912）。

```
-  "version": "0.3.1-beta.14",
+  "version": "0.3.1-beta.13",
-      "version": "0.3.1-beta.14",
+      "version": "0.3.1-beta.13",
```

**差分は6行、実体はversion文字列2箇所だけである。** PR #909でも同じ失敗を観測した。

## なぜPRを2本に分けるか

是正対象の`scripts/check_project_quality.ts`自身が`PROTECTED_FILES`である。したがって次の順でしか適用できない。

1. **本PR。** baseへversioned staged proposalを登録する。protected fileは変更しないため`actualChanges`は空であり、既存validatorで合格する
2. 次のPR。`scripts/check_project_quality.ts`と`agentSkillChain.qualityContractVersion`を変更する。baseのvalidatorが本PRで登録済みのproposalと突合して許可する

`品質契約を有効化するPRで新規proposalを同時登録できません`により、1本にまとめることはできない。

## 登録内容

| 項目 | 値 |
|---|---|
| proposal識別子 | `TQP-LOCKFILE-VERSION-NORMALIZATION-001` |
| 契約versionの遷移 | 2から3へ |
| 対象1 | `file:scripts/check_project_quality.ts` |
| 対象2 | `packageField:agentSkillChain.qualityContractVersion` |

before hashはmainの現在値と一致することを`trustedSnapshot`との突合で確認した。

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/trusted-quality-proposals.json` | M | repository maintainer | 品質契約 | lockfile version正規化のstaged proposalを1件追加する | registryから各所への片方向参照 | REQ-SQ-010 | 本proposalをregistryから取り消せば登録前へ戻る。protected fileは変更していない | pass |

Gitの`4758b6bd0ab7fd5116835d49c90fdae7ddf28f2f..d329b2c8bf42d59936997ebb5f93042f49429db6`に含まれる1 pathと表の1行は重複なし・欠落なしで一致する。

## ゲート実測

coordinator環境（sandbox外）で実行した。

| コマンド | 結果 |
|---|---|
| `npm run project:quality` | 合格 |
| `node --import tsx scripts/check_project_quality.ts --root=. --trusted-root=<mainの検出tree>` | 合格。`valid: true`、`errors: []` |

**base validatorに対する実測を行った。** `origin/main`をdetached worktreeへ展開し、それをtrusted rootとしてcandidateを評価した。

## 外部レビューの状態

本PRのCodeRabbitレビュー状態はmerge時に記録する。`rate limited`の場合、checkは`pass`と表示されるがレビューは実行されない。repository ownerの確定事項により、`rate limited`のときは待たずにmergeし、その事実を記録する。

## 肯定・敵対レビュー

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | before hashがmainの実値と一致し、fromVersion・toVersionが`trustedVersion`と`trustedVersion + 1`を満たす |
| 価値・実現可能性 | pass | 登録だけでは挙動を変えない。次PRで初めて有効になる |
| 整合性 | pass | 既存2件のproposalを変更・削除していない |
| 安全性 | pass | protected fileを1件も変更していない。registry自体はprotected fileではない |
| 保守性 | pass | rollbackはregistryからの取り消しだけで完結する |

## 対象外

- 正規化そのものの実装。次PRで適用する。
- `PROTECTED_FILES`からの`package-lock.json`除外。保護目的は維持する。
