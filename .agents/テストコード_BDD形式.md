# テストコードの BDD 形式（必須）

> **必須**: 本規約に従うシステム開発では、**すべてのテストコード**に Given / When / Then（および必要に応じて And）を**インラインコメントで必ず記載**する。意図の明確化と保守性のため。言語によらず同じラベル（Given, When, Then, And）を用いる。

---

## 1. ルール

- **Given**: テストの前提条件（初期状態・準備データ・入力の用意など）。該当するコードの直前にコメントで `# Given: …` または `// Given: …` を書く。
- **When**: テスト対象の動作（実行する操作・関数呼び出し・イベントなど）。該当するコードの直前に `# When: …` または `// When: …` を書く。
- **Then**: 期待される結果（アサーション・期待値・副作用の確認など）。該当するコードの直前に `# Then: …` または `// Then: …` を書く。
- **And**: 追加の前提条件や期待結果（複数ある場合）。`# And: …` または `// And: …` を使う。

各テストケース（関数・メソッド・it(...) など）の**中に**、上記をインラインで対応させる。テスト全体の docstring のみで BDD を書くのではなく、**コードのブロックごとに**どの部分が Given/When/Then かが分かるようにする。

---

## 2. 例（Python）

```python
def test_validate_audio_file_header_rejects_ebml_without_doctype() -> None:
    # Given: EBML magic only (no DocType within available bytes)
    content = b"\x1a\x45\xdf\xa3" + b"\x81" + b"\x00"
    # When: validating header
    result = validate_audio_file_header(content)
    # Then: it is rejected (safe default)
    assert result is False
```

複数条件がある場合:

```python
def test_foo_returns_ok_when_valid() -> None:
    # Given: valid input
    data = {"key": "value"}
    # And: service is available
    mock_svc.return_value = True
    # When: calling foo
    out = foo(data)
    # Then: result is ok
    assert out.is_ok()
    # And: side effect was recorded
    assert recorder.called_once()
```

---

## 3. 他言語でのコメント形式

- **JavaScript / TypeScript**: `// Given: …` など
- **Go**: `// Given: …` など
- **Ruby**: `# Given: …` など
- **Java / Kotlin / C#**: `// Given: …` など

ラベル（Given, When, Then, And）は英語のまま統一する。

---

## 4. 参照

- 要件・シナリオの BDD: 01_要件定義の Feature/Scenario、03_実装計画のテスト観点
- 実行・実装のルール: [RULES.md](RULES.md) 実装チェックリスト
