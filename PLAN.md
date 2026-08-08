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
| 1 | AGENTS.md本体の改定 | DESIGN設計要素1のとおり、ASCIIフロー図・設定項目追加①〜⑥手順の除去、root許可リスト（散文＋ディレクトリツリーコードブロックの両方）へ`.claude/`追加、I2セルへのプロファイル軸追記を行う（除去した手続き記述の内容は変更単位3で作成するSKILL.mdへ転記する素材として保持する。「ブランチ・worktree」節の削除前チェック順は除去せず本体に残し、変更単位3で`cleanup` SKILL.mdへ重複記載する） | AC-1, AC-7 | なし |
| 2 | docs/GLOSSARY.md・docs/CONFIGURATION.md更新 | 「軽量プロファイル」「既定プロファイル」の用語行追加（20行以内維持）、`### \`profile\`` 見出しと「独立な設定軸の関係」表への行追加 | AC-7, AC-10 | なし |
| 3 | 5つのSKILL.md新規作成 | `.agent-skill-chain/templates/claude/skills/{issue-start,segment-work,gate-review,pr-merge,cleanup}/SKILL.md` を作成し、変更単位1で除去した手続き記述および設計要素2が定める各スキルの担当範囲を自己完結した内容として記載する。`gate-review` にはdesign-gate承認後のADRライフサイクル操作（`adr finalize`相当の呼び出し手順）を含める | AC-2 | 1（転記元の内容確定後） |
| 4 | 軽量プロファイル用テンプレート追加 | `.agent-skill-chain/templates/lightweight/{CLAUDE.md,agent-skill-chain.yaml}` を新設し、`@AGENTS.md` import無しのCLAUDE.md、`profile: lightweight`・`coordination.backend: local` を含む妥当な既定yamlを作成する | AC-4 | なし |
| 5 | config schema拡張 | `.agent-skill-chain/schemas/config.schema.yaml` へ `profile`（optional、`standard\|lightweight`）を追加し、`.agent-skill-chain/config/agent-skill-chain.yaml` へ `profile: standard` を明示追加する。あわせて `templates` オブジェクトの `properties` へ `claude_skills_source`・`claude_skills_target`（既存の `claude_agents_source`/`claude_agents_target` と同形式の任意 `type: string` プロパティ、`templates.required` には追加しない）を追加する | AC-4, AC-7 | なし |
| 6 | 配布マッピング拡張 | `src/lib/template-sync.ts` に `claude_skills` マッピングを追加し `computeTemplateSyncDiffs` を対応させる。`src/lib/asset-manifest.ts` の `collectManagedAssetMappings` に `profile` 引数を追加し、`CLAUDE.md`・`config`（`agent-skill-chain.yaml`のみファイル単位分解）のprofile対応ソース切替を実装する | AC-2, AC-3 | 3, 4, 5 |
| 7 | initコマンド拡張 | `src/commands/init.ts` に `--profile` 解析を追加し、`collectManagedAssetMappings` へ渡す。既存pre-flight方式（衝突時非破壊方針の維持、AC-9）は変更せず対象集合の拡大のみ適用する。軽量プロファイル選択時の標準出力メッセージ（機械的阻止が無い旨の明示、AC-5）を追加する | AC-3, AC-4, AC-5, AC-9 | 6 |
| 8 | upgradeコマンド拡張 | `src/commands/upgrade.ts` に既存 `profile` 値の読み取り・`collectManagedAssetMappings` への引き渡しを追加し、`.claude/skills/` を含む既存ミラー同期に統合する。DESIGN.md設計要素7が定める3ケース区別（ケースA: ファイル不在／ケースB: ファイルは存在するが`profile`フィールドが単純に無い正常な後方互換ケース／ケースC: パース不能または既知enum外の不正な値という異常ケース）を実装し、標準エラー出力への日本語警告メッセージはケースCでのみ出す。ケースA・Bでは警告を出さないこと、ケースCでのみ警告が出力されることを自動テストで検証する。**【design-gate 2巡目是正、要追加実装】**ケースC(ii)（パース不能）の復旧先を、危険な自動化設定を含む `packageRoot()/.agent-skill-chain/config/agent-skill-chain.yaml` から、`packageRoot()/.agent-skill-chain/templates/lightweight/agent-skill-chain.yaml`（安全側既定テンプレート、`profile` フィールドのみ `standard` へ上書き）へ変更する。あわせて、ケースCでは `collectManagedAssetMappings` が返す一覧から対象 `agent-skill-chain.yaml` の `dest` に一致するエントリを除外してから一般ミラー処理へ渡すよう変更し、ケースCの復旧処理が書き込んだ内容を一般ミラー処理が上書きしないようにする（DESIGN.md設計要素7参照。`resolvePreservedProfile`・`repairUnreadableConfig`・`defaultConfigPath` の実装修正を要する）。既存3ラウンドのimplementation-gateは本設計変更前の実装を検証したものであり、本変更点は追加ラウンドで実装・再検証する | AC-3 | 6 |
| 9 | 既定プロファイル回帰確認 | 変更単位1・6・7が既存の `init` 既定分岐（`CLAUDE.md` 常時import・既存配置ファイル・pre-flight非破壊エラー方針）を変更していないことを確認し、既存自動テストを実行する | AC-6 | 7, 8 |
| 10 | スキル説明文字数集計 | `.agent-skill-chain/scripts/skill-description-budget.sh` を新設し、変更単位3のSKILL.md群を対象に実行、結果を `.agent-skill-chain/templates/claude/DESCRIPTION_BUDGET.md`（`claude_skills` 配布マッピングのsource外、`.claude/skills/` へは配布されない）としてコミットする | AC-8 | 3 |
| 11 | レガシー検知との非干渉確認 | `src/lib/legacy-migration.ts` の `LEGACY_SKILLS_DIR`／`LEGACY_SKILL_CONTENT_MARKERS` と、変更単位3・6・7が生成する `.claude/skills/` 配下の内容が衝突しないこと（新設SKILL.mdが旧世代トークンを含まないこと、`detectLegacyAssets` の既存テストが回帰しないこと）を確認する | AC-2, AC-3 | 3, 7 |
| 12 | 自動テスト整備 | AC-2〜AC-6・AC-9・AC-10に対応する自動テスト（init/upgradeの新規プロファイル分岐、スキル配置・同期、config schema、GLOSSARY/CONFIGURATION見出し検査）を実装セグメントで追加・実行する。AC-9のテストは出力メッセージではなくpre-flight方式（対象集合拡大後も1件でも衝突があれば1件も書き込まずに停止する既存の衝突時非破壊方針が維持されること）を検証対象とする。**【design-gate 2巡目是正、要追加実装】**(a) ケースC(ii)復旧後の `agent-skill-chain.yaml` が `merge.autonomous` 等の危険な自動化設定を含まず `profile: standard` であることを検証する回帰テスト、(b) `config` ディレクトリの所有権記録キー（DESIGN.md設計要素5「移行方針」参照。新旧キー形式混在時に `resolveStaleAssets` が実在ファイルを削除候補と誤判定しないこと）を検証する回帰テストを追加する | AC-2, AC-3, AC-4, AC-6, AC-9, AC-10 | 1〜9, 11 |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。

AC-1（AGENTS.md本体の判定基準適合・150行以内）・AC-7（I2セル・GLOSSARY用語の整合）は `hybrid` 検証（目視確認＋`verify-doc-length.sh`自動検査）であり、変更単位1・2の完了時点で実装セグメントが `.agent-skill-chain/ci/verify-doc-length.sh` を実行し行数を確定させる。AC-8は `manual` 検証であり、変更単位10完了後にゲートレビュアが `DESCRIPTION_BUDGET.md` の内容を確認する。
