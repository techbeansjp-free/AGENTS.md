<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: 診断: Issue #208マージ後にrelease/root-cleanupワークフローが起動しない原因調査

- Issue: `ISSUE-211`
- 作成者: `spec_worker`
- 対象ブランチ: `process/211-actions-trigger-diagnosis`

## 目的・背景

Issue #208（PR #210、マージ commit `f4624d2`）のマージ後、main への push によって起動されるべき GitHub Actions ワークフロー agent-skill-chain / release（既存の実績あるワークフロー）および agent-skill-chain / root-cleanup（Issue #208 で新設したワークフロー）のいずれも一度も起動しないという異常が観測された。マージから20分以上経過した時点で、GitHub Actions の UI・API の双方で当該ワークフローの実行回数が0件であることを確認済みである。

Issue #196〜#204 のマージ（いずれも `.github/workflows/` 配下を変更しないマージ）では、agent-skill-chain / release は毎回正常に起動していた。一方 Issue #208 のマージは、`.github/workflows/agent-skill-chain-root-cleanup.yml` の新設と `.github/workflows/agent-skill-chain-reconcile.yml` の変更を含む、`.github/workflows/` 配下を変更する初めてのマージだった。またマージ時の GitHub PR 画面には「1 check was pending」という表示があり、マージ時点で何らかの check が保留状態だったことが示唆されている。本リポジトリは branch protection として比較的新しい「Rulesets」機能を使用しており、admin bypass マージとの組み合わせで GitHub Actions のトリガーに既知の相性問題が生じる可能性がある。

本 Issue は、この「マージ後にワークフローが起動しない」という異常の原因を、実地観測によって切り分けることを目的とする。原因の候補は大きく (a) `.github/workflows/` 配下を変更するマージに固有の問題、(b) admin bypass マージ全般に共通する問題、の2つである。本 Issue 自体は通常の Issue 開発フロー（spec→design→implementation→validation）で進め、`.github/workflows/` 配下を一切変更しない小さな変更（具体的な変更内容は DESIGN/PLAN 段階で確定する）を実装し、`gh pr merge --admin --squash` でマージした上で、マージ後に agent-skill-chain / release が実際に起動するかを実地確認する。

## 要求 → 要件 → 受入条件

### 要求

Issue #208 マージ後に観測された「release・root-cleanup 双方のワークフローが起動しない」という異常について、メンテナ（進行役）が原因を切り分けるための実測結果を得たい、という要求。恒久対策そのものの設計・実装は別 Issue に切り出すことを前提とし、本 Issue では診断に必要な最小限の実地観測と結論の記録のみを求める。

### 要件

- 要件1: 本 Issue 自身が実装する変更内容は `.github/workflows/` 配下を一切含まないこと。
- 要件2: 本 Issue の PR は `gh pr merge --admin --squash` によって admin bypass マージされること。
- 要件3: マージ後、GitHub Actions の UI・API の双方で agent-skill-chain / release ワークフローの起動有無を実地観測し、起動した場合は起動した事実と起動までの時間・トリガーされた commit SHA を、起動しなかった場合は一定時間（マージ後20分以上）経過してもUI・API双方で実行回数が0件であることを記録すること。
- 要件4: 観測結果に基づき、「`.github/workflows/` 配下の変更有無」を原因の主要な切り分け軸として、原因が (a) `.github/workflows/` 配下を変更するマージに固有の問題である、(b) admin bypass マージ全般に共通する問題である、(c) 今回は再現せず原因を切り分けられなかった、のいずれに該当するかを結論として明記すること。
- 要件5: 本 Issue のスコープでは、原因判明後の恒久対策（ワークフロー起動トリガーの修正、Ruleset設定の変更等）の設計・実装は行わないこと。

### 受入条件（Acceptance Criteria）

#### AC-1: 本Issue自身の変更が.github/workflows/配下を含まない

- Given: 本 Issue の PR に含まれる差分（実装セグメントで加える変更）
- When: PR の変更ファイル一覧を確認する
- Then: `.github/workflows/` 配下のファイルが1件も変更・追加・削除されていない
- 検証方法見込み: `automated`（PR差分に対する `.github/workflows/` パスの機械チェック）

#### AC-2: マージ後のrelease/root-cleanupワークフロー起動有無の実地観測と記録

- Given: 本 Issue の PR が `.github/workflows/` 配下を変更しない状態で、`gh pr merge --admin --squash` により main へマージされた直後
- When: マージ後、GitHub Actions の UI（Actions タブ）および API（`gh run list` 等）の双方で、マージ commit を対象とした agent-skill-chain / release ワークフローの実行有無を、マージ直後から少なくとも20分間観測する
- Then: 「起動した」場合は起動時刻・対象 commit SHA・実行結果を、「起動しなかった」場合は観測時間経過後もUI・API双方で実行回数が0件であったことを、それぞれ検証証跡として記録する
- 検証方法見込み: `manual`（自動化できない理由: 実際のマージという1回性のイベント直後にGitHub Actions側の外部挙動を実地観測する必要があるため。検証手順・実行者・証跡は VALIDATION.md で確定する）

#### AC-3: 観測結果に基づく原因切り分けの結論記録

- Given: AC-2 による実地観測の結果が得られている状態
- When: 観測結果（起動有無・起動した場合の時刻や対象SHA、起動しなかった場合の非起動継続時間）を、Issue #208マージ時の状況（`.github/workflows/`配下を変更、admin bypassマージ、「1 check was pending」表示）および Issue #196〜#204マージ時の状況（`.github/workflows/`配下を変更しない）と比較する
- Then: 原因が (a) `.github/workflows/` 配下を変更するマージに固有の問題である、(b) admin bypass マージ全般に共通する問題である、(c) 今回の観測のみでは切り分けられなかった、のいずれに該当するかの結論と、その結論に至った根拠が明記される
- 検証方法見込み: `manual`（自動化できない理由: AC-2の実地観測結果を人間が解釈し結論を下す性質の判断であるため。検証手順・実行者・証跡は VALIDATION.md で確定する）

## スコープ外

- 原因が判明した場合の恒久対策（ワークフロー起動トリガーの修正、Ruleset設定・admin bypassマージ運用の変更等）の設計・実装。判明した原因に応じて別 Issue で対応する。
- Issue #208 自身が新設した root-cleanup ワークフローの機能自体の再修正。
- `.github/workflows/` 配下の変更を伴う実験・再現手順（本 Issue の変更は要件1により `.github/workflows/` 配下を含まないため、この経路での再現確認は行わない）。
- Rulesets・branch protection 設定自体の変更。
