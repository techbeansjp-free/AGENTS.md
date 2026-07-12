---
# document_id: 必須。作成時または major 更新時に UUID（8-4-4-4-12 形式）を付与すること。既存の場合は変更しない。
document_id: "5d834098-5a86-487b-abed-cf1a6910bc94"
---

# レビュー書: README 配備手順の実装・テスト不整合修正

**プロジェクト名**: README 配備手順の実装・テスト不整合修正
**作成日**: 2026 年 07 月 12 日
**最終更新**: 2026 年 07 月 12 日

> **用語**: [.agent-skill-chain/source/CONCEPTS.md §用語規約](../../../../.agent-skill-chain/source/CONCEPTS.md#用語規約) を参照。
> **必須**: レビュー実施は [`.agent-skill-chain/source/REVIEW_RULE.md`](../../../../.agent-skill-chain/source/REVIEW_RULE.md) に従う。レビュー深度: **standard**（既存 3 ファイルへの局所修正。新規モジュール・新規テストファイルは無いが、CLI 引数解決の分岐変更を含むため quick より 1 段上）。

---

## 1. レビュー概要

### 1.1 レビュー目的（必須）

実装内容の確認（02_設計 ADR-1・03_実装計画のタスク 1〜4 との整合）／品質保証（テスト再実行・回帰なし確認）を目的とする。

### 1.2 レビュー対象（必須）

- **実装範囲**: 事実 A（README.md アンインストール表の `--purge` 記載是正）と事実 B（`doctor [dir]` 受理・`src/agents-md.ts` の `runDoctor`/`case "doctor"`/`printHelp` 改修 ＋ `test/test-cli-audit-doctor.sh` への自己テスト追加）。03_実装計画のタスク 1〜4 に対応。
- **レビュー期間**: 2026-07-12（本セッション、verify-and-close 一括実施）
- **レビュー担当者**: verify-and-close サブエージェント（フレッシュコンテキスト、fix/readme-uninstall-doctor-mismatch ブランチ上で working tree の未コミット差分を検証）

---

## 2. 実装内容の確認

### 2.1 実装完了タスク（または Issue）

| タスク名 | 実装内容 | 実装日 | 担当者 | ステータス（必須） |
| --- | --- | --- | --- | --- |
| タスク1: README `--purge` 表是正（事実A） | アンインストール表の「除去する配備物」「保持するユーザー資産」`--purge` 列を実装挙動（project/ 完全削除）に一致させ、注記・補足文を追加 | 2026-07-12 | 実装担当（別セッション） | 完了 |
| タスク2: `doctor [dir]` 受理（事実B） | `runDoctor(projectRoot = process.cwd())` に変更、`case "doctor"` を `audit`/`export` と同型の非フラグ引数解決に置換、`printHelp` の doctor 行を `doctor [dir]` に更新、README サブコマンド表を追随 | 2026-07-12 | 実装担当（別セッション） | 完了 |
| タスク3: `doctor [dir]` 自己テスト追加 | `test/test-cli-audit-doctor.sh` に `doctor_dir_arg`（cwd と別 dir を渡し採用先が dir になることを検証）・`doctor_no_arg_backward_compat`（引数なしは cwd のまま＝後方互換）を追加 | 2026-07-12 | 実装担当（別セッション） | 完了 |
| タスク4: ビルド＋全テスト再実行 | `npm run build`（tsc）、`test/test-cli-audit-doctor.sh`、`test/e2e-install-uninstall.sh` を本レビューで再実行 | 2026-07-12 | verify-and-close（本レビュー） | 完了（§3 参照） |

### 2.2 実装内容の詳細

#### タスク 1: README `--purge` 表是正（事実A）

- **実装内容**: `README.md` の「除去する配備物」行 `--purge` 列を `同左` → `同左 ＋ .agent-skill-chain/project/・.agent-skill-chain/runtime/（issue 履歴・workflow.db を含む）` に、「保持するユーザー資産」行 `--purge` 列を `左に同じ（workflow.db は削除）` → `.agent-skill-chain/project/ を含めすべて削除（統合ルート .agent-skill-chain/ ごと完全削除）。.cursor/.claude のユーザー作成物・自作スキル・独自フックは既定同様に保持` に変更。表直後に `--purge --yes` の破壊範囲を明示する注記ブロックを追加。補足文の「uninstall で保持される」を「既定の uninstall で保持される（`--purge` では削除される）」に限定。doctor 行を `doctor [dir]` に更新（事実B と連動）。
- **変更ファイル**: `README.md`（94・129・130・133 行目付近）
- **実装方法**: 02_設計 §3.1.2 の変更前後テキスト案（(1)(2)(3)(4)）をそのまま適用。正本（`SETUP.md`）への参照リンクは維持し重複記述を増やしていない。
- **確認事項**: `--purge` 列に「project/ を含め削除」が明記され、既定 uninstall 列（変更しない対象）が誤って書き換わっていないこと。→ 確認済み（差分は `--purge` 列と補足文のみ）。

#### タスク 2: `doctor [dir]` 受理（事実B）

- **実装内容**: `runDoctor(): number` → `runDoctor(projectRoot: string = process.cwd()): number` に変更し本体内の `const projectRoot = process.cwd();` を削除。`main()` の `case "doctor": return runDoctor();` を、`argv.slice(3).find((a) => !a.startsWith("-"))` で非フラグ引数を取り、絶対パスはそのまま／相対パスは `join(process.cwd(), dirArg)` として `runDoctor(dir)` を呼ぶ形に変更（`case "audit"` と同一パターン）。`printHelp()` の doctor 行を `doctor [dir]` に更新。
- **変更ファイル**: `src/agents-md.ts`（117・372・1250〜1256 行目付近）、`README.md`（94 行目のサブコマンド表）
- **実装方法**: 02_設計 §3.2.2 の変更前後コード案をそのまま適用。`join` は既存 import を再利用し新規 import なし。
- **確認事項**: 引数なし `doctor` が従来どおり `process.cwd()` を対象にすること（後方互換）。→ §3 のテスト再実行で確認済み。

#### タスク 3: `doctor [dir]` 自己テスト追加

- **実装内容**: `test/test-cli-audit-doctor.sh` に `doctor_dir_arg`（cwd を `mktemp -d` の無関係な場所に置いたまま `doctor "$H"` を実行し、出力に `採用先=$H` と `hash チェーン検証 = 整合` が含まれることを検証）、`doctor_no_arg_backward_compat`（`cd "$H" && doctor`（引数なし）で `採用先=$H` になることを検証）を追加。
- **変更ファイル**: `test/test-cli-audit-doctor.sh`（88〜112 行目付近、既存 `doctor_healthy` の直後）
- **実装方法**: 03_実装計画 §2.3.4 のテストコード例をそのまま適用。`ユースケース:`／`シナリオ:`／`Given`/`When`/`Then` のインラインコメントを付与済み（TEST_BDD_FORMAT.md 準拠。§4.1 参照）。
- **確認事項**: 引数が効いていることを cwd と対象 dir を分離する形で証明しているか。→ 確認済み（`cd "$WORK"` で cwd を対象外へ逃がしてから第 1 引数で `$H` を渡す構成）。

#### タスク 4: ビルド＋全テスト再実行

- 本レビューで `npm run build`・`bash test/test-cli-audit-doctor.sh`・`bash test/e2e-install-uninstall.sh` を実行。結果は §3 に記載。

### 2.3 受け入れ基準・BDD カバレッジ対応表（generate-scenarios / map-coverage）

01_要件定義の受け入れ基準・BDD シナリオと、実装・テストの対応は次のとおり。

| 受け入れ基準 / BDD シナリオ | 対応する実装 | 対応するテスト | 検証方法 | 結果 |
| --- | --- | --- | --- | --- |
| 00 基準1／01 ストーリー1: README の `--purge` 表が project/ 削除を正しく表す | `README.md` 129・130・133 行目是正 | `test/e2e-install-uninstall.sh` の `test_uninstall_purge`（シナリオ3）＋ `test_purge_uninstall_removes_everything`（N6） | README 該当箇所を目視確認（実装挙動との矛盾なし）＋ 既存 E2E 2 本を再実行し実装挙動の裏づけを確認 | 通過（README 記載を確認・E2E 2/2 PASS。§3.3） |
| 01 ユースケース1 シナリオ1: `--purge --yes` は project/ を含め統合ルートを完全削除する（実装挙動の裏づけ） | `PURGE_ARTIFACTS`（`src/agents-md.ts` 807 行目付近）・`finalizeAscRoot()`（818 行目付近、本 issue で無変更） | `test_uninstall_purge`（152〜172 行目）・N6（896〜915 行目） | E2E 再実行 | 通過（PASS） |
| 01 ユースケース1 シナリオ2: README の記載が実装と矛盾しない | README テキスト | 自動テスト化困難（自然言語整合） | review-docs（実装前、00〜03 に対し 2026-07-12T04:53 台に 4 件記録済み）＋ 本レビューでの目視照合 | 通過（README 129/130/133 行目を実装 `PURGE_ARTIFACTS`/`finalizeAscRoot` と突合し矛盾なし） |
| 00 基準2／01 ストーリー2 ユースケース2 シナリオ1: `doctor [dir]` が渡した dir を診断する（ADR-1 方針(a)） | `runDoctor(projectRoot = process.cwd())`・`case "doctor"`（1251〜1256 行目付近） | `test/test-cli-audit-doctor.sh` の `doctor_dir_arg`（新規） | CLI 自己テスト再実行 | 通過（PASS） |
| 01 ユースケース2 シナリオ1 And: 引数なし doctor は cwd を診断する（後方互換） | 同上（既定値 `process.cwd()`） | 既存 `doctor_healthy`（無改変）＋ 新規 `doctor_no_arg_backward_compat` | CLI 自己テスト再実行 | 通過（PASS） |
| 01 ユースケース2 シナリオ2（方針(b)明記のみ） | 対象外 | 対象外 | 02_設計 ADR-1 で方針(a)採用のため実装対象外と明記済み（03「BDD」節） | 未達理由記載済み（実装不要と設計判断） |
| 00 基準3: 01 の BDD シナリオのうちテストコード化できるものが自動テストと対応づけられている | — | 上記表 | 本カバレッジ表で突合 | 通過（テストコード化困難な 1 件を除き全対応。困難な 1 件も理由明記済み） |

**未達・要対応**: なし。方針(b)のシナリオは ADR-1 により実装対象外と設計フェーズで確定済みであり、未達ではなく「対象外」。

**必須成果物の欠落確認**: 00/01/02/03 は既存（作成日 2026-07-12、document_id 記載済み）。04_review は本レビューで新規作成（本ファイル）。欠落なし。

---

## 3. テスト結果の確認

### 3.1 単体テスト

`runDoctor` は spawn／ファイル I/O を伴うため純粋単体化されておらず、CLI 自己テスト（`test/test-cli-audit-doctor.sh`）が実質の単体〜結合レベル担保（02_設計 §6・03「単体テスト」節の方針どおり）。

#### テスト実行結果（`test/test-cli-audit-doctor.sh`、本レビューで再実行）

- **実行日**: 2026-07-12
- **実行コマンド**: `bash test/test-cli-audit-doctor.sh`
- **テストケース数**: 11
- **成功**: 11
- **失敗**: 0
- **スキップ**: 0（`audit_passthrough` の不在ケースが PACKAGE_ROOT 固定のため SKIP 表示されるが、全体結果は `PASS=11 FAIL=0` で確定）

新規ケース `doctor [dir]: 引数の dir が採用先になる` `doctor [dir]: 渡した dir の証跡が診断される` `doctor: 引数なしは cwd（...）が採用先になる（後方互換）` の 3 件がいずれも PASS。既存 `doctor_healthy`・`doctor_tamper_hash`・read-only 確認等は無改変で PASS（回帰なし）。

### 3.2 統合テスト

該当なし（本 issue の範囲は CLI 自己テストと E2E に閉じる）。

### 3.3 E2E テスト

#### テスト実行結果（`test/e2e-install-uninstall.sh`、本レビューで再実行）

- **実行日**: 2026-07-12
- **実行コマンド**: `bash test/e2e-install-uninstall.sh`
- **テストケース数（assert 件数）**: 131
- **成功**: 131
- **失敗**: 0

事実 A の実装挙動裏づけである `test_uninstall_purge`（シナリオ3、4 assert）と `test_purge_uninstall_removes_everything`（N6、4 assert）がいずれも PASS。既定 uninstall が project/ を保持する回帰シナリオ（R3・N5）も PASS。本 issue はこの E2E ファイル自体を変更していないため、全体 PASS=131 FAIL=0 は「実装（README 記載の根拠となる挙動）に変化がなく回帰していない」ことの確認になる。

#### 失敗したテスト

なし（該当なし）。

---

## 4. コードレビュー

### 4.1 コード品質

#### コードスタイル

- **リント結果**: 専用リンタは未設定（プロジェクト方針。`npm run build` の `tsc` を型チェック兼用として使用）。
- **フォーマット**: 問題なし（既存コードのインデント・命名規則に追随）。
- **型チェック**: `npm run build`（`tsc && chmod +x bin/agents-md.js`）を実行しエラー・警告 0 件で成功。`runDoctor` のデフォルト引数化・`case "doctor"` の `dir: string` 型が既存 `case "audit"`/`case "export"` と同型であることを型レベルでも確認。

#### コードレビュー観点

| 観点 | 確認内容 | 結果 | コメント |
| --- | --- | --- | --- |
| 可読性 | `case "doctor"` に「dir 省略時は cwd。init/uninstall/audit/export と同じ引数解決規約」というインラインコメントがあり意図が読み取れる | OK | — |
| 保守性 | `runDoctor` の責務が「対象を診断する」に単一化され、対象決定は呼び出し側（`main`）に集約（02_設計 §1.2 単一責務の原則どおり） | OK | — |
| パフォーマンス | 影響なし（分岐 1 箇所・文字列比較） | OK | — |
| セキュリティ | 相対パス dir を `join(process.cwd(), dirArg)` で解決しており、`case "audit"`/`case "uninstall"` 等の既存パス解決と同じ扱い（パストラバーサル等の新規リスクは導入していない。read-only 診断のため書き込み系の脅威は無い） | OK | — |

### 4.2 指摘事項

指摘なし（軽微な typo・表記ゆれも確認したが該当なし）。README 変更点（`--purge` 表・注記・補足文）、`src/agents-md.ts` 変更点（`runDoctor` シグネチャ・`case "doctor"`・`printHelp`）、`test/test-cli-audit-doctor.sh` 新規ケースはいずれも 02_設計・03_実装計画の記載どおりに適用されており、逸脱は見当たらない。

### 4.3 敵対的観点リスト（REVIEW_DUAL_LENS.md §2.1・必須）

実装を反証・破壊する観点で検証した。不確実な場合は要修正に倒す方針で確認。

| # | 攻めた観点 | 検証内容 | 結論 |
| --- | --- | --- | --- |
| 1 | `doctor [dir]` に `--` で始まる文字列だけを渡した場合（例: `doctor --foo`）に誤って cwd 以外を診断しないか | `argv.slice(3).find((a) => !a.startsWith("-"))` はフラグを除外するため `dirArg` は `undefined` になり `dir = process.cwd()` にフォールバックする。`case "audit"`/`case "export"` と同一ロジックであり、既存テスト（audit 側）で同型ロジックが検証済み | 問題なし（意図どおりフォールバック） |
| 2 | `doctor <相対パス>` を渡した場合、`join(process.cwd(), dirArg)` の解決がテストで担保されているか | 新規テスト `doctor_dir_arg` は絶対パス（`$H` は `mktemp -d` の絶対パス）のみを検証しており、相対パスの解決は自動テストで未検証（03_実装計画 §2.3.3 でも「相対パスは必要に応じ追加（任意）」と明記され、対象外と設計判断済み） | **要確認事項として残存**（自動テスト未カバー）。ただしロジックは `case "audit"`/`case "export"`（相対パスケースも同型実装）と完全同一であり、それらの既存回帰テストが通っていることから間接的に担保されている。実装計画で「任意」と明記済みのため 04 では「残課題（軽微）」として記録し、ブロッカーとはしない（§10 参照） |
| 3 | `runDoctor` のデフォルト引数化で、`case "doctor"` 以外の呼び出し元（もしあれば）が誤って旧シグネチャを期待していないか | `grep -n "runDoctor("` で呼び出し箇所を確認した結果、`main()` の `case "doctor"` 1 箇所のみが呼び出しており、他に呼び出し元は無い | 問題なし |
| 4 | 事実 A の README 修正が「保持するユーザー資産」行の**既定 uninstall 列**（変更しないはずの箇所）を誤って書き換えていないか | diff を再確認し、変更範囲が `--purge` 列・注記・補足文に限定されていることを確認（既定列のテキストは差分に含まれない） | 問題なし |
| 5 | 新規テスト `doctor_dir_arg`／`doctor_no_arg_backward_compat` が実際にアサーションで失敗しうる状態か（見せかけの PASS ではないか） | 本レビューで実行し `assert_contains` 呼び出しが期待どおり実行され `PASS=11 FAIL=0` で確定。アサーション文字列（`採用先=$H`・`hash チェーン検証 = 整合`）は `runDoctor` の実出力文言と一致することをソース側（384 行目付近の出力文言）でも突合済み | 問題なし |
| 6 | `--purge` 表の是正がユーザーに「project/ 以外の重要資産（`.cursor`/`.claude` のユーザー作成物）まで --purge で消える」と誤読させないか | 「保持するユーザー資産」`--purge` 列の変更後テキストに「.cursor/.claude のユーザー作成物・自作スキル・独自フックは既定同様に保持」と明記されており、実装（`PURGE_ARTIFACTS` は `project`・`runtime` のみを対象とし `.cursor`/`.claude` を含まない）と一致 | 問題なし |

### 4.4 must-preserve リスト（REVIEW_DUAL_LENS.md §2.2・必須）

変更が保持すべき不変条件（既存契約・後方互換・既存テストの前提）を同定し、保持を確認した。

| # | must-preserve（不変条件） | 保持確認方法 | 結果 |
| --- | --- | --- | --- |
| 1 | 引数なし `doctor` は常に `process.cwd()` を診断する（既存利用者・既存テストの前提） | `runDoctor(projectRoot: string = process.cwd())` のデフォルト値・`test-cli-audit-doctor.sh` の既存 `doctor_healthy`（`cd "$H" && doctor`）が無改変で PASS | 保持 |
| 2 | 既定 `uninstall`（`--purge` なし）は `.agent-skill-chain/project/` を保持する | `test_uninstall_keeps_user_assets`・R3・N5 が PASS（実装無変更） | 保持 |
| 3 | `PURGE_ARTIFACTS`／`finalizeAscRoot()` の実装ロジック自体は変更しない（README 側のみ是正する 01/02 の方針） | diff に `src/agents-md.ts` の当該関数への変更が含まれないことを確認 | 保持 |
| 4 | README の保持・上書き契約の正本参照リンク（`.agent-skill-chain/source/SETUP.md`）を重複記述せず維持する | 133 行目末尾のリンクが diff で削除されていないことを確認 | 保持 |
| 5 | `case "audit"`／`case "export"` の既存引数解決ロジックは変更しない（`case "doctor"` を同型に揃えるのみ） | diff に `case "audit"`／`case "export"` 本体への変更が含まれないことを確認 | 保持 |
| 6 | `test/e2e-install-uninstall.sh` は本 issue で変更しない（実装挙動裏づけの回帰専用として既存のまま） | `git diff --stat` で当該ファイルが変更対象に含まれないことを確認 | 保持 |

---

## 5. ドキュメントの確認

### 5.1 ドキュメント更新状況

| ドキュメント | 更新状況 | 確認者 | 確認日 |
| --- | --- | --- | --- |
| [`00_要求定義.md`](./00_要求定義.md) | 更新済み（既存。review-docs で指摘0収束済み） | verify-and-close | 2026-07-12 |
| [`01_要件定義.md`](./01_要件定義.md) | 更新済み（既存。review-docs で指摘0収束済み） | verify-and-close | 2026-07-12 |
| [`02_設計.md`](./02_設計.md) | 更新済み（既存。ADR-1 方針(a)確定。review-docs で指摘0収束済み） | verify-and-close | 2026-07-12 |
| [`03_実装計画.md`](./03_実装計画.md) | 更新済み（既存。タスク1〜4 定義済み。review-docs で指摘0収束済み） | verify-and-close | 2026-07-12 |

### 5.2 ドキュメントの整合性

- **実装と設計の整合性**: 整合している（§2.2・§4 で確認したとおり、02_設計 §3.1.2／§3.2.2 の変更前後テキスト案どおりに実装されている）。
- **要件と実装の整合性**: 整合している（§2.3 のカバレッジ表で 01 の受け入れ基準・BDD と実装・テストの対応を確認済み）。
- **コメント**: 03_実装計画の行番号（例: `--purge` 列 129/130 行目、`doctor` 117/372/1251 行目）は起票時点のものであり実装後に多少ずれているが、識別子（表ヘッダ文言・関数名）で再特定できており実装内容自体に齟齬はない。

---

## docs 更新

`docs/` はプロジェクトドキュメント運用として存在するが、本リポジトリでは `docs/maintainer/`（issue ワークフロー成果物）と `docs/AI_CI_CD_VISION.md` のみで、DOCS_RULES.md が想定する「システム仕様書」（01_システム概要／02_画面設計／03_データ設計／04_機能設計 等のナンバリング構成）は本リポジトリでは未採用である。

- 要否: **不要**
- 対象: なし
- 理由: 本 issue の変更（README.md のアンインストール表・doctor 引数仕様、`src/agents-md.ts` の CLI 引数解決、自己テスト追加）は、本リポジトリが運用する「システム仕様書」構成（未採用）に該当する記載を持たない。変更内容は README.md 自体（配布物の説明文書）に直接反映済みであり、別途 `docs/00_review/` へのシステム仕様書レビュー記録は不要と判定する（DOCS_RULES.md §5 軽量パス）。

---

## 6. パフォーマンス確認

### 6.1 パフォーマンステスト結果

該当なし。変更は CLI 引数分岐 1 箇所とドキュメントテキストの是正に限定され、性能特性への影響はない（02_設計 §9 のとおり）。

### 6.2 ボトルネックの確認

該当なし。

---

## 7. セキュリティ確認

### 7.1 セキュリティチェック

| 項目 | 確認内容 | 結果 | コメント |
| --- | --- | --- | --- |
| 認証・認可 | 本 issue に認証・認可の変更なし | OK | 該当なし |
| データ保護 | `--purge` の破壊範囲を実挙動どおりに README へ明記したことで、利用者が project 固有ルールの誤削除リスクを事前に把握できるようになった（2026-07-11 の誤削除インシデント再発防止に寄与） | OK | §1.1 目的に直結する主眼の確認 |
| 入力検証 | `doctor [dir]` の dir 解決は既存 `case "audit"`/`case "export"` と同一パターンで、新規の入力検証要件は発生しない（read-only 診断のため書き込み系の脅威は無い） | OK | §4.3 敵対的観点 #1・#2 で確認済み |

---

## 8. デプロイ準備

本 issue は npm パッケージ（CLI）のソース・ドキュメント修正であり、Web サービスのような個別デプロイ工程は存在しない。次のブランチ・コミット・PR 作成が「デプロイ」に相当する。

### 8.1 デプロイチェックリスト

- [x] すべてのテストが通過している（§3。11/11・131/131）
- [x] コードレビューが完了している（§4）
- [x] ドキュメントが更新されている（README.md。§5）
- [ ] マイグレーションスクリプトが準備されている（該当なし）
- [ ] 環境変数の設定が確認されている（該当なし）
- [ ] バックアップ計画が準備されている（該当なし。破壊的操作を伴わない変更のため）

### 8.2 デプロイ計画

- **デプロイ予定日**: 本レビュー完了後、ユーザー確認のうえコミット・PR 作成（verify-and-close の Constraints によりコミットは本レビューでは行わない）。
- **デプロイ方法**: 通常の PR マージ（`fix/readme-uninstall-doctor-mismatch` → `main`）。npm 公開等は対象外（package.json の `prepare` フックで `build` は自動実行される）。
- **ロールバック計画**: 通常の `git revert`。破壊的なデータ移行を伴わないため追加のロールバック手順は不要。

---

## 9. 設計・境界の確認

### 9.1 設計の確認

- **設計原則の準拠**: spec/01 設計原則の単一責務・明確な境界に沿っている。`runDoctor` の責務を「与えられた対象を診断する」に単一化し、対象決定を呼び出し側 `main()` に集約したことは 02_設計 §1.2 の方針どおり実装されている。
- **ディレクトリ構成**: 新規ファイル・新規モジュールは無く、既存 3 ファイル（`README.md`・`src/agents-md.ts`・`test/test-cli-audit-doctor.sh`）内の局所修正に閉じている（02_設計 §2.3 のとおり）。
- **命名規則**: `case "doctor"` のブロック構文・`dirArg`／`dir` の変数名は `case "audit"`／`case "export"` と揃えられており、既存命名規則からの逸脱はない。

### 9.2 境界・依存の確認

- **責務の境界**: `main()`（引数解決）→ `runDoctor(projectRoot)`（診断）の一方向依存が維持されている。README・help はいずれも実装の記述役に徹しており、実装ロジックへの逆依存はない。
- **依存関係**: `case "doctor"` の変更は `case "audit"`／`case "export"` の既存パターンを踏襲するのみで、それらのコードへの変更は無い（循環参照なし。§4.4 must-preserve #5 で確認済み）。`join` の再利用のみで新規依存追加なし。
- **指摘・推奨**: なし。ADR-1（方針(a)採用）の帰結（§2.5 記載の「`runDoctor` シグネチャ変更」「README/help 更新」「自己テスト追加」「後方互換維持」）がすべて実装に反映されていることを確認した。

### 9.3 重要判断の根拠（evidence_source）

| 判断内容 | evidence_source | 備考（参照元・URL 等） |
| --- | --- | --- |
| 実装が 02_設計 ADR-1（方針(a): `doctor [dir]` 受理）どおりであること | existing_code | `src/agents-md.ts` 372・1251〜1256 行目付近を diff で確認 |
| README 記載が実装（`PURGE_ARTIFACTS`／`finalizeAscRoot`）と矛盾しないこと | existing_code | `src/agents-md.ts` 807・818 行目付近（本 issue で無変更）と README.md 129/130 行目の突合 |
| 新規・既存テストが全て PASS していること | test_output | 本レビューで `bash test/test-cli-audit-doctor.sh`（PASS=11 FAIL=0）・`bash test/e2e-install-uninstall.sh`（PASS=131 FAIL=0）を実行して確認（§3） |
| `runDoctor` の呼び出し元が `main()` の `case "doctor"` 1 箇所のみであること（デフォルト引数化の安全性） | existing_code | `grep -n "runDoctor("` の結果を確認 |
| README テキストと実装挙動の自然言語整合（自動判定困難な部分） | human_decision（review-docs 反復＋本レビューの目視照合） | 2026-07-12T04:53 台の review-docs 記録（workflow.db、00〜03 いずれも指摘0収束）＋ 本レビューでの再照合 |

---

## 10. 課題と改善点

### 10.1 発見された課題

- **課題 1（軽微・残課題）**: `doctor [dir]` の相対パス指定（例: `doctor sub/dir`）を検証する自動テストが無い。§4.3 敵対的観点 #2 のとおり、ロジックは `case "audit"`／`case "export"` と同型で間接的に担保されているが、`doctor` 固有の相対パスケースは 03_実装計画でも「任意」と明記され本 issue のスコープ外とされている。
  - **影響範囲**: 低（相対パス解決ロジック自体は絶対パスと同一関数を通り、既存の `case "audit"`/`case "export"` 用の他テストで間接的にカバーされている。実害の兆候は現時点で無い）。
  - **対応方法**: 本 issue のスコープ外として close してよい。今後 `doctor` の相対パスケースを追加する場合は `test/test-cli-audit-doctor.sh` に 1 ケース追加する（実装変更は不要、テスト追加のみ）。

- **課題 2（本 issue の範囲外・別件の既存不整合。要フォローアップ）**: 本レビューで `node bin/agents-md.js doctor`（本リポジトリ自身を対象）を実行したところ、`workflow.db hash チェーン不整合: entry_hash 不一致=1 件` が検出された。本レビューの新規ログ 2 件（entry_id `9adbda34-...`・`78d12279-...`、いずれも本 issue の implement-feature／verify-and-close 記録）は `gen_entry_hash` による再計算で stored 値と完全一致することを個別に確認済みであり、原因ではない。全 408 行を総当たりで再計算した結果、不一致は `entry_id=848c89bb-60d1-476f-adc9-e05c34806323`（`command=verify-and-close`、`ts_utc=2026-07-11T19:17:24Z`）の 1 件のみで、本 issue の作業開始（2026-07-12T04:34 台）より前・かつ本 issue と無関係な過去の verify-and-close 記録である。
  - **影響範囲**: 中（証跡の完全性という自己拡張ワークフロー基盤の健全性に関わるが、本 issue（README/doctor 引数の記載是正）のスコープ外であり、本 issue の変更が原因ではない）。
  - **対応方法**: 本 issue の変更のみを close 対象とし、当該不整合の是正（原因調査・再発防止）は別 issue（進行役の Go 出しを得たうえで起票）として扱うことを推奨する。本 04_review では「発見事実の記録」に留め、本 issue の実装（README 是正・`doctor [dir]`）を理由に close をブロックしない。

### 10.2 改善提案

- **改善 1**: なし（本 issue の変更範囲は 02/03 の計画どおり最小限に収まっており、追加の改善提案は無い）。

---

## 11. システム仕様書の更新

「docs 更新」節（本ファイル §5 直後）のとおり、本リポジトリでは DOCS_RULES.md が想定するナンバリング構成のシステム仕様書を採用していないため、本節は「不要」判定を確認する形にとどめる。

### 11.1 システム仕様書の確認結果

- **実装した機能**: `doctor [dir]` 引数受理（CLI 機能）。README のドキュメント記載是正（機能追加ではない）。
- **実装した画面**: 該当なし（CLI）。
- **実装したデータ構造**: 該当なし。
- **実装した API**: CLI サブコマンドインターフェースの変更のみ（`doctor [dir]`）。HTTP API 等は対象外。

### 11.2 システム仕様書の更新状況

#### 更新が必要な項目

なし。

#### 更新が不要な項目

- README.md（本リポジトリにおける利用者向け説明の正本の 1 つ）自体が本 issue の直接の修正対象であり、既に是正済み。別途「システム仕様書」への転記は発生しない（DOCS_RULES §5 軽量パス、根拠は §5「docs 更新」節のとおり）。

---

## 12. レビュー結果

### 12.1 総合評価

- **実装品質**: 良好（02_設計・03_実装計画の変更前後テキスト案どおりに適用。§4.3 の敵対的レビューで検出した論点も影響が限定的で対応方針が明確）。
- **テスト品質**: 良好（新規ケース 3 件・既存回帰含め CLI 自己テスト 11/11・E2E 131/131 が PASS。§4.3 課題1 のみ軽微な残課題）。
- **ドキュメント品質**: 良好（00〜03 は review-docs で指摘0収束済み、README 本体の是正内容も実装・テストと整合）。
- **総合評価**: **承認可**。ブロッカーとなる指摘は無い。§10.1 の課題1（相対パステストの任意追加）は残課題として記録し、close を妨げない。

### 12.2 承認状況

- **レビュー承認者**: verify-and-close サブエージェント（本レビュー実施者）
- **承認日**: 2026-07-12
- **承認コメント**: 03_実装計画のタスク1〜4がすべて実装・検証され、テスト回帰なし（PASS=11+131=142、FAIL=0）。§10.1 の軽微な残課題（課題1）を除きブロッカーなし。なお本レビュー中に doctor 自己診断で本 issue と無関係な既存不整合（課題2、2026-07-11 付の別 verify-and-close ログ 1 件の entry_hash 不一致）を発見したが、本 issue の変更が原因でないことを個別検証済みであり、本 issue の close はブロックしない（別 issue でのフォローアップを推奨）。close 可。

---

## 13. 参考資料

### 13.1 プロジェクトドキュメント

- [`00_要求定義.md`](./00_要求定義.md) - 要求定義
- [`01_要件定義.md`](./01_要件定義.md) - 要件定義
- [`02_設計.md`](./02_設計.md) - 設計（ADR-1）
- [`03_実装計画.md`](./03_実装計画.md) - 実装計画

### 13.2 その他の参考資料

- 実行コマンド・結果: `npm run build`（成功）、`bash test/test-cli-audit-doctor.sh`（PASS=11 FAIL=0）、`bash test/e2e-install-uninstall.sh`（PASS=131 FAIL=0）
- workflow.db の review-docs 記録（00〜03、2026-07-12T04:53 台、entry_id: `769bb53b-2372-4d79-bf87-b6107cd7ed14`・`255e1bb3-51af-4419-a76c-109c036f5f0d`・`f40abd28-2d6b-4fe2-b7df-5e855438e55c`・`eb067101-c20c-492b-8601-106e2b1cad62`）

---

## 14. 前のステップ

このレビュー書は、以下のドキュメントを基に作成されています：

- **前**: [`03_実装計画.md`](./03_実装計画.md) - 実装計画フェーズ

---

## 15. 次のステップ

このレビュー書の承認後、以下のステップに進みます：

- **外部設定は不要**: コード実装（CLI・ドキュメント修正）のみで完結するプロジェクトのため `05_最終確認チェックリスト.md` は作成しない。
- 次: コミット（1 論理コミット）→ PR 作成。push・マージはユーザー明示時のみ（本 verify-and-close ではコミットを行わない）。
