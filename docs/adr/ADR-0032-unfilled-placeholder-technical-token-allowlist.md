# ADR

```yaml
id: ADR-0032
status: proposed
title: 未置換プレースホルダ判定における技術トークン許容リストによる誤検出解消
tags: [verify, spec-gate, design-gate, bdd, false-positive]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`.agent-skill-chain/scripts/verify-spec-bdd.sh`（`src/commands/verify.ts` の `specBdd()`）と `verify design-diagram`（`designDiagram()`）は、共有正規表現 `UNFILLED_PLACEHOLDER_RE = /<[^<>\n]*>/` を使い、検査対象フィールド値に `<...>` 部分文字列が1つでも含まれれば未置換プレースホルダとみなしてきた。この判定は、フィールド値が実内容で埋まっていても、AGENTS.md 自身やテンプレートが一般的に使う正当なパス変数表記（例: `reviews/<gate>.yaml` の `<gate>`、`.worktrees/<YYYYMMDD_HHMMSS>-...` の `<YYYYMMDD_HHMMSS>`）が1箇所でも含まれるだけで誤検出する。実際に Issue #449（`review:light` 軽量レビュープロファイル導入）の SPEC.md AC-10 Then フィールドがこの誤検出に該当し、PR #460 は SPEC.md 初回commit以降 `verify` ジョブが恒久的にfailし続け、`gh pr merge --admin` によるブランチ保護回避でしかマージできなかった。

SPEC.md は承認後の編集が原則不可であり（AGENTS.md I2）、一度この誤検出パターンに該当すると当該Issueのライフサイクル終了までCIをgreenにできない。SPEC.md（Issue #461）の未決事項1は、実現アプローチとして (a) テンプレート側のプレースホルダ表記を `<...>` と衝突しない別記法（例: `{{要約}}`）へ変更する、(b) 判定ロジック側で既知の非プレースホルダパターン（パス文脈で使われる短い `<...>` 表記）を除外する、(c) Given/When/Then内の `<...>` は原則プレースホルダとみなさず要約行のみを検査対象にする、の3案を挙げ、技術的検証をdesignセグメントの責務とした。

検討したトレードオフ：

- (a) テンプレート表記変更案：`<...>` を `{{...}}` 等へ変更すれば構文的な衝突は原理的に解消するが、`.agent-skill-chain/templates/issue/{SPEC,DESIGN,PLAN,VALIDATION}.md` 全体の記法変更を伴い、AGENTS.md 本文中の説明（「`<...>` のプレースホルダを実際の内容に置き換えて記入すること」という各テンプレート冒頭コメント）や、進行役・各ワーカーへの周知済み慣行との整合を取り直す必要がある。本Issueのスコープ（`specBdd()`/`designDiagram()` の誤検出解消）に対して変更範囲が広すぎるため採らない。
- (c) Given/When/Then等を検査対象から外す案：要約行のみの検査に縮小すると、Given/When/Then・検証方法見込みフィールドに実際にテンプレートプレースホルダが残っていても検出できなくなり、要件1（既存の真陽性検出能力を損なわない）に反する。採らない。
- (b) 判定ロジック側での既知パターン除外案：`.agent-skill-chain/templates/issue/` が実際に使うプレースホルダ（`<受入条件の要約>`・`<前提条件>`・`<操作・イベント>`・`<期待される結果>`・`` `<automated | manual | hybrid>` ``・`` `<要 | 不要>` `` 等）は全て日本語文字を含むか、空白または `|` を含む複数語表現である。一方、AGENTS.md やテンプレートが使う正当なパス変数表記（`<gate>`・`<YYYYMMDD_HHMMSS>`・`<type>`・`<issue-id>`・`<slug>` 等）は全てASCII英字で始まり英数字・アンダースコア・ハイフンのみで構成される単一の短いトークンである。この構文的な違いは偶然の一致ではなく、日本語での説明的プレースホルダと英語の技術的識別子という表記慣行の違いに起因するため、既存テンプレート・既存文書のいずれも変更せずに機械的に判別できる。テンプレート・文書側の変更を要さず、本Issueのスコープに閉じた最小の修正であるため採用する。

## Decision

`src/commands/verify.ts` に技術トークン判定用の正規表現 `TECHNICAL_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_-]*$/` と、フィールド値中の全ての `<...>` 区間を走査してこの正規表現に一致しない区間が1つでもあれば真を返す `hasUnfilledPlaceholder(value: string): boolean` を新設する。`specBdd()`・`designDiagram()` 内の `UNFILLED_PLACEHOLDER_RE.test(...)` の呼び出し箇所（5箇所）を全て `hasUnfilledPlaceholder(...)` に置き換える。エラーメッセージ・終了コード・検査対象フィールドの構成はいずれも変更しない。

判定は「値全体が単一のプレースホルダか」ではなく「値中に出現する各 `<...>` 区間が個別に技術トークンかどうか」で行う。これにより、実内容化された文の一部に説明的プレースホルダが未置換のまま残っているケース（例:「ログイン後、`<期待される結果>` へ遷移する」）は、それ以外の部分が実内容であっても引き続き検出される。

## Consequences

- 利点: `specBdd()`/`designDiagram()` の誤検出（Issue #461 の直接原因）が解消し、SPEC.md/DESIGN.md 承認後編集不可の制約下でCIが恒久failする事故を防ぐ。テンプレート・既存文書側の変更は不要で、修正範囲が `src/commands/verify.ts` の判定ロジックとそのテストに閉じる。
- 欠点・フォローアップ: `TECHNICAL_TOKEN_RE` は現行の `.agent-skill-chain/templates/issue/` のプレースホルダ表記（日本語または空白・`|` を含む）を前提にした経験的な許容リストであり、将来テンプレートのプレースホルダ表記自体が変更された場合（AGENTS.md の規約変更・ADRを要する）は、本判定ロジックの前提を再検証する必要がある。
- スコープ外の扱い: 本Issueで解消するのは `specBdd()`/`designDiagram()` の2箇所のみであり、他の `verify` サブコマンドにおける同種の誤検出リスクの洗い出しはSPEC.mdのスコープ外とする。誤検出により `--admin` マージで回避済みの既存PR（例: PR #460）に対する事後対応（再検証・CI再実行等）の要否は、本Issueのマージ後に進行役が別途判断する。
