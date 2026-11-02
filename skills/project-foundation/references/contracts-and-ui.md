# 契約・型・画面・データ

APIや画面、永続化を伴う基盤で読む。製品固有の値を決めるための判断基準であり、特定のschema形式やライブラリを全案件へ固定する指示ではない。

## 境界と型の正本

- ディレクトリは責務と依存方向から決める。複数層のサービスではbackend/frontend/infraとtest/doc/generatedの分離を初期候補にし、既存構造と製品形態に合わせる。domainにHTTP/DB/SDK、applicationに配備都合を持ち込まない。依存の接続はcomposition rootへ集める。
- 型を持つ言語ではstrictを基準にし、手書き製品コードの無制限な`any`/`Any`相当、検証を飛ばす型assertionや抑制を禁止する。未信頼入力はunknown/object等で受け、境界schemaで絞る。動的言語も実行時schemaと静的検査の責任を定める。生成物/SDKの制約は対象・理由・再生成/解消条件を限定した例外にする。
- API、イベント、設定ごとに正本schema、生成方向、生成先、互換性を決める。言語に適した実行時validatorを用い、生成DTOをdomainの正本へ直結しない。生成物の手編集を禁止し、再生成差分をCIで検出する。
- 型のみ・再export・生成物・alias・package初期化を含め循環を検査する。実際の対象と未解析経路を明示し、動的importやService Locatorへ移して隠さない。再帰/event/retryの循環はimportグラフと別に、基底条件・進捗・上限・中断を確認する。

## 成功・異常の共通契約

機能ごとに形式を発明する前に、次を正本と受入へ落とす。

| 境界 | 先に決める内容 |
| --- | --- |
| 正常 | status、body/envelopeの有無、header、空結果、ID、日時/精度、null/欠落、pagination/filter/sort |
| 異常 | HTTP等のstatusと安定error code、利用者向けmessage、field violation、request/correlation ID、内部情報を返さない境界 |
| 共通拒否 | validation、未認証/権限、404/405、競合、rate、依存timeout、未知例外を同じ契約で扱うこと |
| 再送/変更 | timeout/cancel、retryの可否と上限、冪等性、二重送信、楽観lock、部分成功/切断後の照会、互換release |
| 信頼 | session/tenant/認可、CSRF/CORS、SSRF、upload、外部文書/AI出力、秘密/個人情報と監査 |

HTTPならRFC 9457等を候補にし、採用した形式をframeworkのvalidation/404等にも適用する。特定envelopeを無条件に強制しない。内部例外・SQL・stack・秘密を返さず、詳細調査は相関IDと保護されたログで行う。

## 画面からの実装と状態の所有

利用者の操作・状態遷移から、画面→契約→業務判断→保存/外部副作用→再表示を一つの受入として作る。loading/empty/success/validation/denied/conflict/error/retry/cancel、連打・戻る・再読込・入力保持も対象にする。既存規約に合うGherkinを先行させ、画面単体の成功で完了しない。

業務不変条件、認可、計算・判断と永続化の正本はserver/domainへ置く。Frontendは表示と操作に必要な状態を担当し、サーバー状態を別storeへ二重管理しない。Webではserver cache用query library等を候補にし、URL・form・focus等の局所状態と区別する。クライアントvalidationはサーバー検証の代わりにしない。offline等でクライアントが正本を持つ要件なら同期・競合を明示する。

通常開発と結合/E2Eは実API接続を持つ。HTTPモックは単体試験・障害再現・先行画面開発等、必要な境界へ限定し、同じschemaへ追従させる。backend同時開発だけを理由に単体の障害再現を捨てず、全試験をモックにも寄せない。productionのworker/endpointへ開発用モックを混入させない。

## UI部品とトークン

既存のdesign systemと部品の再利用境界を確認する。primitive→共通UI→機能component→画面は構成候補であり、規模だけで不要な層を追加しない。登録部品の利用が契約なら追加手順と依存境界を定め、未登録の低水準要素による迂回を検査する。primitive内部のHTML等、許される実装境界も明示する。

design/layout tokenの正本、semantic/component参照、テーマ、生成/更新手順を決める。色・余白・寸法・文字・breakpoint・layer・motion等の値直書きや、未登録部品の使用を検査する。値を定義するtoken自体、primitiveの構造値など必要な例外は範囲と理由を明文化する。業務上の数値までdesign tokenへ押し込まない。

semantic要素、label、keyboard/focus、dialog/validation通知、contrast/reduced motion、長文/overflow/responsiveを部品と画面の双方で確認し、自動a11y検査だけで全適合としない。

## 保存・グラフ・ベクトルが必要な場合

transaction境界、正本/投影、tenantと識別子、更新/削除、outbox等の二重書込み回避、migration/seed/backup/restoreと再構築を先に決める。ツールは採用DBに合わせる。migrationファイル名の初期値は`yyyymmdd_hhmmss_<意味のある名前>`とし、timezone・同秒衝突・依存順序とrevision IDの役割を分ける。既存ファイルは勝手に改名しない。既存の別命名規約があれば互換性と移行を確認して決める。

graphはnode/edgeの意味、方向、多重辺、identity/unique、provenance、時点/削除、関係ごとの循環規則を定める。全体を一律DAGにせず、探索の深さ・fan-out・件数・時間/計算量・制約/indexと投影再構築を検証する。

類似検索が要件なら全文/完全一致/graph/vectorの役割と組合せを決める。embedding model/版・提供先・次元・距離・正規化、index/HNSW/quantization等、tenant filter、削除反映、再embedding/再構築、評価集合・precision/recall・性能を有効化前に確定する。適当な次元を埋めず、未選定なら未検証と導入条件を追跡する。検索候補を根拠の確定や認可の代用にせず、私的資料を許可なく外部embeddingへ送らない。

オブジェクト保存はprovider Adapterへ閉じ込め、非公開、サイズ/checksum/content type、上書き/削除、短期URL・失効・保持/権利を検証する。S3互換のCRUDだけでObject Lock等まで同等としない。worker/queueを使う場合は冪等性、重複/順序、上限付きretry/隔離、取消、backpressureを定める。backup作成とrestore成功は区別する。
