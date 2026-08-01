# SPEC: trusted gate recorder導入後、新規PRのレビュー証跡を生成する経路がCIに存在しない

- Issue: `ISSUE-300`
- 作成者: `implementation_worker`
- 対象ブランチ: `bugfix/300-trusted-gate-evidence-runbook`

## 目的・背景

Issue #283 / PR #284（マージ済み、main v0.2.20以降）は、レビュー証跡の記録経路を「pull_requestトリガーによる同期的な自動レビュー」から「trusted gate recorder（`repository_dispatch`起動、`attestations:write`等の高権限）による非同期・証跡記録型」へ全面刷新した。この結果、`agent-skill-chain-gate.yml`の`verify-and-publish`ジョブは既存の証跡を検証するだけになり、証跡そのものを生成する仕組みがCI内に存在しなくなった。

証跡生成には `.agent-skill-chain/scripts/gate-local-review.sh`（`gate review`→adapter起動→`gate submit-evidence`）を、進行役がGitHub credentialを持たないread-only reviewer・protected base隔離launcherの制約下で明示的に実行する必要がある。この手順は、プロジェクト固有ポリシー文書`.agent-skill-chain/project/MODEL_TIER_TABLE.md`（`manifest.yaml`の`documents.common`に登録済みの規範文書、AGENTS.md本文自体には直接の記載は無い）にも「GitHub Actionsは...AI、provider CLI、Codex Action、provider API credential、self-hosted runnerを使用しない」と明記されており、**CI内でAIレビュアを実行すること自体が設計上禁止**されている。つまりこの手順が個人の記憶・セッションの揮発的コンテキストにしか存在しない状態は、単なる実装漏れではなく、「ローカル実行が必須という設計」に対する運用手順の未文書化が根本原因である。

本Issueは、この運用手順を恒久文書として確立し、少なくとも1件の実PRで実地検証し、レビュー証跡の技術的独立性を確認することを目的とする。

**本Issue自身のrisk分類とreview_profile（AC-2の前提）**: 本Issueには`risk:normal`ラベルが付与されておらず（unclassified扱い）、`autonomy:full`ラベルも無い。AGENTS.md不変条件I8「`risk != normal`（`unclassified`含む）OR `autonomy == full` → `review_profile: strict`」により、本Issue自身のゲートはstrict profile（レビュー証跡2件必須）となる。したがって要件節が定める「本Issue自身の実装についても実地検証を兼ねる」は、本Issue自身のPRがstrict profileで扱われることが前提から導かれ、別のIssueを用意する必要はない。

**Issue #303・#312との関係（AC-2 Givenの前提）**: `gate submit-evidence`（レビュア出力からverdict JSONを解釈しGitHub PR Reviewへ証跡投稿する処理）は、レビュアCLI出力がMarkdownコードフェンスや説明文を伴う場合に解釈へ失敗する不具合を持っていた。Issue #303はコードフェンスのみの場合を、Issue #312はフェンス前後の説明文・tool-call試行テキストが付く場合を、それぞれ中括弧の対応関係によるJSON抽出へ一般化して解決した（いずれもマージ済み）。この修正が無い状態でAC-2の実地検証を行うと、レビュアが正しく評価してもverdict解釈自体が失敗し、証跡生成の成否を判定できない。そのためAC-2のGiven条件は「Issue #303・#312の修正込みのmain」を明示的に要求する。

**実地検証中の追加発見（AC-2改定の理由）**: PR #311での実地検証により、証跡生成自体（`gate-local-review.sh`によるレビュー証跡のGitHub PR Reviewへの記録）は実際に成功することを確認した。しかしその後段の`trusted gate recorder`ワークフロー（`agent-skill-chain-trusted-gate.yml`）は、専用GitHub Appの認証情報（`ASC_GATE_APP_ID`・`ASC_GATE_APP_PRIVATE_KEY`）がリポジトリに一度も登録されていないため、常に失敗することが判明した。これはADR-0013（未accepted）が定める配備条件（`dedicated_app`または`required_workflow`のいずれかのenforcement backendが有効な場合だけ配備する）に違反した状態であり、GitHub Appの作成・secrets登録というインフラ設定（人間の対話的操作を要する）が別途必要である。このインフラ整備自体は本Issueのスコープ外とし、AC-2は「証跡生成物がtrusted gate recorderの入力契約を満たすこと」（インフラ非依存で検証可能な範囲）へ改定する。Check Run記録の実地検証（インフラ整備後のend-to-end smoke）は別Issueへ切り出す。

## 用語

本SPECで用いる「**レビュー証跡の技術的独立性**」（以下「技術的独立性」）は、**別人格・別GitHub actorによるレビューであること**を意味しない。本システムが機械的に検査・保証しているのは、strict profileで必要となる2件のレビュー証跡が、次の性質を全て満たすことである。

1. 2件の証跡の`reviewer.run_id`が互いに異なる（同一レビュア実行の結果を2回投稿したものではない）。
2. 2件の証跡の`reviewer.slot`が互いに異なり、必要なslot集合（strict profileでは`{1, 2}`）を過不足なく満たす。
3. 2件の証跡の`execution.launcher_token_digest`が完全に一致する。これは両証跡が**同一のprotected-base隔離launcher実行が排他生成した1個のone-time attempt token**に由来すること、すなわち候補ブランチのコードでも、後から任意に追加した第三の実行でもないことを示す。
4. 各証跡を投稿したGitHub actorが、許可済みactor（trusted recorder）集合に属する。

すなわち技術的独立性とは「**別run_id・別slot・同一launcher token**」であり、GitHub actorの同一性・非同一性は独立性の判定要素ではない。本システムが正常系として想定する実行経路は、単一の資格情報・単一のprotected-base隔離セッションがslot 1とslot 2を連続実行し、slotごとに異なる`run_id`を発行しつつ、両slotが同一の`launcher_token_digest`を持つ証跡を生成するものであり、これは同一actorによる実行である。証跡には`actor_relation`（`same_as_writer` / `distinct_from_writer`）が記録されるが、これは事後監査のための記録専用の情報であり、`approved` / `rejected` / `human_required` の判定には用いられない。

この設計が自己レビューの疑義を排除できる根拠は「レビュアが別人格であること」ではなく、レビュー対象である候補ブランチのコードが、レビュー実行環境・検証ロジック・証跡内容のいずれにも影響を与えられないこと（protected base隔離・read-only sandbox・prompt/成果物/launcher digestの一致要求）にある。

## 要求 → 要件 → 受入条件

### 要求

新規PRのレビュー証跡生成手順が、個人の記憶に依存せず、Git管理下のrunbookとして誰でも再現可能な形で存在する。少なくとも1件の実PRで、strict profile（独立2体レビュア）を含めてこの手順が実際に機能することを実証する。

### 要件

- `gate review`→`gate reviewer-prompt`→（実評価）→`gate submit-evidence`（`gate-local-review.sh`が内部で実行する一連）の正規手順を、誰が・いつ・どのcapability要件（`frontier_coding`/`maximum_reasoning`等）で・どのコマンドを実行するかを`.agent-skill-chain/standards/`配下の文書として明文化する。
- 実PRのstrict profileゲート（独立2体レビュア必要）を、現在のmain（Issue #303・#312の修正込み）を基準として実際に完走させ、証跡生成物がtrusted gate recorderの入力契約（`repository_dispatch`ペイロード）を満たすことを確認する。Check Run記録自体の実地検証はGitHub App等のインフラ整備後の別Issueで扱う。
- 前節「用語」が定義するレビュー証跡の技術的独立性（別run_id・別slot・同一launcher token）が、`gate-local-review.sh`のprotected-base隔離launcher・one-time attempt token・集約時のrun_id/slot重複排除およびlauncher token digest一致検査によって担保されていることを、既存コード（`src/lib/review-evidence.ts`）の該当ロジックを指し示して確認する。actorの同一性・非同一性は判定要素に含めない。
- 本Issue自身の実装（文書追加のみ、コード変更を伴わない場合）についても、可能な範囲でこの手順を適用し実地検証を兼ねる。

### 受入条件（Acceptance Criteria）

#### AC-1: 運用手順が恒久文書として存在する

- Given: `.agent-skill-chain/standards/` 配下
- When: 新設する運用手順文書を読む
- Then: 「誰が」「いつ」「どのコマンドを」「どのcapability要件で」実行するかが、この文書単体で自己完結して読み取れる
- 検証方法見込み: `manual`

#### AC-2: 実PRでstrict profileの証跡生成を実地検証し、trusted gate recorderの入力契約を満たすことを確認する

- Given: 現在のmain（Issue #303・#312の修正込み）を基準とした実PRのstrict profileゲート
- When: 運用手順に従い `gate-local-review.sh` を実行する
- Then: 以下の3点が全て満たされる
  1. `gate-local-review.sh`の終了コードが`0`である（strict時の2 slot双方の`gate submit-evidence`が成功したことを意味する）。
  2. GitHub PR Reviewへ、`run_id`・`slot`が異なる独立2件の証跡が実際に投稿されている（`gh api pulls/<PR番号>/reviews`で確認）。
  3. `repository_dispatch`のペイロード（`event_type: agent-skill-chain-gate-record`、`client_payload: {pr_number, gate, target_sha}`）が発行されている。
  上記3点のいずれか1つでも満たされなければ本ACは不合格とする（`gate-local-review.sh`が非0で終了する、または証跡が1件以下しか投稿されない、または`repository_dispatch`が発行されない場合は不合格）。trusted gate recorderワークフロー自体がCheck Runを実際に記録できるかは、GitHub App等のインフラ整備を要するため本ACの対象外とする（別Issueで扱う）。
- 検証方法見込み: `manual`

#### AC-3: レビュー証跡の技術的独立性が担保されていることを確認する

本ACが指す「技術的独立性」は前節「用語」の定義（別run_id・別slot・同一launcher token。actorの同一性は判定要素ではない）に従う。

- Given: 既存実装（`.agent-skill-chain/scripts/gate-local-review.sh`・`src/lib/review-evidence.ts`）が持つ、以下の担保機構
  1. protected base隔離launcher: 証跡生成は候補ブランチのコードではなく、常にrepository default branch（main）から作成した隔離clone（credential-bearing remoteを持たない）上で実行される。候補ブランチが自分自身の検証ロジックを改ざんできない。
  2. one-time attempt token: launcher実行1回につき1個のtokenファイルが排他生成（`wx`フラグ・`mode 0600`）され、strict時の各slot（レビュア1体分）の`run_id`を事前固定する。一度消費されたslotは再利用できず、全slotが消費されない限りlauncherは非0で終了する。
  3. 集約時の独立性検査: `run_id`集合の一意性、`slot`集合の一意性と必要slot集合（strict時`{1, 2}`）の充足、および全証跡の`execution.launcher_token_digest`が単一値であることを検査する。
- When: strict profileのゲートで、1回のprotected-base隔離launcher実行がslot 1・slot 2を連続実行し、2件の証跡をGitHub PR Reviewへ投稿したうえで集約検証を行う
- Then: 以下が全て成立する
  1. 2件の証跡の`run_id`が互いに異なり、`slot`が`{1, 2}`を過不足なく満たす。重複または欠落がある場合、集約結果は`approved`にならず`human_required`となる。
  2. 2件の証跡の`execution.launcher_token_digest`が完全に一致する。一致しない場合（別々のlauncher実行に由来する証跡を混在させた場合）、集約結果は`approved`にならず`human_required`となる。
  3. 各証跡を投稿したGitHub actorが許可済みactor（trusted recorder）集合に属する。属さないactorの証跡が含まれる場合、集約結果は`approved`にならず`human_required`となる。
  4. 上記1〜3に加え、全証跡について`prompt_digest`・承認成果物のpath/digest集合・protected-base実行attestation（`trusted_base_sha`・`launcher_digest`・`launcher`識別子・`isolation: ephemeral_clone`・`sandbox: read_only`・`capability.read_only`）が期待値と一致し、かつ全証跡のverdictが`conformance: pass`・`falsification: pass`・`inconclusive: false`・blocking findingなしである場合に限り`approved`となる。
  5. 2件の証跡を投稿したGitHub actorが同一であることは、それ自体では拒否理由にならない。actorとwriterの関係は`actor_relation`（`same_as_writer` / `distinct_from_writer`）として証跡へ記録されるのみで、`approved` / `rejected` / `human_required` の判定には用いられない。したがって「actorが2件で異なること」は本ACの合格条件に含めない。
- 検証方法見込み: `manual`

## スコープ外

- trusted gate recorderの信頼モデル・attestation設計自体の再設計（ADR-0013で確定済みの判断は変更しない）。
- 個別PR（PR #299等、本Issue以外）の手動での通過作業。
- 通常のセグメントワーカー手順の中でレビュー証跡生成を自動起動する経路の追加（CI内でAIレビュアを実行すること自体が設計上禁止されているため、完全自動化は本Issueのスコープでは実現不能と判断する場合はその理由を明記する）。
- GitHub Appの作成・秘密鍵生成・リポジトリへのinstall・secrets（`ASC_GATE_APP_ID`・`ASC_GATE_APP_PRIVATE_KEY`）登録（人間の対話的操作を要するインフラ設定であり、進行役のツールでは実行できない。別Issueで扱う）。
- trusted gate recorderワークフローが実際にCheck Runを記録するend-to-end smoke検証（上記インフラ整備が前提のため別Issueで扱う）。
