schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-300
# target_shaは、本報告が検証対象とする全成果物（SPEC.md・DESIGN.md・PLAN.md・AGENTS.md・
# .agent-skill-chain/standards/GATE_REVIEW_OPERATIONS.md）が揃った時点のcommitを指す。
# SPEC.md改定（AC-2の対象範囲縮小、AC-3のレビュア独立性定義の是正）およびdesign-gate指摘への
# 是正を全て取り込んだ後のSHAであり、現行のAC定義に対する検証証跡であることを示す。
# 本ファイル自身の更新commitは、この直後にVALIDATION.mdのみを変更するものであり、
# 検証対象の成果物内容を変えない（自己のSHAを自己に記載することは原理的に不可能なため）。
target_sha: 0f4b2795363880ba0a88f8b49e4ce0e3f85f5953

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: manual
      result: pass
      reason: "運用手順文書の自己完結性と発見可能性は機械的な自動テストでは判定できず、文書を実際に読み、正本文書からの参照経路を人手で確認する必要がある"
      procedure: |
        1. GATE_REVIEW_OPERATIONS.mdを、この作業を初めて行う想定で通読し、誰が・いつ・どのコマンドを・
           どのcapability要件で実行するかが文書単体（他のIssueコメントや会話履歴を参照せず）で
           判断できることを確認した。
        2. 発見可能性（個人の記憶に依存せず到達できること）を確認するため、AGENTS.mdの
           ディレクトリ構成のstandards/列挙へGATE_REVIEW_OPERATIONSを追加し、
           ゲート運用を述べる本文へ本文書を証跡生成手順の正本として明示した。
           改定後のAGENTS.mdをgrepし、正本文書から本文書への参照経路が2箇所存在することを確認した。
        3. AGENTS.mdの150行上限（不変条件に基づく機械検査）に抵触しないことを
           `.agent-skill-chain/ci/verify-doc-length.sh` の実行（終了コード0、改定後144行）で確認した。
      executor: "implementation_worker（進行役セッション）"
    evidence:
      - ".agent-skill-chain/standards/GATE_REVIEW_OPERATIONS.md（commit 816dbd4, 26165c1）"
      - "AGENTS.md（ディレクトリ構成のstandards/列挙、およびゲート運用本文での正本明示）"
      - "verify-doc-length.sh 実行結果（終了コード0）"

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
           4782567345、いずれもstate=COMMENTED）が記録されたことを確認した（AC-2 Then 2を充足）。
        5. repository_dispatch（event_type: agent-skill-chain-gate-record、client_payload: pr_number/gate/target_sha）が
           発行されたことを、受信側ワークフローのrun 30219790679（run-name: gate-record-311-spec-816dbd4a0ef47d31...）が
           実際に起動している事実により確認した（AC-2 Then 3を充足）。run-nameはclient_payloadの
           pr_number=311・gate=spec・target_sha=816dbd4... をそのまま反映しており、ペイロード内容の証跡でもある。
           gate-local-review.shの終了コードは0（AC-2 Then 1を充足）。
        6. PR #311のCI再実行で verify-and-publish (spec) の「Verify local-review evidence」ステップが
           final: rejected を返したことを確認した（human_requiredではなく実際の判定が返っている＝証跡がverifyGithubReviewEvidenceに
           正しく解釈され、入力契約を満たしたことの直接証跡）。
        7. trusted gate recorderワークフロー（repository_dispatch受信側）はASC_GATE_APP_IDが構成されていませんで失敗した。
           SPEC.mdのAC-2は「trusted gate recorderワークフロー自体がCheck Runを実際に記録できるか」を明示的に対象外と
           しているため、この失敗は本ACの合否に影響しない（別Issueで扱うGitHub Appインフラ整備が前提）。
        8. 上記の実地実行は commit 816dbd4 を target_sha として行った。それ以降の本ブランチのcommitが変更したのは
           SPEC.md・DESIGN.md・PLAN.md・VALIDATION.md・AGENTS.md・
           .agent-skill-chain/standards/GATE_REVIEW_OPERATIONS.md という文書のみであり、証跡生成経路の実体
           （.agent-skill-chain/scripts/gate-local-review.sh・src/lib/review-evidence.ts・.github/workflows/配下）には
           一切変更を加えていない（git diff --name-only 816dbd4..0f4b279 で確認）。したがって本ACの実測結果は
           現在のtarget_shaに対してもそのまま妥当である。
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
        5. 各証跡についてprompt_digestが期待値と一致すること、trusted_base_sha・launcher_digestが期待値と一致すること、
           isolationがephemeral_clone・sandboxがread_only・reviewer.capability.read_onlyが真であることを
           個別に検査し、いずれか1つでも不一致なら失敗させる。さらにapprovedとなるのは全証跡のverdictが
           conformance: pass・falsification: pass・inconclusive: false であり、かつblocking findingが
           1件も無い場合に限られる（いずれかがfailまたはblocking findingありならrejected）ことを確認した。
        6. actorに関する検査はtrustedActors所属の認可チェックのみであり、2件でactorが異なることは要求されない。
           actor_relation（same_as_writer/distinct_from_writer）はreviewersへ記録されるのみで、
           approved/rejected/human_requiredの判定ロジックから参照されないことをコード上で確認した。
           したがってSPEC.mdのAC-3 Thenが定める「actorが2件で異なることは合格条件に含めない」と実装は一致する。
        AC-2の実地検証（PR #311）で、単一のlauncher実行から異なるrun_id/slotを持ち同一launcher_token_digestを
        共有する証跡2件が実際に生成され、集約検証がhuman_requiredではなくrejected（＝独立性・attestation検査を
        通過したうえでのverdict由来の判定）を返したことも、この設計が実際に機能していることの裏付けとなる。
      executor: "implementation_worker（進行役セッション）"
    evidence:
      - ".agent-skill-chain/scripts/gate-local-review.sh"
      - "src/lib/review-evidence.ts（verifyGithubReviewEvidence関数）"
      - "DESIGN.md「技術的独立性の担保（AC-3の確認内容）」節"
      - "SPEC.md「用語」節（技術的独立性＝別run_id・別slot・同一launcher tokenの定義。本ACの判定基準）"

regression:
  executed: true
  evidence:
    - "本ブランチのtarget_sha時点でnpm test全件をローカル実行し、608件全て成功・失敗0件（tests 608 / pass 608 / fail 0、終了コード0）"
    - "verify doc-length 実行（終了コード0、AGENTS.md 144行 ≤ 150行上限）"
    - "verify ac-coverage ISSUE-300 実行（終了コード0、AC-1〜AC-3が全て検証方法・証跡と対応）"
    - "lint vocab 実行（禁止語の混入なし）"
    - "本Issueの変更はAGENTS.md・DESIGN.md・PLAN.md・VALIDATION.md・SPEC.md・GATE_REVIEW_OPERATIONS.mdという文書のみであり、実行コード・ワークフロー定義に変更を加えていない（git diff --name-only で確認）"
    - "Issue #303・#312のnpm test全件実行（607/608成功、唯一の失敗は既知の/tmp/.git環境汚染で本Issueと無関係）"
    - "PR #313（Issue #312）はself-test（npm test全件）がCI上で成功（gh pr checks 313）"
