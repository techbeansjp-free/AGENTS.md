# DESIGN: trusted gate recorder導入後、新規PRのレビュー証跡を生成する経路がCIに存在しない

- Issue: `ISSUE-300`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1` | `.agent-skill-chain/standards/GATE_REVIEW_OPERATIONS.md`（新設） | 既存3標準文書と同じ配置 |
| `AC-1` | `AGENTS.md`への新設文書の登録（ディレクトリ構成の`standards/`列挙への追加＋ゲート運用本文での正本明示） | 正本文書からの参照経路が無いと発見可能性が担保されないため |
| `AC-2` | 実PR（PR #311 / Issue #300自身、strict profile）での`gate-local-review.sh`実地実行 | Issue #303・#312込みの最新main基準。Check Run記録自体は別Issue（GitHub App未整備） |
| `AC-3` | 既存コード（`gate-local-review.sh`・`review-evidence.ts`）の該当箇所を引用した確認記述 | 新規実装は行わない |

## 責務・境界

### コンポーネント構成

- `.agent-skill-chain/standards/GATE_REVIEW_OPERATIONS.md`: 「誰が」「いつ」「どのコマンドを」「どのcapability要件で」実行するかを自己完結して記載する新規運用手順文書。既存の`GIT_CONVENTIONS.md`・`TEST_POLICY.md`・`SECURITY_POLICY.md`と同じ`.agent-skill-chain/standards/`配下に置き、同じ役割（AGENTS.mdが正本として指す規範文書）を与える。
- `AGENTS.md`（既存、本Issueで改定）: 上記の「同じ役割」は配置だけでは成立しない。改定前のAGENTS.mdはディレクトリ構成で`standards/`配下を`GIT_CONVENTIONS`・`TEST_POLICY`・`SECURITY_POLICY`の3件のみ列挙しており、新設文書はリポジトリ内のどの正本文書からも参照されない状態だった。この状態ではAC-1が求める「個人の記憶に依存しない発見可能性」が担保されない。したがって本Issueでは、(a) ディレクトリ構成の`standards/`列挙へ`GATE_REVIEW_OPERATIONS`を追加し、(b) ゲート運用を述べる本文へ「GitHubモードではレビュー証跡をCI内で生成せず進行役がローカルで生成する。その実行者・実行タイミング・コマンド・capability要件は`GATE_REVIEW_OPERATIONS.md`を正本とする」旨を追記する。AGENTS.mdは`.agent-skill-chain/ci/verify-doc-length.sh`により150行上限で機械検査されるため、追記は既存行内への追加に留め、行数を増やさない（改定後も144行）。
- 完全自動化（CI内でのAIレビュア実行）は`.agent-skill-chain/project/MODEL_TIER_TABLE.md`が既に明示的に禁止している（「GitHub Actionsは...AI、provider CLI、Codex Action、provider API credential、self-hosted runnerを使用しない」）。この制約は本Issueのスコープでは変更しない。したがって完全自動化ではなく、**進行役が明示的に実行する手順を文書化する**ことが本Issueの現実的な到達点である。

### 依存関係

```text
新規PR push
  → CI（verify-and-publish）が証跡なしで human_required（マージ不可のまま停止）
  → 進行役が GATE_REVIEW_OPERATIONS.md の手順に従い gate-local-review.sh を実行
    → protected base worktree（main、clean）から隔離clone作成
    → gate-review.sh（scaffold生成）
    → gate-launch-reviewer.sh × 2（strict時。各slotが独立レビュアを起動）
    → gate submit-evidence（GitHub PR Reviewへ証跡投稿）
    → repository_dispatch（event_type: agent-skill-chain-gate-record）を発行
    ※ここまでがAC-2の対象範囲であり、PR #311で実地到達を確認済み
  → 以降は独立した2経路へ分岐する（片方の失敗が他方を止めない）
    ├─ 経路A（現状稼働）: CI再実行時の verify-and-publish が投稿済み証跡を検証し、
    │    approved なら Check Run 成功、rejected / human_required なら失敗を publish する
    │    → 実地検証での到達点は rejected（証跡が正しく解釈された結果であり、
    │      入力契約充足の直接証跡。経路Aは終端まで到達している）
    └─ 経路B（現状未到達）: repository_dispatch を受けた trusted gate recorder が
         専用GitHub App の資格情報で Check Run を発行する
         → ASC_GATE_APP_ID / ASC_GATE_APP_PRIVATE_KEY 未登録のため常に失敗する。
           GitHub App の作成・登録は人間の対話的操作を要するため別Issueで扱う
  → マージ条件としてのゲート成功（不変条件I2が要求する専用App/Workflow由来の
    Check Run 成功）は経路Bの完了を要するため、経路B未整備の現状では到達しない
```

図の終端が「ゲート成功」ではなく「経路Bが未整備のため未到達」で止まることは、本Issueの到達点を意図的に表している。本Issueが担保するのは経路Aの終端到達（証跡が生成され、検証ロジックに正しく解釈されること）までであり、経路Bの終端到達はスコープ外である。

### 実地検証の実績（AC-2）

PR #311（Issue #300自身、strict profile）のspec gateに対し、Issue #303・#312の修正込みの最新main（`8cb1710`）を基準として`gate-local-review.sh`を実行し、以下を確認した。

- 独立2体のレビュー証跡がGitHub PR Reviewへ実際に記録された（review ID 2件、`gh api pulls/311/reviews`で確認）。
- `gate submit-evidence`が両slotとも成功し、`launcher-token.json`の全slot消費を確認した上で`repository_dispatch`（`event_type: agent-skill-chain-gate-record`）が発行された（受信側ワークフローのrunが`gate-record-311-spec-816dbd4...`というrun-nameで実際に起動していることが、ペイロード内容を含む発行の証跡である）。
- 上記の依存関係図の経路Aについて: `verify-and-publish`のCI再実行で`Verify local-review evidence`ステップが`final: rejected`（Opusレビュアが実際にSPEC.md内の複数の矛盾点を検出した結果）を返した。これは証跡が正しく検証された証跡であり、AC-2の「入力契約を満たす」を実証する（`final: human_required`ではなく実際の判定が返っている）。経路Aは終端まで到達している。
- 上記の依存関係図の経路Bについて: `trusted gate recorder`ワークフロー（`repository_dispatch`受信側）は`ASC_GATE_APP_IDが構成されていません`で失敗した。これはGitHub Appインフラ未整備によるものであり、経路Aで実証済みの証跡生成・入力契約充足には影響しない。経路Bの終端（専用App由来のCheck Run発行）は現状未到達であり、本Issueのスコープ外である。

実地検証中に2件の副次的な問題を発見・修正した。
- レビュアCLI出力のverdict JSON解釈が、フェンス付き・前置文/後置文付きの出力を処理できない（Issue #312、修正・マージ済み）。
- protected base worktreeとして独立cloneを使う場合、対象PRのtarget_shaが明示的にfetchされていないと`classifyCoreReview`が`unresolved`を返しhuman_requiredへ倒れる（GATE_REVIEW_OPERATIONS.mdへ運用上の注意として記載）。

## 技術的独立性の担保（AC-3の確認内容）

ここで言う技術的独立性とは「2件の証跡が別`run_id`・別`slot`を持ち、かつ同一のone-time launcher token（`launcher_token_digest`）に由来すること」であり、2件を投稿したGitHub actorが別人格であることではない。正常系は単一のprotected-base隔離セッションがslot 1・slot 2を連続実行する経路であり、同一actorによる実行である。

- `gate-local-review.sh`は実行前に`CURRENT_ROOT`・`CURRENT_SHA`がprotected base（main、指定base_sha）と一致し、かつcleanであることを検査する（候補ブランチのコードを証跡生成に使わせない）。
- 隔離clone（`TRUSTED_TMP`配下）は`git clone --no-checkout` + `checkout --detach $BASE_SHA` + `remote remove origin`でcredential-bearing remoteを持たない状態にしてからbuildする。
- `launcher-token.json`（`mode 0600`、`wx`フラグで排他生成）が各slotの`run_id`を事前に固定し、`consumed_slots`で一度使った slotの再利用を防ぐ。全slotが消費されずtokenファイルが残った場合、launcherは非0で終了し`repository_dispatch`を発行しない。
- `src/lib/review-evidence.ts`の`verifyGithubReviewEvidence`が、`runIds`・`slots`の`Set`重複検査と必要slot集合の充足検査、および全証跡の`launcher_token_digest`が単一値であること（`tokenDigests.size !== 1`なら失敗）を検証する。actor側の検査は`trustedActors`所属の認可チェックのみであり、2件でactorが異なることは要求しない。`actor_relation`は`reviewers`へ記録するだけで判定には使わない。加えて`launcher_digest`・`trusted_base_sha`・`prompt_digest`・成果物digestの一致を全証跡へ要求するため、証跡を後から偽装することはできない。

## 関連ADR

無し（新規の恒久判断を伴わない運用文書の追加）。

## 障害・ロールバック考慮

- 想定される失敗モード: 運用手順文書の記載が実際のコマンド仕様（引数・capability要件）と乖離する。
- 対策: 文書内のコマンド例は、本Issueの実地検証（AC-2）で実際に成功した手順をそのまま転記する。
- ロールバック手順: 本Issueのcommitをrevertすれば文書追加前の状態に戻る（コード変更を伴わないため副作用はない）。
- 影響を受ける既存機能: 無し（新規文書追加のみ）。
