# SPEC: trusted gate recorder導入後、新規PRのレビュー証跡を生成する経路がCIに存在しない

- Issue: `ISSUE-300`
- 作成者: `implementation_worker`
- 対象ブランチ: `bugfix/300-trusted-gate-evidence-runbook`

## 目的・背景

Issue #283 / PR #284（マージ済み、main v0.2.20以降）は、レビュー証跡の記録経路を「pull_requestトリガーによる同期的な自動レビュー」から「trusted gate recorder（`repository_dispatch`起動、`attestations:write`等の高権限）による非同期・証跡記録型」へ全面刷新した。この結果、`agent-skill-chain-gate.yml`の`verify-and-publish`ジョブは既存の証跡を検証するだけになり、証跡そのものを生成する仕組みがCI内に存在しなくなった。

証跡生成には `.agent-skill-chain/scripts/gate-local-review.sh`（`gate review`→adapter起動→`gate submit-evidence`）を、進行役がGitHub credentialを持たないread-only reviewer・protected base隔離launcherの制約下で明示的に実行する必要がある。この手順は、AGENTS.mdの明文規約（`.agent-skill-chain/project/MODEL_TIER_TABLE.md`）にも「GitHub Actionsは...AI、provider CLI、Codex Action、provider API credential、self-hosted runnerを使用しない」と明記されており、**CI内でAIレビュアを実行すること自体が設計上禁止**されている。つまりこの手順が個人の記憶・セッションの揮発的コンテキストにしか存在しない状態は、単なる実装漏れではなく、「ローカル実行が必須という設計」に対する運用手順の未文書化が根本原因である。

本Issueは、この運用手順を恒久文書として確立し、少なくとも1件の実PRで実地検証し、レビュアの独立性を技術的に確認することを目的とする。

## 要求 → 要件 → 受入条件

### 要求

新規PRのレビュー証跡生成手順が、個人の記憶に依存せず、Git管理下のrunbookとして誰でも再現可能な形で存在する。少なくとも1件の実PRで、strict profile（独立2体レビュア）を含めてこの手順が実際に機能することを実証する。

### 要件

- `gate review`→`gate reviewer-prompt`→（実評価）→`gate submit-evidence`（`gate-local-review.sh`が内部で実行する一連）の正規手順を、誰が・いつ・どのcapability要件（`frontier_coding`/`maximum_reasoning`等）で・どのコマンドを実行するかを`.agent-skill-chain/standards/`配下の文書として明文化する。
- 実PRのstrict profileゲート（独立2体レビュア必要）を、現在のmain（Issue #303の修正込み）を基準として実際に完走させ、trusted gate recorderが正しくCheck Runを記録することを確認する。
- レビュアの独立性（同一actorによる自己レビュー疑義の排除）が、`gate-local-review.sh`のprotected-base隔離launcher・one-time attempt token・run ID/slotの重複排除によって技術的に担保されていることを、既存コード（`src/lib/review-evidence.ts`）の該当ロジックを指し示して確認する。
- 本Issue自身の実装（文書追加のみ、コード変更を伴わない場合）についても、可能な範囲でこの手順を適用し実地検証を兼ねる。

### 受入条件（Acceptance Criteria）

#### AC-1: 運用手順が恒久文書として存在する

- Given: `.agent-skill-chain/standards/` 配下
- When: 新設する運用手順文書を読む
- Then: 「誰が」「いつ」「どのコマンドを」「どのcapability要件で」実行するかが、この文書単体で自己完結して読み取れる
- 検証方法見込み: `manual`

#### AC-2: 実PRでstrict profileのゲート通過を実地検証する

- Given: 現在のmain（Issue #303の修正込み）を基準とした実PRのstrict profileゲート
- When: 運用手順に従い `gate-local-review.sh` を実行する
- Then: 独立2体のレビュー証跡がGitHub PR Reviewへ記録され、trusted gate recorderが対応するCheck Runへ`success`または妥当な判定（`rejected`）を記録する
- 検証方法見込み: `manual`

#### AC-3: レビュアの独立性が技術的に担保されていることを確認する

- Given: `.github/workflows/agent-skill-chain-trusted-gate.yml`・`src/lib/review-evidence.ts`の既存実装
- When: protected-base隔離launcher・one-time attempt token・run ID/slot重複排除の各機構を読む
- Then: 同一actorによる自己レビューが技術的に検出・拒否される経路が存在することを確認できる
- 検証方法見込み: `manual`

## スコープ外

- trusted gate recorderの信頼モデル・attestation設計自体の再設計（ADR-0013で確定済みの判断は変更しない）。
- 個別PR（PR #299等、本Issue以外）の手動での通過作業。
- 通常のセグメントワーカー手順の中でレビュー証跡生成を自動起動する経路の追加（CI内でAIレビュアを実行すること自体が設計上禁止されているため、完全自動化は本Issueのスコープでは実現不能と判断する場合はその理由を明記する）。
