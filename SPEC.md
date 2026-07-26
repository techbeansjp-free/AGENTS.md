# SPEC: gate submit-evidenceがMarkdownコードフェンス付きverdict JSONを解釈できない

- Issue: `ISSUE-303`
- 作成者: `implementation_worker`
- 対象ブランチ: `bugfix/303-verdict-json-fence`

## 目的・背景

`agent-skill-chain gate submit-evidence`（`src/commands/gate.ts`）は、レビュアの標準入力から受け取ったverdict textをそのまま`JSON.parse()`する。Claude Code CLI（`claude -p --output-format text`）のレビュア出力は、実際にはMarkdownコードフェンス（```` ```json ... ``` ````）で囲まれた形で返ってくることがあり、素朴な`JSON.parse`が構文エラーで失敗する。

失敗時は`launch_gate_reviewer`のフェイルセーフにより`human_required`へ倒れ、レビュア自体は正しく評価を完了しているにもかかわらず証跡が捨てられる。Issue #298 / PR #299のcore review実行時（2026-07-26）に、Opus tierでの実際のレビュア起動・評価まで到達したにもかかわらずこのバグで失敗したことを実測した（Issue #300コメント参照）。

## 要求 → 要件 → 受入条件

### 要求

レビュア出力がMarkdownコードフェンスで囲まれていても、囲まれていなくても、内包するJSONを正しく解釈しverdictとして処理する。

### 要件

- `submit-evidence`のverdict text解釈箇所で、コードフェンス（```` ```json ``` ````・```` ``` ```` の両方）を許容し、内部のJSONを抽出してからパースする。
- フェンス無しの素のJSONも引き続き解釈できる（regressionにしない）。
- フェンスを除去した結果もなお不正なJSON（構文エラー・契約違反）であれば、従来通りエラーとして扱う（曖昧に成功扱いにしない）。

### 受入条件（Acceptance Criteria）

#### AC-1: フェンス無しの素のJSONは従来通り解釈できる

- Given: 標準入力がフェンスを含まない正しいverdict JSON
- When: `gate submit-evidence`を実行する
- Then: 従来通り正しく解釈され、evidence投稿処理へ進む
- 検証方法見込み: `automated`

#### AC-2: ```` ```json ``` ````フェンス付きverdict JSONを解釈できる

- Given: 標準入力が ```` ```json\n{...}\n``` ```` で囲まれた正しいverdict JSON
- When: `gate submit-evidence`を実行する
- Then: フェンスを除去した内部のJSONが正しく解釈され、フェンス無しの場合と同じ結果になる
- 検証方法見込み: `automated`

#### AC-3: 言語指定無しの```` ``` ````フェンスも解釈できる

- Given: 標準入力が ```` ```\n{...}\n``` ````（`json`指定無し）で囲まれた正しいverdict JSON
- When: `gate submit-evidence`を実行する
- Then: フェンスを除去した内部のJSONが正しく解釈される
- 検証方法見込み: `automated`

#### AC-4: フェンス除去後もなお不正なJSONはエラーのまま

- Given: 標準入力がフェンスで囲まれているが、内部が構文的に不正なJSON、またはフェンスすら無い非JSONテキスト
- When: `gate submit-evidence`を実行する
- Then: 従来通り`verdict JSONを解釈できません`エラーで終了コード1以上になる（曖昧に成功扱いにしない）
- 検証方法見込み: `automated`

## スコープ外

- Issue #300が指摘する「証跡生成経路がCIに自動で組み込まれていない」問題自体の解消は本Issueの対象外。
- レビュアプロンプト側でMarkdown出力を禁止する指示を追加するかどうかの検討（パース側の防御的対応を優先する）。
