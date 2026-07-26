# DESIGN: gate submit-evidenceがMarkdownコードフェンス付きverdict JSONを解釈できない

- Issue: `ISSUE-303`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`〜`AC-4` | `src/commands/gate.ts` の`submit-evidence`（verdict text解釈箇所）に前処理関数`stripJsonCodeFence`を追加 | パース直前にフェンス除去を挟むのみ |

## 責務・境界

### コンポーネント構成

- `stripJsonCodeFence(text: string): string`（新規、`src/commands/gate.ts`内）: 入力テキストの先頭・末尾の空白を除いた上で、` ```json ` または ` ``` ` で始まり ` ``` ` で終わる場合、フェンス行を除去した中身を返す。フェンスが無ければ入力をそのまま返す（責務: 構文的なアンラップのみ。JSONとして妥当かどうかの判定は行わない）。
- `submit-evidence`の`JSON.parse(verdictText)`呼び出しを`JSON.parse(stripJsonCodeFence(verdictText))`へ変更する。

### 依存関係

```text
標準入力（レビュア出力） → stripJsonCodeFence（構文的アンラップ） → JSON.parse → 既存のverdict契約検証（isEvidenceVerdict）
```

既存の`isEvidenceVerdict`によるスキーマ検証・`assertNoCoordinationSecretInVerdict`によるsecret混入検査は変更しない（フェンス除去は`JSON.parse`の直前に挟むだけで、後続の契約検証ロジックには一切手を加えない）。

## 関連ADR

無し（パース処理への局所的な防御的対応であり、新たな恒久判断を要しない）。

## 障害・ロールバック考慮

- 想定される失敗モード: フェンス除去の正規表現が広すぎて、フェンスの体裁を装った不正な入力（例: 本文中に偶然```json```という文字列を含む非JSON）を誤ってJSONとして扱ってしまう。
- 対策: フェンス判定は「文字列全体の先頭がフェンス開始行、末尾がフェンス終了行」の場合のみに限定する（部分一致・本文中の出現では反応しない）。除去後の中身は引き続き`JSON.parse`にかけるため、非JSONであれば従来通りエラーになる（AC-4で固定化）。
- ロールバック手順: 本Issueのcommitをrevertすれば、フェンス除去を行わない従来の挙動に戻る。
- 影響を受ける既存機能: `gate submit-evidence`のverdict解釈のみ。他のJSON.parse呼び出し・他コマンドには影響しない。
