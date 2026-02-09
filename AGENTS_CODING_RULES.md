# AGENTS_CODING_RULES - コーディングルール

> このドキュメントは、**型安全性、テスト容易性、コード品質を保証するための汎用的なコーディングルール**と、  
> **LLM エージェントが絶対に守るべき具体的な実行ルール**を定義します。  
> ワークフロー全体の規約は [`AGENTS.md`](./AGENTS.md)、  
> LLM 向けの全体ルールは [`AGENTS_AI_PLAYBOOK.md`](./AGENTS_AI_PLAYBOOK.md)、  
> テスト作成ガイドラインは [`AGENTS_TEST_GUIDELINES.md`](./AGENTS_TEST_GUIDELINES.md) を参照してください。

---

## クイックリファレンス（絶対に守ること）

1. **型安全性を最優先**
   - すべての関数、メソッド、変数に適切な型アノテーションを付与する
   - `Any`の使用は必要最小限に（最後の手段としてのみ使用）
   - `# type: ignore`の使用は**原則禁止**（例外を制度化）

2. **テスト容易性を徹底する**
   - 依存性注入（DI）を推奨し、モックしやすい設計にする
   - 単一責任の原則を守り、テストしやすい小さな単位にする
   - 副作用を分離し、純粋関数を推奨する

3. **命名規則を統一する**
   - 言語・フレームワークの標準的な命名規則に従う
   - 意味のある名前を使用し、略語は避ける
   - 一貫性を保つ

4. **コードスタイルを統一する**
   - 言語・フレームワークの標準的なコーディング規約に従う
   - フォーマッターとリンターを使用する
   - 一貫性を保つ

5. **コメントとドキュメントを適切に記述する**
   - なぜ（Why）を説明するコメントを書く
   - 複雑なロジックには説明を追加する
   - 公開APIにはドキュメントを記述する

6. **エラーハンドリングを適切に実装する**
   - すべてのエラーケースを考慮する
   - 適切なエラーメッセージを返す
   - エラーログを記録する

---

## 対象と前提

### この規約がカバーするもの

- 型安全性の確保
- テスト容易性の確保
- 命名規則
- コードスタイル
- コメント・ドキュメント
- エラーハンドリング
- パフォーマンス
- セキュリティ
- リファクタリング

### 前提条件

- 使用する言語・フレームワークの標準的なコーディング規約に従う
- 型チェッカー（Pyright、mypy、TypeScript等）を使用
- フォーマッターとリンターを使用
- すべてのコードに型アノテーションを付与（型システムをサポートする言語の場合）

---

## 基本ルール

### 1. 型安全性の確保

#### 基本方針

- **すべての関数、メソッド、変数に適切な型アノテーションを付与する**
- **`Any`の使用は必要最小限に**（最後の手段としてのみ使用）
- **`# type: ignore`の使用は原則禁止**（例外を制度化）
- 型推論に頼らず、明示的な型アノテーションを使用する

#### `# type: ignore`の例外許可条件

`# type: ignore`の使用は原則禁止ですが、以下の**すべての条件**を満たす場合のみ例外として許可されます：

1. **理由をコメントで明記**: なぜ`# type: ignore`が必要なのかを明確に記載する
2. **チケットID必須**: 関連するissue/タスクIDを記載し、将来的な改善計画を追跡可能にする
3. **期限（回収期限）必須**: いつまでに解消するかの期限を明記する
4. **代替案検討済み**: 適切な型定義や型ガードで解決できないことを確認済みであることを明記する

**例外許可の例**:

```python
# type: ignore[assignment]
# 理由: 外部ライブラリ（library_name v1.2.3）の型定義が不完全で、
#       Protocol や型アサーションでは解決できない
# チケット: ISSUE-123
# 回収期限: 2026-03-31（library_name v2.0.0 のリリース予定日）
# 代替案検討: Protocol 定義を試みたが、動的生成されるメソッドのため不可
result = external_library.get_dynamic_object()  # type: ignore[assignment]
```

#### 正しい例

```python
from typing import TypedDict

class TokenCreateDict(TypedDict):
    """トークン作成用の辞書型定義."""
    token: str
    user_id: int

async def create(self, create_dict: TokenCreateDict) -> RefreshToken:
    """トークンを作成."""
    token = RefreshToken(**create_dict)
    # ...
```

#### 間違った例

```python
async def create(self, create_dict: dict[str, Any]) -> RefreshToken:
    """トークンを作成."""
    token = RefreshToken(**create_dict)
    # ...
```

**問題点**: `Any`を使用しているため、型安全性が失われる

#### `Any`が許容される場合

以下の場合のみ`Any`の使用が許容される：

1. **外部ライブラリの型定義が不完全な場合**
   - 例: 動的に生成されるオブジェクト（Alembicの`op`オブジェクト等）
   - この場合でも、可能な限り`Protocol`や型アサーションを使用する

2. **型定義が技術的に不可能な場合**
   - 例: 実行時に動的に生成される型
   - この場合でも、可能な限り型ガードを使用する

**重要**: `Any`を使用する場合は、必ず理由をコメントで明記し、将来的な改善計画を記載する

### 2. テスト容易性の確保

#### 基本方針

- **テスト容易性を徹底する**: すべてのコードはテストしやすい設計にする
- **依存性注入（DI）を推奨**: 外部依存を注入可能にし、モックしやすい設計にする
- **単一責任の原則**: 各クラス・関数は単一の責任を持ち、テストしやすい小さな単位にする
- **副作用の分離**: 純粋関数を推奨し、副作用（DB、ファイル、ネットワーク等）を分離する
- **インターフェース（Protocol）の活用**: インターフェースを定義し、モック可能にする

#### 正しい例

```python
from typing import Protocol

# インターフェース（Protocol）を定義
class UserRepositoryProtocol(Protocol):
    """ユーザーリポジトリのプロトコル."""
    def get_by_id(self, user_id: int) -> User | None:
        """ユーザーIDでユーザーを取得."""
        ...

# サービス層でインターフェースに依存
class UserService:
    """ユーザーサービス."""
    
    def __init__(self, user_repository: UserRepositoryProtocol) -> None:
        """依存性注入."""
        self.user_repository = user_repository
    
    def get_user(self, user_id: int) -> User | None:
        """ユーザーを取得（純粋関数に近い）."""
        return self.user_repository.get_by_id(user_id)
```

#### 間違った例

```python
from sqlalchemy.orm import Session

# 直接DBに依存（テストしにくい）
class UserService:
    """ユーザーサービス."""
    
    def __init__(self, db: Session) -> None:
        """DBセッションを直接注入."""
        self.db = db
    
    def get_user(self, user_id: int) -> User | None:
        """ユーザーを取得."""
        return self.db.query(User).filter(User.id == user_id).first()
```

**問題点**: DBに直接依存しているため、テスト時にDBのセットアップが必要で、テストが複雑になる

### 3. 命名規則

#### 基本方針

- **言語・フレームワークの標準的な命名規則に従う**
- **意味のある名前を使用し、略語は避ける**
- **一貫性を保つ**

#### 言語別の命名規則

##### Python

- **変数・関数**: `snake_case`（例: `user_name`, `get_user_by_id`）
- **クラス**: `PascalCase`（例: `UserService`, `OrderRepository`）
- **定数**: `UPPER_SNAKE_CASE`（例: `MAX_RETRY_COUNT`, `DEFAULT_TIMEOUT`）
- **プライベート**: 先頭に`_`を付ける（例: `_internal_method`）

##### TypeScript/JavaScript

- **変数・関数**: `camelCase`（例: `userName`, `getUserById`）
- **クラス・コンポーネント**: `PascalCase`（例: `UserService`, `OrderForm`）
- **定数**: `UPPER_SNAKE_CASE`（例: `MAX_RETRY_COUNT`, `DEFAULT_TIMEOUT`）
- **プライベート**: 先頭に`_`を付ける（例: `_internalMethod`）

##### PHP

- **変数・関数**: `camelCase`（例: `$userName`, `getUserById()`）
- **クラス**: `PascalCase`（例: `UserService`, `OrderRepository`）
- **定数**: `UPPER_SNAKE_CASE`（例: `MAX_RETRY_COUNT`, `DEFAULT_TIMEOUT`）

#### 命名のベストプラクティス

- **意図を明確に表現する**: 変数名や関数名から、何をしているかが明確にわかるようにする
- **略語は避ける**: `usr`ではなく`user`、`cnt`ではなく`count`を使用
- **ブール値には`is`、`has`、`can`などの接頭辞を使用**: `isActive`、`hasPermission`、`canEdit`
- **関数名は動詞で始める**: `getUser`、`createOrder`、`deleteItem`
- **クラス名は名詞で始める**: `UserService`、`OrderRepository`、`PaymentProcessor`

### 4. コードスタイル

#### 基本方針

- **言語・フレームワークの標準的なコーディング規約に従う**
- **フォーマッターとリンターを使用する**
- **一貫性を保つ**

#### 言語別のコーディング規約

##### Python

- **PEP 8**: Python のコーディング規約に準拠
- **型ヒント**: 型アノテーションを使用
- **インデント**: スペース4つ
- **行の長さ**: 最大79文字（コメント）、最大88文字（コード）

##### TypeScript/JavaScript

- **strict mode**: 可能な限り有効にする
- **型定義**: 明示的な型定義を推奨
- **インデント**: スペース2つまたはタブ
- **行の長さ**: 最大100文字

##### PHP

- **PSR-12**: PHP のコーディング規約に準拠
- **型宣言**: すべてのメソッドで型宣言を使用
- **DocBlock**: すべてのクラス・メソッドで DocBlock を記載

#### コードスタイルのベストプラクティス

- **フォーマッターを使用**: 自動フォーマットツール（Black、Prettier、PHP-CS-Fixer等）を使用
- **リンターを使用**: 静的解析ツール（ESLint、Pylint、PHPStan等）を使用
- **一貫性を保つ**: チーム全体で同じスタイルを維持
- **設定ファイルを共有**: `.editorconfig`、`.prettierrc`、`pyproject.toml`等を共有

### 5. コメントとドキュメント

#### 基本方針

- **なぜ（Why）を説明するコメントを書く**
- **複雑なロジックには説明を追加する**
- **公開APIにはドキュメントを記述する**

#### コメントのベストプラクティス

- **自己説明的なコードを書く**: コード自体が説明になっているように書く
- **なぜ（Why）を説明する**: 何をしているか（What）ではなく、なぜそうしているか（Why）を説明
- **複雑なロジックには説明を追加**: アルゴリズムやビジネスロジックが複雑な場合は説明を追加
- **TODOコメントは避ける**: TODOコメントを残さず、すぐに対応するか、issue/タスクとして管理

#### ドキュメントのベストプラクティス

- **公開APIにはドキュメントを記述**: 公開する関数、クラス、メソッドにはドキュメントを記述
- **パラメータと戻り値を説明**: パラメータの型、意味、戻り値の型、意味を説明
- **使用例を含める**: 複雑なAPIには使用例を含める
- **ドキュメント形式を統一**: 言語・フレームワークの標準的なドキュメント形式（docstring、JSDoc、PHPDoc等）を使用

#### 正しい例

```python
def calculate_discount(
    price: float,
    user_type: UserType,
    is_premium: bool = False,
) -> float:
    """価格に割引を適用する.
    
    ユーザータイプとプレミアム会員かどうかに基づいて割引率を決定し、
    価格に適用します。
    
    Args:
        price: 元の価格
        user_type: ユーザータイプ（一般、学生、シニア等）
        is_premium: プレミアム会員かどうか
    
    Returns:
        割引適用後の価格
    
    Raises:
        ValueError: 価格が0以下の場合
    
    Example:
        >>> calculate_discount(1000.0, UserType.STUDENT, False)
        900.0
    """
    if price <= 0:
        raise ValueError("価格は0より大きい必要があります")
    
    # ユーザータイプに基づいて割引率を決定
    discount_rate = _get_discount_rate(user_type, is_premium)
    
    return price * (1 - discount_rate)
```

#### 間違った例

```python
def calc(price, type, premium):
    """割引計算."""
    # 割引率を計算
    rate = 0.1 if type == "student" else 0.05
    if premium:
        rate += 0.05
    return price * (1 - rate)
```

**問題点**: 
- 関数名が不明確（`calc`）
- パラメータの型が不明
- ドキュメントが不十分
- コメントが「何をしているか」を説明しているだけ（「なぜ」を説明していない）

### 6. エラーハンドリング

#### 基本方針

- **すべてのエラーケースを考慮する**
- **適切なエラーメッセージを返す**
- **エラーログを記録する**

#### エラーハンドリングのベストプラクティス

- **適切な例外を使用**: 言語・フレームワークの標準的な例外クラスを使用
- **エラーメッセージを明確に**: ユーザーにとって理解しやすいエラーメッセージを返す
- **エラーログを記録**: デバッグに必要な情報をログに記録
- **エラーを隠さない**: エラーを無視したり、`except: pass`のような処理を避ける
- **リソースのクリーンアップ**: 例外発生時もリソースが適切にクリーンアップされるようにする

#### 正しい例

```python
def process_order(order_id: int) -> Order:
    """注文を処理する."""
    try:
        order = order_repository.get_by_id(order_id)
        if order is None:
            raise OrderNotFoundError(f"注文ID {order_id} が見つかりません")
        
        if order.status != OrderStatus.PENDING:
            raise InvalidOrderStatusError(
                f"注文ID {order_id} は処理可能な状態ではありません。現在の状態: {order.status}"
            )
        
        # 注文処理のロジック
        order.process()
        order_repository.save(order)
        
        return order
    
    except OrderNotFoundError:
        # 既に適切なエラーメッセージが設定されているので、そのまま再スロー
        raise
    
    except InvalidOrderStatusError:
        # 既に適切なエラーメッセージが設定されているので、そのまま再スロー
        raise
    
    except Exception as e:
        # 予期しないエラーはログに記録してから再スロー
        logger.error(f"注文処理中に予期しないエラーが発生しました: {order_id}", exc_info=True)
        raise OrderProcessingError(f"注文処理に失敗しました: {str(e)}") from e
```

#### 間違った例

```python
def process_order(order_id):
    """注文を処理する."""
    try:
        order = order_repository.get_by_id(order_id)
        order.process()
        order_repository.save(order)
    except:
        pass  # エラーを無視
```

**問題点**: 
- エラーを無視している
- エラーメッセージが返されない
- エラーログが記録されない
- デバッグが困難

### 7. パフォーマンス

#### 基本方針

- **早期最適化は避ける**: パフォーマンスの問題が実際に発生するまで最適化しない（YAGNI原則）
- **ボトルネックを特定**: プロファイラーを使用してボトルネックを特定
- **適切なデータ構造を選択**: アルゴリズムとデータ構造を適切に選択

#### パフォーマンスのベストプラクティス

- **N+1問題を避ける**: データベースクエリのN+1問題を避ける（Eager Loading等）
- **キャッシュを活用**: 頻繁にアクセスされるデータはキャッシュする
- **非同期処理を活用**: I/O待ちが発生する処理は非同期処理を使用
- **バッチ処理を活用**: 複数の処理をまとめて実行する

#### 注意事項

- **可読性を優先**: パフォーマンスよりも可読性を優先する（KISS原則）
- **測定してから最適化**: プロファイラーで測定してから最適化する
- **過剰な最適化は避ける**: 過剰な最適化はコードを複雑にする

### 8. セキュリティ

#### 基本方針

- **入力値検証を徹底する**: すべての入力値を検証する
- **SQLインジェクションを防ぐ**: パラメータ化クエリを使用
- **XSSを防ぐ**: 出力値をエスケープする
- **認証・認可を適切に実装する**: 適切な認証・認可メカニズムを実装

#### セキュリティのベストプラクティス

- **入力値検証**: すべての入力値を検証し、不正な入力を拒否
- **パラメータ化クエリ**: SQLインジェクションを防ぐためにパラメータ化クエリを使用
- **出力値エスケープ**: XSSを防ぐために出力値をエスケープ
- **認証・認可**: 適切な認証・認可メカニズムを実装
- **機密情報の保護**: パスワード、APIキー等の機密情報を適切に保護
- **HTTPSを使用**: 通信はHTTPSを使用
- **セキュリティアップデート**: 依存関係のセキュリティアップデートを適用

### 9. リファクタリング

#### 基本方針

- **小さなステップでリファクタリングする**: 大きな変更を一度に行わない
- **テストを書いてからリファクタリングする**: リファクタリング前にテストを書く
- **動作を変更しない**: リファクタリングは動作を変更しない

#### リファクタリングのベストプラクティス

- **テストを書く**: リファクタリング前にテストを書く
- **小さなステップ**: 小さなステップでリファクタリングする
- **動作を保証**: リファクタリング後も動作が変わらないことを確認
- **コードレビュー**: リファクタリングはコードレビューを受ける

---

## LLM エージェント向け実行ルール（必須）

> ここから下は、**AI がコードを生成するときに絶対に守るチェックリスト**です。

### 共通前提

- すべてのコード生成は、この `AGENTS_CODING_RULES.md` のルールに従う
- 型安全性を最優先し、`Any`や`# type: ignore`の使用を最小限にする
- テスト容易性を徹底し、すべてのコードはテストしやすい設計にする

### 1. 型安全性の確保ルール

AI はコードを生成するとき、**必ず次を守る**：

- **すべての関数、メソッド、変数に適切な型アノテーションを付与する**
- **`Any`の使用は必要最小限に**（最後の手段としてのみ使用）
- **`# type: ignore`の使用は原則禁止**（例外を制度化、詳細は[基本ルール](#1-型安全性の確保)の「`# type: ignore`の例外許可条件」を参照）
- 型推論に頼らず、明示的な型アノテーションを使用する

**禁止事項**:

- 型アノテーションを省略する
- 型推論に頼りすぎる
- `Any`を安易に使用する
- `# type: ignore`を例外許可条件なしで使用する（理由・チケットID・期限・代替案検討の記載なし）

### 2. テスト容易性の確保ルール

AI はコードを生成するとき、**必ず次を守る**：

- **テスト容易性を徹底する**: すべてのコードはテストしやすい設計にする
- **依存性注入（DI）を推奨**: 外部依存を注入可能にし、モックしやすい設計にする
- **単一責任の原則**: 各クラス・関数は単一の責任を持ち、テストしやすい小さな単位にする
- **副作用の分離**: 純粋関数を推奨し、副作用（DB、ファイル、ネットワーク等）を分離する
- **インターフェース（Protocol）の活用**: インターフェースを定義し、モック可能にする

**禁止事項**:

- 外部依存（DB、API、ファイル等）に直接依存する設計
- 静的メソッドやグローバル変数への依存
- 副作用とビジネスロジックの混在
- テスト時にモックやスタブを注入できない設計

### 3. 命名規則ルール

AI はコードを生成するとき、**必ず次を守る**：

- **言語・フレームワークの標準的な命名規則に従う**
- **意味のある名前を使用し、略語は避ける**
- **一貫性を保つ**

**禁止事項**:

- 意味のない名前（`a`、`b`、`temp`等）
- 略語の過度な使用（`usr`、`cnt`等）
- 一貫性のない命名規則

### 4. コードスタイルルール

AI はコードを生成するとき、**必ず次を守る**：

- **言語・フレームワークの標準的なコーディング規約に従う**
- **フォーマッターとリンターを使用する**
- **一貫性を保つ**

**禁止事項**:

- 標準的なコーディング規約に違反する
- 一貫性のないコードスタイル

### 5. コメントとドキュメントルール

AI はコードを生成するとき、**必ず次を守る**：

- **なぜ（Why）を説明するコメントを書く**
- **複雑なロジックには説明を追加する**
- **公開APIにはドキュメントを記述する**

**禁止事項**:

- コードの動作を説明するだけのコメント（自己説明的なコードを書く）
- TODOコメントを残す（すぐに対応するか、issue/タスクとして管理）

### 6. エラーハンドリングルール

AI はコードを生成するとき、**必ず次を守る**：

- **すべてのエラーケースを考慮する**
- **適切なエラーメッセージを返す**
- **エラーログを記録する**

**禁止事項**:

- エラーを無視する（`except: pass`等）
- 不適切なエラーメッセージ
- エラーログを記録しない

### 7. パフォーマンスルール

AI はコードを生成するとき、**必ず次を守る**：

- **早期最適化は避ける**: パフォーマンスの問題が実際に発生するまで最適化しない（YAGNI原則）
- **可読性を優先**: パフォーマンスよりも可読性を優先する（KISS原則）

**禁止事項**:

- 早期最適化（パフォーマンスの問題が発生する前に最適化）
- 可読性を犠牲にする最適化

### 8. セキュリティルール

AI はコードを生成するとき、**必ず次を守る**：

- **入力値検証を徹底する**: すべての入力値を検証する
- **SQLインジェクションを防ぐ**: パラメータ化クエリを使用
- **XSSを防ぐ**: 出力値をエスケープする
- **認証・認可を適切に実装する**: 適切な認証・認可メカニズムを実装

**禁止事項**:

- 入力値検証を省略する
- SQLインジェクションの脆弱性
- XSSの脆弱性
- 認証・認可の不備

---

## AI 自己チェックリスト（コード生成前）

> **重要**: AI は、コードを生成する前に、**必ず以下のチェックリストを自問自答し、すべての項目を確認すること**。

### コード生成時の自己チェック

コードを生成する前に、以下を確認：

- [ ] **型アノテーション**: すべての関数、メソッド、変数に適切な型アノテーションを付与しているか？
- [ ] **`Any`の使用**: `Any`を使用している場合、それが最後の手段であることを確認し、理由をコメントで明記しているか？
- [ ] **`# type: ignore`の使用**: `# type: ignore`を使用していないか？（使用している場合は、例外許可条件（理由・チケットID・期限・代替案検討）をすべて満たしているか確認）
- [ ] **型安全性**: 型チェッカー（Pyright、mypy等）で型エラーが発生しないか？
- [ ] **テスト容易性**: テストしやすい設計になっているか？（依存性注入、単一責任、副作用の分離、インターフェースの活用）
- [ ] **命名規則**: 言語・フレームワークの標準的な命名規則に従っているか？意味のある名前を使用しているか？
- [ ] **コードスタイル**: 言語・フレームワークの標準的なコーディング規約に従っているか？
- [ ] **コメントとドキュメント**: なぜ（Why）を説明するコメントを書いているか？公開APIにはドキュメントを記述しているか？
- [ ] **エラーハンドリング**: すべてのエラーケースを考慮しているか？適切なエラーメッセージを返しているか？
- [ ] **セキュリティ**: 入力値検証を徹底しているか？SQLインジェクションやXSSの脆弱性がないか？

### チェックリストの使い方

1. **生成前に確認**: コードを生成する前に、上記のチェックリストを確認する
2. **不備があれば修正**: チェックリストの項目に不備があれば、生成前に修正する
3. **確認結果を明示**: 生成物と一緒に「自己チェック結果」を簡潔に記載する（例: 「✅ すべての関数・メソッド・変数に型アノテーションを付与、`Any`と`# type: ignore`の使用なし（例外許可条件を満たす場合は記載）、型チェッカーでエラーなし、テスト容易性を確保（依存性注入、単一責任、副作用の分離、インターフェースの活用）、命名規則とコードスタイルに準拠、エラーハンドリングとセキュリティを考慮」）

---

## よくある問題と対処法

### 問題1: `dict[str, Any]`の使用

**問題**: `dict[str, Any]`を使用しているが、具体的な型を定義できる

**対処法**: `TypedDict`を使用して具体的な型を定義する

```python
from typing import TypedDict

class TokenCreateDict(TypedDict):
    """トークン作成用の辞書型定義."""
    token: str
    user_id: int

async def create(self, create_dict: TokenCreateDict) -> RefreshToken:
    """トークンを作成."""
    token = RefreshToken(**create_dict)
    # ...
```

### 問題2: テストしにくい設計

**問題**: 外部依存（DB、API、ファイル等）に直接依存しており、テストが複雑になる

**対処法**: 依存性注入（DI）とインターフェース（Protocol）を活用する

```python
from typing import Protocol

# インターフェース（Protocol）を定義
class UserRepositoryProtocol(Protocol):
    """ユーザーリポジトリのプロトコル."""
    def get_by_id(self, user_id: int) -> User | None:
        """ユーザーIDでユーザーを取得."""
        ...

# サービス層でインターフェースに依存
class UserService:
    """ユーザーサービス."""
    
    def __init__(self, user_repository: UserRepositoryProtocol) -> None:
        """依存性注入."""
        self.user_repository = user_repository
    
    def get_user(self, user_id: int) -> User | None:
        """ユーザーを取得（テストしやすい）."""
        return self.user_repository.get_by_id(user_id)
```

### 問題3: 意味のない名前

**問題**: 変数名や関数名が意味を表していない

**対処法**: 意味のある名前を使用する

```python
# ❌ NG: 意味のない名前
def calc(a, b):
    return a * b

# ✅ OK: 意味のある名前
def calculate_total_price(price: float, quantity: int) -> float:
    """合計金額を計算する."""
    return price * quantity
```

### 問題4: エラーを無視する

**問題**: エラーを無視して処理が続行される

**対処法**: 適切なエラーハンドリングを実装する

```python
# ❌ NG: エラーを無視
try:
    process_order(order_id)
except:
    pass

# ✅ OK: 適切なエラーハンドリング
try:
    process_order(order_id)
except OrderNotFoundError as e:
    logger.error(f"注文が見つかりません: {order_id}")
    raise
except Exception as e:
    logger.error(f"注文処理中にエラーが発生しました: {order_id}", exc_info=True)
    raise OrderProcessingError(f"注文処理に失敗しました: {str(e)}") from e
```

---

## 参考資料

### プロジェクトドキュメント

- [`AGENTS_AI_PLAYBOOK.md`](./AGENTS_AI_PLAYBOOK.md) - LLM エージェント運用ルール
- [`AGENTS.md`](./AGENTS.md) - 開発規約の全体像
- [`AGENTS_TEST_GUIDELINES.md`](./AGENTS_TEST_GUIDELINES.md) - テスト作成ガイドライン

**重要**: 参照パスを記載する際は、必ず実際のファイルパスを確認し、正しい相対パスを使用すること。詳細は [`AGENTS.md`](./AGENTS.md) の「ドキュメント原則」セクションを参照。

### 外部参考資料

#### Python

- [PEP 8 - Style Guide for Python Code](https://peps.python.org/pep-0008/)
- [PEP 484 - Type Hints](https://peps.python.org/pep-0484/)
- [PEP 544 - Protocols: Structural subtyping (static duck typing)](https://peps.python.org/pep-0544/)
- [Pyright 公式ドキュメント](https://microsoft.github.io/pyright/)

#### TypeScript/JavaScript

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Google JavaScript Style Guide](https://google.github.io/styleguide/jsguide.html)
- [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)

#### PHP

- [PSR-12: Extended Coding Style](https://www.php-fig.org/psr/psr-12/)
- [PHP The Right Way](https://phptherightway.com/)

---

## 最後に（人間向け）

- この `AGENTS_CODING_RULES.md` は、**型安全性、テスト容易性、コード品質を保証するための汎用的なコーディングルール**です。
- 迷ったときは：
  1. 型安全性を最優先する
  2. テスト容易性を徹底する
  3. 命名規則とコードスタイルを統一する
  4. コメントとドキュメントを適切に記述する
  5. エラーハンドリングとセキュリティを考慮する
  6. それでも悩んだら `.workflow/{issue}/memo/` にメモを残してから検討

---

**最終更新**: 2026 年 2 月 9 日（`# type: ignore`を原則禁止に変更し例外を制度化、例外許可条件を明確化）
