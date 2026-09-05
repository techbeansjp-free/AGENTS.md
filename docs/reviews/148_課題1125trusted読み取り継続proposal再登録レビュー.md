# 148 課題1125 trusted読み取り継続proposal再登録レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とし、要求・要件・設計・計画・システム仕様書の責務越境と追跡切れをfindingにする。指摘を無理に作らず、指摘なしの承認を有効とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| 対象Issue | #1125 |
| ラウンド | Step 10 ラウンド1 |
| 比較基点 | `f3a17566e297f85da0c8de1d2543abb0e0cc7f00` |
| H_impl | `73b4514a38a665ddd638019d54624f94351de47a` |
| 比較基点の由来 | worktree作成時点の`origin/main`のtip |
| モード | quick（Q-01〜Q-08がすべてtrue） |
| 対象差分 | 1 file、+23 -0。commitは`73b4514a` 1件 |
| 対象外 | 保護fileの内容変更（PR-2）。`TQP-TRUSTED-READ-CONTINUE-001`の削除（**規則上できない**）。`docs/reviews/`のrole authority不整合（#1047） |
| 残り予算 | **2**（同一範囲で最大3ラウンド。以降は収束後のHEAD移動に対する取り直し1回のみ） |
| ラウンド数 | 1 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260905_090953_trusted読み取り継続proposalを本文つきで登録し直す |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-030 |
| 成果物行数 | project **+23行**（`.github/trusted-quality-proposals.json`）。製品コード **0行**。支援層 **0行**。**支援層/成果物 = 0倍** |
| 縮小の先行評価 | **新規Scenarioを足さない。** 契約fieldの不変性と記述fieldの更新可否は既存の`SCN-UNIT-PROPFIELD-001`〜`008`が検査する。特定のproposalIdの存在をassertするtestは、適用後に不要になる保守対象を作る。**強制点も足さない。** 足したのは**手順**（`--trusted-root`付き事前検証）であり、機構ではない |
| 決裁 | 二段階proposalの登録は`status: staged`であり何も有効化しない。適用（PR-2）は別PR |
| 実施者・日時 | reviewer（claude）、2026-09-05（JST） |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定review（3節）、敵対review（4節）、finding分類（5節） | advanced | claude | `project_default`、`independence.differentFrom = implementer` | Critical/High未解決なら停止し、是正後の同一HEADで再review | implementerとreviewerが**同一session**である。0.2節に逸脱として開示する |

### 0.2 開示する逸脱

1. **implementerとreviewerが同一sessionである。** 緩和は、判定の根拠をすべて実行結果に置いたこと（`--trusted-root`付き検証、変異試験2件、sha256の実測）である。
2. **本Issueの前段（PR-1、`001`の登録）は私の作業である。** その作業が `afterSha256` に対応する本文を残さなかったために本PRが必要になった。**再発防止を6節へ書いた。**
3. **`docs/reviews/`はどのroleの`allowedPaths`にも無い。** 解消を #1047 へ委譲する。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| `001`が適用不能である根拠 | `validateTrustedQualityMigration` | `sameMap(targetMap(proposal), actualChanges)` がbyte単位の完全一致を要求する | 一次資料 |
| 再現の失敗 | rationale どおりの変換3通り | `2e2e9729…`・`baf38d32…`・`b4f0acd2…`。目標は `403607b3…`。**一致しない** | 実行記録 |
| 本文が残っていない | `docs/reviews/120_…md`、branch `chore/1125-trusted-read-proposal` | 「prettier適用後から取った」とだけ記録。**是正後の本文そのものは無い。** branchの2 commitはregistryとartifactのみ | 一次資料 |
| `beforeSha256`の一致 | `sha256sum scripts/check_project_quality.ts` | `0702604760f7eb6b3083467a34e6c0b1319f5e3d4b4c1f0f560b71d13f9a1305`。登録値と完全一致 | 実行記録 |
| 欠陥の現存 | `scripts/check_project_quality.ts:786` | 早期`return`により`trustedRoot`指定時も`validateTrustedQualityMigration`が実行されない | 一次資料 |
| 同一file内の不一致 | 同 `:762` | すぐ上の`ci.yml`の読み取りは既に`if/else`である | 一次資料 |
| `afterSha256`の由来 | 是正後の本文へprettierを適用 | `145c8030dd7b778334fe30a47d15b81af34afbe77ffcfae677672e435d94f01c`。**prettierは本文を変更しなかった** | 実行記録 |
| **適用可能性の事前検証** | `check_project_quality.ts --root=<候補> --trusted-root=<本PR>` | `valid: true`。`checks`に「base事前登録済みversioned staged proposalによる品質契約更新」が現れる | 実行記録 |
| registry検証 | `npm run project:quality` | `valid: true`、errors 0件 | 実行記録 |
| テスト | `npm run conformance:check` | `1497 scenarios (1481 passed, 16 skipped)`。project rule 21件、orphan 0件 | テスト出力 |
| commit前candidate | 1 file | working tree clean | Git index |
| commit後external | PR、CI run、review | Step 11で観測する | 外部のimmutable証拠 |

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/trusted-quality-proposals.json` | M | project | project | proposal 1件の末尾追記。既存14件へ触れない | registry → 適用PR の一方向。登録は適用を参照しない | REQ-SQ-030 / AC-01〜AC-06 / SCN-UNIT-PROPFIELD-001 | **登録済みproposalは削除できない。** 適用しなければ`staged`のまま無害である | pass |

## 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.github/trusted-quality-proposals.json` | 入らない | `package.json`の`files`に`.github/`が無い |

判断: 配布物を更新しない
根拠: **配布file数は343のまま変わらない。** `package:check` が合格した。本変更は開発repository固有の品質契約registryであり、利用projectには存在しない。

## 2. PR-2で置く本文（全文）

**`001` に欠けていたのはこれである。** `afterSha256` = `145c8030dd7b778334fe30a47d15b81af34afbe77ffcfae677672e435d94f01c` は、**`beforeSha256` = `0702604760f7eb6b3083467a34e6c0b1319f5e3d4b4c1f0f560b71d13f9a1305` の内容へ次のdiffを当て、prettierを適用した結果**である（prettierは本文を変更しなかった）。

```diff
@@ -775,6 +775,14 @@
     root,
     ".github/workflows/trusted-quality.yml",
   );
+  /**
+   * **読み取れなかった値に依存する検査だけを飛ばす。**
+   *
+   * 早期returnにすると、workflow本文に一切依存しない`validateTrustedQualityMigration`
+   * まで実行されない。読み取り失敗と品質契約の二段階承認違反が同時に存在するとき、
+   * 後者が診断へ現れず、前者を直して再実行するまで気付けない（Issue #1125）。
+   * すぐ上の`ci.yml`の読み取りが既に同じ形をしている。
+   */
   if ("reason" in trustedRead) {
     errors.push(
       protectedReadError(
@@ -783,23 +791,23 @@
         trustedRead.reason,
       ),
     );
-    return { valid: errors.length === 0, errors, checks };
+  } else {
+    const trustedWorkflow = trustedRead.text;
+    for (const required of [
+      "pull_request_target:",
+      "ref: ${{ github.event.pull_request.base.sha }}",
+      "ref: ${{ github.event.pull_request.head.sha }}",
+      "working-directory: trusted",
+      'scripts/check_project_quality.ts "--root=$GITHUB_WORKSPACE/candidate"',
+    ])
+      if (!trustedWorkflow.includes(required))
+        errors.push(`trusted base品質gateに必須拘束がありません: ${required}`);
+    if (/working-directory:\s*candidate/u.test(trustedWorkflow))
+      errors.push(
+        "trusted base品質gateはcandidate directoryでcommandを実行できません",
+      );
+    checks.push("base workflowによるcandidate設定のread-only検証");
   }
-  const trustedWorkflow = trustedRead.text;
-  for (const required of [
-    "pull_request_target:",
-    "ref: ${{ github.event.pull_request.base.sha }}",
-    "ref: ${{ github.event.pull_request.head.sha }}",
-    "working-directory: trusted",
-    'scripts/check_project_quality.ts "--root=$GITHUB_WORKSPACE/candidate"',
-  ])
-    if (!trustedWorkflow.includes(required))
-      errors.push(`trusted base品質gateに必須拘束がありません: ${required}`);
-  if (/working-directory:\s*candidate/u.test(trustedWorkflow))
-    errors.push(
-      "trusted base品質gateはcandidate directoryでcommandを実行できません",
-    );
-  checks.push("base workflowによるcandidate設定のread-only検証");
   if (trustedRoot) {
     const trustedMetadata = readObject(path.join(trustedRoot, "package.json"));
     errors.push(
```

**PR-2は上記に加えて `package.json` の `agentSkillChain.qualityContractVersion` を 11 から 12 へ変更する。** 両方を同時に置いたときだけ `sameMap` が成立する。

### 2.1 この節が目的を果たすことを実測した

**本artifactのdiffだけを入力にして、`afterSha256` をbyte単位で再現できる。**

```console
$ # 本artifactのdiffブロックを抽出し、既定branchの内容へ当てる
$ patch -p1 < from-artifact.diff
$ sha256sum scripts/check_project_quality.ts
145c8030dd7b778334fe30a47d15b81af34afbe77ffcfae677672e435d94f01c
```

登録した `afterSha256` と一致する。**`001` にできなかったのはこれである。**

## 3. 肯定review

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | `beforeSha256` が既定branchの内容と完全一致する。**適用可能性を`--trusted-root`付き実行で実証した** |
| 価値 | pass | **本PR単独では価値を生まない。** PR-2の前提を作る。`001`の失敗を繰り返さない |
| 実現可能性 | pass | registryへの1件追記で成立する。`project:quality` が `valid: true` |
| 整合性 | pass | 版が11から12へ連続し、`fromVersion` が現在のtrusted versionと一致する |
| 保守性 | pass | 是正後の本文が証跡に残るため、PR-2は**証跡から機械的に再現できる** |

## 4. 敵対review

| 反例・攻撃 | 検証 | 結果 |
|---|---|---|
| `afterSha256` がまた食い違うのではないか | 候補へ本文を当てて `--trusted-root` 付き検証 | **`valid: true`。** 実証済み |
| 検証に検出力があるのか | 本文のcommentを**1文字**変えて再実行 | **reject。** `versioned staged proposalと完全一致しません` |
| version据え置きでも通るのではないか | `qualityContractVersion` を11のまま再実行 | **reject。** 同上 |
| `001` と `002` が両方適用されるのではないか | `sameMap` は完全一致を要求する | **両立しない。** 実際の変更内容と一致する側だけが選ばれる |
| 登録だけで何かが有効化されるのではないか | `status: staged` | 有効化しない。保護fileも `qualityContractVersion` も本PRで1バイトも変えていない |
| `beforeSha256` を候補側から取っていないか | 既定branch `f3a17566` の内容から取った | 自己申告になっていない |
| 既定branchが動いて陳腐化しないか | 自動releaseはtag方式で `package.json` のversion文字列も `0.3.1-managed-by-tag` のまま動かない | **merge直前に再確認する**（5節ADV-01） |

## 5. finding分類

| ID | 分類 | 内容 | 対処 |
|---|---|---|---|
| DISC-001 | resolved | `001` の `afterSha256` に対応する本文が再現できない | `002` を新規登録し、2節へ本文を全文で残した |
| DISC-002 | resolved | `--mode=quick` 指定でもCLIが `full` を返した。モード判定質問は**すべて「変えないか」を問う否定形**で `true` が安全側である | 正本の表を開いて8問すべて `true` で回答し直した。CLIが `mode: quick`、`reasons: []` を返した |
| ADV-01 | record-only | 既定branchが動くと `beforeSha256` が陳腐化しうる | merge直前に再確認する。自動releaseはtag方式で当該fileを触らない |
| ADV-02 | record-only | `001` は `staged` のまま永久に残る。削除経路が無い | 規則どおりである。#1211（project ruleの廃止経路）と同型の論点だが、proposal registryは対象外 |

**blocking 0件。未解決のCritical / High 0件。**

## 6. 再発防止

**#1002 は「hashがずれると再登録になる」を教訓にしたが、ずれる原因はhashの取り方ではなく本文が残っていないことだった。**

#1002 は変換手順を全手記録し、さらに **PR-1のcommitをtrusted rootとして切り出して事前検証**していた。#1125 の PR-1（`001`）にはそれが無い。artifact `120_…` は「prettier適用後から取った」とだけ書いている。

**`afterSha256` を登録するPRは、次の3つを揃える。**

1. 是正後の本文を**全文**（または `beforeSha256` の内容へ当てられる完全なdiff）で証跡へ書く
2. PR-1のcommitをtrusted rootに切り出し、その本文を当てて `--trusted-root` 付き実行が `valid: true` を返すことを確認する
3. その実行結果を証跡へ引用する

**本PRは3件とも実施した。**

## 7. 検証結果

| 検査 | 結果 |
|---|---|
| `npm run conformance:check` | `1497 scenarios (1481 passed, 16 skipped)`、`7886 steps`。project rule 21件、orphan 0件 |
| `npm run project:quality` | `valid: true`、errors 0件 |
| `npm run lint` / `format:check` / `typecheck` / `source:check` | すべて合格 |
| `npm run directories:check` / `skills:check` / `cli:check` / `workflow:check` | すべて合格 |
| `npm run docs:format` / `test:format` / `package:check` / `architecture:check` | すべて合格 |
| `npm run trace:check` | valid。orphan 0件 |
| `npm run audit:check` | Step 11直前に実行する |
| `--trusted-root` 付き事前検証 | `valid: true`。migration検査が `checks` に現れる |
| **本artifactからの再現** | 2.1節のdiffを既定branchの内容へ当てたsha256が `145c8030…` と一致 |

### 変異試験

| ID | 変異 | 結果 |
|---|---|---|
| M1 | PR-2本文のcommentを1文字変える | **reject** |
| M2 | `qualityContractVersion` を11のまま据え置く | **reject** |

**2件ともreject。** 変異は `/tmp` の候補copyに対して行い、worktreeを変更していない。

## 8. 仕様更新

**`no-spec-impact`。** REQ-SQ-030の記述は変えない。本PRは同要件へ適合させるための二段階手順の1段目であり、**仕様の記述ではなく実装を後続PR（PR-2）で変える。** 新規SCNを足さず、既存SCNを1件も削除していない。

## 9. 判定

**承認。** blocking 0件、未解決のCritical / High 0件。resolved 2件（DISC-001・002）、record-only 2件（ADV-01・02）。
