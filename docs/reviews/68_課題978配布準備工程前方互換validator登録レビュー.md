# 68 課題978 配布準備工程前方互換validator登録レビュー

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象Issue | #978 |
| 比較基点 | `784611cb654c83dba6976d9f93833c31fda77300` |
| H_impl | `81ae26d0d5cc35909da15bab961bba3b6a6fda18` |
| reviewer | codex（実装担当と別identity、別context） |
| 実施日 | 2026-08-27 |
| ラウンド数 | 2 |

### 0.1 routing入力契約

本PRの差分、proposalが事前承認する`scripts/check_project_quality.ts`の差分全文、既定branch側validatorの照合ロジックだけを渡した。**実装担当の判定と検証結果は渡していない。**反例の探索はreviewerが独自に行った。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求 | https://github.com/techbeansjp-free/AGENTS.md/issues/978 | #965の基盤段階として前方互換validatorをproposal登録する | 人間判断 |
| 差分 | `784611cb`..`81ae26d0` | 1 file（registry JSONのみ） | 既存コード |
| 欠陥の再現 | 実測 | `npm install "github:techbeansjp-free/AGENTS.md#v0.3.1-beta.23"` がexit 0で`dist/`も`.bin/`も生成しない | 実行観測 |
| package manager差の切り分け | probe package | npmはgit依存installで`prepare`のみ、pnpmは`prepare`があっても`prepack`を実行する | 実行観測 |
| 二段階の強制 | `scripts/check_project_quality.ts` | `品質契約を有効化するPRで新規proposalを同時登録できません` | 既存コード |
| before hashの現存性 | `origin/main` | 保護fileの実hashがproposalの`beforeSha256`と一致 | 実行観測 |
| 静的検査 | 12種 | すべてexit 0 | テスト出力 |
| 承認対象validatorの受理検査 | 2形 | 現行legacy形と新形の双方を受理 | 実行観測 |
| 承認対象validatorの変異試験 | 5経路 | すべて拒否 | 実行観測 |

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/trusted-quality-proposals.json` | M | repository owner | 品質契約registry | 品質契約version 5→6のstaged proposalを1件登録する | `scripts/check_project_quality.ts`が`PROPOSAL_REGISTRY`として読む。registry→validatorの単方向で循環なし | REQ-SQ-010、REQ-SQ-012 | 有効化しなければ強制は変わらない | pass |

### 変更fileの実行経路

本fileはrepositoryから読まれない静的資産ではなく、**既定branch側validatorの入力**である。

| 経路 | 実体 |
|---|---|
| 読み取り定数 | `scripts/check_project_quality.ts` の `PROPOSAL_REGISTRY = ".github/trusted-quality-proposals.json"` |
| 読み取り箇所 | `checkProjectQualityContract`が`trustedRoot`側と`root`側の両方を`readProposalRegistry`で読む |
| 照合 | `fromVersion === trustedVersion`、`toVersion === candidateVersion`、`targets`のhash mapの完全一致 |
| 起動 | `.github/workflows/trusted-quality.yml`が`pull_request_target`でbase側validatorを実行する |

**依存の向きはregistry→validatorの単方向で、循環しない。**本PRはregistryへ1件追加するだけでvalidator側を変更しないため、照合ロジックは動かない。

### 既定branch追随

**登録後に既定branchが動いたため、#962で定めた手順で追随した。**

1. review artifact commitは未作成のため退避不要
2. `git merge origin/main`で`784611cb`を取り込む。衝突なし
3. `比較基点`を取り込んだ既定branch tip、`H_impl`を追随merge後の是正commitとする
4. 個別監査表を`比較基点..H_impl`から再生成する
5. review artifactを最終commitへ置く

追随で入ったのはrelease bump（`0.3.1-beta.28`→`0.3.1-beta.29`）のみで、保護fileは動いていない。`beforeSha256`が陳腐化していないことを実hashで確認した。

## 2. 受け入れ条件の確認

| AC | 結果 | 証拠 |
|---|---|---|
| 強制を変えない | 充足 | 差分はregistry JSONのみ。保護fileと`package.json`は無変更 |
| 現行の形を受理し続ける | 充足 | 承認対象validatorを現行`package.json`へ適用し`project:quality`がexit 0 |
| 新しい形を受理する | 充足 | 新形の`package.json`へ適用し`project:quality`がexit 0 |
| 自己緩和を拒否し続ける | 充足 | 変異5経路すべて拒否 |
| before hashが現存する | 充足 | `origin/main`の実hashと一致 |

### 2.1 開発考慮事項の適用判定（必須）

| ID | 判定 | 確認 |
|---|---|---|
| DC-PRIVACY | not-applicable | 個人データを扱わない |
| DC-OBSERVABILITY | not-applicable | logも計測も生成しない |
| DC-UX | not-applicable | UIを持たない |
| DC-TOKENS | not-applicable | UI要素を持たない |

## 3. 肯定的評価

- 差分がregistry JSON 1件に限られ、強制を1件も変えない。
- `verify:distribution`が現行`prepack`の文字列と完全一致するため、gate集合と順序が保存されることが文字列比較で示せる。
- 有効化しない限り何も起きないため、放置がそのままrollbackになる。

## 4. 敵対的評価

| 反例 | 結果 |
|---|---|
| `verify:distribution`へ`exit 0`を注入すると、gate名は全件揃いprefixも一致するため受理される。実行時は以降のgateが成功扱いで省略される | **成立。** 集合一致から完全一致へ改めて是正 |
| gate順序の入れ替え・任意commandの挿入・コメントアウトが同様に通る | **成立。**同一の是正で解消 |
| legacy形の分岐が`prepare`を検証しないため、`"prepare": "true"`でnpm経路がbuildされない配布が成立する | **成立。**legacy形でも`prepare`の自己緩和を拒否するよう是正 |
| 承認対象の2 targetでPR-2に必要十分か | **不足を指摘。**下記「移行が三段階である根拠」に記録 |
| 現行形を受理し続けることで、有効化後にversion更新なしでlegacyへ戻せる | 成立。残存risk として記録。PR-3で`check_conformance.ts`（保護対象外）へ現行形の固定検査を置いて塞ぐ |

### 移行が三段階である根拠

`.github/workflows/trusted-quality.yml`は`pull_request_target`で**base側のvalidatorを取得し、candidateを固定fileとして読む**。したがってPR-2ではbase（品質契約version 5、legacy形のみ受理）のvalidatorがcandidateの`package.json`を検査する。**PR-2に`scripts`の切替を同梱すると`prepack scriptを自己緩和できません`で落ちる。**

移行は次の三段階になる。

| 段階 | 内容 | 保護対象 | 検査するvalidator |
|---|---|---|---|
| PR-1（本PR） | proposalの登録 | なし | base v5 |
| PR-2 | validatorの差し替えと品質契約version 5→6。`scripts`はlegacyのまま | 2件（proposalのtargetと一致） | base v5 |
| PR-3 | `scripts`を新形へ、`release.yml`を`verify:distribution`へ、conformance検査の追加 | なし | base v6（新形を受理する） |

**この事実は本PRのproposalを無効にしない。**PR-2で変わる保護対象は`scripts/check_project_quality.ts`と`agentSkillChain.qualityContractVersion`の2件だけであり、`package.json`の`scripts`はsnapshot対象外のためtargetに含める必要も可能性もない。

## 5. 指摘

| ID | 深刻度 | 内容 | 状態 |
|---|---|---|---|
| S10-H-01 | High | `verify:distribution`の集合一致検査が`exit 0`注入・順序入れ替え・任意command挿入を受理する | 是正済み。完全一致へ変更 |
| S10-H-02 | High | 移行は二段階では完了せず、`scripts`切替に第三のPRが必要 | 是正不要。事実として記録し移行計画へ反映 |
| S10-M-01 | Medium | legacy形の分岐が`prepare`を検証しない | 是正済み |
| S10-M-02 | Medium | 有効化後にversion更新なしでlegacy形へ戻せる | 未是正。PR-3で塞ぐ。本PRは強制を変えないため本PRの範囲外 |

### 縮小した検証とその理由

**承認対象validatorに対する永続的な回帰testを本PRへ置いていない。**承認対象は`afterSha256`で固定された将来の内容であり、本PRの作業樹には存在しない。testを置くと本PRが保護fileを変更することになり、二段階移行の前提が崩れる。代替として、承認対象の差分全文を本artifactの付録Aへ引用し、受理2形と変異5経路の実行観測を証拠として残した。**永続的なtestはPR-2で承認対象と同時に導入する。**

## 6. ラウンド固有の確認

### ラウンド1

High 2、Medium 2。判定 **rejected**。

### ラウンド2

H-01とM-01を是正。H-02は事実として移行計画へ反映し、proposalの妥当性に影響しないことを確認。M-02をPR-3へ分離。新規Critical/High 0件。判定 **approved**。

## 7. テスト結果

| コマンド | 結果 |
|---|---|
| 静的検査12種 | すべてexit 0 |
| `npm test` | 904 scenario全通過、4805 step全通過 |

承認対象validatorの受理検査。

| 入力 | 期待 | 結果 |
|---|---|---|
| 現行`package.json`（legacy形） | 受理 | 受理 |
| 新形（PR-3が使う形） | 受理 | 受理 |

承認対象validatorの変異試験。

| 変異 | 結果 |
|---|---|
| `verify:distribution`へ`exit 0`を注入 | 拒否 |
| `verify:distribution`のgate順序を入れ替え | 拒否 |
| `verify:distribution`から`audit:check`を除去 | 拒否 |
| legacy形で`prepare`を`true`へ | 拒否 |
| `prepack`を任意commandへ | 拒否 |

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.github/trusted-quality-proposals.json` | 入らない | repository局所の品質契約registry |

判断: 配布物を更新しない

根拠: `npm run package:check`がexit 0であり、`.github/`は配布境界外である。**本PRは強制を1件も変えないため、consumerから観測できる変化は無い。**

## 9. 独立reviewの成立

| 条件 | 充足 |
|---|---|
| reviewerが実装担当と別identityである | 充足。codex |
| reviewerが実装担当の判断を入力に持たない | 充足。差分と照合ロジックだけを渡した |
| 各ラウンドの判定と根拠が原文引用を伴う | 充足 |
| 有限ラウンドで終了する | 充足。2ラウンドでapproved |

**ラウンド1で実際にHigh 2件を検出し、うち1件は承認対象の内容そのものの是正に至った。**`targets`は登録後に変更できないため、この検出はマージ前でなければ回復不能であった。

## 10. 仕様整合性

`docs/specs/`は更新していない。本PRは既存のREQ-SQ-010（保護対象の範囲）とREQ-SQ-012（登録済みproposalの不変性）の下で、その機構を1回利用するだけであり、新しい要件を導入しない。#965の有効化段階で配布経路の要件を採番する。

## 11. 総合判定と再開地点

**判定: approved**

- 未解決Critical: 0件
- 未解決High: 0件
- 未解決Medium: 1件（S10-M-02。PR-3へ分離）

再開地点: ステップ11（PR作成）

## 付録A 承認対象validatorの差分全文

`targets[0]`は`scripts/check_project_quality.ts`の内容をhashで固定する。**登録後に`targets`は変更できないため、その実体を本artifactへ保存する。**

| 項目 | 値 |
|---|---|
| `beforeSha256` | `249d8d3ff0356f3e2b82d549da20dbf83663a66f9b4abb039bfc31c0ba5102bf` |
| `afterSha256` | `300f2e1358c8a04b5f3af129d31faffb49fbe2ee346a5a377d345c011561dc91` |

`beforeSha256`は`比較基点`(`784611cb654c83dba6976d9f93833c31fda77300`)における当該fileの実hashである。次で再現できる。

```
git show 784611cb654c83dba6976d9f93833c31fda77300:scripts/check_project_quality.ts | sha256sum
```

`afterSha256`は、`beforeSha256`の内容へ下記の差分を適用し`prettier --write`で整形した結果のhashである。**PR-2はこの差分をそのまま適用する。**適用後のfileへ同じ手順でhashを取れば`afterSha256`と一致する。

```diff
@@ -86,10 +86,65 @@
   "conformance:check": "node --import tsx scripts/check_conformance.ts",
   quality:
     "npm run lint && npm run format:check && npm run typecheck && npm run source:check && npm test",
-  prepack:
-    "npm run project:quality && npm run quality && npm run build && npm run docs:format && npm run test:format && npm run trace:check && npm run architecture:check && npm run conformance:check && npm run audit:check && npm run package:check",
 };
 
+/**
+ * 配布前品質検証のgate集合。**consumerの準備工程では実行しない。**
+ *
+ * `prepack`はgit依存installの準備でpnpmが実行する。品質gateをそこへ置くと、`.git`の無い
+ * 展開先で`git ls-files`依存の検査が必ず落ち、配布経路が成立しない（Issue #965）。
+ */
+const DISTRIBUTION_GATES = [
+  "project:quality",
+  "quality",
+  "build",
+  "docs:format",
+  "test:format",
+  "trace:check",
+  "architecture:check",
+  "conformance:check",
+  "audit:check",
+  "package:check",
+] as const;
+
+/** 新しい形。`prepack`はbuildだけを行い、品質gateは`verify:distribution`が持つ。 */
+const DISTRIBUTION_PREPARE_COMMAND = "npm run build";
+
+/**
+ * `prepack`と配布前品質検証の組が、現行の形か新しい形のいずれかであることを検査する。
+ *
+ * **両方を受理するのは前方互換のためである。** 新しい形へ移すには`prepack`の内容を変える
+ * 必要があり、この検査自体がprotected fileにあるため、proposal registryによる二段階の
+ * 承認を経る。基盤段階でこの検査が両方を受理していなければ、activation段階が提出できない。
+ */
+function validateDistributionScripts(
+  scripts: Record<string, unknown>,
+): string[] {
+  const prepack = typeof scripts.prepack === "string" ? scripts.prepack : "";
+  const gates = DISTRIBUTION_GATES.map((gate) => `npm run ${gate}`).join(
+    " && ",
+  );
+  if (prepack === DISTRIBUTION_PREPARE_COMMAND) {
+    const errors: string[] = [];
+    if (scripts.prepare !== DISTRIBUTION_PREPARE_COMMAND)
+      errors.push(
+        `prepackを${DISTRIBUTION_PREPARE_COMMAND}にする場合、prepareも同じ内容が必要です`,
+      );
+    if (scripts["verify:distribution"] !== gates)
+      errors.push(
+        "verify:distributionは配布前品質gateを順序どおり完全一致で宣言しなければなりません",
+      );
+    return errors;
+  }
+  if (prepack !== gates) return ["prepack scriptを自己緩和できません"];
+  if (
+    scripts.prepare !== undefined &&
+    scripts.prepare !== DISTRIBUTION_PREPARE_COMMAND
+  )
+    return [`prepareは${DISTRIBUTION_PREPARE_COMMAND}でなければなりません`];
+  return [];
+}
+
 function readObject(file: string): Record<string, unknown> {
   const value = parseJsonStrict(fs.readFileSync(file, "utf8"), file);
   if (!isRecord(value)) throw new Error(`${file}はobjectでなければなりません`);
@@ -443,11 +498,7 @@
     errors.push(
       "quality scriptはlint→format→typecheck→source→testの順序が必要です",
     );
-  const prepack = typeof scripts.prepack === "string" ? scripts.prepack : "";
-  if (!prepack.startsWith("npm run project:quality && npm run quality && "))
-    errors.push(
-      "prepackはproject品質契約とqualityを先頭で実行しなければなりません",
-    );
+  errors.push(...validateDistributionScripts(scripts));
   checks.push("project choiceとpackage scriptの完全一致");
 
   const tsconfig = readObject(path.join(root, "tsconfig.json"));
```
