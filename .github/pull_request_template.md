<!--
正本: AGENTS.md §4セグメント・4ゲート / §成果物の自己完結性
1 Issue = 1 ブランチ = 1 worktree = 1 PR。このPRのheadブランチへ、spec/design/implementation/validation
の各セグメントワーカーが順にcommit/pushする。セグメントゲートはGitHubモードではガイドラインであり
自動CI強制は無い（AGENTS.md I2）。実施要否は進行役が判断するため、このテンプレートでの自己申告は不要。
-->

## Issue

Closes #<issue-id>

## 変更概要

<変更概要をここに記述>

## 理由

<理由をここに記述>

## 影響範囲

<影響範囲をここに記述>

## ロールバック方針

<ロールバック方針をここに記述>

## 成果物リンク

<成果物リンクをここに記述>

## このPRに含まれるセグメント

- [ ] spec
- [ ] design
- [ ] implementation
- [ ] validation

## 自己完結性チェック（AGENTS.md §成果物の自己完結性・§参照・コメントの陳腐化防止）

- [ ] 変更した成果物（SPEC.md / DESIGN.md / PLAN.md / VALIDATION.md / ADR 等）は、外部参照に意味を委譲せず、目的・制約・完了条件等を自身の内部に記載している
- [ ] 規範文書・ソースコードコメントに、セクション番号参照・ファイルパス＋行番号参照を新たに追加していない
