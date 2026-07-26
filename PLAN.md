# PLAN: セグメント別 worker アダプタ・モデルティア選択の恒久設定

- Issue: `ISSUE-307`
- 対応する DESIGN: `DESIGN.md`
- 対象ブランチ: `feature/307-segment-worker-adapter-config`

## 目的・対象範囲

`DESIGN.md` が定めた設計要素を、どの順序で・どの単位に分割して実装するかを定める。対象は設定スキーマ、設定型と選択解決、`worker context`、設定ファイル、起動ラッパー、codex アダプタ、テストの7つの変更単位である。設計判断そのもの（責務・境界・優先順位・環境変数名・具体的なモデル文字列の保持場所）は本書の対象外であり、`DESIGN.md` が正本である。

## 前提

- 実装は本 Issue のブランチ上で行い、変更単位ごとに commit・push する。
- worktree には旧設計（アダプタ内にティア対応を持たせる案）を実装した未 commit の差分が残っている。これは設計ゲートで却下された案に基づくものであり、実装セグメント開始時に本 PLAN の変更単位に従って書き直される。旧差分の内容を前提にしない。
- 変更対象パスは登録済みプロジェクトポリシーが定めるコア変更に該当するため、独立レビューは Strict（レビュア2体）で実施される。実装セグメントの作業自体は通常どおり writer lease 1つで進める。
- 設定ファイルの編集は writer lease を保持するセグメント作業ワーカーが行う。進行役は編集しない。
- 具体的なモデル文字列を書いてよいのは設定ファイルの `worker.model_tiers` だけである。設定スキーマ・起動ラッパー・アダプタのソースには書かない。
- コア独立レビュー用のモデル宣言と attestation 機構（登録済みプロジェクトポリシー・そのスキーマの固定値・関連する型と実行時検証）には触れない。読み取りも行わない。
- 本リポジトリの設定変更は配布既定値へ波及し、導入先には恒久的なオプトアウト手段が無い。この帰結は意図されたものであり、実装中に「導入先のために既定値を弱める」方向の独自判断を行わない。

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 設定スキーマ拡張 | `.agent-skill-chain/schemas/config.schema.yaml` の `worker` に任意項目 `segment_overrides` と `model_tiers` を追加する。`segment_overrides` はキーを4セグメント名に限定し、値は `adapter` / `model_tier` / `reasoning_effort` の任意項目のみ。`model_tiers` はキーをティア名の列挙（`highest_capability`）に限定し、値はアダプタ名（`codex`、必須）をキーとする最小長1の文字列。モデル値は固定値にしない。全階層で `additionalProperties: false` を維持し、`model_tier` または `reasoning_effort` を持つ上書きには `adapter: codex` を要求する条件制約を置く。`schema_version` は据え置く。examples に新形式を1件追加する。 | `AC-4` | なし |
| 2 | 設定型と選択解決 | `src/lib/config.ts` の型へ `worker.segment_overrides` と `worker.model_tiers` を追加する（読込・検証・型付けのみ、判断は持たない）。`src/lib/worker-selection.ts` を新設し、(a) 設定とセグメント名から `adapter` / `model_tier` / `reasoning_effort` を返す純粋関数、(b) ティア対応表とティア名・アダプタ名から具体的なモデル文字列を返す純粋関数（解決失敗を明示的に区別して返す）を実装する。フォールバックは上書き→`worker.adapter`→`human`。ファイル入出力・環境変数の読み書きは持たせない。 | `AC-1, AC-3, AC-9` | `#1` |
| 3 | worker context の拡張 | `src/commands/worker.ts` に任意の segment 引数を追加し、`adapter` / `model_tier` / `model` / `reasoning_effort` / `backend` / `issue_number` を `KEY=VALUE` で出力する。未解決キーは行を出力しない。segment 省略時は従来の3行のみを返す。不正なセグメント名、およびティア指定があるのに対応表を引けない場合は、値を推測せず日本語の理由付きで失敗させる。ヘルプ出力に恒久設定の変更操作・実行主体・タイミングと現在の解決結果の確認手段を追記する。 | `AC-1, AC-2, AC-3, AC-7` | `#2` |
| 4 | 本リポジトリの設定切替 | `.agent-skill-chain/config/agent-skill-chain.yaml` の `worker.segment_overrides.implementation` に `adapter: codex` / `model_tier: highest_capability` / `reasoning_effort: high` を設定し、`worker.model_tiers.highest_capability.codex` に具体的なモデル文字列を記述する。spec・design・validation は既定の claude のまま据え置く。セグメント別上書き側には具体的なモデル文字列を書かない。あわせて `worker` セクション直上のコメントへ、恒久設定の変更操作・実行主体・タイミングと、モデル世代更新時に触るのはティア対応表の値だけであることを自己完結的に記載する。 | `AC-6, AC-7, AC-9` | `#3` |
| 5 | 起動ラッパーの伝達 | `.agent-skill-chain/scripts/worker-launch.sh` が `worker context <issue_id> <segment>` を1回呼び、`adapter` でアダプタを選び、`ASC_WORKER_MODEL` / `ASC_WORKER_REASONING_EFFORT` / `ASC_WORKER_MODEL_TIER` を解決できた場合のみ export して `launch_worker` を呼ぶようにする。ティア対応表を読まず、ティアから具体名を導く処理も持たない。`worker context` の失敗は既存の lease 取得前 error として伝播させる。終了コードの伝播規則は変更しない。 | `AC-2` | `#3` |
| 6 | codex アダプタの優先順位調整 | `.agent-skill-chain/adapters/codex.sh` の `_codex_worker_model` / `_codex_worker_effort` を、個別上書き環境変数→設定由来の解決済み値（`ASC_WORKER_MODEL` / `ASC_WORKER_REASONING_EFFORT`）→従来フォールバックの順で評価する実装へ置き換える。起動コマンド全体の上書き環境変数が最優先である規則と既存フォールバック値は維持する。ティア対応の関数は追加せず、具体的なモデル文字列も追加しない。防御的検査として、`ASC_WORKER_MODEL_TIER` が設定されているのに `ASC_WORKER_MODEL` が空の場合は従来フォールバックへ落とさず、既存の blocked フェイルセーフ経路へ倒し日本語の理由を標準エラー出力へ出す。 | `AC-2, AC-3` | `#5` |
| 7 | テスト追加 | 単体（`test/unit/`）: 選択解決の4観点（セグメント別解決・フォールバック・スカラーのみの旧形式・未設定時 `human`）、ティア解決の3観点（対応表から解決・エントリ不在で解決失敗・アダプタ用モデル不在で解決失敗）、スキーマの受理／拒否（新形式・旧形式・モデル値を別文字列へ変更した設定の受理・未知アダプタ／未知ティア／未知セグメント／未知キーの拒否）。結合（`test/integration/`）: 起動ラッパーからアダプタへの環境変数伝達と codex 起動コマンドのモデル・reasoning effort 指定、完全上書き環境変数の優先、ティア未指定時の従来値維持、ティア解決失敗時に起動しないこと、防御的検査の blocked 経路、本リポジトリ設定での実装セグメント解決結果、アダプタのソースに具体的なモデル文字列が新たに追加されていないこと。 | `AC-1, AC-2, AC-3, AC-5, AC-6, AC-9` | `#4, #6` |
| 8 | 常時必須テストの実行と証跡 | ビルド・型検査・単体／結合テスト、語彙検査、参照検査、ADR 検査、文書量検査、成果物存在検査、secret・依存関係スキャンを実行し、結果を実装セグメントの証跡として残す。 | 完了条件 | `#7` |

AC-8（設定項目追加手続きの帰結の明記）は設計成果物（`DESIGN.md` の当該節と `ADR-0015`）で既に充足しており、実装セグメントに対応する変更単位を持たない。新設フィールドの内容が実装中に変わった場合のみ、`DESIGN.md` の当該節の更新が必要になる。

## 各変更単位の完了確認

- `#1`〜`#3`: 新形式・旧形式の設定に対する `worker context` の出力が期待どおりであること。ティア指定があるのに対応表を引けない設定では日本語の理由付きで失敗すること。
- `#4`: 追加の指示・環境変数なしで、実装セグメントが `adapter=codex` / `model_tier=highest_capability` / `reasoning_effort=high` と対応表由来のモデル文字列に解決され、他3セグメントが `claude` に解決されること。設定ファイル内で具体的なモデル文字列が現れるのがティア対応表だけであること。
- `#5`〜`#6`: 起動ラッパー経由の起動で、codex 起動コマンドのモデル指定が対応表の値と一致し、reasoning effort 指定が `high` になること。テスト用の完全上書き環境変数を与えた場合はそちらが優先されること。アダプタのソースに具体的なモデル文字列が新たに現れないこと。
- `#7`〜`#8`: 全 AC に対応するテストが存在し成功すること。常時必須のテストが成功すること。

## 実装順序の見直しについて

作業順序（上記の変更単位の並び）のみを見直す場合は本書のみを更新すればよい。設計要素・責務・境界・優先順位・環境変数名・具体的なモデル文字列の保持場所そのものを変更する場合は `DESIGN.md` の更新と設計ゲートの再通過が必要になる。

## 対象外

ゲートレビュア側の選択、コア独立レビューの契約・スキーマ固定値・attestation 検証の変更、codex 以外の新規アダプタ、claude / human アダプタのモデル選択方式の変更、ティア対応表への claude 用・human 用モデルの追加、`highest_capability` 以外のティア定義、ティア語彙の統合、4セグメント構成の変更、配布既定値と本リポジトリ運用設定の分離、更新コマンドが設定ファイルのローカル変更を保護する方式の導入。
