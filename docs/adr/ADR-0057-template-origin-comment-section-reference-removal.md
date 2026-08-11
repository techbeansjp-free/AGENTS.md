<!--
このファイルはAGENTS.mdが定めるADR・テンプレート・テスト適用性の規約に基づく雛形であり、Issue毎（design セグメント）に複製して使う。docs/adr/ に保存する。
<...> のプレースホルダを実際の内容に置き換えて記入すること。
-->

# ADR

```yaml
id: ADR-0057
status: proposed   # proposed | accepted | superseded | deprecated
title: テンプレート冒頭由来コメントのセクション記号参照除去とlint-references.sh走査範囲の現状維持
tags: [templates, lint-references, self-reference]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

AGENTS.mdの「参照・コメントの陳腐化防止」は、規範文書・ソースコードコメントにおけるセクション番号参照（見出しテキストをセクション記号付きで直接埋め込む記法）を、セクション追加・見出し移動のたびに参照が陳腐化しAIが誤って古い位置情報を正しいものと誤解釈する実害を理由に禁止している。

`.agent-skill-chain/templates/issue/{SPEC,DESIGN,PLAN,VALIDATION}.md`・`.agent-skill-chain/templates/adr/ADR.md` の冒頭1〜2行目は、この禁止パターンに該当する記述（「正本: AGENTS.md 」に続けてAGENTS.md側の見出し名をセクション記号付きで直接埋め込んだ記法）を含んでいた。この5ファイルはIssueが起票されるたびに各segment worker・ADR finalization workerによってIssue branch上の実成果物へ複製される雛形であるため、放置すると新規Issueが起票されるたびに全成果物へ機械的に複製・伝播し、複製時点の見出しテキストがAGENTS.md側で変更・移動された後も追随せず陳腐化した参照として残り続ける。

`.agent-skill-chain/scripts/lint-references.sh`（`agent-skill-chain lint references`）を対象ファイル単体に対して明示的に実行すると、この記述は「見出しテキストで解決できないセクション番号参照」として検出される。一方、このリポジトリのCIワークフローが実行する既定の引数無し実行（`.agent-skill-chain/templates/` を含むリポジトリ全体を走査対象に含む）では、AGENTS.md自身が同名の見出しを持つため参照が解決可能と判定され、違反として報告されなかった。調査の結果、既定走査は元々 `.agent-skill-chain/templates/` 配下を走査対象へ含んでおり（`src/lib/scan.ts` の `defaultLiveFileRoots`）、走査対象の欠落が非検出の原因ではなく、見出しテキスト解決ロジック（`src/commands/lint.ts` の `isResolvable`）が、埋め込まれた見出し名がAGENTS.md側の実在の見出しと文字列一致する場合に「解決可能」と判定し違反としない仕様であることが非検出の原因であると判明した。

以下の設計判断を要した。

1. 対象5ファイルの記述内容自体（発生源）を、見出しテキストへの直接依存に依らない表現へ書き換えるか。
2. `lint-references.sh` の走査対象・見出し解決ロジック自体を変更するか。

## Decision

対象5ファイルの冒頭由来コメントを、セクション記号による見出しテキストの直接指定を含まない表現へ書き換える（発生源の是正）。書き換え後もAGENTS.mdへの言及（どの規約に基づく雛形かという由来情報）自体は保持し、成果物の自己完結性を損なわない。

`lint-references.sh` の走査対象・見出し解決ロジックは変更しない。既定走査は元々 `.agent-skill-chain/templates/` 配下を対象に含んでおり、走査対象拡張という設計変更は不要である。見出し解決ロジック（埋め込まれた見出し名がAGENTS.md側の実在見出しと一致する場合に解決可能と判定する仕様）自体の是非は、対象5ファイルの発生源修正により実害（非検出のまま複製が伝播する状態）が解消されるため、本Issueのスコープでは変更しない。

## Consequences

- 対象5ファイルは、単体実行・既定走査のいずれの `lint-references.sh` 実行でも禁止参照違反を報告しなくなる。
- 新規Issueが起票されるたびに複製される雛形の由来コメントが、AGENTS.md側の見出し移動・番号変更の影響を受けない表現になる。
- `lint-references.sh` の走査対象・見出し解決ロジックには変更を加えないため、既存の生きたファイル（`.agent-skill-chain/` 配下・AGENTS.md自体）の検査結果への回帰は生じない。
- 見出し解決ロジック自体（埋め込まれた見出し名がAGENTS.md側の見出しと一致すれば解決可能とみなす仕様）は本Issueでは変更しないため、将来同種の記述（AGENTS.mdの見出し名をセクション記号無しで直接埋め込む記法等）が新規に混入した場合、既定走査では引き続き非検出となり得る。この残存論点への対応要否は別Issueで判断する。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |

本文（Context / Decision / Consequences）の変更が必要になった場合は、新しい ADR を作成し `supersedes` / `superseded-by` で旧 ADR との関係を記録する。既存 ADR の本文を書き換えてはならない。

## ライフサイクル

```text
DESIGNワーカー   → ADR を proposed で作成
設計レビュア     → ADR 本文をレビュー（read-only）→ content digest を承認
進行役           → adr-finalize.sh を起動
ADR finalization → writer lease を取得 → status を accepted へ更新
ワーカー           → commit・push → content digest を再検査
```
