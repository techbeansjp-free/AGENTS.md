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
- 単体テストの 5 観点（正常系・異常系・境界値・回帰・結合）は [RULES.md](RULES.md) のテスト戦略および 02_設計 §6.2 と整合する。

---

## 5. 単体テストの網羅観点

単体テストでは、**正常系・異常系・境界値・回帰・結合**の 5 観点を BDD（Given-When-Then）で仕様書レベルで網羅する。以下は各観点の定義と、インライン BDD での記述例（§1 のルールに従う）。

| 観点 | 定義 | BDD 記述例（コメント要約） |
|------|------|---------------------------|
| **正常系** | 期待どおりの入力で期待どおりの結果となること。 | Given: 有効な入力 / When: 対象を呼び出す / Then: 成功と期待値を返す |
| **異常系** | 不正入力・エラー条件で期待どおりのエラーまたはフォールバックとなること。 | Given: 不正な入力またはエラー条件 / When: 対象を呼び出す / Then: 期待するエラーまたはフォールバックとなる |
| **境界値** | 境界付近の値（最小・最大・0・空など）で期待どおりとなること。 | Given: 境界値（最小・最大・0・空のいずれか） / When: 対象を呼び出す / Then: 仕様どおりの結果となる |
| **回帰** | 既存の振る舞いが変更で壊れていないこと（既存テストで担保）。 | Given: 既知の前提 / When: 対象を呼び出す / Then: 従来どおりの振る舞いが維持されている |
| **結合** | 他モジュール・サービスとの境界（モックまたはスタブで制御）で期待どおりとなること。 | Given: 依存をモック/スタブで用意 / When: 対象を呼び出す / Then: 境界での入出力が期待どおりとなる |

例（正常系・インライン）:

```python
def test_parse_accepts_valid_json() -> None:
    # Given: 有効な JSON 文字列
    s = '{"a": 1}'
    # When: parse を呼び出す
    out = parse(s)
    # Then: 成功し期待どおりの値となる
    assert out.is_ok() and out.value == {"a": 1}
```

例（異常系・インライン）:

```python
def test_parse_rejects_invalid_json() -> None:
    # Given: 不正な JSON 文字列
    s = "{ invalid }"
    # When: parse を呼び出す
    out = parse(s)
    # Then: エラーまたはフォールバックとなる
    assert out.is_err()
```

例（境界値・インライン）:

```python
def test_count_returns_zero_for_empty_list() -> None:
    # Given: 空リスト（境界値）
    items: list[int] = []
    # When: count を呼び出す
    n = count(items)
    # Then: 0 を返す
    assert n == 0
```

例（回帰・インライン）:

```python
def test_legacy_format_still_parsed_correctly() -> None:
    # Given: 既存仕様の入力
    raw = legacy_serialize(known_fixture)
    # When: パースする
    result = parse(raw)
    # Then: 従来どおりの振る舞いが維持されている
    assert result == expected_from_fixture
```

例（結合・インライン）:

```python
def test_service_calls_repository_with_mock() -> None:
    # Given: リポジトリをモックで用意
    mock_repo.return_value.get.return_value = Entity(id=1)
    # When: サービスを呼び出す
    out = service.get_entity(1)
    # Then: 境界での入出力が期待どおり
    assert out.id == 1
    mock_repo.return_value.get.assert_called_once_with(1)
```
