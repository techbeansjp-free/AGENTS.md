# DESIGN: gate submit-evidenceがverdict JSON前後の説明文・tool-call試行テキストを解釈できない

- Issue: `ISSUE-312`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`〜`AC-6` | `extractFirstJsonObject`関数（新規、`src/commands/gate.ts`） | `stripJsonCodeFence`を置き換える |

## 責務・境界

### コンポーネント構成

- `extractFirstJsonObject(text: string): string`（新規）: 入力テキストを先頭から走査し、最初の`{`から、文字列リテラル（ダブルクォート・エスケープ考慮）を跳ばしながら中括弧の深さを追跡し、深さが0に戻る対応する`}`までを1つのJSON候補として切り出す。候補が見つからなければ入力全体をそのまま返す（後続の`JSON.parse`が失敗し、従来通りエラーになる）。
- 既存の`stripJsonCodeFence`（Issue #303）はこの関数に置き換える。フェンス除去は「フェンス記法を取り除く」という限定的な前処理だったが、新関数は「テキスト中のどこにあってもJSON本体を中括弧の対応関係で機械的に特定する」というより一般的な抽出であり、フェンス付き・フェンス無し・前置文・後置文のいずれも同じロジックでカバーする。
- `submit-evidence`の`JSON.parse(stripJsonCodeFence(verdictText))`呼び出しを`JSON.parse(extractFirstJsonObject(verdictText))`へ変更する。

### 依存関係

```text
標準入力（レビュア出力、任意の前置文・後置文・フェンスを含みうる）
  → extractFirstJsonObject（中括弧対応関係による抽出、文字列リテラルを跳ばす）
  → JSON.parse
  → 既存のverdict契約検証（isEvidenceVerdict）
```

既存の`isEvidenceVerdict`によるスキーマ検証・`assertNoCoordinationSecretInVerdict`によるsecret混入検査は変更しない。

### アルゴリズム

1. `text`中で最初に出現する`{`のindexを探す。見つからなければ`text`をそのまま返す。
2. その位置から1文字ずつ走査し、状態（`inString`・`escaped`）を保ちながら中括弧の深さを数える。
   - `inString`が真の間は、`\`によるエスケープの次の文字を除き、`{`・`}`をカウントしない。
   - `"`（エスケープされていない）で`inString`を切り替える。
   - `inString`が偽で`{`なら深さ+1、`}`なら深さ-1。
3. 深さが0に戻った時点のindexを終端とし、開始から終端までの部分文字列を返す。走査完了までに深さが0に戻らなければ（対応する`}`が無い）、`text`をそのまま返す。

## 関連ADR

無し（パース処理への局所的な防御的対応であり、新たな恒久判断を要しない）。

## 障害・ロールバック考慮

- 想定される失敗モード: 抽出ロジックが誤って途中の`}`で打ち切ってしまい、本来のJSONの一部だけを抽出してしまう（文字列リテラル内の中括弧を誤検出した場合等）。
- 対策: 文字列リテラル状態を正しく追跡するステートマシンを実装し、AC-5でリテラル内`{`/`}`を含むfixtureを回帰テストとして固定化する。
- ロールバック手順: 本Issueのcommitをrevertすれば、Issue #303時点の`stripJsonCodeFence`（フェンスのみ対応）の挙動に戻る。
- 影響を受ける既存機能: `gate submit-evidence`のverdict解釈のみ。他のJSON.parse呼び出し・他コマンドには影響しない。
