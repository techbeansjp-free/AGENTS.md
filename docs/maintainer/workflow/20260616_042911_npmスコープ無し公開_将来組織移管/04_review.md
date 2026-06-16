---
document_id: "b96cf67e-f4b1-46e8-bb9f-831173ae0a61"
---

# レビュー書: npm スコープ無し公開・将来組織移管（agent-skill-chain 改名＋自動リリース＋C 群補強）

**プロジェクト名**: npm スコープ無し公開・将来組織移管
**作成日**: 2026 年 06 月 16 日
**最終更新**: 2026 年 06 月 16 日

> レビュー深度: **full**（パッケージ名変更・CI リリースフロー・enforcement 強化という後方互換／配布物に直結する高影響変更のため）。
> 二観点（[REVIEW_DUAL_LENS.md](../../../../.agents/REVIEW_DUAL_LENS.md)）必須。敵対的観点リスト・must-preserve リストを §9.4/§9.5 に記載。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認 / 品質保証 / 配布（publish）前最終チェック。Part1（A 改名・B release.yml・C-1/C-2/C-6）＋ Part2（C-3/C-4/C-5/C-7・gen_entry_hash 共有化）の実装が 02/03 設計どおりか、受け入れ基準 SC-1〜14・BDD UC1〜11 を満たすかを独立に検証する。

### 1.2 レビュー対象（必須）

- **実装範囲**: A 改名 `agent-skill-chain`（bin `agents-md` 据え置き）、B release.yml 案C 自動リリース全面改訂、C-1 強制力マトリクス、C-2 description/README 是正、C-3 hook E2E ハーネス、C-4 バイパス耐性（パス正規化＋AGENT_ROLE nonce）、C-5 audit/doctor 強化、C-6 audit.yml 同梱、C-7 NDJSON export、gen_entry_hash 共有関数化（N-D）。
- **レビュー期間**: 2026-06-16 ～ 2026-06-16
- **レビュー担当者**: verify-and-close worker（fresh サブ・独立検証）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク

| タスク | 実装内容 | 実装日 | ステータス |
| ------ | -------- | ------ | ---------- |
| T1 改名A | package.json name=agent-skill-chain・lock 同期・src 例示是正・README/SETUP/RELEASE/adapters 波及・RELEASE §0.1 移管手順 | 2026-06-16 | 完了 |
| T2 release.yml B | 案C 自動リリース（version patch / 日時タグ / publish public / NPM_TOKEN ゲート / tag==pkg 撤去） | 2026-06-16 | 完了 |
| T3 C-1/C-2 | enforcement/README §ツール別強制力マトリクス（3 区分）／description・README 段階配備＋CI 最終保証へ是正 | 2026-06-16 | 完了 |
| T4 C-4 | PreToolUse.sh R5 正規化絶対パス比較＋AGENT_ROLE nonce 出所制御・回帰テスト | 2026-06-16 | 完了 |
| T5 C-5 | src/agents-md.ts に audit/doctor 強化（spawnSync 透過・hash チェーン・integrity）→build で bin 反映 | 2026-06-16 | 完了 |
| T6 C-7 | export-ndjson.sh ＋ CLI export ・検証テスト | 2026-06-16 | 完了 |
| T7 C-3 | test/e2e-claude-hook.sh ＋ docs/maintainer/claude-hook-e2e.md | 2026-06-16 | 完了 |
| T8 C-6 | .workflow/templates/github/workflows/audit.yml 同梱（allowlist 内・pack 収録） | 2026-06-16 | 完了 |
| T9 仕上げ | run-all.sh に新規 4 テスト登録・gen-entry-hash.sh 共有化 | 2026-06-16 | 完了 |

### 2.2 実装内容の詳細（要点）

- **改名（A）**: `package.json:name` のみ変更。`bin.agents-md` / `files` allowlist / `engines.node>=20` / `publishConfig.access=public` / `license=MIT` はいずれも不変（§9.5 must-preserve で実測確認）。`printHelp()` 内の bin 名 `agents-md` は据え置き。
- **release.yml（B）**: `on.push.branches=[main]`、release-npm（13 step）→ release-marketplace。`npm version patch`（semver）と 日時タグ `vYYYYMMDD.HHMMSS`（JST）を分離。`tag==pkg` 比較は両ジョブから撤去（grep 0 件・新フローでは不変条件として成立しないため撤去が正当）。
- **C-4**: R5 を realpath 正規化＋実行 cwd 起点の許可正本パス一致へ。AGENT_ROLE=scribe は nonce 一致時のみ採用、不一致は unknown 降格。R4（複合シェル）/R6（sqlite3 直接）の順序・挙動は非破壊。
- **gen_entry_hash 共有化（N-D）**: `.agents/scripts/gen-entry-hash.sh` を単一正本化し write-workflow-log.sh / doctor / export が source。14 フィールド連結式は同一。

---

## 3. テスト結果の確認

### 3.1 単体・結合・E2E（独立再実行・実測）

本レビューで自分で実行した結果（自己申告を鵜呑みにしない）。

- **実行日**: 2026-06-16
- **`bash test/run-all.sh`**: 合計=**12 PASS=12 FAIL=0 SKIP=0**（EXIT 0。初回実装時 11 → セキュリティ是正で `test-write-workflow-log-glob.sh` 追加し 12）。e2e-install-uninstall は 88 サブ PASS を含む。詳細な再実測は §10.4 を参照。
- **`npm run typecheck`（tsc --noEmit）**: PASS（EXIT 0）。
- **`npm run build`（tsc && chmod）**: PASS（EXIT 0・bin 再生成）。
- **`.agents/scripts/verify-npm-pack.sh`**: PASS（EXIT 0・**169 files**・禁止パターン無し・必須正本あり）。
- **`npm pack --dry-run --json`**: `audit.yml` / `gen-entry-hash.sh` / `export-ndjson.sh` が収録。`test/`・`docs/maintainer` の混入は 0 件。

#### 個別独立再実行

- **test-c4-bypass-resistance.sh**: PASS=10 FAIL=0（C-4a 5・C-4b 3・回帰 R4/R6 2）。
- **doctor 実機 DB**: 健全 DB で integrity_check=ok、hash チェーン=整合（179 行）、read-only（md5 不変）を実測。

### 3.2 失敗したテスト

なし（FAIL=0）。

---

## 4. コードレビュー

### 4.1 コード品質

- **型チェック**: 0 エラー / 0 警告（tsc --noEmit PASS）。
- **ビルド**: 成功。

#### コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| ---- | -------- | ---- | -------- |
| 可読性 | 新規スクリプトのコメント・関数分離（block()/allow()・gen_entry_hash 単一正本） | OK | |
| 保守性 | hash 式を 1 か所に集約（再実装禁止・N-D）し write-workflow-log/doctor/export が source | OK | 退行リスクを構造的に低減 |
| パフォーマンス | export/doctor は read-only・同期処理（spec/06 準拠） | OK | |
| セキュリティ | C-4 で相対/symlink/bash -c/AGENT_ROLE 偽装の各回避を block。CI audit の env 偽装非検知は既知残存リスクとして正直記述＋外部証跡で補強 | OK | §9.4 D-3 参照 |

### 4.2 指摘事項

#### 指摘 1: audit #26（src/agents-md.ts コメント外部参照）の FAIL は HEAD 既存・本 issue 範囲外

- **重要度**: 低（スコープ規律の確認事項）
- **指摘内容**: `bash .agents/enforcement/ci/audit.sh` で `src/agents-md.ts` のコメント 5 箇所（working tree 行 546/573/575/610/623）が #26（CODE_COMMENT_RULES `.md` 参照禁止）で FAIL する。
- **裏取り結論**: **HEAD 既存の pre-existing FAIL であり本 issue で新規発生していない**。`git show HEAD:src/agents-md.ts` を一時的に working tree へ差し替えて audit を実行したところ、**同一コメント**（agents-core.mdc・README.md・SKILL.md・AGENTS.md を含む `.md` 名）が HEAD でも #26 FAIL（HEAD 行 270/297/299/334/347）することを実測確認。検証後 working tree の src は完全復元（diff 一致）。Part1/Part2 の新規コメントは `.sh`/`.sql`/シンボルのみで `.md` を含まず、新規 #26 ヒットを増やしていない。
- **対応状況**: **本 issue では修正しない（スコープ規律）**。既存事象であり、別 issue で扱う。

#### 指摘 2: audit「04_review 未更新」FAIL は本 04 作成で解消

- **重要度**: 低
- **指摘内容**: audit が当該 issue に 04_review.md 必須と FAIL していた。
- **対応状況**: 本ファイル（04_review.md）の作成と write-workflow-log により解消する（verify-and-close 完了で消える設計どおりの FAIL）。

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認 |
| ------------ | -------- | ---- |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み | SC-1〜14・移管手順・SC-2 判定範囲を明記 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み | US/UC・BDD（UC1〜11）・NDJSON 出力形式 |
| [`02_設計.md`](./02_設計.md) | 更新済み | §3.1〜3.9・C-4 二防御分離・hash 共有 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み | T1〜T9・SC↔テスト対応表 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合（02/03 のタスク・SC マッピングと実装が一致。設計逸脱なし）。
- **要件と実装の整合性**: 整合（§8 受け入れ基準カバレッジ表参照・欠落ゼロ）。

---

## docs 更新

- 要否: **不要**
- 対象: なし
- 理由: 本変更はパッケージ正本（package.json/CI/enforcement/CLI）の改修であり、`docs/`（システム仕様書）の機能仕様には影響しない。保守者向け文書（RELEASE.md §0.1・adapters.md・claude-hook-e2e.md）は本 issue 実装の一部として更新済み。

---

## 8. 受け入れ基準カバレッジ（SC-1〜14・BDD UC1〜11）

| SC | BDD | 検証方法（本レビューで独立実測） | 結果 |
| -- | --- | -------------------------------- | ---- |
| SC-1 name | UC1/UC2 | `node -e` で name=agent-skill-chain・`npm view agent-skill-chain version`=404（空き） | OK |
| SC-2 旧名ゼロ | UC2 | `git ls-files \| grep -v close/ \| xargs grep -lI '@techbeansjp-free/agents-md'` = 0 件 | OK |
| SC-3 pack | UC3 | verify-npm-pack.sh EXIT 0・169 files・allowlist 内・禁止パターン 0 | OK |
| SC-4 移管手順 | UC1 | RELEASE.md §0.1 に unscoped 名移管・404 確認・owner 付け替え（名前不変）記載（テストコード化不可・ドキュメント存在確認） | OK |
| SC-5 名前確定理由 | UC1 | 00/01 に第一候補 agents-md 空き確認・確定名 agent-skill-chain・理由記載 | OK |
| SC-6 自動リリース | UC4 | release.yml YAML 妥当・jobs=[release-npm, release-marketplace]・on.push.branches=[main]・version patch/日時タグ/publish public/NPM_TOKEN ゲート存在 | OK |
| SC-7 バージョニング | UC4 | semver patch と 日時タグ分離・`tag==pkg` 比較撤去 grep 0 件 | OK |
| SC-8 マトリクス | UC5 | enforcement/README §ツール別強制力マトリクス（3 区分キーワード 9 hit）＋ README リンク | OK |
| SC-9 表現是正 | UC6 | 旧誤読「向けに配備する」= package.json/README とも 0 件・段階配備＋CI 最終保証表現あり | OK |
| SC-10 hook E2E | UC7 | e2e-claude-hook.sh PASS（配線経由 block/allow 5 件）＋ claude-hook-e2e.md 存在 | OK |
| SC-11 バイパス耐性 | UC8 | test-c4-bypass-resistance.sh PASS=10（正規化比較＋nonce 出所制御＋回帰） | OK |
| SC-12 audit/doctor | UC9 | test-cli-audit-doctor.sh PASS＋doctor 実機 DB で hash/integrity 検証 | OK |
| SC-13 CI テンプレ | UC10 | audit.yml が allowlist 内・pack 収録（dry-run JSON で確認） | OK |
| SC-14 export | UC11 | test-export-ndjson.sh PASS（NDJSON 妥当・連鎖・順序・read-only） | OK |

**欠落: ゼロ**。SC 対象外の線引き（実機 hook 実行・実 Secrets 登録・実 publish はユーザー操作前提）は守られている。本レビューでは合成環境・dry-run・read-only に留め、実 publish や実機発火は行っていない。

---

## 9. 設計・境界の確認

### 9.1 設計の確認

- **設計原則の準拠**: OK。C-7 export は read-only・同期（spec/06「単純な同期で十分なら導入しない」準拠）。hash 式は単一正本化（重複排除・UNIX 哲学）。
- **ディレクトリ構成**: OK。新規スクリプトは `.agents/scripts/`（配布物 allowlist 内）、テストは `test/`（非配布）、E2E 手順文書は `docs/maintainer/`（非配布）。
- **命名規則**: OK。

### 9.2 境界・依存の確認

- **責務の境界**: OK。`workflow_log` への書き込みは write-workflow-log.sh のみ（不変）、C-7 export は読み出し専用、doctor は read-only。
- **依存関係**: OK。write-workflow-log/doctor/export が gen-entry-hash.sh を source（再実装禁止）。循環なし。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| -------- | --------------- | ---- |
| 全テスト PASS（11/11） | test_output | 本レビューで `bash test/run-all.sh` 独立実行 |
| gen_entry_hash 後方互換（179 行 hash 不変・整合） | observed_runtime | doctor を実機 DB に対し実行・md5 不変確認 |
| C-4 各回避ベクタ block | test_output | test-c4-bypass-resistance.sh 独立実行 PASS=10 |
| audit #26 が HEAD 既存 | existing_code / test_output | HEAD src を差し替えて audit 実行・同一 FAIL を実測 |
| SC-1 name 空き | observed_runtime | `npm view` 404 実測 |
| must-preserve 維持 | existing_code | package.json 実フィールド読取で確認 |

### 9.4 敵対的観点リスト（反証・破壊を試みた観点と結論）

- **D-1 改名でビルド・bin 起動が壊れていないか** → typecheck/build PASS、bin 名 `agents-md` 不変、e2e-install-uninstall 88 サブ PASS。退行なし。
- **D-2 lock とのバージョン/名前不整合** → verify-npm-pack PASS、JSON 妥当、name 同期確認。問題なし。
- **D-3 C-4 で正当な scribe 経路を誤 block していないか** → test で cwd 起点相対 allow・nonce 一致 allow・nonce 未配線後方互換 allow を確認。**さらに本フェーズの書記（write-workflow-log）実行が成功すること自体が正当 scribe 経路の非誤 block の実証**（§後述 write-workflow-log 証跡）。
- **D-4 gen_entry_hash 共有化で既存チェーンが壊れないか（最重要退行点）** → doctor で 179 行全行の entry_hash/prev_hash 整合を実測。式は 14 フィールド同一。壊れていない。
- **D-5 release.yml の `tag==pkg` 撤去が安全性を落とさないか** → 新フローは semver patch と 日時タグを分離するため当該不変条件は元々成立せず、撤去が正当（02 §3.2 設計どおり）。publish は `npm view name@version` で冪等 skip、NPM_TOKEN 未設定で安全 skip。
- **D-6 audit に本 issue 由来の新規 FAIL がないか** → #26 のみ FAIL だが HEAD 既存と裏取り済み（指摘 1）。本 issue 由来の新規 FAIL は無い。「04_review 未更新」は本 04 作成で解消。
- **D-7 pack に test/docs が混入していないか** → dry-run JSON で 0 件確認。allowlist 内に限定。

- **D-8 nonce 出所分離が偽装を本当に塞ぐか（HIGH 是正の最重要点）** → クリーン tmp 再現で、是正前に成立した「env 同値偽装」（§10.2 (b)）が **block** されることを実測。正規経路（c）は allow、enforce on/off で nonce 生成・削除を実測。塞がれている。
- **D-9 GIT_RANGE 検証が正当 range を誤って弾かないか** → `HEAD~1..HEAD`・`main..HEAD` が WARN なしで素通りを実測。`--output=`/`;` 注入は攻撃ファイル未生成。退行なし。
- **D-10 SHA ピンの射程はスコープ内に限定されているか** → release/self-enforce の `@v4` 残存 0。templates 配下の `@v4` はタスク named 外で意図的に未変更（過剰変更を避けた）。
- **D-11 `.scribe-nonce` が配布物に漏れないか** → pack dry-run で 0 件・gitignore＋allowlist 二重除外を実測。漏洩なし。

**敵対的結論**: must-fix は無し。検出した FAIL は全て既存（#26）または本フェーズで解消（04 未更新）であり、本 issue 実装・セキュリティ是正の退行・設計逸脱・検知力低下は認められない。セキュリティ是正は HIGH の偽装経路を実測で塞ぎ、MEDIUM/LOW も独立確認で解消。

### 9.5 must-preserve リスト（不変条件・ラウンド継承＋本レビュー追加）

実装前ドキュメントレビュー各ラウンドから継承し、本検証で実測確認した不変条件。

| must-preserve | 確認方法 | 結果 |
| ------------- | -------- | ---- |
| bin 名 `agents-md` 据え置き | package.json bin 読取 | 維持（`{"agents-md":"bin/agents-md.js"}`） |
| files allowlist 不変 | package.json files 読取 | 維持（`.agents/`,AGENTS.md,CLAUDE.md,`.workflow/templates/`,bin/,README.md） |
| engines node>=20 | package.json engines 読取 | 維持 |
| publishConfig.access=public | package.json 読取 | 維持 |
| license MIT | package.json 読取 | 維持 |
| 既存ガード R4/R5/R6 の順序・挙動 | test-c4-bypass-resistance 回帰・test-pretooluse-hook 32 件 | 維持（非破壊） |
| 正本のみ編集＋アダプタ再生成（手編集禁止） | build-adapters.sh で再生成・diff 確認 | 維持 |
| close 不改変 | 本 issue は close 配下を変更せず | 維持 |
| workflow_log schema 不変 | C-7 は read-only・schema.sql 準拠 | 維持 |
| gen_entry_hash 式同一（14 フィールド） | doctor で 179 行整合実測・`git diff gen-entry-hash.sh` 空 | 維持 |
| 既存 R5 正規化比較・nonce 後方互換（ファイル/期待 nonce 無配線時は従来 allow） | tmp 再現で nonce 無配線時 allow（後方互換）を確認 | 維持 |
| `.scribe-nonce` 非配布（gitignore＋allowlist） | pack dry-run 0 件・`git check-ignore` | 維持 |
| release/self-enforce 以外の workflow（ci-check 等）は不変 | git diff 対象外 | 維持 |

**must-preserve 結論**: 全不変条件を維持。セキュリティ是正は既存ガード（R4/R5/R6・後方互換 nonce・gen_entry_hash 式）を非破壊で拡張し、退行なし。

### アダプタ再生成の結果

- `.adapters/`・`.claude/` はいずれも gitignore 対象（`git check-ignore` 確認）＝git 影響なし。
- `bash .agents/scripts/build-adapters.sh` を 2 回実行し **決定性 diff ゼロ**（run1 vs run2 で `diff -r` 一致）。
- `.adapters/{claude,cursor}/.agents/enforcement/claude/PreToolUse.sh` が正本と **MATCH**。新規 `gen-entry-hash.sh`/`export-ndjson.sh` も同梱を確認。
- 正規フロー `bash .agents/scripts/setup.sh` で `.claude/hooks/PreToolUse.sh` を最新化し、**正本と diff 一致（MATCH）**。実行前は旧版（112 行）で stale だったが、再生成で C-4 版（217 行）へ同期。
- 副作用確認: `workflow.db`（md5 不変・179 行維持）、`.claude/settings.json`（不変）。tmp 隔離方針に留意し本番 DB・設定を破壊していない（手編集なし・正規スクリプト経由のみ）。

---

## 10. publish 前セキュリティ是正の検証（再 verify-and-close）

publish 直前に実施したセキュリティ脆弱性是正（HIGH 1・MEDIUM 2・LOW 1）の反映を受け、本レビューで**独立に再検証**した結果。是正対象は §02 §3.6.2・SC-11・enforcement/README・claude-hook-e2e.md・03 へ正直化反映済み。証跡 memo: `memo/20260616_093808_publish前セキュリティ是正.md`。

### 10.1 検証サマリ（独立実測・2026-06-16）

| 是正 | 内容 | 独立検証結果 |
| ---- | ---- | ------------ |
| **HIGH** | AGENT_ROLE nonce 出所分離（期待 nonce=ファイル `${AGENTS_ROOT}/.scribe-nonce`[0600] 優先・実 nonce=env） | **解消確認**（下記 10.2 でクリーン tmp 再現） |
| **MEDIUM** | `audit.sh` GIT_RANGE 許可パターン検証（不正は HEAD~1..HEAD へ無害化＋WARN） | **解消確認**（`--output=`/`;` 注入で攻撃ファイル未生成・正当 range 素通り） |
| **MEDIUM** | `release.yml`/`self-enforce.yml` の action を SHA ピン | **解消確認**（両ファイルの `uses: ...@v4` 残存 **0**） |
| **LOW** | `write-workflow-log.sh` `to_json_array` に `set -f`（noglob） | **解消確認**（`*`/`?`/`[..]` 文字どおり記録・通常分割は後方互換） |

### 10.2 HIGH 解消の独立再現（クリーン tmp 隔離・`mktemp -d`＋`git archive HEAD`）

`PreToolUse.sh`（働き木の C-4b 版）を `git archive HEAD` 展開ツリーへ重ね、`{tool_name:Bash, command:<canonical write-workflow-log.sh>}` の stdin JSON を投入して再現。

- **(a') 素朴 `export AGENT_ROLE=scribe`（`.scribe-nonce` ファイル存在・実 nonce 未知）** → **block（exit 2）**。ROLE が unknown へ降格し `only scribe may run Bash` で拒否。
- **(b) env だけ掌握し `AGENTS_SCRIBE_NONCE`=`AGENTS_EXPECTED_SCRIBE_NONCE` を同値に揃える（是正前に偽装成立した経路）** → **block（exit 2）**。期待値は**ファイル出所**から読むため env 同値では一致できず、是正前の偽装が**塞がれた**ことを確認。
- **(c) 正規（env 実 nonce == ファイル期待 nonce）** → **allow（exit 0）**。正当 scribe 経路は誤 block しない。

**enforce on/off ライフサイクル**（クリーン tmp・ビルド済 bin 使用）:

- `enforce on`: `.agents/.scribe-nonce` を **0600** で生成、`settings.json` env `AGENTS_SCRIBE_NONCE` に**同値リテラル**を配線（別出所・同値・MATCH 実測）、`AGENTS_EXPECTED_SCRIBE_NONCE` は settings に**不在**（false）。再 `on` で nonce が**ローテート**することも確認。
- `enforce off`: `.scribe-nonce` を**削除**（実測 DELETED）。

**HIGH の限界（正直化の確認）**: env 空間全体＋0600 ファイル読取まで掌握できる相手への完全防御ではない旨が 02 §3.6.2 item2・SC-11 表・enforcement/README・claude-hook-e2e.md に明記され、過剰主張（「nonce を知らないため scribe になれない」）が除去されていることを確認。最終保証は CI audit ＋ 外部証跡（NDJSON export/署名/append-only）。

### 10.3 MEDIUM/LOW/SHA ピンの独立確認

- **GIT_RANGE**: クリーン tmp で `AUDIT_GIT_RANGE='--output=/tmp/PWNED HEAD'` および `'HEAD; touch ...'` を投入 → いずれも WARN で無害化、**攻撃ファイル未生成**。正当 `HEAD~1..HEAD`・`main..HEAD` は WARN なしで素通り。
- **glob**: `test/test-write-workflow-log-glob.sh` PASS=3（`*`/`?`/`[..]` 非展開・通常カンマ分割の後方互換）。
- **SHA ピン**: `release.yml`（checkout 2・setup-node 2）・`self-enforce.yml`（checkout 1・setup-node 1）が `@34e11487…#v4.3.1`・`@49933ea5…#v4.4.0` でピン済み。両ファイルの `uses: ...@v4` 残存 **0 件**。`.workflow/templates/github/workflows/`（ci-check/audit/subagent-guard）の `@v4` は**本是正のスコープ外**（タスクで named されたのは release/self-enforce のみ）。

### 10.4 テスト・型・pack の独立再実行（実測）

- **`bash test/run-all.sh`**: 合計=**12 PASS=12 FAIL=0 SKIP=0**（既存 11＋新規 `test-write-workflow-log-glob.sh`）。
- **`test/test-c4-bypass-resistance.sh`**: PASS=**13**（file 出所一致 allow／env 同値でもファイル不一致 block／ファイル優先 の 3 ケース追加・既存 block 非破壊）。
- **`test/test-audit.sh`**: PASS=**21**（正当 range 非破壊／`--output=` 無害化／`;` 無害化 の 3 ケース追加）。
- **`npm run typecheck`**: PASS（EXIT 0）。**`npm run build`**: PASS（bin 再生成）。
- **`verify-npm-pack.sh`**: PASS（EXIT 0・**169 files**・禁止パターン 0・必須正本あり）。
- **`npm pack --dry-run --json`**: `.scribe-nonce` **非混入**（grep 0 件）。`.scribe-nonce` は `.gitignore`（`/.agents/.scribe-nonce`）＋ files allowlist で二重除外（`git check-ignore` 確認）。

### 10.5 監査（audit.sh 再実行）

- `bash .agents/enforcement/ci/audit.sh` 実行 → **本 issue 由来の新規 FAIL なし**。FAIL は #26（`src/agents-md.ts` の `.md`/`.mdc` 言及コメント・行 547/574/576/611/624）のみ。
- **#26 は HEAD 既存の偽陽性**（別 issue「audit残骸チェック偽陽性是正」で起票済み・スコープ外）。当該 FAIL 行は HEAD の同一コメント（行 546/573/575…）であり、セキュリティ是正による +1 行シフトのみ。是正コード（nonce/GIT_RANGE/glob/SHA ピン）は新規 `.md` 参照を追加していない。

### 10.6 アダプタ再生成（正本変更に伴う・gitignore 対象）

- `PreToolUse.sh`・`settings.enforce.json` の変更に伴い `build-adapters.sh`・`setup.sh` を正規フローで実行（手編集なし）。
- `.adapters/{claude,cursor}/.agents/enforcement/claude/PreToolUse.sh` が正本と **MATCH**。`.adapters/{claude,cursor}/.agents/platforms/claude/settings.enforce.json` も正本と **MATCH**（`AGENTS_EXPECTED_SCRIBE_NONCE` 不在も含め一致）。
- `setup.sh` で `.claude/hooks/PreToolUse.sh` を最新化し正本と **MATCH**。
- `.adapters/`・`.claude/` は `git check-ignore` で**いずれも無視**＝**git 影響なし**（`git status` のトラッキング差分は正本ソース・テスト・issue ドキュメントのみ）。

### 10.7 SC-1〜14 カバレッジの維持確認

是正後も §8 の SC-1〜14 カバレッジは**全 OK 維持**。特に **SC-11（バイパス耐性）**は是正で強化（出所分離追加・PASS=13 へ）され、限界記述が正直化された。他 SC（name/pack/release/audit/export 等）は是正の影響を受けず不変。must-preserve（§9.5）も全維持（gen-entry-hash.sh 無変更＝14 フィールド式同一を `git diff` 空で確認）。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（設計逸脱なし・型/ビルド/テスト全通過）。
- **テスト品質**: 良好（**12/12 PASS**・SC 全カバー・回帰テスト追加。c4-bypass=13・audit=21・glob=3 の独立再実測）。
- **セキュリティ**: publish 前是正（HIGH/MEDIUM×2/LOW）を独立再現で解消確認。HIGH は是正前の env 同値偽装を実測で block・正規経路 allow・enforce on/off の nonce 生成削除を確認。限界も正直化済み。**publish go（セキュリティ的に問題なし）**。
- **ドキュメント品質**: 良好（00〜03 と実装の整合・SC↔テスト対応表）。
- **総合評価**: **クローズ可（合格）**。must-fix なし。

### 12.2 承認状況

- **レビュー承認者**: verify-and-close worker（fresh サブ・独立検証）
- **承認日**: 2026-06-16
- **承認コメント**: 受け入れ基準 SC-1〜14・BDD UC1〜11 を欠落ゼロで満たし、must-preserve 不変条件を全維持。audit #26 は HEAD 既存（裏取り済み・範囲外）。コミットは orchestrator が別途実施。

---

## 13. 参考資料

- [`00_要求定義.md`](./00_要求定義.md) / [`01_要件定義.md`](./01_要件定義.md) / [`02_設計.md`](./02_設計.md) / [`03_実装計画.md`](./03_実装計画.md)
- 実装証跡 memo: `memo/20260616_064615_実装Part1_…`・`memo/20260616_071017_実装Part2_…`
- [REVIEW_DUAL_LENS.md](../../../../.agents/REVIEW_DUAL_LENS.md)

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md)（実装計画 → 実装 Part1/Part2 完了）

---

## 15. 次のステップ

- コミット（1 論理コミット・feature ブランチ・push はユーザー明示時のみ）を orchestrator が実施。
- 実 publish・Secrets 登録・実機 hook 実行はユーザー操作（SC 対象外）。
