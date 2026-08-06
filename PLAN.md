# PLAN: docs: 各種モード・設定項目が散在しており体系的に一望できるドキュメントが無い(設定リファレンス整備)

- Issue: `ISSUE-429`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `docs/CONFIGURATION.md` 新設 | 「目的・対象範囲」「前提・用語」「設定項目一覧」（`coordination`・`durability`・`autonomy`・`risk`・`review`・`worker`・`worktree`・`branch`・`issue`・`wip`・`lease`・`bdd`・`issue_sync`・`merge`・`human_confirmation`・`templates`・`checks` の17項目、各 `### \`<key>\`` 見出し＋既定値・取りうる値・影響・詳細リンクの4点）「独立な設定軸の関係」「ARCHITECTURE.mdとの役割分担」の各節を、着手時点の `.agent-skill-chain/config/agent-skill-chain.yaml`・`.agent-skill-chain/schemas/config.schema.yaml` を根拠に作成する | `AC-1, AC-2, AC-3, AC-4, AC-6` | なし |
| 2 | README.md「## 設定」節へのリンク追加 | 既存段落末尾に `docs/CONFIGURATION.md` への1文リンクを追加する（内容の複製はしない） | `AC-5` | `#1` |
| 3 | `verify config-doc-sync` CLIサブコマンド追加 | `src/commands/verify.ts` に `configDocSync` 関数を追加（`.agent-skill-chain/schemas/config.schema.yaml` の `properties` キー集合から `schema_version` を除いたものと、`docs/CONFIGURATION.md` 内の `^###\s+\`<key>\`\s*$` 見出し集合を一方向比較し、スキーマ側にのみ存在するキーを違反として報告）。`src/lib/cli-routes.ts` へ `'verify config-doc-sync': verify.configDocSync` を登録。`test/integration/verify.test.ts`（または新規テストファイル）に単体テストを追加し、(a) 全項目一致で成功、(b) スキーマ側にのみ存在するキーで失敗、(c) 見出し表記規約からの逸脱（バッククォート抜け等）で失敗、の3ケースを最低限含める | `AC-7` | `#1` |
| 4 | `.agent-skill-chain/ci/verify-config-doc-sync.sh` 新設 | 既存 `verify-doc-length.sh`・`verify-template-sync.sh` と同一の薄いラッパー構成（CLI解決フォールバック＋`exec ... verify config-doc-sync "$@"`）で作成する | `AC-7` | `#3` |
| 5 | `.github/workflows/agent-skill-chain-config-doc-sync.yml` 新設 | 本リポジトリ直下 `.github/workflows/` にのみ配置し、`.agent-skill-chain/templates/github/.github/workflows/` には追加しない（AC-8対応、ADR-0034・ADR-0017踏襲）。トリガーは `pull_request: types: [opened, synchronize, reopened, ready_for_review]`。ジョブ名は `verify-config-doc-sync`（既存の必須チェック `verify` ジョブとは別名にし、テンプレート側の `agent-skill-chain-ci.yml` を一切変更しない）。ステップは checkout → setup-node → `npm ci` → `npm run build` → `./.agent-skill-chain/ci/verify-config-doc-sync.sh` | `AC-7, AC-8` | `#4` |
| 6 | vocab/references lint実行確認 | `node bin/agents-md.js lint vocab` と `node bin/agents-md.js lint references` を実行し、エラー無しであることを確認する。対象走査ルート（`defaultLiveFileRoots`/`defaultReferenceFileRoots`）には `docs/`・`README.md` が含まれないため、影響範囲は主に `#3`〜`#5` で追加した `src/**`・`.agent-skill-chain/ci/**`・`.github/workflows/**` のコメント・識別子である | `AC-9` | `#1, #2, #3, #4, #5` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。ただし `#3` の見出し検査正規表現（`### \`<key>\`` 完全一致）は DESIGN.md「責務・境界」節が確定させた設計要素であるため、当該正規表現の記法自体を変更する場合は DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
