# DESIGN: verify spec-bdd / verify design-diagram が本文中の正当な `<...>` パス変数表記を未置換プレースホルダと誤判定する不具合を修正する

- Issue: `ISSUE-461`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| 要件1・AC-2・AC-5 | `hasUnfilledPlaceholder()`（`src/commands/verify.ts`） | テンプレート由来プレースホルダ（`<受入条件の要約>`・`<前提条件>`・`<操作・イベント>`・`<期待される結果>`・`` `<automated \| manual \| hybrid>` ``・`` `<要 \| 不要>` ``）は全て日本語文字または空白・`\|` を含むため、修正後も引き続き検出対象になる |
| 要件2・AC-1・AC-4 | `hasUnfilledPlaceholder()` 内の `TECHNICAL_TOKEN_RE` 判定 | `<gate>`・`<YYYYMMDD_HHMMSS>`・`<type>`・`<issue-id>`・`<slug>` のようなASCII英字始まり・英数字/アンダースコア/ハイフンのみの短いトークンは「正当なパス変数表記」とみなし、それ単独ではプレースホルダと判定しない |
| 要件3・AC-3 | `hasUnfilledPlaceholder()` の全 `<...>` 走査（部分一致対応） | フィールド値全体ではなく値中に出現する全ての `<...>` 区間を個別に判定するため、実内容化された文の一部に説明的プレースホルダ（例: `<期待される結果>`）が残っていれば検出する |
| 要件4 | `specBdd()`・`designDiagram()` の両方が同一の `hasUnfilledPlaceholder()` を呼び出す | 判定関数を1つに集約し、検査対象（SPEC.mdのGiven/When/Then等、DESIGN.mdの判断/根拠）ごとに意味論を分岐させない |
| 要件5 | `specBdd()`・`designDiagram()` の呼び出し箇所以外は変更しない | エラーメッセージ文言・終了コード規約・検査項目の構成は現状のまま維持する |

## 責務・境界

### コンポーネント構成

- `hasUnfilledPlaceholder(value: string): boolean`（新設、`src/commands/verify.ts`）: 文字列中の全ての `<...>` 区間を検出し、各区間の中身が「正当な技術トークン」（`TECHNICAL_TOKEN_RE` に一致）でなければ真陽性の未置換プレースホルダとみなす。真偽判定のみを行い、エラーメッセージの組み立ては呼び出し元の責務のまま変更しない。
- `TECHNICAL_TOKEN_RE`（新設、モジュール内定数）: `^[A-Za-z][A-Za-z0-9_-]*$`。ASCII英字で始まり、英数字・アンダースコア・ハイフンのみで構成される短いトークンにのみ一致する。日本語文字・空白・`|` を含む区間はこの正規表現に一致しないため「正当なパス変数表記ではない＝プレースホルダ」と判定される。
- `specBdd()`（既存、変更）: `UNFILLED_PLACEHOLDER_RE.test(...)` の5箇所の呼び出しのうち、要約・Given/When/Then・検証方法見込みの判定を `hasUnfilledPlaceholder(...)` に置き換える。検査項目・エラーメッセージ・終了コードは変更しない。
- `designDiagram()`（既存、変更）: 判断・根拠フィールドの判定を同様に `hasUnfilledPlaceholder(...)` に置き換える。mermaidコードフェンス検査・終了コード規約は変更しない。

責務は「区間ごとの正当性判定（`hasUnfilledPlaceholder`）」と「検査対象ごとのフィールド抽出・エラーメッセージ組み立て（`specBdd`/`designDiagram`）」に分離されており、判定ロジックを2箇所で重複実装しない。

### 依存関係

```text
specBdd() → hasUnfilledPlaceholder() → TECHNICAL_TOKEN_RE
designDiagram() → hasUnfilledPlaceholder() → TECHNICAL_TOKEN_RE
```

新規の外部依存・循環依存は無い。既存の `extractField()`・`splitMdSections()` との関係も変更しない。

### 図示要否の判断

- 判断: `不要`
- 根拠: 依存関係は「`specBdd()`/`designDiagram()` が `hasUnfilledPlaceholder()` を呼ぶ」という一方向2本のみ（3未満）、状態遷移は無し（0）、責務境界となるコンポーネントは `hasUnfilledPlaceholder()`・`TECHNICAL_TOKEN_RE`・既存2関数の計4だが実質は「新設1関数＋定数1つを既存2関数から呼ぶ」という単純な差し替えであり、循環依存・多段委譲は生じない。テキスト矢印表記で依存関係は十分に表現できるため、mermaid図は不要と判断した。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0032
    relation: adopts
```

## 障害・ロールバック考慮

- 想定される失敗モード1（過検出の再発）: `TECHNICAL_TOKEN_RE` の判定条件を誤って緩めると、本来検出すべき説明的プレースホルダ（例: 英単語のみで構成される仮の未置換プレースホルダ）が見逃される可能性がある。対策として、AC-2・AC-3・AC-5に対応する回帰テスト（テンプレート丸ごと複製・部分実内容化ケース）を実装セグメントで追加し、既存の真陽性検出能力を機械的に保証する。
- 想定される失敗モード2（誤検出の別形態での再発）: 将来 `.agent-skill-chain/templates/issue/` のプレースホルダ表記が変更された場合、`TECHNICAL_TOKEN_RE` による判定が現行テンプレートの記法を前提にしているため、新しい記法が正しく検出されない可能性がある。テンプレート表記の変更はAGENTS.mdの規約変更（ADR必須）を伴うため、その際に本ロジックの再検証を行うことをADRのConsequencesに記録する。
- ロールバック手順: `src/commands/verify.ts` の本変更コミットを revert する（`UNFILLED_PLACEHOLDER_RE.test(...)` への差し戻し）。DESIGN.md/PLAN.md/ADRを含め単一PR内の変更のため、PR単位のrevertで完全に戻せる。状態を持たない純粋関数の置き換えであり、データ移行・設定変更は伴わない。
- 影響を受ける既存機能: `verify spec-bdd`・`verify design-diagram` の2コマンドのみ。他の `verify` サブコマンド（`ac-coverage`・`adr` 等）は `UNFILLED_PLACEHOLDER_RE` を参照しておらず影響を受けない。
