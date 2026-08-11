# ADR

```yaml
id: ADR-0047
status: proposed
title: 配布テンプレートからのdependabot.yml完全削除（config化・opt-out化ではなく）
tags: [distribution, template-sync, dependabot]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`agent-skill-chain` は `init`／`sync templates`／`setup github` を通じて `.agent-skill-chain/templates/github/.github/` 配下のファイル一式を配布先（consumer project）の `.github/` へ展開する。この配布ファイル群には `dependabot.yml`（npm・github-actionsを対象とした週次自動更新設定）が含まれており、`.agent-skill-chain/templates/github/.github.seed-only.yaml` の `paths:` にも登録されていた（ISSUE-574で導入されたseed-only区分。初回配置後の内容カスタマイズは差分として検査しないが、展開先からの完全な削除は `computeTemplateSyncDiffs`（`src/lib/template-sync.ts`）により「未同期（欠落）」として検知され続ける仕様）。

`dependabot.yml` は依存関係更新という汎用CI/CD設定であり、agent-skill-chainがドメインとする開発プロセスの調整・強制（ゲート・writer lease・4セグメント等）のいずれの仕組みからも参照・依存されていない。コード上の参照は `src/lib/template-sync.ts` 内のseed-only区分を説明するコメント1箇所（`CODEOWNERS・dependabot.yml等`という例示）のみであり、機能的な依存は無い。seed-only区分によって初回配置後のカスタマイズは許容されていたが、「配布そのものを望まない」consumer projectが一度配置された `dependabot.yml` を削除しても、`verify template-sync` 等が恒久的に「未同期（欠落）」を報告し続け、実質的に削除できない状態になっていた。

2026-08-11、ユーザーから「配布物には含めてほしくない」という直接の要望を受けてISSUE-611が起票された。検討した選択肢は次の2つである。

1. **config化・opt-out化**: `agent-skill-chain.yaml` に新規フィールド（例: `templates.dependabot.enabled`）を追加し、既定は配布するが明示的に無効化できるようにする。
2. **配布物からの完全削除**: `dependabot.yml` を配布元テンプレートツリーから削除し、`.github.seed-only.yaml` のエントリも削除する。

## Decision

選択肢2（配布物からの完全削除）を採用する。

理由:

- AGENTS.mdのUNIX原則「疑わしい機能は追加しない」に照らし、`dependabot.yml` はagent-skill-chainのいずれの強制機構（ゲート・writer lease・4セグメント・Coordination Backend）にも依存されておらず、config化してまで維持すべき機能的必然性が無い。
- config化はagent-skill-chainの設定スキーマ（`agent-skill-chain/config/v1`）に新規フィールドを追加することを意味し、AGENTS.mdが定める設定項目追加の要件（ハードコード不可の理由・プロジェクト単位で変わる必要性の正当化・スキーマ更新・既定値定義・migration定義）を満たす根拠が無い（本要望は「一律含めてほしくない」であり、プロジェクトごとに可否を分ける必要性は無い）。
- 完全削除であれば、配布元テンプレートツリーの実ファイル一覧（`computeTemplateSyncDiffs` が読む `sourceFiles`）から自然に除外され、既存の同期検査ロジック自体の変更を必要としない（`.github.seed-only.yaml` のエントリ削除のみで整合する）。

このリポジトリ自身（dogfooding）の `.github/dependabot.yml` は、このリポジトリ自身のnpm・GitHub Actions依存関係更新のために存置し続ける対象であり、配布物としての要否とは別の判断のため、本決定の対象外とする（配布元テンプレートツリーの外にあるファイルであり、本決定はそこに触れない）。

既に `dependabot.yml` が配置済みのconsumer projectについて、本決定は展開先ファイルを自動削除しない。展開先だけに存在する余剰ファイルは `computeTemplateSyncDiffs` の検査対象外（既存仕様）であるため、本決定の適用後も「未同期」としては報告されず、削除するかどうかは各consumerの判断に委ねる。

## Consequences

- 利点: 新規導入・既存導入（`upgrade`／`sync templates`）いずれの経路でも、これ以上 `dependabot.yml` がconsumer projectへ配布・強制されなくなる。設定スキーマの複雑化（新規フィールド追加）を避けられる。
- 欠点: 「dependabotによる週次自動更新」機能自体をagent-skill-chain配布物として今後 consumer に提供する手段が無くなる。将来的にこの機能を配布したいという要望が生じた場合、config化ではなくテンプレートファイルの復元（本決定のrevert相当）が必要になる。
- フォローアップ: 既に配置済みのconsumer projectの `.github/dependabot.yml` は本決定では削除されない。将来、削除を支援する仕組み（例: upgrade時の明示的なクリーンアップ案内）が必要になった場合は別Issueで検討する（本決定のスコープ外）。
