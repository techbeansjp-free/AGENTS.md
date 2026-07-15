---
document_id: "6f4805cc-0761-41b8-9cc9-126b9bbcc6b1"
---

# レビュー書: R1 の runtime/ 直接編集禁止（Bash heredoc 強制）と Auto Mode Bypass 分類器の構造的衝突の解消

**プロジェクト名**: R1 の runtime/ 直接編集禁止（Bash heredoc 強制）と Auto Mode Bypass 分類器の構造的衝突の解消
**作成日**: 2026 年 07 月 15 日
**最終更新**: 2026 年 07 月 15 日

> **重要**: **このドキュメントは常に更新**: レビューで発見した問題点や改善提案、対応内容などがあった場合は、即座に本ドキュメントを更新すること。
>
> **必須**: 本レビューは [.agent-skill-chain/source/REVIEW_RULE.md](../../../../.agent-skill-chain/source/REVIEW_RULE.md) に従う。レビュー深度: **standard**（enforcement 中核 1 ファイル + ルール文書 3 件 + テスト 2 件の変更。regression 面が広いため軽量パスは採らない）。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認 / 品質保証 / クローズ前最終チェック。前々任（要求〜設計〜review-docs）・前任（implement-feature）とは**独立した第三者の目**として、実装成果物（PreToolUse.sh の R1 carve-out ほか）が 02_設計・03_実装計画・01_要件定義と整合し、テストが再現性を持って全件パスすることを、報告の鵜呑みなしに自ら検証する。

### 1.2 レビュー対象（必須）

- **実装範囲**: R1（PreToolUse.sh の `.agent-skill-chain/runtime/` 配下 Edit/Write 一律禁止）を、保護が実際に必要な対象（memo・workflow.db\*）のみに絞った basename allowlist 方式へ narrowing。あわせて run_command.md §Constraints・enforcement/DESIGN.md・README.md の追随更新、test-pretooluse-hook.sh・e2e-claude-hook.sh の回帰テスト追加。
- **レビュー期間**: 2026-07-15
- **レビュー担当者**: verify-and-close 担当サブエージェント（opus ティア・独立検証）

### 1.3 検証した変更ファイル（git diff --stat 実測）

| ファイル | 追加/削除 | 種別 |
| -------- | --------- | ---- |
| `.agent-skill-chain/source/enforcement/claude/PreToolUse.sh` | +26/-5 相当 | 実装（carve-out 本体） |
| `.agent-skill-chain/source/enforcement/DESIGN.md` | +4 | 設計文書追随 |
| `.agent-skill-chain/source/enforcement/README.md` | +1 | 仕様追随 |
| `.agent-skill-chain/source/skills/agent/run_command.md` | +4/-1 | 委譲手順の非迂回化 |
| `test/test-pretooluse-hook.sh` | +100 相当 | UC3 期待反転・UC8 差替・UC13 新設 |
| `test/e2e-claude-hook.sh` | +18/-6 | C-3 memo 差替・doc allow 追加 |

---

## 2. 実装内容の確認

### 2.1 実装完了タスク

| タスク名 | 実装内容 | ステータス |
| -------- | -------- | ---------- |
| タスク1: PreToolUse.sh carve-out | R1 の runtime/ block に、basename allowlist（10 件）厳密一致 かつ `/memo/` 非包含での no-op フォールスルー allow を追加 | 完了 |
| タスク2: run_command.md 更新 | memo・workflow.db は Bash 必須／issue ドキュメントは Edit/Write 可、と区別する記述へ更新 | 完了 |
| タスク3: DESIGN.md・README.md 追随 | carve-out・フォールスルー制約・ROLE=unknown 残存リスクを追記 | 完了 |
| タスク4: 単体テスト | UC3 期待反転・UC8 ケース3 差替・UC13 新設（jq/nojq 両系統） | 完了 |
| タスク5: E2E テスト | 配線経由の memo block 差替・00_要求定義.md allow 追加 | 完了 |

### 2.2 実装内容の詳細（独立コードトレース）

#### タスク1: PreToolUse.sh の carve-out（PreToolUse.sh 264〜296 行）

- **allowlist の実体**: `ALLOWED_DOC_BASENAMES="00_要求定義.md 00_システム理解.md 01_要件定義.md 02_設計.md 03_実装計画.md 04_review.md 05_最終確認チェックリスト.md 90_issues.md 99_PR.md 99_PR_review.md"`（277 行）。**`.agent-skill-chain/runtime/templates/` 直下の issue ドキュメント 10 件と完全一致することを実測確認**（`ls` 結果と 1:1 対応。非ドキュメント（AGENTS_MERMAID_RULES.md・agents・docs・github・指摘対応）は正しく除外。`指摘対応/` 配下テンプレートは 90_issues の 00_要求定義.md に埋め込まれる別実体でないため除外、を ADR-2 で確認済み）。
- **判定ロジック（283〜294 行）**: basename を `${PATH_TARGET##*/}` で抽出 → allowlist と厳密一致（`==` の quoted RHS＝リテラル比較・glob 無効）でループ照合 → `R1_DOC_ALLOWED==1` かつ `PATH_TARGET != *"/memo/"*` の場合のみ `:`（no-op）で allow、それ以外は `block`。
- **確認事項**: basename 抽出は前方一致でなく完全一致のため `00_要求定義.md.bak` は不一致→block（過剰許可なし）。`/memo/` は前後スラッシュ要求のため `memo2/`・`mymemo/` の lookalike を誤検知せず、実 `memo/` 配下は正しく block。

#### 独立検証項目4（no-op フォールスルー・R2 独立性）の制御フロー追跡 — 【最重要・CONFIRMED】

タスク指示の核心である「carve-out が `allow()` 早期 exit ではなく no-op フォールスルーで実装され、R2 が carve-out 通過後も独立評価されること」を、実際の制御フローを行単位で追って確認した。

- **carve-out の allow は 291 行の `:`（no-op）であり、`allow()`（32〜35 行＝`exit 0`）を呼んでいない**ことを実コードで確認。
- R1 ブロック（278〜296 行）と R2 ブロック（306〜341 行）は**別個の `if` 文**であり、R1 が `exit` しない限り制御は必ず R2 に到達する。
- **orchestrator（`ROLE=="orchestrator" && IS_SUBAGENT!="1"`）が `00_要求定義.md` を Edit するケースを手トレース**: R1 で `R1_DOC_ALLOWED=1` かつ `/memo/` 非包含 → `:`（allow, no exit）→ フォールスルー → R2 の `case "$TOOL"` で `Edit|Write|...` に一致 → `block`（exit 2）。carve-out は orchestrator 自身の直接編集を素通りさせない。
- これを**実機で再現**: `UC13[jq]/[nojq]: orchestrator の 00_要求定義.md Edit は carve-out 後も exit 2（R2独立性）` が PASS。逆に carve-out が `allow()`（early exit 0）で実装されていれば本テストは exit 0 で FAIL するはずであり、テストが「フォールスルー実装であること」を実効的に固定化していることを確認した。

**結論**: 独立検証項目4は CONFIRMED。実装は設計 ADR-1 の必須実装制約（フォールスルー方式）を正しく満たす。

#### タスク2/3: ルール文書の追随

- `run_command.md §Constraints`: 従来の「runtime/ 配下は Edit/Write 不可・Bash heredoc で書け」の単一指示を、(a) memo・workflow.db\* は Bash 必須 / (b) issue ドキュメント（10 basename 明示）は Edit/Write 可、の 2 分岐へ更新。**これにより「Edit/Write 制限を Bash で回避せよ」という Auto Mode Bypass 分類器のシグネチャに一致する文面が正規委譲手順から除去された**（ストーリー1 の達成手段）。
- `DESIGN.md`・`README.md`: carve-out の保護範囲・フォールスルー実装制約・ROLE=unknown 残存リスクを追記。#18 の結論（非対称は意図的設計）を否定せず「保護範囲を絞る追加の洗練」と明記（ストーリー3・BR-5 の達成）。

---

## 3. テスト結果の確認（自ら再実行・再現性検証）

前任の「全件パス」報告を鵜呑みにせず、本エージェントが**自ら両テストを実行**して再現した。

### 3.1 単体テスト: `test/test-pretooluse-hook.sh`

- **実行日**: 2026-07-15
- **結果**: **PASS=134 / FAIL=0**（`全テスト PASS`・exit 0）
- **本 issue 関連の新規/変更テスト（全 PASS を確認）**:
  - UC3: `memo Edit は exit 2`（旧 00_要求定義.md 対象から memo へ差替）／`00_要求定義.md の Edit は exit 0（carve-out）`
  - UC8 ケース3: `subagent worker の memo Edit は exit 2（R1 保護対象は不変）`（agent_id 付きでも memo は block 維持）
  - UC13（jq/nojq 各8件）: サブ issue 配下 02_設計.md allow・`.bak` 偽装 block・workflow.db block・**orchestrator doc Edit は R2 で block**・unknown role の doc allow（残存リスク固定化）・unknown role の memo block・memo2 lookalike 非誤 block・05_最終確認チェックリスト.md allow（allowlist 網羅性）
- **非破壊**: 全テストが `/tmp` 隔離下で実行され本リポ .agents hook を触っていないことをテスト自身が PASS で確認。

### 3.2 E2E テスト: `test/e2e-claude-hook.sh`

- **実行日**: 2026-07-15
- **結果**: **PASS=6 / FAIL=0**（`全テスト PASS`・exit 0）
- **本 issue 関連**: `C-3: 配線経由 memo 直接 Edit は exit 2（block・保護維持）`／`C-3: 配線経由 00_要求定義.md の Edit は exit 0（allow）`。settings.json 実配線経由の stdin JSON 注入で carve-out が実機相当に機能することを確認。

### 3.3 判定

両テストとも本エージェントの手元で**再現性を持って全件 PASS**。テスト未実行のまま監査完了とはしていない。

---

## 4. 受け入れ基準の確認（map-coverage: BDD ↔ 実装・テスト）

| ストーリー / 受け入れ基準 | 実装での担保 | テストでの担保 | 判定 |
| -------- | -------- | -------- | ---- |
| S1: 正規委譲が Bash 迂回シグネチャに構造上該当しない | run_command.md の 2 分岐化（issue ドキュメントは Edit/Write 可） | UC3 doc allow・UC13 各 allow・E2E doc allow | OK |
| S1: 00〜04 の Edit/Write が許可される | PreToolUse.sh carve-out（allowlist・フォールスルー） | UC3 `00_要求定義.md exit 0`・UC13 `02_設計.md`/`05_...md` allow | OK |
| S2: memo への Edit/Write は block 維持 | allowlist 非包含 + `/memo/` 非包含判定 | UC3 memo exit2・UC8 memo exit2・UC13 unknown memo exit2・E2E memo block | OK |
| S2: workflow.db(-wal/-shm) への Edit/Write は block 維持 | basename が allowlist 外 | UC13 `workflow.db exit2` | OK |
| S2: R2〜R6 は変更されない | R1 ブロック内に閉じた変更（ADR-3）・R2 は独立 if | UC13 orchestrator doc exit2（R2 発火）・既存 R2〜R6 テスト全 PASS | OK |
| S3: #18 論点（保護目的の有無）と本 issue 論点（保護範囲の広さ）が別軸と明記 | DESIGN.md 追記・02_設計 ADR-1 の #18 整合節 | ドキュメント審査（テスト対象外の受け入れ基準） | OK |
| S3: R1 の保護目的を否定する記述を含まない | DESIGN.md「設計判断そのものを覆すものではない」明記 | 同上 | OK |
| 境界: 前方一致偽装（`.bak`）を誤許可しない | basename 完全一致 | UC13 `.bak exit2` | OK |
| 残存リスク: ROLE=unknown の doc allow を固定化 | ADR-1 で受容・明記 | UC13 `unknown doc exit0`（挙動固定） | OK |

**カバレッジ欠落**: 検出なし。01 の BDD 全シナリオ（UC1 シナリオ1/2、UC2 シナリオ1）が実装・テストへ対応済み。S3 の 2 基準はドキュメント記述の性質上テスト非対象だが、成果物審査で充足を確認。

---

## 5. 設計・境界の確認（review-architecture）

- **ADR-1（保護範囲を memo・workflow.db\* に絞る）との整合**: 実装は allowlist 10 basename + `/memo/` 非包含で、memo・workflow.db\* を allowlist から除外。ADR と一致。フォールスルー実装制約（ADR-1 必須制約）も §2.2 のとおり満たす。
- **ADR-2（basename 厳密一致 + `/memo/` 非包含）との整合**: 実装は緩い正規表現・拡張子のみ判定・数字前方一致のいずれも採らず、固定集合との `==` 厳密一致。ADR-2 の採用選択肢と一致。`/memo/` 非包含の頑健性（lookalike 非誤検知）も UC13 memo2 テストで実証。
- **既存 `.gitignore` 例外との一貫性**: 既存 ADR-3 例外（279〜280 行）は `:` no-op フォールスルーで allow。新設 carve-out（290〜291 行）も同型の `:` no-op。**同一の審査済みパターンを踏襲**しており、新しい判定様式を持ち込んでいない。判定順序も (1).gitignore 厳密一致 → (2)doc allowlist + /memo/ 非包含 → (3)block、と設計 §フロー図どおり。
- **R2 との独立性（path 軸 vs role 軸）**: DESIGN.md の「R1（path 軸・全 ROLE）と R2/R3(b)（role 軸・subagent 除外）は目的の異なる独立ガード」という既存設計思想を維持。carve-out は R1 の path 軸内の narrowing に閉じ、role 軸（R2）を変更しない。
- **境界の逸脱なし**: 変更は R1 ブロック内 + 追随文書 + テストに限定。認証・認可（scribe nonce・R2 allowlist）に非接触。

---

## 6. 発見した指摘

**実装ロジックの欠陥: なし（差し戻し不要）。** 独立コードトレース・両テスト再実行・設計整合確認のいずれからも、実装ロジックの重大欠陥・回帰・設計乖離は検出されなかった。記述レベルの軽微な修正も不要（allowlist は templates と完全一致、コメントと実装が一致、日英併記・フォールスルー制約コメントが正確）。

**受容済み残存リスク（新規指摘ではない・設計で明示受容済み）**: ROLE=unknown 時、doc basename への Edit/Write が新たに allow される（従来は R1 の役割非依存防衛線で block）。ADR-1・DESIGN.md・UC13 テストで受容・固定化済み。正規配備（`enforce on` で `AGENT_ROLE=orchestrator` 静的配線）では unknown は主に手動・テスト環境に限られ、memo・workflow.db\* 保護は ROLE 非依存で維持されるため保護目的の中核は不変。本レビューでも受容判断を妥当と確認する。

---

## 7. 分類器バイパス検討の非該当確認

本 issue の解決方針は「フレームワーク自身の設計・ルールを変更し、正規委譲が Bash 迂回パターンに構造上該当しない形にする」ことに限られ（BR-1）、Auto Mode Bypass 分類器そのものの回避・権限緩和・false positive の押し通しは検討・採用されていないことを確認した。本レビューでも分類器バイパス・回避策の検討や提案は一切行っていない。

---

## 8. 監査観点（PHASES）の充足

- **全シナリオのテストコード化の網羅**: 01 の全 BDD シナリオが UC3/UC8/UC13/E2E に対応（§4 の対応表）。jq 有/無の両系統で同一合否を検証。
- **フォーマットの正しさ**: 00〜03 は frontmatter（document_id）を保持。本 04_review も document_id 付きでテンプレート構成（レビュー概要・実装内容・テスト結果・受け入れ基準・設計確認・システム仕様書更新）に準拠。
- **証跡**: 本 04_review 作成後に write-workflow-log（step5）で workflow.db へ記録（MODEL_TIER=opus）。

---

## 9. システム仕様書（docs/）の更新 — 継続追随ゲート判定

[DOCS_RULES.md §継続追随ゲート](../../../../.agent-skill-chain/source/DOCS_RULES.md) に基づき、本 issue の実装変更がシステム仕様書（`docs/`）の記載範囲に影響するかを判定した。

- **照合対象**: `docs/04_機能設計/enforcement/README.md`（enforcement を記述する唯一の系統ドキュメント）。
- **判定**: **更新不要（軽量パス）**。
- **根拠（evidence_source: existing_code）**: 当該仕様書は enforcement を**レイヤ/ポリシーの抽象度**（Layer1〜4 の役割・「PreToolUse は違反なら exit 2」・「サブ委譲の絶対強制」・「書記経路の一本化＝workflow.db 書込は書記ラッパーのみ」）で記述しており、**R1 の path 軸の個別ルール（runtime/ 配下の basename 単位の allow/block）を列挙していない**（`grep` で R1・gitignore・「直接編集」等の記述が当該ファイルに存在しないことを実測確認）。本 issue の変更は R1 の適用範囲を doc basename について狭めるものだが、仕様書が記述する抽象（Layer2 の exit 2 挙動・R2 の絶対強制・workflow.db 書記一本化）はいずれも不変であり、workflow.db 保護は明示的に維持されている。したがって仕様書の記載範囲に影響しない。R1 の詳細正本は `.agent-skill-chain/source/enforcement/DESIGN.md`・`README.md`（本 issue で追随更新済み）にあり、そちらで整合が取れている。
- **記録**: 本判定 1 件を `docs/00_review/` に軽量パス記録として追記する。

---

## 10. クローズ推奨

- **実装ロジックの欠陥・回帰・設計乖離: 検出なし。** 差し戻し不要。
- **テスト: 単体 134/134・E2E 6/6 を本エージェントが再実行し全件 PASS を再現。**
- **設計整合: ADR-1〜3・BR-1〜5・C-1〜6 を満たすことを確認。** フォールスルー実装制約・R2 独立性を実コードトレースで CONFIRMED。
- **継続追随ゲート: 軽量パス（更新不要）通過。**

**推奨: 本 issue はクローズ可。orchestrator はコミット・PR 作成へ進んでよい（マージはユーザー判断）。**

---

## 12. CodeRabbit 指摘（PR #92・profile: CHILL）への対応

PR #92 に対する CodeRabbit（自動レビュー）の指摘 2 件のうち、指摘1（symlink/hardlink 耐性）への対応を記録する。指摘2（テストカバレッジ）は `test/test-pretooluse-hook.sh` へのテストケース追加で対応済み（別コミット）。

### 12.1 指摘1: R1 carve-out の symlink/hardlink 耐性

**指摘内容**: R1 の doc basename allowlist 判定（PreToolUse.sh）は `file_path` 文字列の basename のみを見ており、realpath 解決を行わない。symlink/hardlink で basename を詐称すれば、実体が memo・workflow.db\* であっても allowlist に一致させて carve-out を通過できる余地があるのではないか。

**独立検証結果（本エージェントが実コードを再確認）**:

- 基名抽出は実際に文字列演算のみで、realpath 解決を経ない。PreToolUse.sh 282 行 `R1_BASENAME="${PATH_TARGET##*/}"` で `PATH_TARGET`（stdin JSON の `tool_input.file_path` をそのまま抽出した値）から `##*/` によるパス区切り文字までの前方一致除去を行うのみであり、シンボリックリンク先の実体パスを解決する処理（`realpath`/`readlink -f` 等）は R1 のこの判定経路に存在しない。指摘は事実として妥当。
- 一方、symlink/hardlink を作成する `ln` コマンドの実行には Bash が必要である。PreToolUse.sh の Bash 実行判定（R3、352〜406 行）を確認すると、Bash を無条件 allow されるのは 395〜398 行の `(b) 非 scribe の subagent worker（IS_SUBAGENT=1）` のみである。この分岐に該当する worker は scribe 専用の R4/R5 制約（コマンド単独実行制約・複合シェル禁止）を一切適用されず、任意のシェルコマンドを実行できる。
- 他ロールは symlink を作成できない: orchestrator（main）は 322〜324 行および 399〜401 行で Bash 実行そのものが block される。scribe は 353〜394 行で `write-workflow-log.sh` の単独実行のみに制限され（R4 で複合コマンド禁止・R5 で第 1 トークンの realpath が正本パスと厳密一致することを要求）、`ln -s` 等の任意コマンドは実行できない。unknown/env-worker 等その他ロールは 402〜404 行で Bash 実行自体が block される。
- したがって、symlink/hardlink で R1 carve-out の basename 判定を回避できる主体は「Bash を無制限に allow されている非 scribe subagent worker」のみに限定される。しかし、この worker は symlink 経路を使わずとも、Bash 経由で `.agent-skill-chain/runtime/` 配下の memo・workflow.db\* に直接書込可能である（R1 は `TOOL == "Edit" || "Write"` の場合のみ判定対象とし、Bash 経由のファイル書込＝`cat >`/`echo >>` 等はそもそも R1 の対象外であるため、278 行の条件分岐に入らず素通りする）。ゆえに symlink 経路を追加で使っても、到達可能な書込先集合は「その worker が既に Bash で直接到達できる範囲」を超えて拡大しない＝新規の権限昇格は生じない。

**判定**: 指摘1は理論上の指摘として正しいが、実害を検証した結果、既存のロール権限モデル（R2/R3 の role 軸）の下では新規の権限昇格を生まないため、**残存リスクとして受容し、コード変更は行わない**。R5（scribe 経路）が同種の basename/symlink 詐称攻撃を realpath 正規化（370〜393 行の `norm_path()`）で既に封じているのと同じパターンを R1 の doc carve-out にも適用する defense-in-depth は、コストに対して実効性の低い（到達可能集合を変えない）硬化であるため、本 issue のスコープでは対応せず、将来課題として申し送る。



- [00_要求定義.md](./00_要求定義.md) / [01_要件定義.md](./01_要件定義.md) / [02_設計.md](./02_設計.md) / [03_実装計画.md](./03_実装計画.md)
- [.agent-skill-chain/source/enforcement/claude/PreToolUse.sh](../../../../.agent-skill-chain/source/enforcement/claude/PreToolUse.sh)
- [.agent-skill-chain/source/REVIEW_RULE.md](../../../../.agent-skill-chain/source/REVIEW_RULE.md) / [DOCS_RULES.md](../../../../.agent-skill-chain/source/DOCS_RULES.md)

---

**最終更新**: 2026 年 07 月 15 日
