---
document_id: "19fe33d1-6d91-4988-9ca9-9661c6457c42"
---

# レビュー書: テンプレート群が runtime/ 名前空間に同居している（templates carve-out）

**プロジェクト名**: テンプレート群が runtime/ 名前空間に同居している
**作成日**: 2026年07月15日
**最終更新**: 2026年07月15日
**対応 GitHub Issue**: #103

> レビュー深度: **full**（enforcement 中核ファイル `PreToolUse.sh` R1 の変更・全 ROLE に影響。前々任/前任とは独立した第三者の目として検証し、実装者報告を鵜呑みにせず差分の再トレースとテスト再実行を行った）。
> レビューモデルティア: **opus**（本タスクは opus 固定で実行）。

---

## 1. レビュー概要

### 1.1 レビュー目的

`.agent-skill-chain/source/enforcement/claude/PreToolUse.sh` の R1 に追加された templates carve-out（配布物テンプレートの path-prefix 例外）と共通ヘルパ `r1_carveout_guard` 抽出リファクタが、(1) doc 分岐・templates 分岐の双方で振る舞いを変えていないか、(2) `templates-evil/` 等を誤許可しないか、(3) memo/`workflow.db*` の保護を後退させていないか、(4) R2（orchestrator 直接編集拒否）への到達を no-op フォールスルーで維持しているか、を独立に再検証する。

### 1.2 レビュー対象

- **実装範囲**:
  - `PreToolUse.sh`: 共通ヘルパ `r1_carveout_guard()` の新設（既存 doc 分岐インライン 4 分岐の振る舞い不変移送）、templates carve-out `elif` 分岐の追加、R1 コメント追記。
  - `enforcement/DESIGN.md`: templates carve-out の理由・設計方針の明文化（R1 節に 1 項追記）。
  - `test/test-pretooluse-hook.sh`: UC15 新設（jq/nojq 両経路）。
  - `00_要求定義.md`: branch frontmatter を実ブランチ名へ是正・`github_issue: "#103"` 追記。
- **レビュー担当**: 独立レビューエージェント（opus・第三者検証）。

---

## 2. 実装内容の確認（差分の独立再トレース）

### 2.1 実装完了タスク

| タスク | 実装内容 | ステータス |
| --- | --- | --- |
| T1: `r1_carveout_guard` 抽出 + doc 分岐リファクタ | symlink/hardlink 実体検査の 4 分岐を関数化し doc 分岐を 1 行呼び出しへ置換 | 完了 |
| T2: templates carve-out 分岐追加 | `.gitignore` 例外と汎用 runtime 分岐の**間**に path-prefix elif を挿入 | 完了 |
| T3: DESIGN.md・コメント明文化 | R1 節・R1 コードコメントに carve-out 理由を追記 | 完了 |
| T4: UC15 テスト新設 | jq/nojq 両経路で 42 代表・R2 独立性・保護維持・誤マッチ防止・memo 除外・絶対パス・symlink 耐性を検証 | 完了 |

### 2.2 独立再検証（実装者報告を鵜呑みにせず自ら差分を読んだ結果）

#### 観点(1): `r1_carveout_guard` 共通化が doc 分岐・templates 分岐で振る舞いを変えていないか — **CONFIRMED（振る舞い不変）**

`r1_carveout_guard()`（PreToolUse.sh 231〜246 行）の 3 block 条件は、リファクタ前の doc 分岐インライン実装（旧 348〜362 行）と論理的に完全一致する:

| 分岐 | 旧インライン（doc 分岐） | 新ヘルパ `r1_carveout_guard` |
| --- | --- | --- |
| ① unresolved symlink | `[[ -L "$PATH_TARGET" && -z "$R1_REAL" ]]` → block | `[[ -L "$path" && -z "$real" ]]` → block |
| ② 実体が memo/workflow.db* | `[[ -n "$R1_REAL" ]] && { */memo/* \|\| workflow.db* }` → block | `[[ -n "$real" ]] && { */memo/* \|\| workflow.db* }` → block |
| ③ nlink>1 hardlink | `[[ -f && ! -L ]] && r1_has_extra_hardlink` → block | 同一 → block |
| ④ 安全 | `else : # allow` | 条件全外れ → `return 0`（呼び出し側 `:`） |

差分は (a) 変数名（`R1_REAL`→`real`・`R1_REAL_BASE`→`real_base`、かつ `local` 化＝スコープ漏れ解消の改善のみ）、(b) 旧 `else :` が「条件不成立で関数末尾 `return 0`」へ移送、の 2 点のみで、いずれも観測可能な振る舞いを変えない。`block` は `exit 2` するため（PreToolUse.sh 24〜31 行で確認）、block 後に関数が return してフォールスルーする経路は存在しない。**回帰ガードである既存 UC13（doc carve-out）・UC14（symlink/hardlink 耐性）が jq/nojq 両経路で全 PASS**（§3）であり、リファクタの振る舞い不変を実測で裏付けた。

#### 観点(2): templates carve-out の path-prefix 判定が `templates-evil/` 等を誤許可しないか — **CONFIRMED（誤許可なし）**

分岐条件（PreToolUse.sh 380 行）:
```
elif { [[ "$PATH_TARGET" =~ \.agent-skill-chain/runtime/templates/ ]] || [[ "$PATH_TARGET" =~ /\.agent-skill-chain/runtime/templates/ ]]; } && [[ "$PATH_TARGET" != *"/memo/"* ]]; then
```
- 正規表現 RHS のメタ文字は先頭の `\.`（リテラルドット化）のみ。他は英数字・ハイフン・スラッシュのリテラルであり過剰マッチしない。
- 末尾スラッシュ `templates/` を要求するため、`runtime/templates-evil/x.md`（`templates` の後が `-evil`）・`runtime/mytemplates/x.md`（`runtime/` の後が `my...`）はいずれも `runtime/templates/` 部分文字列を含まず**分岐に入らない** → 汎用 runtime 分岐へ流れ basename 非該当で block。UC15 の誤マッチ防止 2 ケース（`templates-evil`・`mytemplates`）が両経路で exit 2 を実測。
- パストラバーサル `runtime/templates/../workflow.db` を仮に与えても、carve-out 進入後に `r1_carveout_guard` が `realpath -m` で `runtime/workflow.db` へ解決し real_base=`workflow.db` → `workflow.db*` 一致 → block。**path-prefix の緩さを実体検査が二重に塞いでいる**ことを確認。

#### 観点(3): memo/`workflow.db*` の保護が後退していないか — **CONFIRMED（後退なし・むしろ厳密側）**

- **memo**: templates 分岐条件に `&& [[ "$PATH_TARGET" != *"/memo/"* ]]` を課すため、`runtime/templates/x/memo/foo.md` は分岐に入らず汎用 runtime 分岐で block（UC15 実測 exit 2）。symlink で memo を指す場合も `r1_carveout_guard` の分岐②が block。
- **workflow.db\***: basename が `ALLOWED_DOC_BASENAMES` に無く汎用分岐で block。templates 配下に仮に `workflow.db` があっても `r1_carveout_guard` の real_base 一致で block（実際には templates/ に workflow.db は存在せず、防御は理論的エッジのみに作用）。UC15 実測で memo Edit・workflow.db Write ともに exit 2。
- 保護範囲は本変更の前後で不変（`/memo/`・`workflow.db*` の 2 点）。carve-out は保護対象を**広げていない**。

#### 観点(4): R2 到達が no-op フォールスルーで維持されているか（`allow()` 未使用） — **CONFIRMED（R2 独立性維持）**

templates 分岐本体（PreToolUse.sh 383〜384 行）は `r1_carveout_guard "$PATH_TARGET"` の後に `:`（no-op）のみで、`allow()`（`exit 0` 早期終了）を**使っていない**（`grep` で当該分岐に allow 呼び出しが無いことを確認）。よって carve-out 一致後もスクリプトは後続 R2（412 行 `if [[ "$ROLE" == "orchestrator" && "$IS_SUBAGENT" != "1" ]]`）へ必ず到達する。UC15 の「orchestrator の templates Edit → exit 2」が両経路で実測 PASS しており、**もし実装者が `allow()` を誤用していればこのケースは exit 0 となりテストが FAIL する**。PASS していることが no-op フォールスルーの動作証跡である。

---

## 3. テスト結果の確認（独立再実行）

実装者報告（192/0・6/0）を鵜呑みにせず、レビュー担当が自ら再実行した。

### 3.1 単体テスト `test/test-pretooluse-hook.sh`

- **実行コマンド**: `bash test/test-pretooluse-hook.sh`
- **結果**: `PASS=192 FAIL=0`（全テスト PASS）
- UC15（templates carve-out）の jq/nojq 両経路が全 PASS。回帰ガードの UC13/UC14 も全 PASS。
- テストは内部で `mktemp -d`（`$TMP`）隔離環境を構築し、symlink 実測も隔離ツリーで実施。「非破壊確認」ケースも PASS（本リポジトリ非破壊）。

### 3.2 E2E テスト `test/e2e-claude-hook.sh`

- **実行コマンド**: `bash test/e2e-claude-hook.sh`
- **結果**: `PASS=6 FAIL=0`（全テスト PASS）
- settings.json 配線経由の block/allow（orchestrator Write→block・memo Edit→block・doc Edit→allow）を実機相当の stdin JSON 注入で確認。

### 3.3 構文チェック

- `bash -n PreToolUse.sh` → syntax OK。

### 3.4 受け入れ基準・BDD とテストの対応（map-coverage）

| 01_要件 BDD | 対応テスト | 結果 |
| --- | --- | --- |
| UC1 シナリオ1（basename 非該当 templates を Edit → allow） | UC15 正常系 42 代表 5 ファイル（scribe_claude.md 等）＋絶対パス | PASS |
| UC1 シナリオ1 補足（R2 は迂回されない） | UC15 orchestrator templates Edit → exit 2 | PASS |
| UC1 シナリオ2（memo/workflow.db* は引き続き block） | UC15 memo Edit・workflow.db Write → exit 2、templates/x/memo → exit 2 | PASS |
| UC2 シナリオ1（名前空間規約の一貫性明文化） | DESIGN.md R1 節・R1 コードコメントへの追記（目視・grep 確認） | 反映済み |
| 03 T1 BDD（doc 名 symlink→workflow.db は block・振る舞い不変） | UC14（回帰）＋ UC15 templates symlink→workflow.db/memo | PASS |
| 誤マッチ防止（templates-evil/・mytemplates/） | UC15 境界値 2 ケース | PASS |

全 BDD シナリオがテストコード化され、対応が取れている（未対応シナリオなし）。ドキュメント明文化（UC2）のみ自動テスト非対象で、レビューでの目視確認とした旨が 03 に明記済み（テストコード化しない理由が記載されており監査観点を満たす）。

---

## 4. コードレビュー

### 4.1 コード品質

| 観点 | 確認内容 | 結果 | コメント |
| --- | --- | --- | --- |
| 可読性 | carve-out の意図（path-prefix・末尾スラッシュ・/memo/ 除外・no-op）をコメントで説明しているか | OK | R1 コメント（365〜375 行）・関数コメント（218〜229 行）に背景・限界を明記 |
| 保守性（DRY） | 実体検査重複を 1 ヘルパへ集約したか | OK | doc/templates 双方が `r1_carveout_guard` を共有。将来 carve-out 追加時も再利用可 |
| 単一責務 | ヘルパは実体検査のみ、分岐は一致判定のみに責務分離されているか | OK | 02_設計 §1.2 準拠 |
| CQRS（副作用なし） | 判定内で Write/Edit を行わないか | OK | `realpath`/`stat` の読み取りのみ |
| セキュリティ | carve-out で保護対象への穴を作っていないか | OK | §2.2 観点(3)。symlink/hardlink/traversal を実体解決で塞ぐ |

### 4.2 指摘事項

**ブロッキング指摘: なし（合格）。**

| # | 重要度 | 指摘 | 対応状況 |
| --- | --- | --- | --- |
| 1 | 低（非ブロッキング・既知の限界） | templates 配下の symlink が **runtime 外の任意ファイル**（例 `/etc/passwd`）を指す場合、carve-out は allow しフォールスルーする。ただしこれは既存 doc 分岐と同一のセマンティクスであり、R1 の保護対象（memo/workflow.db*）ではない外部ファイルは worker が元々直接編集可能なため権限昇格・保護後退にはならない。本変更が新規に導入したリスクではない。 | 対応不要（申し送り）。R1 の責務境界（runtime 内部の memo/workflow.db* 保護）の範囲外。 |
| 2 | 低（既知の限界・継承） | hardlink 検知は `nlink>1` の best-effort であり相手側リンク実体までは断定しない。`stat` 不在環境では省略。 | 対応不要。既存 `r1_has_extra_hardlink` の限界を継承（関数コメントに正直化済み）。真の防御は symlink 実体解決・R2/R3 role 軸・CI audit の多層。 |

---

## 5. ドキュメントの確認

### 5.1 更新状況

| ドキュメント | 更新状況 | 確認 |
| --- | --- | --- |
| `00_要求定義.md` | branch frontmatter を実ブランチ `worktree-agent-163639templates` へ是正・`github_issue: "#103"` 追記（機械監査 #35 整合） | OK |
| `01_要件定義.md` | 新規作成（document_id 付与済み） | OK |
| `02_設計.md` | 新規作成（ADR-1〜4・document_id 付与済み） | OK |
| `03_実装計画.md` | 新規作成（T1〜T4・BDD・document_id 付与済み） | OK |
| `enforcement/DESIGN.md` | R1 節へ templates carve-out を追記。既存の「保護対象 memo/workflow.db* のみ」記述は不変 | OK |
| `PreToolUse.sh` R1 コメント | 例外3として carve-out 理由を追記 | OK |

### 5.2 整合性

- 実装と 02_設計（ADR-1〜4）の整合: 整合（path-prefix 採用・basename allowlist 不変・共通ヘルパ抽出・/memo/ 除外・no-op フォールスルー、いずれも設計どおり）。
- 要件と実装の整合: 01 の受け入れ基準（編集手段の単一規約化・保護範囲不拡大・(a)/(b) 2 案検討）を全て充足。設計は (a) allowlist 拡張を ADR-1 で採用。
- フォーマット: 全成果物に document_id（UUID）付与済み。BDD は Given/When/Then インラインコメント付き（TEST_BDD_FORMAT 準拠）。memo プレフィックスは専用経路取得（過去 memo 群）。

---

## 6. 設計・境界の確認（review-architecture）

### 6.1 設計の確認

- **設計原則の準拠**: 単一責務（分岐＝一致判定／ヘルパ＝実体検査）・DRY（重複排除）・CQRS Query 側（副作用なし）を満たす。
- **ディレクトリ構成**: 変更なし（templates/ の物理配置は ADR-1 どおり不変。既存ファイル内部編集・既存テストへの追加のみ）。
- **命名規則**: `r1_carveout_guard` は既存の `r1_norm_path`・`r1_has_extra_hardlink` と同じ `r1_` 接頭辞のヘルパ層命名に整合。

### 6.2 境界・依存の確認

- **責務の境界**: 変更は R1 ブロックと新規ヘルパのみ。`parse_input`・ROLE/nonce 判定・R2〜R6・`is_in_project_allowlist`・`ALLOWED_DOC_BASENAMES` 文字列は不変（差分で確認）。
- **依存関係**: `r1_carveout_guard` は既存下位関数（`r1_norm_path`・`r1_has_extra_hardlink`・`block`）にのみ依存。循環参照なし。
- **分岐順序**: `.gitignore` 厳密一致 → templates carve-out → 汎用 runtime（doc allowlist）の elif 順で、templates を汎用より先に評価。`/memo/` を含む templates パスは意図どおり汎用分岐へ流れて block（ADR-4）。

### 6.3 重要判断の根拠（evidence_source）

| 判断 | evidence_source | 参照 |
| --- | --- | --- |
| 共通ヘルパ抽出が振る舞い不変 | existing_code + test_output | 差分再トレース（§2.2 観点1）・UC13/UC14 全 PASS |
| path-prefix が誤マッチしない | existing_code + test_output | 正規表現解析・UC15 誤マッチ防止ケース PASS |
| memo/workflow.db* 保護後退なし | existing_code + test_output | 分岐条件・guard 実体検査・UC15 保護維持ケース PASS |
| R2 独立性（no-op フォールスルー） | existing_code + test_output | `allow()` 未使用の目視確認・UC15 orchestrator ケース exit 2 |
| 192/0・6/0 | test_output | レビュー担当による再実行（§3） |

---

## 7. システム仕様書の更新（継続追随ゲート・DOCS_RULES §継続追随ゲート）

### 7.1 判定: **更新不要（軽量パス）・指摘 0 件**

- **対象システム仕様書**: `docs/04_機能設計/enforcement/README.md`（enforcement を記述する唯一の系統仕様書）。
- **根拠（evidence_source: existing_code）**: 当該仕様書は enforcement を **Layer1〜4 の抽象度**で記述し、R1 の path 軸個別ルール（runtime/ 配下の carve-out 群・`.gitignore` 例外・doc allowlist）を**列挙していない**（`grep -n "R1\|carve-out\|allowlist\|templates\|.gitignore\|memo\|workflow.db" docs/04_機能設計/enforcement/README.md` は 23 行の「書記経路一本化」1 件のみヒット＝R1 個別ルールの記述なしを実測）。本 templates carve-out は R1 の source 側洗練であり、仕様書が記述する抽象（Layer2 の exit 2 挙動・サブ委譲絶対強制＝R2・workflow.db 書記一本化）はいずれも**不変**。R1 の詳細正本は `enforcement/DESIGN.md`（本 issue で追随更新済み）にあり、docs/ とは抽象度の異なる別レイヤ文書のため二重管理不要。
- **先行整合**: 直前の R1 narrowing issue（#91・`docs/00_review/20260715_110423_review.md`）が同一仕様書に対し同一の軽量パス判定を下しており、本判定はその前例と整合する。
- **docs/README.md 更新履歴**: 版更新を伴わない軽量パスのため追記不要（DOCS_RULES §継続追随ゲート 4 は仕様書更新時の相互リンク要求で、更新不要判定には非適用）。
- **記録**: 本判定を `docs/00_review/20260715_134942_review.md` に記録し、`docs/00_review/README.md` 索引に追記した。

---

## 8. レビュー結果

### 8.1 総合評価

- **実装品質**: 良好。enforcement 中核への最小差分・既存機構の再利用・共通化による保守性向上。
- **テスト品質**: full レベルとして十分。UC15 新設（jq/nojq）＋既存 UC13/UC14 回帰、E2E 配線経路も PASS。
- **ドキュメント品質**: 良好。DESIGN.md・コードコメントに理由明文化。全成果物に document_id。
- **総合評価**: **合格（差し戻し不要）。** 4 観点すべて独立再検証で CONFIRMED。ブロッキング指摘なし。

### 8.2 差し戻し要否

- **差し戻し: 不要。** テスト 192/0・6/0 をレビュー担当が再実行で確認。差分の独立再トレースでも退行・保護後退・R2 迂回のいずれも検出されなかった。

---

## 9. 敵対的観点（アドバーサリアルレビュー）

- **反論1**: 「path-prefix は前方一致が緩く `runtime/templates/../../workflow.db` で保護対象を編集できるのでは」→ 該当パスは carve-out 進入後に `r1_carveout_guard` が `realpath -m` で `runtime/workflow.db` に解決し real_base=`workflow.db` 一致で block する。path 判定の緩さは実体検査が塞ぐ二層防御。
- **反論2**: 「共通ヘルパ抽出で doc 分岐の挙動が微妙に変わったのでは」→ 変数の `local` 化とスコープ以外の論理差分はなく、回帰ガード UC13/UC14 が両経路で全 PASS。`block` は `exit 2` するため block 後にフォールスルーする経路は構造的に存在しない。
- **反論3**: 「no-op ではなく allow() でも worker なら結局編集できるので同じでは」→ 違う。worker は同じでも orchestrator（IS_SUBAGENT!=1）では allow() だと R2 到達前に exit 0 して直接編集が素通りする退行になる。no-op ゆえに UC15 の orchestrator ケースが exit 2 になり、この退行が無いことをテストが保証している。
- **反論4**: 「templates 配下の symlink が /etc/passwd 等 runtime 外を指せば編集できてしまう」→ R1 の保護対象は runtime 内部の memo/workflow.db* であり、runtime 外ファイルは worker が元々直接編集可能。権限昇格ではなく既存 doc 分岐と同一セマンティクス（§4.2 指摘1）。

## 10. must-preserve（不変条件）

- `.agent-skill-chain/runtime/` 配下の `memo/` 配下・`workflow.db*` への直接 Edit/Write は本変更後も全 ROLE で block されること（UC15 保護維持ケース）。
- orchestrator（main・IS_SUBAGENT!=1）の runtime/templates 配下 Edit/Write は carve-out 後も R2 で block されること（no-op フォールスルー必須・`allow()` 不可）。
- doc allowlist carve-out の symlink/hardlink 実体すり替え耐性（UC14）は共通ヘルパ抽出後も維持されること。
- 末尾スラッシュ `templates/` 判定により `templates-evil/`・`mytemplates/` を carve-out に取り込まないこと。

---

## 11. 参考資料

- [`00_要求定義.md`](./00_要求定義.md) / [`01_要件定義.md`](./01_要件定義.md) / [`02_設計.md`](./02_設計.md) / [`03_実装計画.md`](./03_実装計画.md)
- `.agent-skill-chain/source/enforcement/claude/PreToolUse.sh`（R1・`r1_carveout_guard`）
- `.agent-skill-chain/source/enforcement/DESIGN.md`（R1 節・templates carve-out）
- `test/test-pretooluse-hook.sh`（UC13/UC14/UC15）・`test/e2e-claude-hook.sh`
- `docs/00_review/20260715_134942_review.md`（継続追随ゲート・軽量パス記録）
- 先行 issue: `docs/maintainer/workflow/close/20260715_095026_R1runtime直接編集禁止のBash強制がAutoModeBypass分類器と衝突/`（#91）

---

## 12. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

**最終更新**: 2026年07月15日
