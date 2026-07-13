---
document_id: "3a721b7e-b943-43aa-83ad-526b77b95531"
issue_id: "c0b8c9e0-7170-4e14-a876-11a1721532a4"
---

# レビュー書: README.md の読者分離

**プロジェクト名**: README.md の読者分離
**作成日**: 2026 年 07 月 12 日
**最終更新**: 2026 年 07 月 12 日

> **必須**: レビューは [`.agent-skill-chain/source/REVIEW_RULE.md`](../../../../../.agent-skill-chain/source/REVIEW_RULE.md)・[`REVIEW_DUAL_LENS.md`](../../../../../.agent-skill-chain/source/REVIEW_DUAL_LENS.md) に従う。レビュー深度は **standard**（markdown 3 ファイルの再編・中規模）。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認 / 品質保証（受け入れ基準・リンク整合・DRY・履歴排除・非回帰の検証）と、02_設計・03_実装計画への準拠確認を行い、クローズ可否を判定する。

### 1.2 レビュー対象（必須）

- **実装範囲**: README.md の利用者向け特化への縮小・再構成、CONTRIBUTING.md（開発者・メンテナ向け単一入口）の新設、docs/maintainer/RELEASE.md の後方参照整合更新（markdown 3 ファイル）。
- **レビュー期間**: 2026-07-12 ～ 2026-07-12
- **レビュー担当者**: verify-and-close（レビュー・監査役）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク（または Issue）

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス |
| ---- | ---- | ---- | ---- | ---- |
| タスク1 CONTRIBUTING.md 新設 | 開発者・メンテナ向け単一入口を新設。移設3ブロック＋docs/maintainer 委譲リンク | 2026-07-12 | implementer | 完了 |
| タスク2 README.md 縮小・再構成 | 開発者・メンテナ限定3ブロック除去、操作節を `## 配備後の管理（CLI）` へ独立化、数字接頭辞除去 | 2026-07-12 | implementer | 完了 |
| タスク3 RELEASE.md 後方参照整合 | 冒頭・参照節2箇所の入口記述を README→CONTRIBUTING.md へ更新 | 2026-07-12 | implementer | 完了 |
| タスク4 リンク整合・受け入れ検証 | grep ベース静的検証・既存テスト非回帰 | 2026-07-12 | verify-and-close | 完了 |

### 2.2 実装内容の詳細

#### タスク 1: CONTRIBUTING.md 新設

- **実装内容**: ルート `CONTRIBUTING.md` を新設。`## GitHub 直接参照での配備（開発者・自己拡張向け）`／`## 本リポジトリでテストを回す`／`## リリース（メンテナ向け）`／`## さらに詳しく（詳細正本）` の4見出しで構成。
- **変更ファイル**: `CONTRIBUTING.md`（新規）
- **実装方法**: 現 README の3ブロック（GitHub 直接参照 init／`npm test`・`bash test/run-all.sh`／リリース要約）を本文保持で移設。詳細は書き写さず `docs/maintainer/*` 4文書へ要約リンク委譲。
- **確認事項**: 移設3ブロック存在・委譲リンク解決・RELEASE 詳細本文の非複製 → いずれも OK（§3 検証結果参照）。

#### タスク 2: README.md 縮小・再構成

- **実装内容**: §71「GitHub 直接参照（開発者・自己拡張向け）」・§163「リリース手順（メンテナ向け）」・§動作確認後半（self-repo テスト）を除去。旧 §1 配下にネストしていた操作群（サブコマンド表・ピン留め・アンインストール・enforcement opt-in）を独立トップレベル節 `## 配備後の管理（CLI）` へ再配置。導入配下の数字接頭辞（0./1./2./3.）を除去。
- **変更ファイル**: `README.md`（70行変更、削減方向）
- **実装方法**: `## 導入（プロジェクトへ配備するとき）` 見出しは一字不変（アンカー保全）。§導入 lede と §入口と参照 表に CONTRIBUTING.md リンクを追加。
- **確認事項**: 限定見出し不在・操作節独立・アンカー保全・self-repo テスト不在・CONTRIBUTING リンク存在 → いずれも OK。

#### タスク 3: RELEASE.md 後方参照の整合更新

- **実装内容**: L3 冒頭「README §リリース手順は入口リンクと要約のみを持ち…」→「CONTRIBUTING.md §リリース は入口リンクと要約のみを持ち…」。L84 参照行を `[CONTRIBUTING.md](../../CONTRIBUTING.md) §リリース — 入口リンク・要約` へ更新。
- **変更ファイル**: `docs/maintainer/RELEASE.md`（2箇所・4行変更）
- **実装方法**: 詳細本文（version-bump ジョブ手順等）は不変・重複させない。`../../CONTRIBUTING.md` の相対解決を確認。
- **確認事項**: 入口が CONTRIBUTING を指す・パス解決・詳細本文残存・DRY → いずれも OK。

---

## 3. テスト結果の確認

本 issue はドキュメント再編でありランタイム挙動を持たないため、テストは **grep ベース静的検証**（受け入れ基準の証跡化）と **既存テストスイート非回帰**で担保する（02 §6 の方針）。

### 3.1 単体テスト（静的検証）

#### テスト実行結果（必須: 数値で記載）

- **実行日**: 2026-07-12
- **静的検証項目数**: 13（下表）
- **成功**: 13
- **失敗**: 0
- **スキップ**: 0

#### 静的検証（03 §2.x.4 の BDD シェル検証を再実行）

| # | 検証コマンド（要旨） | 期待 | 結果 |
| ---- | ---- | ---- | ---- |
| 1 | `grep -qF "## 導入（プロジェクトへ配備するとき）" README.md` | 存在（アンカー保全） | OK |
| 2 | `grep -rn "README.md#導入プロジェクトへ配備するとき" SETUP.md claude-hook-e2e.md` | 2箇所ヒット・解決 | OK（SETUP.md:191, claude-hook-e2e.md:14） |
| 3 | 開発者/メンテナ限定見出しが README に不在 | 不在 | OK |
| 4 | `grep -n "^## 配備後の管理" README.md` | 存在 | OK（L98） |
| 5 | `npm test`／`bash test/run-all.sh` が README に不在 | 不在 | OK |
| 6 | README→CONTRIBUTING.md リンク存在 | 1件以上 | OK（L53, L178） |
| 7 | 数字接頭辞 `### N. ` が README に不在 | 不在 | OK |
| 8 | `version-bump`（RELEASE 詳細）が CONTRIBUTING に不在 | 不在（DRY） | OK |
| 9 | `version-bump` が RELEASE.md に残存 | 残存 | OK（6件） |
| 10 | CONTRIBUTING→docs/maintainer 4文書 `test -f` | 全実在 | OK |
| 11 | RELEASE.md→`../../CONTRIBUTING.md` 解決 | 実在 | OK |
| 12 | 歴史的経緯記述（移した/かつては/以前は 等）不在 | 不在 | OK（§4.2 指摘1 参照） |
| 13 | README.md・CONTRIBUTING.md 内の全 markdown リンクを `grep -noE '\]\([^)]+\)'` で列挙し、各リンク先（http(s) 外部リンクを除く）を相対パスで `test -f` 解決 | 内部リンク全件解決 | OK（README 12件＋CONTRIBUTING 7件＝計19出現、外部リンク1件（`https://github.com/microsoft/apm`）を除く内部18件すべて実在ファイルへ解決。アンカー付き1件は見出し `## ツール別強制力マトリクス` の実在も確認） |

### 3.2 統合テスト（既存テストスイート非回帰）

`bash test/run-all.sh` を実行。実出力サマリ:

```text
合計=19 PASS=14 FAIL=0 SKIP=5
```

- **FAIL=0**（本変更で FAIL を増やしていない＝非回帰確認）。evidence_source: test_output。
- SKIP=5 の内訳は以下の 5 テストで、全件が同一原因（`bin/agents-md.js` 未生成＝この worktree に npm/node_modules が導入されておらずビルド未実行）による必須依存欠如の SKIP であり、本 markdown 変更とは無関係。1 対 1 の対応は次のとおり（`bash test/run-all.sh` 実出力より、evidence_source: test_output）。

  | # | テスト名 | SKIP 理由（実出力） |
  | ---- | ---- | ---- |
  | 1 | `test-package-manifest-parity` | `bin/agents-md.js 未生成かつビルド不可（npm/node_modules なし）` → 必須依存欠如 (exit 2) |
  | 2 | `test-cli-audit-doctor` | `bin/agents-md.js が無い（npm run build を先に）` → 必須依存欠如 (exit 2) |
  | 3 | `test-export-ndjson` | `bin/agents-md.js が無い（npm run build を先に）` → 必須依存欠如 (exit 2) |
  | 4 | `e2e-claude-hook` | `bin/agents-md.js が無い（npm run build を先に）` → 必須依存欠如 (exit 2) |
  | 5 | `e2e-install-uninstall` | `CLI が見つかりません（bin/agents-md.js は非追跡の生成物。先に npm ci && npm run build が必要）` → 必須依存欠如 (exit 2) |

  なお `test-coverage-check`（`test-coverage-check.sh` 内の1アサーション）に現れる `[SKIP] kcov 未導入のためラップ結合テストを省略` は、上記5件とは無関係な**別テストファイル内の個別アサーションの SKIP**であり、当該テストファイル自体は `PASS=30 FAIL=0` で PASS 扱いのため合計の `SKIP=5` には含まれない（混同注意）。
- **重要**: `test-check-comment-refs`（コードコメントの外部参照検出）は **PASS**。03 §リスクで懸念した「markdown リンクによる comment-refs 誤発火」は発生しなかった（markdown リンクは対象外である設計どおり）。

### 3.3 E2E テスト

該当なし（ドキュメント再編。自動 E2E 経路なし）。利用者/開発者導線の到達性は本レビューの人手確認（§9・§12）で代替。

---

## 4. コードレビュー（review-code）

### 4.1 コード品質

- **リント結果**: 該当なし（markdown。専用 linter 未設定）
- **フォーマット**: 問題なし（既存文書の見出し・表・コードフェンス慣習に一致）
- **型チェック**: 該当なし

#### コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| ---- | ---- | ---- | ---- |
| 可読性 | README が利用者向け単一責務に縮小、CONTRIBUTING が開発者入口として明快 | OK | 数字接頭辞除去で導線見出しが内容名になり可読性向上 |
| 保守性 | 詳細を docs/maintainer に一本化し README/CONTRIBUTING は要約＋リンク（DRY） | OK | RELEASE 詳細本文の非複製を grep 実証 |
| 規約準拠 | 歴史的経緯の不記載・見出しアンカー不変・DRY | OK | §4.2 指摘1（false positive）参照 |
| 03準拠 | タスク1-4 の実装内容が 03 §2.x と一致 | OK | 移設ブロック・見出し名・委譲リンクすべて計画どおり |

### 4.2 指摘事項

#### 指摘 1: 歴史記述 grep のヒットは false positive（対応不要）

- **重要度**: 低
- **指摘内容**: 歴史的経緯検出 grep（`旧` 等）が `docs/maintainer/RELEASE.md:65` の「復**旧**は secret …」にヒットした。
- **対応状況**: 完了（対応不要と確定）
- **対応方法**: 当該箇所は「復旧」（recovery）の一部であり歴史的経緯の記述ではない。かつ本 issue で変更していない既存 RELEASE.md 本文（障害切り分けの手順）。README・CONTRIBUTING・RELEASE の変更箇所に「README から移した」等の歴史記述は無い（成功基準4 を満たす）。

#### 指摘 2: 00-03 の as-built 行番号同期（許容・対応不要）

- **重要度**: 低
- **指摘内容**: 00/01/02/03 に未コミット差分がある（`README.md（全204行）`→`207行`、`L179-186`→`L179-187` 等の行番号更新）。
- **対応状況**: 完了（許容と確定・記述を基準明確化のうえ更新）
- **対応方法**: この「207行」は 00 §2.3・§8、01 §5、02 §1・§9 が参照する**分離前（実装前）の README.md の行数**である（00 §2.3 冒頭に「README.md（全207行）を精読した結果の分類。行番号は現状のもの」と明記済みで、切り分け表の前提記述であり実装後の状態を表すものではない）。したがって実装（README 縮小）後もこれらの参照箇所は変更不要である。一方、**実装後の最終 README.md は実測 185 行**（`wc -l README.md` で実測、evidence_source: test_output）であり、00〜03 のいずれにもこの実装後の総行数を「207行」等の旧行数で誤って主張する記述は存在しない（00/01/02/03 全文 grep で「207行」の出現箇所を確認した結果、全て分離前基準の記述であることを確認済み）。document_id は不変（既存値を維持）。DOCS_RULES §行番号直リンク禁止はコア/command/spec のドキュメント間参照が対象で、issue 内の現状分析記述（00 §2.3 等）は対象外。害はなく整合性を高める更新のため許容する。

### 4.3 敵対的観点リスト（review-code）

境界・異常系・前提崩れを攻めた観点と結論。不確実な場合は要修正に倒す方針で判定。

| # | 攻めた観点（境界/異常系/前提崩れ） | 結論 |
| ---- | ---- | ---- |
| A1 | 「限定見出しが見た目だけ消え、本文中に読者限定語が残る」possibility → `GitHub 直接参照（開発者・自己拡張向け`・`リリース手順（メンテナ向け）` を grep | 問題なし。README 本体から不在を実証 |
| A2 | 「self-repo テスト（`npm test`）が README のどこかに残存」→ README 全体を grep | 問題なし。不在 |
| A3 | 「移設の際 RELEASE 詳細本文（version-bump 手順）を CONTRIBUTING に書き写して DRY 違反」→ CONTRIBUTING を grep | 問題なし。CONTRIBUTING に version-bump 不在、RELEASE.md に残存 |
| A4 | 「§導入 見出しが1文字でも変わりアンカー切れ」→ 完全一致 grep＋外部参照2箇所の再解決 | 問題なし。見出し不変・2参照とも解決 |
| A5 | 「数字接頭辞除去で別の見出しへの外部アンカー参照が切れる」→ repo 全体 `README.md#` grep | 問題なし。§導入 以外に被参照アンカーは存在しない（templates/・enforcement/README.md は別ファイル） |
| A6 | 「RELEASE.md→`../../CONTRIBUTING.md` の相対パスが誤りでリンク切れ」→ `test -f` で解決確認 | 問題なし。ルート CONTRIBUTING.md を指す |
| A7 | 「CONTRIBUTING→docs/maintainer の委譲リンク先が実在しない」→ 4文書 `test -f` | 問題なし。全実在 |
| A8 | 「markdown リンク増加で comment-refs テストが誤発火し回帰」→ `bash test/run-all.sh` | 問題なし。test-check-comment-refs PASS、FAIL=0 |
| A9 | 「旧『README §リリース手順』を指すスタール参照が他所に残る」→ repo 全体 grep | 問題なし。スタール参照ゼロ |

### 4.4 must-preserve リスト（review-code）

壊してはならない不変条件と、変更が保持していることの確認。

| # | 不変条件（must-preserve） | 保持確認 |
| ---- | ---- | ---- |
| P1 | `## 導入（プロジェクトへ配備するとき）` の見出しテキスト・アンカー（`#導入プロジェクトへ配備するとき`） | 保持（完全一致 grep OK） |
| P2 | 外部参照2箇所（SETUP.md:191・claude-hook-e2e.md:14）が §導入 へ解決 | 保持（2箇所ヒット・解決） |
| P3 | RELEASE.md のリリース手順詳細本文（version-bump 等）が詳細正本として残存 | 保持（RELEASE.md に version-bump 6件残存） |
| P4 | README の利用者向け操作（apm 導入・marketplace・ローカル配備・アンインストール・enforcement opt-in・動作確認前半・入口と参照） | 保持（`## 配備後の管理（CLI）` 独立節＋各導入節に残置） |
| P5 | CLI 呼び出し形 `npx github:…`（apm へ誤置換しない・ADR-2） | 保持（README 管理節・CONTRIBUTING init とも npx 形式維持） |
| P6 | 既存テストスイートの緑（FAIL 非増加） | 保持（FAIL=0） |
| P7 | 各成果ドキュメントの document_id 不変 | 保持（00-03 の document_id は既存値のまま。frontmatter 差分なし） |

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| ---- | ---- | ---- | ---- |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み（as-built 行番号同期） | verify-and-close | 2026-07-12 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み（as-built 行番号同期） | verify-and-close | 2026-07-12 |
| [`02_設計.md`](./02_設計.md) | 更新済み（as-built 行番号同期） | verify-and-close | 2026-07-12 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み（as-built 行番号同期） | verify-and-close | 2026-07-12 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している（README/CONTRIBUTING/RELEASE の実差分が 02 §2.2.1/§2.2.2/§3.3 と一致。ADR-1〜4 の帰結どおり）。
- **要件と実装の整合性**: 整合している（01 §2.1 の3ストーリー受け入れ基準を全て充足。§8 対応表参照）。
- **コメント**: 歴史的経緯の追記なし（現在の事実のみ）。

---

## 6. パフォーマンス確認

該当なし（ドキュメント再編。ランタイム性能への影響なし）。

---

## 7. セキュリティ確認

該当なし（CLI・スクリプト・enforcement ロジックは不変。markdown 再編のみ）。

---

## 8. 受け入れ基準の確認（generate-scenarios / map-coverage）

### 8.1 01 §2.1 ストーリー別受け入れ基準 × カバレッジ対応表

| ストーリー | 受け入れ基準 | 検証方法 | 結果 |
| ---- | ---- | ---- | ---- |
| S1 利用者が README だけで完結 | 開発者/メンテナ限定見出しが README に不在 | grep 不在（検証3） | 達成 |
| S1 | 利用者向け操作（apm/marketplace/ローカル/アンインストール/enforcement/動作確認/入口と参照）が README に残る | README 精読＋`## 配備後の管理` grep（検証4） | 達成 |
| S1 | 残る操作節が開発者見出し配下にネストされない | `## 配備後の管理（CLI）` トップレベル節化を確認 | 達成 |
| S2 開発者が単一ファイルから辿れる | 分離先 CONTRIBUTING.md が存在し README から1リンク到達 | `test -f`＋README→CONTRIBUTING リンク（検証6） | 達成 |
| S2 | 現 §71・§179-187・§163 相当が CONTRIBUTING に集約 | CONTRIBUTING に3ブロック存在（検証・§2.2） | 達成 |
| S2 | 詳細を書き写さず docs/maintainer へリンク委譲 | version-bump 非複製＋4文書リンク解決（検証8,10） | 達成 |
| S3 分割後もリンクが壊れない | SETUP.md・claude-hook-e2e.md の §導入 参照が解決 | grep＋アンカー完全一致（検証1,2） | 達成 |
| S3 | RELEASE.md 後方参照が要約の実所在（CONTRIBUTING）と整合 | RELEASE.md grep＋パス解決（検証11・§2.2 タスク3） | 達成 |
| S3 | README/CONTRIBUTING→docs/maintainer 全リンク解決（リンク切れ0件） | README・CONTRIBUTING 内の全 markdown リンクを列挙し解決確認（検証13）＋4文書 `test -f`（検証10）＋repo 全体 `README.md#` grep（§4.3 A5） | 達成（全リンク解決確認済み。内部18件全実在、外部1件は対象外） |

### 8.2 00 §6 成功基準（5件）× カバレッジ

| # | 成功基準 | 検証方法 | 判定 |
| ---- | ---- | ---- | ---- |
| 1 | README に「開発者・自己拡張向け」「メンテナ向け」限定見出しが存在しない | grep 不在（検証3） | ○ |
| 2 | 開発者・メンテナ向け情報が単一分離先に集約され README から1リンク到達 | CONTRIBUTING 存在＋リンク（検証6, §2.2） | ○ |
| 3 | 全 markdown リンク・参照が解決（特に §導入 2箇所・RELEASE 後方参照・docs/maintainer 各リンク）＝リンク切れ0件 | README・CONTRIBUTING 全リンク列挙による解決確認（検証13）＋検証1,2,10,11＋repo 全体 grep（§4.3 A5,A9） | ○（全リンク解決確認済み） |
| 4 | README・分離先・コメントに歴史的経緯の記述がない | grep（検証12・指摘1 で false positive 確認） | ○ |
| 5 | 既存 RELEASE.md の内容が重複コピーされていない | version-bump 非複製（検証8,9） | ○ |

### 8.3 BDD シナリオ（01 §2.2 / 03 §2.x.4）× テスト対応

| BDD シナリオ | 対応検証 | 結果 |
| ---- | ---- | ---- |
| UC1-S1 開発者向け見出し除去＋分離先から辿れる | 検証3,6 | 達成 |
| UC1-S2 利用者向け操作残置＋非ネスト | 検証4＋精読 | 達成 |
| UC2-S1 README §導入 外部参照維持 | 検証1,2 | 達成 |
| UC2-S2 RELEASE.md 後方参照整合＋詳細非重複 | 検証8,9,11 | 達成 |
| 03 タスク1 BDD（3ブロック＋委譲リンク） | 検証8,10, §2.2 | 達成 |
| 03 タスク2 BDD（限定見出し除去・操作節独立・アンカー保全） | 検証1,3,4,5 | 達成 |
| 03 タスク3 BDD（後方参照整合・詳細残存） | 検証9,11 | 達成 |
| 03 タスク4 BDD（アンカー保全・リンク解決・非回帰） | 検証1,2,10＋run-all.sh | 達成 |

- **未達・要対応**: なし。全受け入れ基準・全 BDD シナリオがカバー済み。
- **必須成果物の欠落**: なし（00/01/02/03 は必須セクション充足。04 は本書で作成）。
- **テストコード化の網羅**: ドキュメント再編のため自動化可能な観点は grep/`test -f` の静的検証で全てコード化済み（03 §2.x.4 の BDD シェル）。人手確認に留めた観点（利用者/開発者の導線到達性の主観評価）は「ドキュメントのため自動 E2E 困難」の理由を明記（03 §2.x.3 E2E 欄）。

---

## docs 更新

（[`.agent-skill-chain/source/DOCS_RULES.md`](../../../../../.agent-skill-chain/source/DOCS_RULES.md) §継続追随ゲートに従う判定）

- **要否**: 不要（軽量パス・DOCS_RULES §継続追随ゲート step5）
- **対象**: なし
- **理由**: 本 issue の変更は markdown の情報アーキテクチャ再編（README 縮小・CONTRIBUTING 新設・RELEASE.md 後方参照2行の整合）のみで、システム仕様書（`docs/`）の記載範囲に影響しない。本リポの `docs/` は `AI_CI_CD_VISION.md` と `docs/maintainer/` から成り、番号付きシステム仕様書（01_システム概要/02_画面設計/03_データ設計/04_機能設計 等）も `docs/00_review/` も存在しない（`ls docs/` で実確認、evidence_source: existing_code）。RELEASE.md 自体は `docs/maintainer/` 文書だが、その変更（入口所在の後方参照）は本 issue 実装の一部として本書 §2.2・§4 で既にレビュー済み。したがって as-built 同期を要する別のシステム仕様書は無く、根拠付きの「更新不要」判定1件で通過する。CLI・スクリプト・enforcement ロジック・データ構造・API は不変（機能追加なし）。

---

## 9. 設計・境界の確認（review-architecture）

### 9.1 設計の確認

- **設計原則の準拠**: 準拠（02 §1.2）。単一責務（README＝利用者／CONTRIBUTING＝開発者入口／docs/maintainer＝詳細正本）、明確な境界（利用者操作と開発者導線を見出し階層で物理分離）、UNIX 哲学＝要約＋リンクで DRY を実現。spec/06 の可読性最優先に沿う。
- **ディレクトリ構成**: 準拠。CONTRIBUTING.md はルート（GitHub 標準の貢献者入口・発見性が高い。ADR-1）。詳細は既存 docs/maintainer に集約。
- **命名規則**: 準拠。見出し名は内容を表し数字接頭辞を廃止（ADR-3）。

### 9.2 境界・依存の確認

- **責務の境界**: 明確。02 §2.1.1 の責務一覧（README/CONTRIBUTING/docs/maintainer/外部参照元）と実装が一致。3層（利用者正本＋開発者入口＋詳細正本）構成が実装で成立。
- **依存関係**: 一方向。README → CONTRIBUTING（1リンク委譲）→ docs/maintainer（詳細委譲）。RELEASE.md 後方参照 → CONTRIBUTING §リリース。循環参照なし（02 §2.1.3 の到達経路と一致・実測で確認）。
- **指摘・推奨**: なし（設計と実装が完全一致。ADR-1〜4 の帰結どおり編集対象が README・CONTRIBUTING・RELEASE.md の3ファイルに限定され、SETUP.md・claude-hook-e2e.md は不変）。

### 9.3 敵対的観点リスト（review-architecture）

| # | 攻めた観点（境界/依存/前提崩れ） | 結論 |
| ---- | ---- | ---- |
| B1 | 「CONTRIBUTING が docs/maintainer の詳細を吸収して二重の詳細正本になり責務境界が崩れる」 | 問題なし。CONTRIBUTING は要約＋リンクのみ（version-bump 非複製で実証）。詳細正本は docs/maintainer に一意 |
| B2 | 「README→CONTRIBUTING→docs/maintainer→README の循環参照」 | 問題なし。委譲は一方向。docs/maintainer から README への参照は §導入 アンカー（利用者向け・別責務）のみで循環を形成しない |
| B3 | 「apm 導線と管理 CLI の呼び出し形が混在し利用者を誤誘導（apm は bin を導入しないのに apm でコマンド実行できると誤解）」 | 問題なし。ADR-2 に従い管理 CLI は `npx github:…` を維持。事実整合 |
| B4 | 「init（配備）と管理 CLI（uninstall/doctor/enforce）の責務分割が曖昧」 | 問題なし。init（開発者向け配備）は CONTRIBUTING、管理 CLI は README §配備後の管理 に分離（ADR-2 の帰結どおり） |
| B5 | 「採用先へ配備されない CONTRIBUTING に外部参照元を張り替えると採用先文脈でリンクが壊れる」 | 問題なし。ADR-4 に従い外部参照元2箇所は §導入（採用先でも解決するパッケージ相対）を維持し張り替えていない |
| B6 | 「01 の要求（利用者/開発者/リンク整合）に対し設計に抜け漏れ」 | 問題なし。3ストーリー・5成功基準を §8 で全カバー |

### 9.4 must-preserve リスト（review-architecture）

| # | 不変条件（must-preserve） | 保持確認 |
| ---- | ---- | ---- |
| Q1 | docs/maintainer/* が各詳細の単一正本である責務境界 | 保持（CONTRIBUTING は入口・要約に徹し詳細を複製しない） |
| Q2 | 委譲の一方向性（README→CONTRIBUTING→docs/maintainer） | 保持（循環なし・02 §2.1.3 と一致） |
| Q3 | §導入 が採用先文脈でも機能する利用者向け正本であること | 保持（見出し不変・外部参照元を CONTRIBUTING へ張り替えない ADR-4） |
| Q4 | 並行2 issue（github-issue-gate・close-move-enforcement）の内容を統合しない | 保持（CONTRIBUTING に当該手順の集約なし。00 §5 スコープ順守） |
| Q5 | 変更対象を3ファイルに限定（CLI/スクリプト/enforcement 不変） | 保持（git diff は README/CONTRIBUTING/RELEASE＋issue docs のみ） |

### 9.5 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考 |
| ---- | ---- | ---- |
| アンカー保全（§導入 見出し不変で外部参照2箇所が解決） | existing_code / test_output | 完全一致 grep＋`grep -rn` で2箇所解決を実測 |
| DRY 保持（RELEASE 詳細が CONTRIBUTING に非複製） | test_output | `grep version-bump`：CONTRIBUTING 0件／RELEASE.md 6件 |
| 既存テスト非回帰 | test_output | `bash test/run-all.sh` → 合計=19 PASS=14 FAIL=0 SKIP=5 |
| 数字接頭辞除去の安全性（被参照アンカーなし） | existing_code | repo 全体 `README.md#` grep で §導入 以外の被参照ゼロ |
| CLI 呼び出し形 `npx github:…` 維持の妥当性（apm は bin 非導入） | existing_code | 02 ADR-2（README apm 展開に bin 生成記載なし） |
| docs 継続追随ゲート＝更新不要 | existing_code | `ls docs/`：番号付きシステム仕様書・00_review 不在 |

- **inference_only のみに依存する重要判断**: なし（全判断が existing_code / test_output の外部根拠を伴う）。

---

## 10. 課題と改善点

### 10.1 発見された課題

- なし（要修正の指摘ゼロ）。§4.2 の2件はいずれも「対応不要と確定」した低重要度の観察。

### 10.2 改善提案（本 issue スコープ外・メインへの申し送り）

- **改善1**: 将来、並行2 issue（GitHubIssue 起票ゲート・close 移動監査強制）の開発者向け具体手順を CONTRIBUTING.md へ集約できる余地がある（00 §5「今後の展望」）。本 issue では扱わない。
  - **効果**: 開発者向け手順の単一入口としての CONTRIBUTING の価値が高まる。
- **改善2**: markdown リンク切れの自動検知（テストスイートへのリンクチェッカ追加）は現状 grep 手動。将来の回帰防止に有効だが本 issue スコープ外。

---

## 11. システム仕様書の更新

- 本ゲートの判定は本書「docs 更新」節に集約（要否＝不要・根拠付き軽量パス）。
- 本リポの `docs/` は番号付きシステム仕様書（01_システム概要/02_画面設計/03_データ設計/04_機能設計）を持たないため、§11.3 の各セクション更新は該当なし。
- 更新履歴（`docs/README.md`）: 該当なし（`docs/README.md` は不在。本リポの docs/ 運用形態では更新履歴の集約先が存在しない）。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（02・03 に完全準拠。編集を3ファイルに限定し副作用なし）。
- **テスト品質**: 良好（受け入れ基準・BDD を静的検証で全カバー、既存スイート FAIL=0 で非回帰）。
- **ドキュメント品質**: 良好（DRY・履歴排除・アンカー保全を実証。00-03 も as-built 同期済み）。
- **総合評価**: 合格。要修正の指摘なし。クローズ可能。

### 12.2 承認状況

- **レビュー承認者**: verify-and-close（レビュー・監査役）
- **承認日**: 2026-07-12
- **承認コメント**: 受け入れ基準5件・BDD 全シナリオ達成、リンク切れ0件、DRY・履歴排除・アンカー保全を実証。既存テスト非回帰（FAIL=0）。二観点（敵対的×4.3/9.3・must-preserve×4.4/9.4）を両立し退行リスクなしと判断。commit はメイン側でユーザー確認のもと実施（本レビューのスコープ外）。

---

## 13. 参考資料

### 13.1 プロジェクトドキュメント

- [`00_要求定義.md`](./00_要求定義.md) - 要求定義
- [`01_要件定義.md`](./01_要件定義.md) - 要件定義
- [`02_設計.md`](./02_設計.md) - 設計
- [`03_実装計画.md`](./03_実装計画.md) - 実装計画

### 13.2 その他の参考資料

- 成果物: `README.md`（縮小）、`CONTRIBUTING.md`（新設）、`docs/maintainer/RELEASE.md`（後方参照更新）
- レビュー規約: [`REVIEW_RULE.md`](../../../../../.agent-skill-chain/source/REVIEW_RULE.md)、[`REVIEW_DUAL_LENS.md`](../../../../../.agent-skill-chain/source/REVIEW_DUAL_LENS.md)、[`DOCS_RULES.md`](../../../../../.agent-skill-chain/source/DOCS_RULES.md)、[`CLOSEOUT.md`](../../../../../.agent-skill-chain/source/CLOSEOUT.md)

---

## 14. 前のステップ

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

- 外部設定不要（コード実装なし・markdown 再編のみ）。05_最終確認チェックリストはスキップ可。
- クローズアウト（欠落工程）: verify(ii) 実経路検証＝本 issue はドキュメント再編でランタイム実経路を持たないため、静的検証（grep/`test -f`）と既存スイート非回帰が実効的な検証経路である（§3・§8）。commit（1 issue = 1 論理コミット）はメイン側でユーザー確認のもと実施。
