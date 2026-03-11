# テストコード BDD 形式

単体テストでは BDD（Given / When / Then）に沿って観点を明確にする。**各テストは必ず次の3ブロックで構成し、それぞれのブロックの直前にインラインコメントを1つずつ書く。この形を強制する。**

---

## §1 インラインコメント必須（3ブロック構成）

各テストケースは**必ず**次の3ブロックで構成する。**コメントは各ブロックの「直上」に1つだけ書く。** コメントだけをまとめて書いたり、ブロックと対応させない書き方は不可。

| ブロック | コメント形式（言語に合わせる） | 直下に書くコード |
|----------|-------------------------------|------------------|
| **Given** | `# Given:` または `// Given:` + 前提条件の短文説明 | 前提条件を用意するコード（モック・入力・初期化など） |
| **When**  | `# When:` または `// When:`  + 実行する操作の短文説明 | 被テスト対象を呼び出すコード（1行または数行） |
| **Then**  | `# Then:` または `// Then:`  + 期待される結果の短文説明 | 期待結果を検証するコード（assert 等） |

**正しい例**（Python / pytest 風）: Given のコメントの直下にセットアップ、When の直下に呼び出し、Then の直下にアサーションを書く。

```python
async def test_dispatch_api_path_with_invalid_api_key_returns_401(mock_call_next: AsyncMock) -> None:
    # Given: /api/v1/audio のような API パスで X-API-Key が不正
    from starlette.requests import Request
    req = MagicMock(spec=Request)
    req.url.path = "/api/v1/audio/upload"
    req.headers.get.return_value = "wrong-key"
    middleware = SecurityHeadersMiddleware(app=MagicMock())

    # When: dispatch を呼ぶ
    response = await middleware.dispatch(req, mock_call_next)

    # Then: 401 と Invalid or missing X-API-Key が返り、call_next は呼ばれない
    assert response.status_code == 401
    body_bytes = bytes(response.body)
    assert json.loads(body_bytes.decode()) == {"detail": "Invalid or missing X-API-Key"}
    mock_call_next.assert_not_awaited()
```

**誤った例**: 3つのコメントをまとめて先に書き、その下にコードを続けるだけ — これは禁止。必ず Given の直下にセットアップ、When の直下に実行、Then の直下に検証を書く。

監査（review-code・verify-and-close）で、上記の3ブロック構成と「各ブロックの直上に Given/When/Then コメントが1つずつあること」を確認する。欠落・ブロックずれは指摘対象とする。

---

## §2 01・03 との対応

テスト観点は 01_要件定義の BDD シナリオおよび 03_実装計画のタスク別テスト仕様と対応させる。詳細は workflow/TEMPLATES.md と 03_実装計画.md の BDD セクションを参照。

---

参照: RULES.md（テスト）、skills/review/review-code/、workflow/PHASES.md（監査観点）。
