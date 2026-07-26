# PLAN: セグメント別 worker アダプタ・モデルティア選択の恒久設定

- Issue: `ISSUE-307`
- 対応する DESIGN: `DESIGN.md`
- 対象ブランチ: `feature/307-segment-worker-adapter-config`

## 目的・対象範囲

`DESIGN.md` が定めた設計要素を、どの順序で・どの単位に分割して実装するかを定める。対象は設定スキーマ、設定型と選択解決、`worker context` コマンド、起動ラッパー、codex アダプタ、本リポジトリの設定値、テストの7つの変更単位である。設計判断そのもの（責務・境界・優先順位・環境変数名）は本書の対象外であり、`DESIGN.md` が正本である。

## 前提

- 実装は本 Issue のブランチ上で行い、変更単位ごとに commit・push する。
- 変更対象パスは登録済みプロジェクトポリシーが定めるコア変更に該当するため、独立検証は Strict（レビュア2体）で実施される。実装セグメントの作業自体は通常どおり writer lease 1つで進める。
- 設定ファイルの編集は writer lease を保持するセグメント作業ワーカーが行う。進行役は編集しない。

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 設定スキーマ拡張 | `.agent-skill-chain/schemas/config.schema.yaml` の `worker` に任意項目 `segment_overrides` を追加する。キーは4セグメント名限定、値は `adapter` / `model_tier` / `reasoning_effort` の任意項目のみ、全階層で `additionalProperties: false` を維持。`model_tier` または `reasoning_effort` を持つ上書きには `adapter: codex` を要求する条件制約を置く。`schema_version` は据え置く。examples に新形式を1件追加する。 | `AC-4` | なし |
| 2 | 設定型と選択解決 | `src/lib/config.ts` の型へ `worker.segment_overrides` を追加する（読込・検証・型付けのみ、判断は持たない）。`src/lib/worker-selection.ts` を新設し、設定とセグメント名から `adapter` / `model_tier` / `reasoning_effort` を返す純粋関数を実装する。フォールバックは上書き→`worker.adapter`→`human`。 | `AC-1, AC-3` | `#1` |
| 3 | worker context の拡張 | `src/commands/worker.ts` に任意の segment 引数を追加し、選択解決の結果を `KEY=VALUE` で出力する。未解決キーは行を出力しない。segment 省略時は従来の3行のみを返す。不正なセグメント名は日本語の理由付きで失敗させる。ヘルプ出力に恒久設定の変更操作・実行主体・タイミングと現在の解決結果の確認手段を追記する。 | `AC-1, AC-3, AC-7` | `#2` |
| 4 | 起動ラッパーの伝達 | `.agent-skill-chain/scripts/worker-launch.sh` が `worker context <issue_id> <segment>` を1回呼び、`adapter` でアダプタを選び、`ASC_WORKER_MODEL_TIER` / `ASC_WORKER_REASONING_EFFORT` を解決できた場合のみ export して `launch_worker` を呼ぶようにする。終了コードの伝播規則は変更しない。 | `AC-2` | `#3` |
| 5 | codex アダプタのティア解決 | `.agent-skill-chain/adapters/codex.sh` に単一のティアマッピング `_codex_model_for_tier`（初期値 `highest_capability` → `gpt-5.6-sol`）を追加する。`_codex_worker_model` / `_codex_worker_effort` を、個別上書き環境変数→設定由来値→従来フォールバックの順で評価する実装へ置き換える。起動コマンド全体の上書き環境変数が最優先である規則は維持する。未知ティアは推測せず既存の blocked フェイルセーフ経路へ倒し、日本語の理由を標準エラー出力へ出す。 | `AC-2, AC-9` | `#4` |
| 6 | 本リポジトリの設定切替 | `.agent-skill-chain/config/agent-skill-chain.yaml` の `worker.segment_overrides.implementation` に `adapter: codex` / `model_tier: highest_capability` / `reasoning_effort: high` を設定する。spec・design・validation は既定の claude のまま据え置く。具体的なモデル文字列は書かない。あわせて `worker` セクション直上のコメントへ、恒久設定の変更操作・実行主体・タイミングを自己完結的に記載する。 | `AC-6, AC-7` | `#3` |
| 7 | テスト追加 | 単体（`test/unit/`）: 選択解決の4観点（セグメント別解決・フォールバック・スカラーのみの旧形式・未設定時 `human`）とスキーマの受理／拒否（新形式・旧形式・未知アダプタ・未知ティア・未知セグメント・未知キー・不正な組合せ）。結合（`test/integration/`）: 起動ラッパーからアダプタへの環境変数伝達と codex 起動コマンドのモデル・reasoning effort 指定、完全上書き環境変数の優先、ティア未指定時の従来値維持、未知ティアの blocked 経路、本リポジトリ設定での実装セグメント解決結果。 | `AC-1, AC-2, AC-3, AC-5, AC-6, AC-9` | `#5, #6` |
| 8 | 常時必須テストの実行と証跡 | ビルド・型検査・単体／結合テスト、語彙検査、参照検査、ADR 検査、文書量検査、成果物存在検査、secret・依存関係スキャンを実行し、結果を実装セグメントの証跡として残す。 | 完了条件 | `#7` |

## 各変更単位の完了確認

- `#1`〜`#3`: 新形式・旧形式の設定に対する `worker context` の出力が期待どおりであること（単体テストで固定）。
- `#4`〜`#5`: 起動ラッパー経由の起動で、codex 起動コマンドのモデル指定が `gpt-5.6-sol`、reasoning effort 指定が `high` になること。テスト用の完全上書き環境変数を与えた場合はそちらが優先されること。
- `#6`: 追加の指示・環境変数なしで、実装セグメントが `codex` / `highest_capability` / `high` に解決され、他3セグメントが `claude` に解決されること。設定ファイルに具体的なモデル文字列が現れないこと。
- `#7`〜`#8`: 全 AC に対応するテストが存在し成功すること。常時必須のテストが成功すること。

## 実装順序の見直しについて

作業順序（上記の変更単位の並び）のみを見直す場合は本書のみを更新すればよい。設計要素・責務・境界・優先順位・環境変数名そのものを変更する場合は `DESIGN.md` の更新と設計ゲートの再通過が必要になる。

## 対象外

ゲートレビュア側の選択、codex 以外の新規アダプタ、claude / human アダプタのモデル選択方式の変更、`highest_capability` 以外のティア定義、4セグメント構成の変更、配布既定値と本リポジトリ運用設定の分離。
