---
document_id: "9a1c7e4d-52b8-4f6a-8d3e-1b6c9f0a4e77"
---

# レビュー: .agent-skill-chain プロジェクト固有上書き・モデル選定方針の整合

**前のステップ**: [03_実装計画.md](./03_実装計画.md)
**対応 GitHub Issue**: #147

---

## 1. 完了判定サマリー

F-1〜F-12（12件）・D-11・D-12（計14件）すべてを実装した。02_設計.md の対応方針（推奨案）どおりであり、D-12 のみユーザー承認済みの Plan C（フォールバック案）で実施した。非所有ファイル（`enforcement/ci/audit.sh`・`ledger/schema.sql`・`scripts/write-workflow-log.sh`・`enforcement/README.md`・`source/COVERAGE_AND_EXCEPTIONS.md`）は変更していない。

---

## 2. 敵対的観点リスト（自己レビューで検証した観点と結果）

| # | 観点 | 検証方法 | 結果 |
|---|------|----------|------|
| 1 | F-4/F-5 の source↔project 参照が新たな循環を生んでいないか | MODEL_SELECTION.md → MODEL_TIER_TABLE.md の参照方向と、MODEL_TIER_TABLE.md → MODEL_SELECTION.md の参照方向を目視で突合 | 一方向であることを確認（MODEL_SELECTION は「project の当該節に定める」と参照するのみで実体を持たない。project 側は実体を持つが source を正本として参照し返さない）。循環なし。 |
| 2 | F-1 の新規5行が F-3 チェックリストを一貫して参照しているか（役割ごとに恣意的な基準を作っていないか） | MODEL_TIER_TABLE.md の対応表を通読 | 要求・要件執筆／issue起票／調査／chore／デフォルトの5行すべてが `§opus 要否判定チェックリスト` へのアンカーリンクで参照しており、個別基準の重複定義なし。 |
| 3 | F-6 のメタデータ形式化が既存の grandfather 救済機構（audit.sh）を壊していないか | `enforcement/ci/audit.sh` の `check_worktree_branch_naming()` を実際に読み、`_gf["$gl"]=1` が完全一致キーであることを確認したうえで、実データ25行を実際にシェルで再現パースし、変更前と同じ25個のキーが得られることを検証 | 当初案（1行に `名前 \| 理由 \| 日付 \| PR` を収める形式）だと完全一致照合が壊れることが判明したため、メタデータをブランチ名の直前コメント行に退避する形式へ設計を具体化して実装。実データで検証済み、壊れていない。 |
| 4 | F-9 で COV-001 を台帳表外に移した結果、`test/coverage-check.sh` の `EXCLUDE_PATHS` との二重化整合性（正本 §1「片方だけの除外は禁止」）が崩れていないか | `EXCLUDE_PATHS` の実データを確認 | COV-001（test/）はそもそも `INCLUDE_PATHS` 配下ではないため元から `EXCLUDE_PATHS` に記載が無く、台帳表からの移設によって二重化状態が変化しない（移設前後で `--exclude-path` 指定不要という扱いは同一）。COV-004 も同様に `--exclude-path` 指定不要としており、二重化ルールとの矛盾なし。 |
| 5 | D-12 で新設した「role×effort 受け皿」が EFFORT_POLICY.md の「コアに具体値を置かない」原則と矛盾していないか | EFFORT_POLICY.md 本文を確認 | 具体対応表（Effort列の値）は MODEL_TIER_TABLE.md（project 側）にのみ置き、EFFORT_POLICY.md（source/コア）には具体値を記載していない。原則と整合。 |
| 6 | F-11 の置換がリポ全体の `.agents` 表記を壊していないか（source 配下の別称使用箇所に誤って波及していないか） | `grep -rn "\.agents\b"` を CLAUDE.md・AGENTS.md に対して実行 | 対象2ファイルに `.agents` の残存なし。source 配下（README.md 見出し等、非所有）は意図的に変更していない（02_設計.md F-11 推奨案Aどおり）。 |
| 7 | 新規追加した相対リンクが全て実在ファイルへ解決するか | 変更6ファイルの新規リンクを機械抽出し実在確認 → さらにリポ全体を対象に `check-relative-links.sh` を実行 | 変更ファイルの新規リンクは全て解決。リポ全体走査（124ファイル・533リンク・アンカー検査ON）でも切れリンク0件。 |
| 8 | D-12 のスコープが「ledger/audit には触れない」という承認条件を実際に守れているか | `git diff --stat` で変更ファイル一覧を確認 | 変更9ファイルは全て承認された実装対象ファイルのみ。`ledger/schema.sql`・`scripts/write-workflow-log.sh`・`enforcement/ci/audit.sh` はいずれも `git status` に現れず未変更。 |
| 9 | F-2 の COV-004 追加によって、かえって「audit.sh 自身も分母に含めるべきでは」という別の議論を招かないか（過剰主張していないか） | COV-004 の文言を確認 | 「台帳なし除外の禁止に抵触しないための明示」に留め、「enforcement 配下を将来的に分母に含めるべき」という規範的主張はしていない（台帳の代替保証欄で self-enforce CI による間接検証を根拠として記載するのみ）。過剰主張なし。 |
| 10 | F-7 の継承物受け渡し機構が、既存の AGENT_CONDUCT.md の転記規範（B-9系の指摘対象）と矛盾する新たな二重定義を生んでいないか | OPERATING_PRINCIPLES.md (e) 節の文言を確認 | 「AGENT_CONDUCT.md が定める転記対象と同様」と参照する形にとどめ、転記の対象・様式そのものは複製していない（越境しての新定義はしていない）。 |

---

## 3. must-preserve リスト（今回の変更で維持しなければならない既存事項）

- **MODEL_TIER_TABLE.md の既存4行**（設計・レビュー・監査／システム仕様書処理／実装／書記）の記述内容・根拠は変更していない（Effort 列の追加のみ）。
- **fable 行の既存例外条件**（「ユーザーが個別issueを『最重要』と明示指定した場合」）は削除せず維持し、F-12 で新条件を追加のみ行った（既存条件の弱体化ではなく拡張）。
- **COVERAGE_EXCEPTIONS.md の既存 COV-002・COV-003 の内容**（列の値）は一切変更していない。
- **worktree-naming-grandfather.txt の【第1部】25ブランチ名**は元の値・順序を維持し、追記・削除していない（実データ検証で確認済み）。
- **CLAUDE.md・AGENTS.md の `.agent-skill-chain/project` 優先原則そのもの**（「.agents より優先」→「.agent-skill-chain/source より優先」という表記統一のみ）は変更せず、優先順位の意味・挙動は一切変えていない。
- **MODEL_SELECTION.md・EFFORT_POLICY.md の既存原則本文**（適用条件・ティア明記義務・品質ゲート最上位・別次元性等）は変更せず、フォールバック・参照確定・非対称性の追記のみを行った。
- **非所有ファイル（enforcement/README.md・enforcement/ci/audit.sh・ledger/schema.sql・scripts/write-workflow-log.sh・source/COVERAGE_AND_EXCEPTIONS.md）**は一切編集していない（02_設計.md §4 の所有境界どおり）。

---

## 4. 申し送り事項（本パッケージ外・連携が必要な事項）

- **enforcement/README.md の #40 記述**: 「`gh pr checkout` 由来等の外部名や既存名は...追記して救済（Tier3 allowlist）」という記述に、本パッケージで新設したメタデータ必須形式（理由・日付・PR/承認をコメント行に記載）への言及がない。enforcement パッケージ側での追随を推奨する（02_設計.md §4 で申し送り済みの事項の再確認）。
- **D-12 の ledger/audit 実装**: `effort`/`effort_rationale` の ledger 記録欄追加・audit 検査対象化は、#145（台帳記録整合強化）または enforcement パッケージでの実施が必要（本パッケージでは着手していない）。

---

## 5. 実装先 commit

- worktree: `/home/adachi/projects/AGENTS.md/.worktree/chore/20260718_092843-プロジェクト上書きモデル選定整合/`
- ブランチ: `chore/20260718_092843-プロジェクト上書きモデル選定整合`
- コミットハッシュ: `8d844ea`（"fix(project/model-selection): project固有上書き・モデル選定方針の指摘14件を是正 (Issue #147)"）
