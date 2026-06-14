# COVERAGE_EXCEPTIONS.md — 本リポ（自己拡張の消費者）の例外台帳（実データ）

本ファイルは配布物正本 [.agents/COVERAGE_AND_EXCEPTIONS.md](../.agents/COVERAGE_AND_EXCEPTIONS.md) 第3章の必須列に従う、本リポジトリの**カバレッジ例外台帳（実データ）**である。列定義・認定基準（第2章の 1〜4）・100% 方針・禁止パターンは**正本を参照**し、本台帳では重複定義しない（DRY）。本台帳は**実データ行のみ**を持つ。

- **二重化（A↔B）**: 「適用手段」列に記載した kcov のパス除外オプション（`--exclude-path` に渡すパス）は、計測スクリプト [.agents/scripts/test/coverage-check.sh](../.agents/scripts/test/coverage-check.sh) の `EXCLUDE_PATHS`（正本変数・除外 A）と**一致させること**。片方だけの除外（A のみ・B のみ）は禁止（正本 §1）。
- **100% の分母**: 計測対象（分母）は `INCLUDE_PATHS=.agents/scripts` 配下の**実行ロジックを持つ bash 本体**。本台帳に載せた対象を分母から外したうえで、**残りの計測対象に対して `FAIL_UNDER=100` を強制**する（閾値は下げない）。
- **行単位 ignore 不使用**: bash には行単位無視の公式手段が無いため、除外は**パス単位（kcov `--exclude-path` / `--exclude-pattern`）＋本台帳**の二重化のみで行う（行 pragma は使わない）。

---

## 例外台帳（実データ）

| ID | 対象 | カテゴリ | 理由 | 代替保証 | 適用手段 | 承認 | 有効期限 |
|----|------|----------|------|----------|----------|------|----------|
| COV-001 | `.agents/scripts/test/`（`test-*.sh` / `e2e-*.sh` / `run-all.sh` / `coverage-check.sh`） | 1 | テスト自身は計測の駆動元であり、テストのテストを分母に入れると循環し意味が無い（テスト駆動の対象外）。 | これらは self-enforce CI の各 step（E2E install/uninstall・audit）と `run-all.sh` 経由で実行され、結果が確認される（CI ジョブ `self-enforce`）。 | kcov `--exclude-path=.agents/scripts/test` | 本 issue `20260615_054810_カバレッジ計測の自リポ適用`（PR レビューで承認） | なし（恒久。テスト自身は分母に戻さない） |
| COV-002 | `.agents/scripts/lib/deploy-skills.sh` | 4 | 結合テストで直接駆動されない薄い配備補助。単体で計測するコストが成果に見合わない。 | install/uninstall E2E（`.agents/scripts/test/e2e-install-uninstall.sh`・CI ジョブ `self-enforce` の Install/uninstall & encapsulation E2E step）で配備結果が間接的に検証される。 | kcov `--exclude-path=.agents/scripts/lib/deploy-skills.sh` | 本 issue `20260615_054810_カバレッジ計測の自リポ適用`（PR レビューで承認） | リファクタで結合テストから直接駆動できるようになり次第、台帳から外して分母に戻す |
| COV-003 | テンプレート・設定・スキーマ・生成物・非実行データ（`.workflow/templates/`・`.agents/ledger/schema.sql`・`.adapters/` 生成物・`*.md` / `*.json` / `*.yml`） | 1 | 機械生成・宣言的データであり実行ロジックを持たない（bash でないため kcov の計測対象に元々入らない）。「分母に含めない」ことを明示する。 | schema は self-enforce CI の Schema source-of-truth check step、生成物は Generated-output diff-zero / npm pack leak check step で別系統に検証される。 | `INCLUDE_PATHS=.agents/scripts` で bash 本体のみを計測対象とし、非実行データは include されない（kcov は bash 以外を計測しない） | 本 issue `20260615_054810_カバレッジ計測の自リポ適用`（PR レビューで承認） | なし（恒久。非実行データは分母に含めない） |

---

## 段階導入の運用（閾値を下げない）

- **既定（方式 1）**: 計測対象 include を「結合テストで確実に駆動される対象」に絞り、その分母に対して **`FAIL_UNDER=100` を最初から適用**する。未駆動の対象は本台帳に登録して分母から外し、**テスト追加で順次 include に戻す**（分母を段階拡大、閾値は常に 100）。
- **過渡（方式 2・原則不使用）**: どうしても初期に 100 を組めない場合のみ、**期限付き**で初期閾値（例 90）を `FAIL_UNDER` に設定する。その場合は本台帳に**有効期限・引上げ計画・正本 §1 への過渡的逸脱である旨**を必ず明記し、恒久化しない。**既定は方式 1**であり、現状は方式 2 を採用していない。

---

## 関連ドキュメント

- 配布物正本: [.agents/COVERAGE_AND_EXCEPTIONS.md](../.agents/COVERAGE_AND_EXCEPTIONS.md)（§1 方針・§1.1 禁止パターン・§2 認定基準・§3 必須列）
- 計測スクリプト: [.agents/scripts/test/coverage-check.sh](../.agents/scripts/test/coverage-check.sh)（正本変数 `INCLUDE_PATHS` / `EXCLUDE_PATHS` / `FAIL_UNDER` / `COV_OUT`）
- CI 配線: [.github/workflows/self-enforce.yml](../.github/workflows/self-enforce.yml)（kcov 導入 step ＋ coverage step）
- 設計・実装計画: `docs/maintainer/workflow/20260615_054810_カバレッジ計測の自リポ適用/02_設計.md`・`03_実装計画.md`
