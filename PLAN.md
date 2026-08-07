<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: PLAN.md。DESIGN.md とは別ファイル）。
設計（何を・なぜ・どの構造にするか）と実装計画（どの順序で・どの変更単位で実装するか）は責務が異なる。
実装途中で作業順序だけを見直す場合、DESIGN.md 自体を変更する必要はない。
-->

# PLAN: ADR-0023を実装し、常時規律モデルとは別にスキル経由のオンデマンド軽量プロファイルを提供する

- Issue: `ISSUE-503`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | AGENTS.md本体の改定 | DESIGN設計要素1のとおり、ASCIIフロー図・設定項目追加①〜⑥手順の除去、root許可リストへ`.claude/`追加、I2セルへのプロファイル軸追記を行う（除去した手続き記述の内容は変更単位3で作成するSKILL.mdへ転記する素材として保持する） | AC-1, AC-7 | なし |
| 2 | docs/GLOSSARY.md・docs/CONFIGURATION.md更新 | 「軽量プロファイル」「既定プロファイル」の用語行追加（20行以内維持）、`### \`profile\`` 見出しと「独立な設定軸の関係」表への行追加 | AC-7, AC-10 | なし |
| 3 | 5つのSKILL.md新規作成 | `.agent-skill-chain/templates/claude/skills/{issue-start,segment-work,gate-review,pr-merge,cleanup}/SKILL.md` を作成し、変更単位1で除去した手続き記述および設計要素2が定める各スキルの担当範囲を自己完結した内容として記載する | AC-2 | 1（転記元の内容確定後） |
| 4 | 軽量プロファイル用テンプレート追加 | `.agent-skill-chain/templates/lightweight/{CLAUDE.md,agent-skill-chain.yaml}` を新設し、`@AGENTS.md` import無しのCLAUDE.md、`profile: lightweight`・`coordination.backend: local` を含む妥当な既定yamlを作成する | AC-4 | なし |
| 5 | config schema拡張 | `.agent-skill-chain/schemas/config.schema.yaml` へ `profile`（optional、`standard\|lightweight`）を追加し、`.agent-skill-chain/config/agent-skill-chain.yaml` へ `profile: standard` を明示追加する | AC-4, AC-7 | なし |
| 6 | 配布マッピング拡張 | `src/lib/template-sync.ts` に `claude_skills` マッピングを追加し `computeTemplateSyncDiffs` を対応させる。`src/lib/asset-manifest.ts` の `collectManagedAssetMappings` に `profile` 引数を追加し、`CLAUDE.md`・`config`（`agent-skill-chain.yaml`のみファイル単位分解）のprofile対応ソース切替を実装する | AC-2, AC-3 | 3, 4, 5 |
| 7 | initコマンド拡張 | `src/commands/init.ts` に `--profile` 解析を追加し、`collectManagedAssetMappings` へ渡す。既存pre-flight方式は変更せず対象集合の拡大のみ適用する。軽量プロファイル選択時の標準出力メッセージを追加する | AC-3, AC-4, AC-5, AC-9 | 6 |
| 8 | upgradeコマンド拡張 | `src/commands/upgrade.ts` に既存 `profile` 値の読み取り・`collectManagedAssetMappings` への引き渡しを追加し、`.claude/skills/` を含む既存ミラー同期に統合する | AC-3 | 6 |
| 9 | 既定プロファイル回帰確認 | 変更単位1・6・7が既存の `init` 既定分岐（`CLAUDE.md` 常時import・既存配置ファイル・pre-flight非破壊エラー方針）を変更していないことを確認し、既存自動テストを実行する | AC-6 | 7, 8 |
| 10 | スキル説明文字数集計 | `.agent-skill-chain/scripts/skill-description-budget.sh` を新設し、変更単位3のSKILL.md群を対象に実行、結果を `.agent-skill-chain/templates/claude/skills/DESCRIPTION_BUDGET.md` としてコミットする | AC-8 | 3 |
| 11 | レガシー検知との非干渉確認 | `src/lib/legacy-migration.ts` の `LEGACY_SKILLS_DIR`／`LEGACY_SKILL_CONTENT_MARKERS` と、変更単位3・6・7が生成する `.claude/skills/` 配下の内容が衝突しないこと（新設SKILL.mdが旧世代トークンを含まないこと、`detectLegacyAssets` の既存テストが回帰しないこと）を確認する | AC-2, AC-3 | 3, 7 |
| 12 | 自動テスト整備 | AC-2〜AC-6・AC-9・AC-10に対応する自動テスト（init/upgradeの新規プロファイル分岐、スキル配置・同期、config schema、GLOSSARY/CONFIGURATION見出し検査）を実装セグメントで追加・実行する | AC-2, AC-3, AC-4, AC-6, AC-9, AC-10 | 1〜9, 11 |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。

AC-1（AGENTS.md本体の判定基準適合・150行以内）・AC-7（I2セル・GLOSSARY用語の整合）は `hybrid` 検証（目視確認＋`verify-doc-length.sh`自動検査）であり、変更単位1・2の完了時点で実装セグメントが `.agent-skill-chain/ci/verify-doc-length.sh` を実行し行数を確定させる。AC-8は `manual` 検証であり、変更単位10完了後にゲートレビュアが `DESCRIPTION_BUDGET.md` の内容を確認する。
