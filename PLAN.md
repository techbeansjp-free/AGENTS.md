<!--
正本: AGENTS.md 4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: PLAN.md。DESIGN.md とは別ファイル）。
-->

# PLAN: リリース自動化（バージョンbump・タグ付け・GitHub Release作成）

- Issue: `ISSUE-196`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md の6コンポーネントを、下から（副作用の小さい・単体テスト可能なものから）順に実装する。バージョン解決器を最初に独立実装・単体テストし、後退禁止（AC-5）・冪等版数決定の正しさを先に固めてから、副作用を伴う書込み・タグ・Release・トリガ配線を積む。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | バージョン解決器 | semver一致タグの最大版数 `latest` 取得、`target`/`needCommit` 決定、後退禁止ガードを、副作用なしの単体テスト可能な単位（CLIサブコマンドまたは `.agent-skill-chain/ci/` 配下の独立nodeスクリプト）として実装。seed規則・非semverタグ除外・patch加算・manual先行bump尊重・後退時fail の各分岐を単体テストで固定 | `AC-5`（＋`AC-1`の版数決定部） | なし |
| 2 | bumpブランチ・PR作成／admin merge器 | `needCommit` 時に `package.json.version` を `target` へ書換え、短命ブランチ `release/bump-v<target>` 上に `chore(release): v<target> [skip ci]` でcommitして `GITHUB_TOKEN` でpush、`gh pr create` で機械生成の版数台帳更新PRを作成、`gh pr merge --admin --squash --subject "chore(release): v<target> [skip ci]"`（bypass_actor登録済み `RELEASE_MAIN_PAT`）で main へマージ。`--subject` 明示でsquash既定設定に依存せず `[skip ci]` 生存を保証。admin merge前に head=`release/bump-v*` かつ変更ファイル=`package.json`（±`package-lock.json`）のみのスコープ検査を行い、逸脱時は `human_required` で停止。ブランチ名の `target` 埋め込みで重複防止、既存ブランチ・PRはスコープ検査通過時のみ再利用（冪等）。生pushではなくPR経由でありI4を満たす | `AC-1`, `AC-6` | `#1` |
| 3 | タガー（冪等） | `v<target>` タグの存在チェック後、未存在時のみ対象commitへ注釈付きタグを作成・push（`GITHUB_TOKEN`） | `AC-2`, `AC-4`, `AC-7` | `#1`, `#2` |
| 4 | リリーサ（冪等） | `v<target>` の GitHub Release 存在チェック後、未存在時のみ当該タグを指すReleaseを作成（`GITHUB_TOKEN`） | `AC-3`, `AC-4`, `AC-7` | `#3` |
| 5 | トリガ・concurrency層＋ワークフロー統合 | `.github/workflows/agent-skill-chain-release.yml` を作成。`on: push: branches:[main]` ＋リリース対象 `paths` フィルタ、`concurrency:{group:release, cancel-in-progress:false}`、`permissions: contents: write`、`[skip ci]` 早期skipガード、#1〜#4 をステップとして配線 | `AC-1`〜`AC-7`（統合） | `#1`, `#2`, `#3`, `#4` |
| 6 | テンプレート同期・stale除去 | #5 のワークフローを `.agent-skill-chain/templates/github/.github/workflows/` にも同一内容で配置し `verify-template-sync.sh` を通す。stale な `.claude-plugin/marketplace.json` を削除（marketplace/apm廃止決定の反映、ADR-0005） | `AC-1`〜`AC-7`（配布整合） | `#5` |

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのもの（版数体系・トリガ判定基準・6コンポーネント分割・認証方式）を変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
