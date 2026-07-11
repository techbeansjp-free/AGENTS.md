# テストコード BDD 形式

単体テストでは BDD（ユースケース → シナリオ → Given / When / Then、必要に応じて And）に沿って観点を明確にする。**次のレイヤーをすべて満たす。この形を強制する。**

---

## §0 必須レイヤー（全体像）

| レイヤー | 付与単位 | 書き方 | 内容 |
|----------|----------|--------|------|
| **ユースケース** | テストのまとまり（例: テストクラス・`describe` / `context` ブロック・同一ファイル内の論理グループ） | そのまとまりの**直前**に、言語の doc コメント（KDoc / Javadoc / `"""` / `///` 等）で **`ユースケース:`** 行を含める | 利用者・システム目線で「何のためのテスト群か」1〜3文 |
| **シナリオ** | **各テストメソッド・各 `it` / `test` ケース** | 当該テストの**直前**に doc コメントで **`シナリオ:`** 行を含める | その1テストが検証する状況・条件を1〜3文（01 の BDD シナリオと対応させる） |
| **Given / When / Then** | 各テスト本体 | **各ブロックの直上**にインラインコメントを1つずつ（§1） | 前提・操作・検証。複数段がある場合は **And**（§2） |

**禁止**: ユースケース・シナリオを省略する。Given/When/Then のみで済ませる。3つの GWT コメントをまとめて先に書き、その下にだけコードを置く（§1 の誤った例と同様）。

---

## §1 インラインコメント必須（Given / When / Then）

各テストケースの**本文**は**必ず**次の3ブロックで構成する。**コメントは各ブロックの「直上」に1つだけ書く。** コメントだけをまとめて書いたり、ブロックと対応させない書き方は不可。

| ブロック | コメント形式（言語に合わせる） | 直下に書くコード |
|----------|-------------------------------|------------------|
| **Given** | `# Given:` または `// Given:` + 前提条件の短文説明 | 前提条件を用意するコード（モック・入力・初期化など） |
| **When**  | `# When:` または `// When:`  + 実行する操作の短文説明 | 被テスト対象を呼び出すコード（1行または数行） |
| **Then**  | `# Then:` または `// Then:`  + 期待される結果の短文説明 | 期待結果を検証するコード（assert 等） |

**正しい例**（Python / pytest 風）: テストクラスの docstring に `ユースケース:`、各テストメソッドの docstring に `シナリオ:`、本文に GWT。

```python
class TestSecurityHeadersMiddleware:
    """ユースケース: API キー検証ミドルウェアが不正キーで API パスを拒否すること。"""

    async def test_dispatch_api_path_with_invalid_api_key_returns_401(
        self, mock_call_next: AsyncMock
    ) -> None:
        """シナリオ: /api 配下で X-API-Key が不正なとき 401 を返し call_next しない。"""

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

**正しい例**（Kotlin / JUnit 風）: KDoc でユースケース・シナリオ、行コメントで GWT。

```kotlin
/**
 * ユースケース:
 * 決済サービスが残高不足時に明確なエラーを返す。
 */
class PaymentServiceTest {

    /**
     * シナリオ:
     * 残高が請求額未満のウォレットに課金しようとしたとき、失敗する。
     */
    @Test
    fun chargeFailsWhenBalanceInsufficient() {
        // Given: 残高 100 円のウォレットと 500 円の課金リクエスト
        val wallet = walletWithBalance(100)
        val request = chargeRequest(amount = 500)

        // When: 課金を実行する
        val result = paymentService.charge(wallet, request)

        // Then: 残高不足として失敗し、ウォレット残高は変わらない
        assertThat(result.isFailure).isTrue()
        assertThat(wallet.balance).isEqualTo(100)
    }
}
```

**誤った例**: 3つの GWT コメントをまとめて先に書き、その下にコードを続けるだけ — 禁止。ユースケース・シナリオの doc コメントがない — 禁止。

監査（review-code・verify-and-close）で、**ユースケース・シナリオの有無**、上記の3ブロック構成、「各ブロックの直上に Given/When/Then コメントが1つずつあること」を確認する。欠落・ブロックずれは指摘対象とする。

---

## §2 And（必要な場合）

次のときは **And** を使う。形式は `# And (Given):` / `// And (Given):` など、**どのステップへの追加か**が分かるように書く。

- **Given が複数段**: 前提のうち2段目以降のブロックの直上に `And (Given):` を付ける。
- **Then が複数検証**: 最初の検証群は `Then:`、続く検証ブロックの直上に `And (Then):` を付ける。
- **When が複数操作**（例: 2回呼ぶ）: 2回目の操作ブロックの直上に `And (When):` を付ける。

And を付けないと意味が通じない複数ブロックがあるのに、1つの Then に押し込んでいる場合も指摘対象とする。

---

## §3 01・03 との対応

テスト観点は 01_要件定義の BDD シナリオおよび 03_実装計画のタスク別テスト仕様と対応させる。**シナリオ**の doc コメントは可能な限り 01 のシナリオ名・意図と対応付けてよい（コメント内に「01 SC-…」等を書いてもよい）。詳細は workflow/TEMPLATES.md と 03_実装計画.md の BDD セクションを参照。

---

参照: RULES.md（テスト）、skills/review/review-code/、workflow/PHASES.md（監査観点）。
