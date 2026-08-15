# SPEC: ローカル実行用 `.agent-skill-chain/scripts/*.sh` ラッパーがCLI未検出時に自動導入フォールバックを持たない

- Issue: `ISSUE-677`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/677-cli-resolution-fallback-scripts`

## 目的・背景

`.agent-skill-chain/scripts/*.sh` のうち、agent-skill-chain CLI サブコマンドへの薄いラッパーとなっているスクリプト41本（`setup.sh`・`doctor.sh`・`issue-start.sh`・`worker-launch.sh`・`gate-review.sh` 等）は、いずれも同一の3経路解決ブロック（`bin/agents-md.js` → `node_modules/.bin/agent-skill-chain` → PATH上の `agent-skill-chain`）を個別にコピーして持っており、共通libへの切り出しはされていない。3経路のいずれでも見つからない場合、これら41本は日本語エラーメッセージを出して即 `exit 1` するのみで、CLIを自動導入しない。

一方、Issue #536で `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml` の「Ensure agent-skill-chain CLI」ステップには、同じ3経路のいずれでも解決できない場合に `npm install -g agent-skill-chain@latest` を実行して自動導入するフォールバックが既に実装されている。この修正はCIワークフローテンプレート1箇所にのみ適用され、ローカル実行用スクリプト41本には反映されなかった（共通化されていないため、#536時点で横展開が漏れた）。

この結果、consumerプロジェクトがテンプレート一式のみを導入し、CLI本体をグローバルにもプロジェクトローカルにも未導入のまま `.agent-skill-chain/scripts/setup.sh` 等をローカルで直接実行すると、CIでは同条件下で自動導入・続行するのに対し、ローカルでは何も自動化されず即失敗する。CIとローカルでの挙動乖離自体が、#536のような修正が今後も41本すべてへ横展開されず漏れ続ける構造的原因になっている。本Issueはこの重複と挙動乖離を解消する。

## 対象範囲

本SPECが仕様を定める対象は次の3つに限る。

- `.agent-skill-chain/scripts/*.sh` のうち、agent-skill-chain CLIサブコマンドへの薄いラッパーとして動作する全スクリプト（本SPEC作成時点で41本）のCLI解決処理とその失敗時挙動。
- 上記スクリプト群が共有するCLI解決処理の実装形態（重複コピーか単一の共有実装か）。
- 上記共有実装と、CIワークフローテンプレート（`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml`・同 `agent-skill-chain-root-cleanup.yml`）内の既存CLI解決・自動導入処理との重複の扱い。

対象外は本SPEC末尾の「スコープ外」に列挙する。

## 前提

本SPECの要件・受入条件は、次の前提が成立する環境で評価する。前提が崩れる環境の挙動は本Issueの対象外とする。

- 対象スクリプトは POSIX 互換シェル（bash）で実行される。実行者はローカル開発端末の利用者、またはCIランナーである。
- CLI解決の3経路とは、`bin/agents-md.js`（リポジトリ内ビルド成果物）、`node_modules/.bin/agent-skill-chain`（プロジェクトローカル導入）、PATH上の `agent-skill-chain`（グローバル導入）を、この順で判定する処理を指す。この順序と各経路の判定条件は本Issueでは変更しない。
- 自動導入の実行には `npm` コマンドと外部ネットワーク到達性が必要であり、いずれも欠ける環境では自動導入は失敗する。その失敗は異常ではなく想定内の分岐として扱う。
- グローバル導入（`npm install -g`）に権限が必要な環境が存在し、権限不足による失敗も同様に想定内の分岐として扱う。
- 本SPEC作成時点で、CIワークフローテンプレート側には3経路解決と自動導入フォールバックが既に実装済みであり、ローカル用スクリプト側には自動導入フォールバックが存在しない。

## 用語

本SPEC内で用いる語を次の意味に固定する。

- **ラッパースクリプト**: `.agent-skill-chain/scripts/*.sh` のうち、自身は業務ロジックを持たず、解決したCLI実体へ引数を透過して対応するサブコマンドを実行することだけを責務とするスクリプト。
- **3経路解決**: `bin/agents-md.js` → `node_modules/.bin/agent-skill-chain` → PATH上の `agent-skill-chain` の順に探索し、最初に見つかったものをCLI実体として採用する処理。
- **自動導入フォールバック**: 3経路解決がいずれも失敗した場合に、`npm install -g agent-skill-chain@latest` 相当のコマンドでCLIを導入し、成功時は処理を続行する分岐。
- **共有実装**: ラッパースクリプト群が各自コピーを持たず、単一のファイルを読み込む（source する等）ことで得るCLI解決・自動導入フォールバックの実装。
- **呼び出しインターフェース**: ラッパースクリプトの外部から観測できる契約、すなわち受け付ける引数、委譲先CLIサブコマンド、正常系の標準出力・終了コード。

## 要求 → 要件 → 受入条件

### 要求

consumerプロジェクトの利用者が、agent-skill-chain CLI本体が未導入の状態で `.agent-skill-chain/scripts/*.sh` のいずれかをローカルで直接実行しても、CIワークフロー実行時と一貫した挙動（3経路で解決できない場合の自動導入試行）を得られること。また、CLI解決ロジックが41本に重複しているために将来の挙動変更（フォールバック方式の変更等）が横展開漏れを起こす状態を解消すること。

### 要件

- `.agent-skill-chain/scripts/*.sh` のうち、CLIサブコマンドへの薄いラッパーとなっている全スクリプトが、CLI解決ロジックを重複コピーではなく単一の共有実装から得ること。
- 上記の共有実装は、既存の3経路解決順序（`bin/agents-md.js` → `node_modules/.bin/agent-skill-chain` → PATH上の `agent-skill-chain`）による判定を維持すること。
- 上記3経路のいずれでも解決できない場合、CIの「Ensure agent-skill-chain CLI」ステップと同等の自動導入（`npm install -g agent-skill-chain@latest` 相当）を試みること。
- 自動導入が失敗した場合は、原因を含む明確な日本語エラーメッセージを出力し、非ゼロ終了コードで停止すること（無言で処理を継続しない）。
- 変更後も、41本のラッパースクリプトそれぞれの既存の呼び出しインターフェース（引数の透過、対応するCLIサブコマンドへの委譲、正常系のexit code）が変更前と同一であること。
- CIワークフローテンプレート（`agent-skill-chain-ci.yml`・`agent-skill-chain-root-cleanup.yml`）側の既存のCLI解決・自動導入ロジックとの重複・乖離が解消できるなら解消すること。解消しない場合は、その理由をCIワークフローテンプレート側のコメントとして明記すること。
- `init`/`upgrade`/`setup` コマンドが consumer の `package.json` へ `agent-skill-chain` を devDependency として自動追加する機能は本Issueの対象外とする。

### 受入条件（Acceptance Criteria）

#### AC-1: CLI解決ロジックの重複が排除されている

- Given: `.agent-skill-chain/scripts/*.sh` のうち、agent-skill-chain CLIサブコマンドへの薄いラッパーとなっているスクリプト群
- When: 各スクリプトのCLI解決処理（3経路判定）の実装箇所を確認する
- Then: 各スクリプトが個別に3経路判定ロジックのコード片を保持するのではなく、単一の共有実装を参照（source等）しており、同一ロジックの重複コピーが機械的に検出できない
- 検証方法見込み: `automated`

#### AC-2: 3経路のいずれでも見つからない場合に自動導入が試行される

- Given: `bin/agents-md.js` が未ビルド、`node_modules/.bin/agent-skill-chain` が不在、かつ PATH 上にも `agent-skill-chain` が存在しない環境
- When: 対象の41本のいずれか（例: `setup.sh`）をローカルで直接実行する
- Then: 「CLIが見つかりません」で即座に失敗するのではなく、CIの「Ensure agent-skill-chain CLI」ステップと同等の自動導入（`npm install -g agent-skill-chain@latest` 相当）がまず試行され、導入に成功すれば処理が続行する
- 検証方法見込み: `automated`

#### AC-3: 自動導入失敗時は明確な日本語エラーで停止する

- Given: AC-2と同じくCLIが3経路のいずれでも未解決であり、かつ自動導入コマンド自体がネットワーク不通・権限不足等で失敗する環境
- When: 対象のラッパースクリプトを実行する
- Then: 自動導入の失敗理由を含む明確な日本語エラーメッセージを標準エラー出力へ出し、非ゼロのexit codeでスクリプトが停止する
- 検証方法見込み: `hybrid`

#### AC-4: 既存の正常系呼び出しインターフェースが後方互換である

- Given: CLIが3経路のいずれかで既に解決可能な既存環境（例: `bin/agents-md.js` がビルド済みの本リポジトリ自身のworktree）
- When: 変更後の41本のラッパースクリプトのいずれかを、変更前と同じ引数で実行する
- Then: 対応するCLIサブコマンドへ引数がそのまま透過され、正常系の出力・exit codeが変更前と同一である
- 検証方法見込み: `automated`

#### AC-5: CIワークフロー側との重複・乖離の扱いが明示されている

- Given: 共通lib化後のローカル用CLI解決・自動導入ロジックと、`agent-skill-chain-ci.yml`（および `agent-skill-chain-root-cleanup.yml`）内の既存の「Ensure agent-skill-chain CLI」相当ロジック
- When: 両者の実装を比較する
- Then: 重複が解消（例: CIワークフロー側が共通libを参照する形へ統一）されているか、統一しない場合はその判断理由がCIワークフローテンプレート内のコメントとして明記されている
- 検証方法見込み: `manual`

本SPECが定める受入条件は AC-1 から AC-5 までの5件で全てである。これ以外のAC-IDは存在しない。

## 未決事項

次は設計セグメント（`DESIGN.md`）で確定させる。いずれも本SPECの要件・受入条件の判定には影響せず、受入条件を満たす複数の実装形態のうちどれを採るかの選択に留まる。

- 共有実装の配置先ファイル名と設置ディレクトリ。判断基準は、配布物（consumerへ展開される `.agent-skill-chain/` 配下）に含められること、および各ラッパースクリプトから自身の位置を基準に相対解決できること。
- 共有実装を読み込む方式（source による関数読み込みか、実行可能スクリプトへの委譲か）。判断基準は、既存の呼び出しインターフェースを変えずに済むことと、CLI実体のパスを呼び出し元へ返せること。
- 自動導入コマンドの実行条件（例: 非対話環境の判定、`npm` 不在時の事前判定、権限不足時の再試行有無）。判断基準は、AC-3が要求する「失敗理由を含む日本語エラーで非ゼロ終了」を常に満たすこと。
- CIワークフローテンプレート側を共有実装へ統一するか、意図的な重複として残すか（AC-5はいずれの結論も許容し、後者の場合はテンプレート内コメントでの理由明記を要求する）。判断基準は、ワークフロー実行時点でリポジトリ内の共有実装が確実に利用可能かどうか。

## スコープ外

- `init`/`upgrade`/`setup` コマンドが consumer プロジェクトの `package.json` へ `agent-skill-chain` を devDependency として自動追加する機能の新設（別の設計判断を要する大きめの変更であり、必要なら別Issueとして扱う）。
- CLI解決の3経路（`bin/agents-md.js` → `node_modules/.bin/agent-skill-chain` → PATH上の `agent-skill-chain`）の判定順序・条件自体の変更。
- `npm install -g agent-skill-chain@latest` 以外の自動導入手段（例: ローカルビルドの自動実行）の新設。
- ゲートレビュー用プロンプト生成が、成果物本文からAC-IDを見出し限定ではなく単純文字列一致で抽出し、本文の解説文・コメント中に現れた同形の文字列まで実在するAC-IDとして扱う不具合の修正。これは `.agent-skill-chain/` 配下のCLI実装側の別欠陥であり、本Issueが扱うシェルスクリプトのCLI解決処理とは対象コンポーネントも原因も異なるため、別Issueとして扱う。本SPECでは、当該不具合を誘発しうる同形文字列を本文へ書かないことで回避する。
