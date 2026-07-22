# 正本: AGENTS.md §不変条件I7
#
# 本ファイルは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）に完全一致する単一YAMLドキュメントである。
# 見出し構造ではなく1つのYAMLとして記述する（src/commands/verify.ts の acCoverage() が
# 本ファイル全体を単一YAMLとして readYamlFile() で読み込むため、見出し相当の情報はコメントで表現する）。
#
# 本検証は実装者本人とは別の独立検証者として実施した。実装フェーズの自己申告（434件pass）を
# 鵜呑みにせず、以下すべてを自ら再実測した:
#   - 本 worktree で npm test（pretest で npm run build）を独立に再実行し、
#     434 tests / 434 pass / 0 fail / 0 skipped を実測した（実装フェーズ報告と一致・回帰なし）。
#   - AC-1/AC-2: src/commands/setup.ts の純関数 decideGithubBundle() を tsx で直接 import し、
#     local/github/config不読/未知backend の4ケースを実測。local→run:false、github→run:true、
#     config不読→run:false（安全側スキップ）、未知backend→run:false を確認した。
#   - AC-3: doctor の checkAdrConsistency()（D5）を tsx で直接呼び、健全（対称）ケースは ok:true・
#     非対称/status enum不正/dangling参照の各不整合を ok:false で検知することを実測。D1〜D5 全体は
#     test/integration/doctor.test.ts（225行・意図的不整合フィクスチャ）を独立に再実行し全通過を確認した。
#   - AC-5: .agent-skill-chain/adapters/claude.sh の WORKER_ALLOWED_TOOLS_DEFAULT 実値を grep し、
#     生 Bash(gh pr create:*) が除去され Bash(gh pr view/edit/comment:*) が残存することを実測。
#     さらに pr-create.sh→node bin/agents-md.js pr create→src/lib/exec.js gh() のNode子プロセス経路を
#     追跡し、allowlist除去がラッパー自身のPR作成を阻害しないことを確認した。
#   - AC-6: test/integration/github-backend.test.ts の pr create 本文生成テスト3件を独立に再実行し
#     全通過（テンプレート5節が SPEC/DESIGN から自動充填される）を実測した。
#   - AC-7/AC-8: 実 git フィクスチャ（proposed→正規finalize commit / proposed→本文改変+複数ファイル
#     +非finalizeメッセージの逸脱commit）を作成し、src/lib/adr-finalize-guard.ts の
#     checkAdrFinalizePath() を tsx で直接呼び、正規finalize=finding無し・逸脱=3条件すべてに
#     finding発生を実測。加えて src/commands/adr.ts finalize が「単一ファイル add + 固定メッセージ
#     commit + status行のみ改変」を構造的に満たすことをソースで確認し、AC-8の非誤検知が実運用の
#     finalize経路でも成立することを確証した。
#
# ---- AC-4 対象外doctor観点の理由記録（AC-4のThenが要求する記録本体・非ブロッキング） ----
#
# DESIGN.md 論点2に基づき、doctorへ追加可能な健全性観点を「実装（D1〜D5）」「部分除外」「対象外」に
# 判別した。以下は対象外・部分除外とした観点とその理由である（AC-4 の検証対象そのもの）。
#
# 対象外1（Check Run 状態）: github backend 固有でネットワークとPR/SHA解決を要する。ゲートの正本が
#   Check Run そのものであり、doctor による再導出は正本の重複となる。ローカルでオフライン再現できない
#   ため対象外とした。
# 対象外2（label projection）: github backend 固有でネットワークを要する。label 適用はべき等な
#   setup-labels.sh が正本であり常時再適用可能なため、doctor による検知の実益が乏しい。対象外とした。
# 対象外3（system-spec manifest 整合性）: docs/system-spec/ の実体が未構築（ADR-0001 が proposed で
#   実体構築は別Issue）であり、検査対象が存在しない。実体構築後に別途追加すべき観点であり現時点では対象外。
# 部分除外1（D3 writer lease）: github backend の git-ref lease はネットワークを要するため対象外とし、
#   local backend のローカル状態ファイル（issues/<id>/.../lease.yaml）の expires_at 失効のみを検査する。
# 部分除外2（D4 requirement ID 一貫性）: system-spec 安定ID（例 ASC-GATE-FR-0014）の一貫性は
#   system-spec 未構築のため対象外とし、各 worktree の SPEC.md 内 AC-ID 重複検知のみの軽量版を実装した。
#
# ---- findings（AC個別のpass/fail判定に加えて記録する検証者所見。いずれも非ブロッキング） ----
#
# finding-1（AC-7/AC-8関連、既存ADRへのガード適用時の挙動・スコープ内で許容・非ブロッキング）:
#   本 worktree で node bin/agents-md.js verify adr を実 ADR-0002（status: accepted）に対し実行すると、
#   ADR finalize手順逸脱としてfindingを報告し exit 1 となることを実測した。原因は ADR-0002 の
#   accepted化commitが正規 'adr finalize' CLI 経路ではなく squash-merge commit（#179）であり、
#   固定メッセージ形式・単一ファイル変更・status行のみ差分の3署名をいずれも満たさないためである。
#   これは誤検知ではなく、過去に実在した手順逸脱（#178 VALIDATION finding-2 で記録済み）の正しい検出で
#   ある。ただし CI（agent-skill-chain-ci.yml の verify-adr ステップ）は「PR差分で変更された docs/adr/*.md
#   のみ」を対象に verify-adr.sh を呼ぶ設計であり、本 PR(#188) は ADR を一切変更しない（差分ゼロ）ため
#   CI の verify-adr ループは0回実行され、本 PR の CI/ゲートは破綻しない。SPEC スコープ外「既存逸脱事例の
#   遡及是正は行わない」とも整合する。残存リスク: 将来のPRが squash-merge で accepted化された ADR を
#   （status以外の目的で）変更すると、当該ガードが逸脱を（実質誤検知として）報告し CI を落としうる。
#   これは DESIGN.md 論点4が明記する「squash/rebase により履歴署名が失われうるトレードオフ」の範囲内で
#   あり、本 Issue のブロッカーにはしない。将来的な緩和（accepted化commitを履歴からたどれない場合の
#   扱いの精緻化、または accepted 遷移直近commitのみを対象に限定する等）を推奨として記録する。
#
# finding-2（AC-8関連、実装の軽微な可読性・実害なし・非ブロッキング）:
#   src/lib/adr-finalize-guard.ts の commitメッセージ照合は git log -1 --format=%B（コミット全文body）を
#   取得し変数 subject へ格納して単一行の期待文字列と比較する。正規 finalize CLI は本文の無い単一行commitを
#   生成するため実運用で不一致は生じないが、将来 finalize commit にトレーラ等が付くと %B は複数行となり
#   誤検知しうる。命名（subject に %B を格納）と、subject/body いずれを照合すべきかの明確化を可読性向上として
#   推奨する。現状の実装は AC-7/AC-8 を実測で満たしており、本 Issue のブロッカーにはしない。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-188
target_sha: b09f156acfd867509e5e5ed2e79f6b4d27fd8e1a

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: hybrid
      result: pass
      reason: "setup（引数無し）のフルCLI経路は実行時ルート解決の既知挙動（主 worktree 側 src/ を指し config 不在で ENOENT になりうる）によりworktree内での端到端再現が不安定なため、DESIGN.md 論点1で副作用と分離するため純関数へ切り出された decideGithubBundle() の返り値を直接実測して検証した。実装フェーズ報告の「bare setup のフルCLI経路は既存動作により再検証不可」という説明は妥当であり、挙動変更の本体である判定ロジックは独立に実測可能で実測済みである"
      procedure: "tsx で src/commands/setup.ts の decideGithubBundle(targetDir) を直接 import し、コピー済み config の coordination.backend を local に設定した targetDir を渡すと run:false（GitHub固有処理をスキップ）を返すことを実測した。config 不読・未知 backend も安全側で run:false を返すことも併せて実測した"
      executor: claude
    evidence:
      - "実測: decideGithubBundle(local) -> {run:false, message:'[setup github] スキップ: coordination.backend が github ではありません（現在: local）...'}"
      - "src/commands/setup.ts（decideGithubBundle: github明示時のみ run:true、local・config不読・未知backendは run:false）"
      - "src/commands/setup.ts（setup() 本体が decision.run で githubBundle() の実行/スキップを分岐、スキップ時は情報行を summary へ積む）"
      - "test/unit/setup.test.ts・test/integration/setup.test.ts（分岐の自動回帰テスト）"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
      reason: "自動テストに加え、github backend 設定時に decideGithubBundle() が run:true を返し既存 githubBundle() 経路が無変更で通ることを独立に実測したため"
      procedure: "tsx で decideGithubBundle(targetDir) を coordination.backend=github の targetDir に対して呼び run:true を実測。setup() 本体が run:true 時に従来どおり githubBundle() を実行し失敗時は fail することをソースで確認した"
      executor: claude
    evidence:
      - "実測: decideGithubBundle(github) -> {run:true, message:''}"
      - "src/commands/setup.ts（run:true 時は既存 githubBundle(targetDir) を無変更で実行、GitHubモードの機能後退なし）"
      - "test/unit/setup.test.ts・test/integration/setup.test.ts（github時の実行分岐テスト）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
      reason: "自動テストに加え、追加検査 D5（ADR整合性）を直接呼び出し各不整合を再現して検知を、正常時の沈黙を独立に実測したため"
      procedure: "1) test/integration/doctor.test.ts（D1〜D5 の意図的不整合フィクスチャ・225行）を含む npm test 全体を独立に再実行し全通過を確認。2) checkAdrConsistency(root) を tsx で直接呼び、対称ADR=ok:true、supersedes⇔superseded-by非対称=ok:false、status enum不正=ok:false、dangling参照=ok:false を実測した"
      executor: claude
    evidence:
      - "src/commands/doctor.ts（D1 branch名規約／D2 Durability Backend疎通／D3 local writer lease失効／D4 SPEC.md内AC-ID重複／D5 ADR整合性 を独立try/catchで追加）"
      - "src/lib/adr-consistency.ts（D5 と lint adr check が共有する対称性検査ロジック、重複排除）"
      - "test/integration/doctor.test.ts（D1〜D5 の NG検知・正常時沈黙の自動テスト、全通過）"
      - "実測: checkAdrConsistency 健全=ok:true／非対称・status不正・dangling=ok:false+理由文字列"

  - ac_id: AC-4
    verification:
      mode: manual
      result: pass
      reason: "技術的に実装不能・非対象と判断した doctor 観点の対象外理由の記録有無は、独立検証成果物の内容確認でのみ判定できるため"
      procedure: "本 VALIDATION.md 冒頭コメントの『AC-4 対象外doctor観点の理由記録』節に、対象外3観点（Check Run状態・label projection・system-spec manifest整合性）と部分除外2観点（D3 github lease・D4 system-spec安定ID）の理由を記載し、DESIGN.md 論点2の判別と整合することを確認した"
      executor: claude
    evidence:
      - "本 VALIDATION.md コメント節『AC-4 対象外doctor観点の理由記録』（対象外3＋部分除外2の理由）"
      - "DESIGN.md 論点2（実装D1〜D5／部分除外／対象外の判別根拠）"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
      reason: "自動テストに加え、adapter 既定 allowlist の実値と pr create ラッパーの起動経路を独立に実測したため"
      procedure: "1) test/integration/worker-adapters.test.ts（既定allowlistに生 gh pr create が含まれず、pr createラッパー経路 .agent-skill-chain/scripts/* と gh pr view/edit は含まれることを assert）を含む npm test 全体を再実行し全通過を確認。2) claude.sh の WORKER_ALLOWED_TOOLS_DEFAULT 実値を grep し生 Bash(gh pr create:*) 不在・Bash(gh pr view/edit/comment:*) 残存を実測。3) pr-create.sh→node bin/agents-md.js pr create→src/lib/exec.js gh() のNode子プロセス経路を追跡し、allowlist除去がラッパー自身のPR作成を阻害しないことを確認した"
      executor: claude
    evidence:
      - ".agent-skill-chain/adapters/claude.sh（WORKER_ALLOWED_TOOLS_DEFAULT から Bash(gh pr create:*) を除去、view/edit/comment は残存、除去理由と正規経路をコメントで自己完結記載）"
      - "test/integration/worker-adapters.test.ts（生 gh pr create 不在・pr createラッパー経路含有・env完全上書き可 の assert）"
      - "実測: 生 gh pr create の出現箇所はコメント4件のみ・DEFAULT変数実値には不在"
      - "src/commands/pr.ts・.agent-skill-chain/scripts/pr-create.sh（ラッパーはNode子プロセスで gh を起動しBash allowlist管理外）"

  - ac_id: AC-6
    verification:
      mode: hybrid
      result: pass
      reason: "実 PR 作成には gh を要するため gh-stub で --body を記録する統合テストで検証する必要があり、そのテストを独立に再実行してテンプレート5節の自動充填を実測したため"
      procedure: "test/integration/github-backend.test.ts の pr create 本文生成テスト3件（SPEC.mdのみ／DESIGN.mdあり／テンプレート不読フォールバック）を独立に再実行し全通過を確認。gh-stub が記録した --body に Closes・変更概要・理由・影響範囲・ロールバック方針・成果物リンクのテンプレート各節が SPEC/DESIGN から充填されることを実測した"
      executor: claude
    evidence:
      - "src/commands/pr.ts（buildIssueBody: PRテンプレート5節を SPEC.md/DESIGN.md 成果物から自動充填、ラッパー実装は無変更）"
      - ".agent-skill-chain/templates/github/.github/pull_request_template.md（変更概要・理由・影響範囲・ロールバック方針・成果物リンクの5節）"
      - "test/integration/github-backend.test.ts（pr create 本文生成テスト3件・gh-stub の --body 検証、独立再実行で pass）"

  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
      reason: "自動テストに加え、実 git フィクスチャで finalize 非経由の status 変更 commit を再現しガードの逸脱検知を独立に実測したため"
      procedure: "1) test/integration/verify.test.ts の finalize ガード逸脱検知テストを含む npm test 全体を再実行し全通過を確認。2) 実 git リポジトリに proposed ADR を作成後、status を accepted へ変えつつ本文も改変し他ファイルも変更する非finalizeメッセージの commit を作り、checkAdrFinalizePath() を tsx で直接呼ぶと、(a)固定メッセージ不一致・(b)ADR以外も変更・(c)status行以外の本文改変 の3条件すべてに finding が発生し逸脱として報告されることを実測した"
      executor: claude
    evidence:
      - "src/lib/adr-finalize-guard.ts（accepted遷移commitを git log --follow で特定し、固定メッセージ・単一ファイル・status行のみ差分の3署名を照合）"
      - "src/commands/verify.ts（status: accepted のADRについて worktreeRoot() 基点で checkAdrFinalizePath を呼び errors へ積む）"
      - "test/integration/verify.test.ts（finalize経路ガードの逸脱検知テスト、全通過）"
      - "実測: 逸脱フィクスチャで3条件すべてに finding 発生（非ゼロ相当）"

  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
      reason: "自動テストに加え、正規 finalize 相当の commit（固定メッセージ・単一ADRファイル・status行のみ差分）をガードが誤検知しないことを実 git フィクスチャで独立に実測したため"
      procedure: "1) test/integration/verify.test.ts の正規finalize非誤検知テストを含む npm test 全体を再実行し全通過を確認。2) proposed ADR を『status行のみ accepted へ変更・単一ファイル add・固定メッセージ chore(adr): <ID> を accepted へ更新』の commit で finalize したフィクスチャに対し checkAdrFinalizePath() が空配列（finding無し）を返すことを実測。3) src/commands/adr.ts finalize が git add 単一ファイル＋固定メッセージ commit＋status行のみ改変を構造的に満たすことをソースで確認し、実運用の finalize 経路でも誤検知しないことを確証した"
      executor: claude
    evidence:
      - "src/lib/adr-finalize-guard.ts（3署名すべてを満たす場合は空配列を返し過剰検出しない）"
      - "src/commands/adr.ts finalize（git add 単一ファイル + commit -m 固定メッセージ + status行のみ置換 でガードの3署名を構造的に充足）"
      - "test/integration/verify.test.ts（正規finalize由来commitの非誤検知テスト、全通過）"
      - "実測: 正規finalizeフィクスチャで checkAdrFinalizePath -> finding無し"

  - ac_id: AC-9
    verification:
      mode: automated
      result: pass
      reason: "npm test を独立にフル実行し、実測件数を確認した"
      procedure: "本 worktree で npm test（pretest で npm run build）を実行し、434 tests / 434 pass / 0 fail / 0 skipped を実測した（実装フェーズ報告の434件と一致・回帰なし）"
      executor: claude
    evidence:
      - "npm test 実行結果: tests 434, pass 434, fail 0, skipped 0"

regression:
  executed: true
  evidence:
    - "npm test 実行結果: 434/434 pass, 0 fail, 0 skipped（独立再実行）"
    - "追加24件（doctor D1〜D5・setup分岐・allowlist・finalizeガード）を含み既存410件と合わせ全通過"
