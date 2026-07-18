# COVERAGE_EXCEPTIONS.md — 本リポ（自己拡張の消費者）の例外台帳（実データ）

本ファイルは配布物正本 [.agent-skill-chain/source/COVERAGE_AND_EXCEPTIONS.md](../source/COVERAGE_AND_EXCEPTIONS.md) 第3章の必須列に従う、本リポジトリの**カバレッジ例外台帳（実データ）**である。列定義・認定基準（第2章の 1〜4）・100% 方針・禁止パターンは**正本を参照**し、本台帳では重複定義しない（DRY）。本台帳は**実データ行のみ**を持つ。

- **二重化（A↔B）**: 「適用手段」列に記載した kcov のパス除外オプション（`--exclude-path` に渡すパス）は、計測スクリプト [test/coverage-check.sh](../../test/coverage-check.sh) の `EXCLUDE_PATHS`（正本変数・除外 A）と**一致させること**。片方だけの除外（A のみ・B のみ）は禁止（正本 §1）。
- **100% の分母**: 計測対象（分母）は `INCLUDE_PATHS=.agent-skill-chain/source/scripts` 配下の**実行ロジックを持つ bash 本体**。本台帳に載せた対象を分母から外したうえで、**残りの計測対象に対して `FAIL_UNDER=100` を強制**する（閾値は下げない）。**`INCLUDE_PATHS` は意図的に `source/scripts` へ限定しており、`.agent-skill-chain/source/enforcement/` 配下の bash（`ci/audit.sh`・`claude/PreToolUse.sh`・`claude/PostToolUse.sh` 等）は分母から除外される。この除外は本台帳（下記 COV-004）で明示し、「台帳なしの除外」（正本 §1.1 禁止パターン）に該当しないようにする。**
- **行単位 ignore 不使用**: bash には行単位無視の公式手段が無いため、除外は**パス単位（kcov `--exclude-path` / `--exclude-pattern`）＋本台帳**の二重化のみで行う（行 pragma は使わない）。

---

## 分母外（参考・カテゴリ付与対象外）

次は、正本 [`.agent-skill-chain/source/COVERAGE_AND_EXCEPTIONS.md` 第2章](../source/COVERAGE_AND_EXCEPTIONS.md) のカテゴリ 1〜4 のいずれにも該当しない。「除外」ではなく「計測対象（`INCLUDE_PATHS`）に元々含まれない」という事実の注記であり、台帳表のカテゴリ列は持たせない。

- **`test/`**（`test-*.sh` / `e2e-*.sh` / `run-all.sh` / `coverage-check.sh`）: `INCLUDE_PATHS=.agent-skill-chain/source/scripts` の配下ではない（リポルート `test/`）ため分母に元々入らない。テスト自身は計測の駆動元であり、テストのテストを分母に入れると循環し意味が無い（テスト駆動の対象外。手書きのテストスクリプト群であり「機械生成コード」（カテゴリ1）には該当しないため、台帳表からは分離する）。これらは self-enforce CI の各 step（E2E install/uninstall・audit）と `run-all.sh` 経由で実行され、結果が確認される（CI ジョブ `self-enforce`）。承認: 本 issue `20260615_054810_カバレッジ計測の自リポ適用` / `20260615_105835_自己テスト基盤をtestへ移設`（PR レビューで承認）。

---

## 例外台帳（実データ）

| ID | 対象 | カテゴリ | 理由 | 代替保証 | 適用手段 | 承認 | 有効期限 |
|----|------|----------|------|----------|----------|------|----------|
| COV-002 | `.agent-skill-chain/source/scripts/lib/deploy-skills.sh` | 4 | 結合テストで直接駆動されない薄い配備補助。単体で計測するコストが成果に見合わない。 | install/uninstall E2E（`test/e2e-install-uninstall.sh`・CI ジョブ `self-enforce` の Install/uninstall & encapsulation E2E step）で配備結果が間接的に検証される。 | kcov `--exclude-path=.agent-skill-chain/source/scripts/lib/deploy-skills.sh` | 本 issue `20260615_054810_カバレッジ計測の自リポ適用`（PR レビューで承認） | リファクタで結合テストから直接駆動できるようになり次第、台帳から外して分母に戻す |
| COV-003 | テンプレート・設定・スキーマ・生成物・非実行データ（`.agent-skill-chain/runtime/templates/`・`.agent-skill-chain/source/ledger/schema.sql`・`.adapters/` 生成物・`*.md` / `*.json` / `*.yml`） | 1 | 機械生成・宣言的データであり実行ロジックを持たない（bash でないため kcov の計測対象に元々入らない）。「分母に含めない」ことを明示する。 | schema は self-enforce CI の Schema source-of-truth check step、生成物は Generated-output diff-zero / npm pack leak check step で別系統に検証される。 | `INCLUDE_PATHS=.agent-skill-chain/source/scripts` で bash 本体のみを計測対象とし、非実行データは include されない（kcov は bash 以外を計測しない） | 本 issue `20260615_054810_カバレッジ計測の自リポ適用`（PR レビューで承認） | なし（恒久。非実行データは分母に含めない） |
| COV-004 | `.agent-skill-chain/source/enforcement/` 配下の bash（`ci/audit.sh`・`claude/PreToolUse.sh`・`claude/PostToolUse.sh` 等） | 4 | `INCLUDE_PATHS=.agent-skill-chain/source/scripts` に固定しているため enforcement 配下の bash は計測対象（分母）に元々含まれないが、正本 §1.1「台帳なし除外の禁止」に抵触しないよう本行で明示する。単体カバレッジ計測を新設するコスト（INCLUDE_PATHS 拡大）は大規模なため、低コストで規約準拠となる台帳行方式を採る。 | self-enforce CI の各 step（audit 実行・E2E install/uninstall 等）で動作結果が検証される（CI ジョブ `self-enforce`）。 | `INCLUDE_PATHS=.agent-skill-chain/source/scripts` の配下ではない（`enforcement/` 配下）ため分母に元々入らない＝`--exclude-path` 指定は不要。 | 本 issue `20260718_041240_プロジェクト上書きモデル選定整合`（F-2、PR レビューで承認） | なし（恒久。INCLUDE_PATHS 方針を変更しない限り enforcement 配下は分母外） |

---

## 段階導入の運用（閾値を下げない）

- **既定（方式 1）**: 計測対象 include を「結合テストで確実に駆動される対象」に絞り、その分母に対して **`FAIL_UNDER=100` を最初から適用**する。未駆動の対象は本台帳に登録して分母から外し、**テスト追加で順次 include に戻す**（分母を段階拡大、閾値は常に 100）。
- **過渡（方式 2・原則不使用）**: どうしても初期に 100 を組めない場合のみ、**期限付き**で初期閾値（例 90）を `FAIL_UNDER` に設定する。その場合は本台帳に**有効期限・引上げ計画・正本 §1 への過渡的逸脱である旨**を必ず明記し、恒久化しない。**既定は方式 1**であり、現状は方式 2 を採用していない。

---

## 関連ドキュメント

- 配布物正本: [.agent-skill-chain/source/COVERAGE_AND_EXCEPTIONS.md](../source/COVERAGE_AND_EXCEPTIONS.md)（§1 方針・§1.1 禁止パターン・§2 認定基準・§3 必須列）
- 計測スクリプト: [test/coverage-check.sh](../../test/coverage-check.sh)（正本変数 `INCLUDE_PATHS` / `EXCLUDE_PATHS` / `FAIL_UNDER` / `COV_OUT`）
- CI 配線: [.github/workflows/self-enforce.yml](../../.github/workflows/self-enforce.yml)（kcov 導入 step ＋ coverage step）
- 設計・実装計画: `docs/maintainer/workflow/20260615_054810_カバレッジ計測の自リポ適用/02_設計.md`・`03_実装計画.md`
