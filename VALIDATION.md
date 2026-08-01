schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-300
target_sha: 9b23e514fd60113e87e1fb2f6e5f11fa4aa6a424

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: manual
      result: pass
      reason: "運用手順文書の自己完結性は機械的な自動テストでは判定できず、文書を実際に読んで単体で再現可能かを人手で確認する必要がある"
      procedure: "GATE_REVIEW_OPERATIONS.mdを、この作業を初めて行う想定で通読し、誰が・いつ・どのコマンドを・どのcapability要件で実行するかが文書単体（他のIssueコメントや会話履歴を参照せず）で判断できることを確認した"
      executor: "implementation_worker（進行役セッション）"
    evidence:
      - ".agent-skill-chain/standards/GATE_REVIEW_OPERATIONS.md（commit 816dbd4, 26165c1）"

  - ac_id: AC-2
    verification:
      mode: manual
      result: pass
      reason: "trusted gate recorderのCheck Run記録はGitHub App未整備のため本Issueのスコープでは検証不能。証跡生成・入力契約充足の実地確認は実際にコマンドを実行しGitHub API応答を確認する必要がある"
      procedure: |
        1. PR #311（Issue #300自身、risk未分類のためstrict profile）のbase_sha（8cb1710、Issue #303・#312込みの最新main）を
           独立clone（main worktreeが他の並行セッションで使用中のため作成）でclean checkoutした。
        2. target_sha（816dbd4）を明示的にgit fetchした（classifyCoreReviewのgit diff解決に必要、GATE_REVIEW_OPERATIONS.mdへ記載）。
        3. CLAUDE_CORE_REVIEW_MODEL_TIER=frontier_coding等のcapability要件を指定し、gate-local-review.sh
           ISSUE-300 spec strict 816dbd4 8cb1710 311 claude を実行した（DONE RC=0）。
        4. gh api repos/.../pulls/311/reviews で、実際にGitHub PR Reviewへ独立2件の証跡（review ID 4782564835,
           4782567345、いずれもstate=COMMENTED）が記録されたことを確認した。
        5. PR #311のCI再実行で verify-and-publish (spec) の「Verify local-review evidence」ステップが
           final: rejected を返したことを確認した（human_requiredではなく実際の判定が返っている＝証跡がverifyGithubReviewEvidenceに
           正しく解釈され、入力契約を満たしたことの直接証跡）。
        6. trusted gate recorderワークフロー（repository_dispatch受信側）はASC_GATE_APP_IDが構成されていませんで失敗した。
           これはGitHub Appインフラ未整備によるものであり、AC-2が要求する「証跡生成物が入力契約を満たす」ことには影響しない
           （契約充足はステップ5で既に確認済み）。
      executor: "implementation_worker（進行役セッション）"
    evidence:
      - "PR https://github.com/techbeansjp-free/AGENTS.md/pull/311"
      - "gh api repos/techbeansjp-free/AGENTS.md/pulls/311/reviews（review ID 4782564835, 4782567345）"
      - "gh run view 30219790470（verify-and-publish (spec)、final: rejected）"
      - "Issue #300 コメント（2026-07-26、GitHub App未整備の発見記録）"

  - ac_id: AC-3
    verification:
      mode: manual
      result: pass
      reason: "技術的独立性の担保は既存コードの静的な読解による確認であり、既存のsubmit-evidence関連テストが間接的にカバーする"
      procedure: |
        技術的独立性の定義（別run_id・別slot・同一launcher token。actorの同一性は判定要素ではない）に照らし、
        gate-local-review.sh・review-evidence.tsの該当箇所を読み、以下を確認した。
        1. protected base worktreeのCURRENT_ROOT/CURRENT_SHAがbase_shaと一致しcleanであることを実行前に検査する
           （候補ブランチの実行コードを証跡生成に使わせない）。
        2. 隔離cloneはgit clone --no-checkout + checkout --detach + remote remove originでcredential-bearing
           remoteを持たない状態にしてからbuildする。
        3. launcher-token.json（mode 0600、wxフラグで排他生成）が各slotのrun_idを事前固定し、consumed_slotsで
           再利用を防ぐ。全slotが消費されない場合はlauncherが非0終了しrepository_dispatchを発行しない。
        4. verifyGithubReviewEvidence（review-evidence.ts）がrunIds/slotsのSet重複検査・必要slot集合の充足検査・
           全証跡のlauncher_token_digestが単一値であることの検査を行い、launcher_digest/trusted_base_sha/
           prompt_digest/成果物digestの一致も全証跡へ要求するため、証跡の後からの偽装ができないことを確認した。
        5. actorに関する検査はtrustedActors所属の認可チェックのみであり、2件でactorが異なることは要求されない。
           actor_relation（same_as_writer/distinct_from_writer）はreviewersへ記録されるのみで、
           approved/rejected/human_requiredの判定ロジックから参照されないことをコード上で確認した。
        AC-2の実地検証（PR #311）で、単一のlauncher実行から異なるrun_id/slotを持ち同一launcher_token_digestを
        共有する証跡2件が実際に生成されたことも、この設計が実際に機能していることの裏付けとなる。
      executor: "implementation_worker（進行役セッション）"
    evidence:
      - ".agent-skill-chain/scripts/gate-local-review.sh"
      - "src/lib/review-evidence.ts（verifyGithubReviewEvidence関数）"
      - "DESIGN.md「技術的独立性の担保（AC-3の確認内容）」節"

regression:
  executed: true
  evidence:
    - "Issue #303・#312のnpm test全件実行（607/608成功、唯一の失敗は既知の/tmp/.git環境汚染で本Issueと無関係）"
    - "PR #313（Issue #312）はself-test（npm test全件）がCI上で成功（gh pr checks 313）"
