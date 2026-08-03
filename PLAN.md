# PLAN: プロジェクトポリシーへのCI確認義務・Codex実装委譲ロールの正規commit化

- Issue: `ISSUE-340`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md で定義した設計要素を、どの順序で・どの単位に分割して実装するかを記述する。各変更単位は対応する AC-ID を明示する。3変更単位はいずれも独立しており依存関係が無いため、任意の順で適用可能だが、参照整合性（manifestが参照するファイルの先行存在）を意識し以下の順で実施する。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `RULES.md追記` | 「追加規約」箇条書きの末尾に、PR作成後のCI確認義務を定める5項目目を一言一句そのまま追記する | `AC-1` | なし |
| 2 | `interactive-implementation-delegation.md新規作成` | `.agent-skill-chain/project/`直下（`roles/`ディレクトリ配下ではない）に新規作成し、(a) Codex CLIへのreasoning effort `high`（実装者判断で`xhigh`許可）委譲、(b) 委譲がcommitを正当化する4条件（Issue・ブランチ・worktree文脈内／writer lease取得済み／実行主体がセグメント作業ワーカー(I5)／implementation-gate通過）、(c) 正規Issueフローのimplementation segment workerへの非影響、(d) `xhigh`格上げと`model_selection.ordinary.behavior: explicit_selection`・`MODEL_TIER_TABLE.md`恒久設定原則との適用範囲排他性、を本文中に記述する | `AC-3` | なし |
| 3 | `manifest.yaml更新` | `project.policy_version` を `2→3` へ、`documents.common` の末尾に `interactive-implementation-delegation.md` を追加する（`documents.roles` は変更しない） | `AC-2` | `#2`（参照先ファイルの存在を先に確定させるため） |
| 4 | `commit・push・Draft PR作成` | #1〜#3の変更を1コミットにまとめ、`process/340-policy-ci-check-codex-role` へpushし、`Closes #340` を含むDraft PRを作成する | `AC-4` | `#1, #2, #3` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## ゲートレビュー実施方針

変更単位#1〜#3が変更する3ファイル（`RULES.md`・`interactive-implementation-delegation.md`・`manifest.yaml`）はいずれも `.agent-skill-chain/project/manifest.yaml` の `model_selection.core_review.triggers.path_prefixes` に登録された `.agent-skill-chain/project/` 配下に存在するため、各セグメントゲート（design-gate・implementation-gate・validation-gate）は `required_profile: strict` の対象となる。具体的には、専任2体のレビュアが `model_tier: frontier_coding` かつ `reasoning_tier: maximum_reasoning` の能力証明を満たした上でレビューを実施し、レビュア確保が不可能な場合は人間判断（`human_required`）へ昇格する。本Issueのspec-gate以降の各ゲートは、進行役がこの判定に基づきstrict profile（2名独立レビュア）でレビューを実施する。AC-1・AC-3の検証方法見込みが`hybrid`（前提条件：3件のCI検査通過、実質的検証：strict profile独立2レビュアの目視確認）である以上、design-gate以降で実施されるこのstrict profileレビューが両ACの内容面（一言一句一致・(a)〜(d)の記載整合性）を検証する唯一の実質的手段であり、CI通過はレビュー実施の代替にはならない。

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。

本Issueの3変更（#1〜#3）はいずれも独立した静的ファイル変更であり、#3が#2に依存する以外の順序制約は無いため、実装セグメントでの並び替えは低リスクである。
