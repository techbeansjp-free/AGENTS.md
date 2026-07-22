# ADR

```yaml
id: ADR-0005
status: proposed
title: リリース版数をpackage.json semverへ統一しmarketplace/apm公開を廃止する
tags: [release, versioning, distribution, github-actions]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

agent-skill-chain 新実装（PR #191 でmainへマージ）には、旧実装の `.github/workflows/release.yml` に相当するリリース自動化が存在せず、mainのGitHub Releaseは統合マージ以降更新が止まっている。ISSUE-196 でリリース自動化を復元するにあたり、恒久的に効く2つの判断を確定する必要がある。

第1に版数体系。旧実装は `package.json` を `npm version patch` で semver bump する一方、実際のgitタグ・GitHub Release は JST日時形式 `vYYYYMMDD.HHMMSS` という別体系で生成していた。この二重体系が、ISSUE-196 の SPEC レビューで「バージョンが後退しないとは何に対してか」を曖昧にし、AC-5 の重大な不明確さの原因になった。後続の実装・検証が同じ罠を踏まないよう、版数体系そのものを設計判断として固定する必要がある。

第2に配布物公開の範囲。旧実装は `release-marketplace`・`apm-release` ジョブで Claude/Cursor marketplace パッケージと apm パッケージの生成物を公開していた。しかし新パッケージは npm レジストリを経由せず `npx github:techbeansjp-free/AGENTS.md` によるGitHub直接参照配備を主導線とし、配布前提が旧実装と異なる。加えて、現存する `.claude-plugin/marketplace.json` は既に削除済みのパス（`.agent-skill-chain/source/`・存在しない `.adapters/claude`）を参照したまま放置され、リポジトリの実態と矛盾している。

## Decision

**版数体系**: リリース版数は `package.json` の semver を唯一の正本とする。gitタグは `v<semver>`、GitHub Release の tag/name も同一文字列とし、`package.json`・タグ・Release の3者を常に単一の `target` 値から生成して定義上一致させる。日時形式など semver 以外の版数体系は採用しない。後退禁止（ISSUE-196 要件4）の比較は semver 正規表現 `^v[0-9]+\.[0-9]+\.[0-9]+$` に一致する既存タグのみを対象とし、旧日時形式タグ（`v20260720.060726` 等）は非一致として比較から機械的に除外する。これにより「新旧版数体系をまたいだ比較をしない」を体系選択自体で保証する。

**配布物公開の範囲**: 旧 `release-marketplace`・`apm-release` に相当する marketplace/apm 生成物の公開ジョブは新実装で踏襲せず廃止する。主導線 `npx github:...` は生成物公開を要さないためである。併せて、実態と矛盾し誤解を招く `.claude-plugin/marketplace.json` を ISSUE-196 の実装で削除する。

## Consequences

- リリース版数の後退判定・整合判定が単一 semver 軸に閉じ、旧実装の二重体系に起因する曖昧さが解消される。実装・検証は semver 比較1本で AC-4/AC-5 を機械検証できる。
- 初回の自動リリースは、既存の semver 一致タグが無いため `package.json` 現行版数 `0.2.0` を seed として patch 加算した `v0.2.1` となる。旧日時形式タグは以後のリリース系列に一切影響しない。
- marketplace/apm 経路の利用者がいた場合、その配布は停止する。現時点で主導線は `npx github:...` に一本化されているため実害は想定しないが、将来 marketplace 配布を再開する場合は本ADRを別ADRでsupersedeし、正しい生成元パスに基づく `marketplace.json` の再構築と公開ジョブの再設計を要する。
- `.claude-plugin/marketplace.json` の削除により、stale なパス参照によるツール・利用者の誤解が解消される。
