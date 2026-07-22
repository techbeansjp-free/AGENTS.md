# ADR

```yaml
id: ADR-0005
status: proposed
title: リリース版数をpackage.json semverへ統一し、版数bumpコミットをmainへPR経由(admin merge)で反映し、marketplace/apm公開を廃止する
tags: [release, versioning, distribution, github-actions, branch-protection]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

agent-skill-chain 新実装（PR #191 でmainへマージ）には、旧実装の `.github/workflows/release.yml` に相当するリリース自動化が存在せず、mainのGitHub Releaseは統合マージ以降更新が止まっている。ISSUE-196 でリリース自動化を復元するにあたり、恒久的に効く2つの判断を確定する必要がある。

第1に版数体系。旧実装は `package.json` を `npm version patch` で semver bump する一方、実際のgitタグ・GitHub Release は JST日時形式 `vYYYYMMDD.HHMMSS` という別体系で生成していた。この二重体系が、ISSUE-196 の SPEC レビューで「バージョンが後退しないとは何に対してか」を曖昧にし、AC-5 の重大な不明確さの原因になった。後続の実装・検証が同じ罠を踏まないよう、版数体系そのものを設計判断として固定する必要がある。

第2に、自動リリースが行う版数bumpコミットを main へどう反映するか。自動化は `package.json` の `version` を書き換えるコミットを main に着地させる必要があるが、main は branch protection 下にあり、AGENTS.md 不変条件 I4 は「mainへの変更はPR経由のみ」を上書き不可の規約として要求する。旧設計案はこのコミットを bypass_actor 登録済み admin PAT で main へ生pushする恒久機構を採ったが、これは I4 と正面から緊張する恒久判断であるにもかかわらず ADR に未記載であった。可修復な外部要因（ゲートCIの `ANTHROPIC_API_KEY` 等 secrets 未設定）を理由に I4 違反を恒久アーキテクチャへ焼き込むべきではない、という設計ゲートの反証レビューを受け、この点を恒久判断として確定する。

第3に配布物公開の範囲。旧実装は `release-marketplace`・`apm-release` ジョブで Claude/Cursor marketplace パッケージと apm パッケージの生成物を公開していた。しかし新パッケージは npm レジストリを経由せず `npx github:techbeansjp-free/AGENTS.md` によるGitHub直接参照配備を主導線とし、配布前提が旧実装と異なる。加えて、現存する `.claude-plugin/marketplace.json` は既に削除済みのパス（`.agent-skill-chain/source/`・存在しない `.adapters/claude`）を参照したまま放置され、リポジトリの実態と矛盾している。

## Decision

**版数体系**: リリース版数は `package.json` の semver を唯一の正本とする。gitタグは `v<semver>`、GitHub Release の tag/name も同一文字列とし、`package.json`・タグ・Release の3者を常に単一の `target` 値から生成して定義上一致させる。日時形式など semver 以外の版数体系は採用しない。後退禁止（ISSUE-196 要件4）の比較は semver 正規表現 `^v[0-9]+\.[0-9]+\.[0-9]+$` に一致する既存タグのみを対象とし、旧日時形式タグ（`v20260720.060726` 等）は非一致として比較から機械的に除外する。これにより「新旧版数体系をまたいだ比較をしない」を体系選択自体で保証する。

**版数bumpコミットのmain反映方式（I4適合）**: 版数bumpコミットは main へ生pushせず、必ずPRを経由して反映する。自動化は短命ブランチ `release/bump-v<target>` 上に `chore(release): v<target> [skip ci]` コミットを作成・pushし、`gh pr create` で機械生成の版数台帳更新PRを起こし、`gh pr merge --admin --squash` でマージする。このマージは required status check を bypass するが、それは進行役に標準承認済みの `gh pr merge --admin` 運用（ruleset の bypass_actor に登録済みの admin 権限、secret `RELEASE_MAIN_PAT`）と同一の特権操作である。I4 が求めるのは「PR経由」であって「全チェックが緑であること」ではないため、生pushをPR経由 admin merge へ置き換えることで I4 の文言上の要求を満たしつつ、ゲートCIの secrets 未設定という可修復な別問題には一切依存しない構造とする。このbump PRは SPEC/DESIGN/PLAN/VALIDATION を伴わない機械生成の版数台帳更新のみのPRであり、Issue成果物ではなく、既に承認済みの決定（本ADRを含む ISSUE-196 の design-gate 承認）の機械的執行に過ぎない。したがって4セグメントゲート（Check Run必須）の対象外として扱う。ブランチ名に `target` 版数を含めることで同一版数のbumpブランチ・PRの重複作成を自然に防ぐ。

**配布物公開の範囲**: 旧 `release-marketplace`・`apm-release` に相当する marketplace/apm 生成物の公開ジョブは新実装で踏襲せず廃止する。主導線 `npx github:...` は生成物公開を要さないためである。併せて、実態と矛盾し誤解を招く `.claude-plugin/marketplace.json` を ISSUE-196 の実装で削除する。

## Consequences

- リリース版数の後退判定・整合判定が単一 semver 軸に閉じ、旧実装の二重体系に起因する曖昧さが解消される。実装・検証は semver 比較1本で AC-4/AC-5 を機械検証できる。
- 初回の自動リリースは、既存の semver 一致タグが無いため `package.json` 現行版数 `0.2.0` を seed として patch 加算した `v0.2.1` となる。旧日時形式タグは以後のリリース系列に一切影響しない。
- 版数bumpが main へ生pushされず必ずPR経由 admin merge で反映されることで、I4「mainへの変更はPR経由のみ」を文言通り満たす。branch protection の緩和や生push特権を恒久機構へ焼き込まず、既に運用中の admin merge 特権と同一の権限モデルに収まる。ゲートCIの secrets 未設定という別問題からリリース自動化が切り離され、当該問題の解消有無に関わらずリリースが機能する。
- bump PR は機械生成の版数台帳更新（Issue非成果物）として4セグメントゲートの対象外である。ただし bump の main 反映には bypass_actor 登録済み admin 資格情報（`RELEASE_MAIN_PAT`）が必要であり、この特権が漏洩・誤用されれば任意コミットの無検査マージに悪用されうる。secret の最小権限管理（bump PR の admin merge 用途に限定）と失効時の再登録運用を前提とする。生push権限が不要になった分、旧設計より攻撃面は縮小する。
- admin merge が failした残骸として stale な bumpブランチ・PR が生じうる。次runは同一 `target` の既存ブランチ・PRを再利用してマージを再試行し、`target` が進んだ場合の stale PR は掃除対象となる（自己修復・冪等性は維持される）。
- marketplace/apm 経路の利用者がいた場合、その配布は停止する。現時点で主導線は `npx github:...` に一本化されているため実害は想定しないが、将来 marketplace 配布を再開する場合は本ADRを別ADRでsupersedeし、正しい生成元パスに基づく `marketplace.json` の再構築と公開ジョブの再設計を要する。
- `.claude-plugin/marketplace.json` の削除により、stale なパス参照によるツール・利用者の誤解が解消される。
