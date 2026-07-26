# SPEC: gate submit-evidenceがverdict JSON前後の説明文・tool-call試行テキストを解釈できない

- Issue: `ISSUE-312`
- 作成者: `implementation_worker`
- 対象ブランチ: `bugfix/312-verdict-prose-prefix`

## 目的・背景

`gate submit-evidence`（`src/commands/gate.ts`）のverdict text解釈は、Issue #303でMarkdownコードフェンス（trim後の全文が厳密にフェンスそのものである場合）を除去できるようになった。しかし実際にレビュアCLI（`claude -p --output-format text`）を繰り返し実行したところ、フェンス以外にも複数の異なる非JSON前置パターンが出現することを実測で確認した（Issue #300の実地検証中、3回中2回失敗）。

観測されたパターン:
1. 素のJSON（フェンス無し） → 成功（既存動作）
2. `ReportFind` で始まるテキスト（tool-call試行と推定） → 失敗
3. `ADR-0013の実...` で始まる日本語説明文 → 失敗

`stripJsonCodeFence`（Issue #303実装）は「trim後の全文が厳密にフェンスそのもの」という形にのみ対応しており、フェンスの前後・フェンス無しでJSONの前に説明文やtool-call試行らしきテキストが付く場合は救えない。

## 要求 → 要件 → 受入条件

### 要求

レビュアCLIの出力に、JSON本体の前後へ任意の説明文・tool-call試行テキスト等が付いていても、埋め込まれたJSONオブジェクトを正しく抽出して解釈する。

### 要件

- verdict text全体から、文字列リテラルを考慮した中括弧の対応関係で最初の完全なJSONオブジェクト（`{`から対応する`}`まで）を抽出し、それを`JSON.parse`する。
- 抽出したJSON文字列自体が構文的に不正な場合は、従来通りエラーとして扱う（曖昧に成功扱いにしない）。
- JSON文字列リテラル内に含まれる`{`・`}`によって対応関係の検出が誤動作しない。
- 既存のIssue #303の挙動（フェンス除去）を後退させない。

### 受入条件（Acceptance Criteria）

#### AC-1: 素のJSONは従来通り解釈できる

- Given: 標準入力がフェンスも前置テキストも無い正しいverdict JSON
- When: `gate submit-evidence`を実行する
- Then: 従来通り正しく解釈される
- 検証方法見込み: `automated`

#### AC-2: フェンス付きJSONは従来通り解釈できる（Issue #303の回帰防止）

- Given: 標準入力が```` ```json ``` ````または言語指定無し```` ``` ````フェンスで囲まれた正しいverdict JSON
- When: `gate submit-evidence`を実行する
- Then: 従来通り正しく解釈される
- 検証方法見込み: `automated`

#### AC-3: JSON本体の前に説明文がある場合も解釈できる

- Given: 標準入力が「JSON本体の解釈とは無関係な説明文 + 正しいverdict JSON」の順で構成される
- When: `gate submit-evidence`を実行する
- Then: 埋め込まれたJSONオブジェクトが正しく抽出・解釈される
- 検証方法見込み: `automated`

#### AC-4: JSON本体の後に説明文がある場合も解釈できる

- Given: 標準入力が「正しいverdict JSON + 本体とは無関係な説明文」の順で構成される
- When: `gate submit-evidenceを`実行する
- Then: 埋め込まれたJSONオブジェクトが正しく抽出・解釈される
- 検証方法見込み: `automated`

#### AC-5: JSON文字列リテラル内の中括弧に惑わされない

- Given: verdict JSONの文字列値（`evidence`配列の要素等）に`{`や`}`を含む正しいJSON
- When: `gate submit-evidence`を実行する
- Then: 対応関係の検出がリテラル内の中括弧を誤って構造として扱わず、正しく全体を抽出・解釈する
- 検証方法見込み: `automated`

#### AC-6: 抽出後も不正なJSONはエラーのまま

- Given: 標準入力に完全なJSONオブジェクトが一切含まれない、または抽出候補が構文的に不正
- When: `gate submit-evidence`を実行する
- Then: 従来通り`verdict JSONを解釈できません`エラーで終了コード1以上になる
- 検証方法見込み: `automated`

## スコープ外

- レビュアプロンプト側（`gate reviewer-prompt`の指示文言）を変更してモデルの出力を厳密なJSONのみに矯正する試みは行わない。
- レビュアCLI呼び出し自体の設定・timeout・retry戦略の変更は行わない。
