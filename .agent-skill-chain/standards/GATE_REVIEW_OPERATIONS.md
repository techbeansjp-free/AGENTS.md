<!--
正本: AGENTS.md §4セグメント・4ゲート / Issue #300
GitHubモードでtrusted gate recorder（Issue #283 / PR #284）が有効な場合の、レビュー証跡生成の運用手順。
-->

# GATE_REVIEW_OPERATIONS

## 目的・対象・前提

`agent-skill-chain-gate.yml`の`verify-and-publish`ジョブは、既に記録済みのレビュー証跡を検証するだけであり、証跡そのものを生成する仕組みをCI内に持たない。GitHub Actionsは設計上AIレビュアを実行しない（`.agent-skill-chain/project/MODEL_TIER_TABLE.md`）。したがって証跡生成は、**進行役がローカル環境から明示的に実行する**手順として恒久化する。対象はGitHub coordination modeで`verify-and-publish`が`human_required`（`現在のtarget SHA用review evidenceがありません`）を返している任意のPR・任意のセグメントである。

## 実行者・実行タイミング・実行環境

- 実行者: 進行役（GitHub credentialを持つが、read-only reviewerとしてのAI起動権限はcredentialを持たない専用launcherへ委譲する）。
- 実行タイミング: セグメントのcheckpoint push後、対応する`verify-and-publish`が`human_required`で失敗した時点。
- 実行環境: **repository default branch（main）のprotected base worktreeがclean**であること。同一main worktreeを他の並行セッションが使用中（`git status`に無関係なuntracked成果物がある等）の場合は、`git clone`で独立した一時cloneを作成し、そのclone上でmainのHEADへ`checkout`してから実行する（本Issue #300の実地検証で採用した方法）。

## 実行コマンド

```bash
# 1. protected base（main、対象PRの現在のbase.shaと一致するSHA）がcleanであることを確認する。
#    base.shaはGitHub側のキャッシュにより最新main tipへ即時反映されないことがある。
#    `gh api repos/{owner}/{repo}/pulls/<PR番号> --jq '.base.sha'` の値を必ず使うこと
#    （リポジトリ実tipを推測で使わない）。
git status --short   # 出力が空であること

# 2. capability要件を明示してlocal reviewを起動する（strict時は独立2体が自動で起動される）。
CLAUDE_CORE_REVIEW_MODEL_TIER=frontier_coding \
CLAUDE_CORE_REVIEW_REASONING_TIER=maximum_reasoning \
CLAUDE_CORE_REVIEW_MODEL=claude-opus-5 \
CLAUDE_CORE_REVIEW_REASONING_PROBE_CMD='claude auth status' \
./.agent-skill-chain/scripts/gate-local-review.sh \
  <ISSUE-ID> <gate_id> <standard|strict> <target_sha> <base_sha> <PR番号> claude
```

- `<gate_id>`: `spec|design|implementation|validation`。
- `<standard|strict>`: 対象Issueの`review_profile`（`risk != normal`または`autonomy == full`なら`strict`）。
- `CLAUDE_CORE_REVIEW_MODEL_TIER`/`CLAUDE_CORE_REVIEW_REASONING_TIER`: coreレビュー（`.agent-skill-chain/project/manifest.yaml`の`model_selection.core_review`対象パス）の場合は`frontier_coding`/`maximum_reasoning`固定。対象外の通常ゲートではフェイルセーフのcapability検証自体が発火しないため、この2変数は空でよい。
- `CLAUDE_CORE_REVIEW_MODEL`: 実際にサブプロセスへ`--model`として渡すモデル名。`frontier_coding`要件を満たすモデル（例: `claude-opus-5`）を指定する。

## 成功確認

- コマンドの終了コードが`0`。
- `gh pr checks <PR番号>`で該当gateの`verify-and-publish`が再実行後に`success`または`failure`（`rejected`判定、承認不可の意）になり、`human_required`のまま止まらないこと。
- `gh api repos/{owner}/{repo}/commits/<target_sha>/check-runs`で対応するCheck Runのconclusionが`success`または`action_required`（reject時）であること。

## 既知の制約

- **自己参照的なブートストラップ**: `gate-local-review.sh`は常にPRのbase（main）からephemeral cloneを作りビルドする（候補ブランチの実行コードを証跡生成に使わない設計、Issue #283のセキュリティ境界）。そのため、証跡生成パイプライン自体（`gate submit-evidence`・`review-evidence.ts`等）を修正するPRは、その修正がmainへ入るまで自分自身を通常経路で通せない。この場合は変更内容を通常通り精査した上で`gh pr merge --admin`により一度だけ人手で着地させ、以降のPRから自動的に恩恵を受ける（Issue #303・#312で実施した前例）。これは意図的なトレードオフであり、境界を緩めて自動化する変更は行わない。
- **レビュアCLI出力の非決定性**: `claude -p`はプロンプトで「JSON契約のみを返せ」と指示しても、tool-call試行らしきテキストや自然文の説明を前後に付けて返すことがある（実測、3回中2回）。`gate submit-evidence`はverdict text中から中括弧の対応関係で最初の完全なJSONオブジェクトを抽出する（Issue #312）ため、単純な前置・後置テキストには耐性があるが、100%の再現性は保証しない。失敗した場合は同じコマンドを再試行する。
- **GitHub `base.sha`のキャッシュ遅延**: mainへのpush直後は、対象PRの`base.sha`がGitHub側でまだ古い値を指していることがある（`mergeable_state: behind`で判別可能）。この場合、`gh api pulls/<PR番号>`が返す`base.sha`をそのまま使うこと（リポジトリの実際のtip SHAではない）。

## 通常のセグメントワーカー手順への自動組込みについて

CI内でAIレビュアを実行すること自体が設計上禁止されているため（前掲）、本手順の完全自動化（進行役が`gate review`等を一切意識しない状態）は現時点では実現できない。将来的な改善候補としては、セグメントのcheckpoint push直後に進行役側のadapter（`.agent-skill-chain/adapters/claude.sh`）が本コマンドを自動起動する経路が考えられるが、これは別途設計判断（ADR）を要するため本Issueのスコープでは実施しない。
