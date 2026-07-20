# VALIDATION: agent-skill-chain — lint-vocab識別子認識本格実装・ADR-0002 finalize・secret scan CI導入
#
# 本ファイルは .agent-skill-chain/schemas/validation-report.schema.yaml
# (agent-skill-chain/validation-report/v1) に完全一致する単一YAMLドキュメントである。
# 見出し構造ではなく1つのYAMLとして記述する理由は ISSUE-176 VALIDATION.md と同様
# （src/commands/verify.ts の acCoverage() が本ファイル全体を readYamlFile() で読み込むため）。
#
# 本検証は実装者本人とは別の独立した検証者として実施した。実装者の自己申告（394/394テストpass等）
# を鵜呑みにせず、以下すべてを自ら再実測した:
#   - npm ci && npm run build をこのworktreeで実行し成功を確認。npm test をフルで実行し
#     394/394 pass, 0 fail, 0 skipped を実測（実装フェーズ報告の394件と一致、regressionなし）。
#   - node bin/agents-md.js lint vocab（引数無し・デフォルト対象）を実行しexit 0を実測。
#   - AC-1/AC-2/AC-3の識別子文脈判定を、実装者のテスト（test/integration/lint.test.ts）とは別に、
#     自分で.agent-skill-chain/scripts/配下に一時テストファイルを作成して独立検証し、検証後削除した
#     （実ファイルは汚していない、git status --short で確認）。
#   - 反証的レビューとして、CLIサブコマンド文脈判定（DESIGN.md「A-3」、隣接語ホワイトリスト方式）の
#     過剰除外リスクを能動的に探索し、実際に再現した（findings参照）。この結果、AC-1/AC-2の
#     形式的なGiven/When/Thenは満たされる一方、より広い「散文中の禁止語混入は引き続き検出される」
#     という要件1の意図には抜け穴が残っていることを実測確認した。
#   - AC-6/AC-7: git log -p --follow -- docs/adr/ADR-0002-github-lease-git-ref-cas.md で
#     status以外（Context/Decision/Consequences/supersedes）が一切変更されていないことを実際の
#     diffで確認した。.agent-skill-chain/scripts/adr-lint.sh check の実行でexit 0を確認した。
#     一方、ADR.md finalizationライフサイクル規約（設計ゲート承認後にadr_finalization_worker専任が
#     `adr finalize` CLI経由でwriter leaseを取得し更新する）と実際の手順（design/planフェーズの
#     同一commitでDESIGN.mdと共にstatusを直接編集）の間の乖離を発見した（findings参照）。
#   - AC-8/AC-9: node bin/agents-md.js lint secrets を、正しい長さのダミーsecret文字列
#     （AWS Access Key ID・AWS Secret Access Key・GitHub PAT・Slack token・Google API key・
#     Stripe secret key・PEM秘密鍵ヘッダの7パターン全て）で独立に再現し、全パターンが検知され
#     exit 1になることを実測した。また通常のソースファイル（src/commands/lint.ts・package-lock.json
#     等）に対しては誤検知なくexit 0であることを確認した。さらに/tmp配下に独立したローカルbare
#     リポジトリ（実GitHubリモートとは無関係）を構築し、lint secrets --diff <base-ref> が
#     追加行のみを検査し（削除行は無視、通常差分は誤検知しない）ことを実測確認した。
#   - AC-8/AC-10の「実際のGitHub Actions実行結果・PR画面での実測確認」（manual要求）について、
#     PLAN.mdの申し送りに従い使い捨てブランチ・PRをtechbeansjp-free/AGENTS.mdへ作成しようと
#     試みたが、Claude Codeのauto modeクラシファイアにより本worktree外（/tmp配下の別クローン）
#     からのpush・PR作成が拒否された（未コミット・未pushで安全に終了、git status上も痕跡なし）。
#     この制約下での代替として、(a) 既存PR #179の実際のstatusCheckRollupとmergeable状態、
#     (b) GitHub REST APIによるbranch protection/rulesetの直接照会、という2つの現行実データで
#     AC-10を実測した（findings参照。結果はFAIL）。
#   - AC-11: .agent-skill-chain/ci/verify-template-sync.sh を実行しexit 0を確認、
#     diffコマンドで正本・配布先の2ファイルが完全一致することも直接確認した。
#     （注記: SPEC.md/PLAN.mdは本スクリプトを`.agent-skill-chain/scripts/verify-template-sync.sh`と
#     記載しているが、実体は`.agent-skill-chain/ci/verify-template-sync.sh`であった。動作・結果には
#     影響しないため単なる文書内パス表記の軽微な誤りとして扱い、AC-11の判定には影響させない）。
#
# ---- findings（AC個別のpass/fail判定に加えて記録する検証者所見） ----
#
# finding-1（AC-2関連、設計判断に関わるため修正せず本ファイルで指摘のみ）:
#   CLIサブコマンド文脈判定（isCliSubcommandContext、隣接する既知verbホワイトリストで識別子文脈と
#   みなす方式）は、真にCLI呼び出しを指す文でなくとも「banned語の前後どちらかの空白区切りトークンが
#   cli-routes.tsの動詞集合に含まれる単語」であれば無条件に除外してしまう。動詞集合には
#   create/start/resume/review/status/run/context/latest/finalize等、日常的な英単語が多数含まれる。
#   実際に以下の散文だけを含むファイルを作成しlint vocabを実行したところ、3行とも違反として
#   検出されなかった（期待: 散文としての「issue」誤用のため検出されるべき）:
#     「新しい issue create の手順を説明する。」
#     「issue status を確認してから作業する。」
#     「これは issue review の話ではない。」
#   （検証コマンド: node bin/agents-md.js lint vocab .agent-skill-chain/scripts/__tmp.md、
#    実行後ただちに一時ファイルは削除、実ファイルへの影響なし）
#   これはAC-1/AC-2の形式的なGiven/When/Thenが指定する3種の識別子文脈の例そのものは正しく
#   区別できているため個別ACとしてはpass判定とするが、要件1が意図する「散文中の禁止語混入は
#   引き続き検出される」という一般原則には、動詞ホワイトリストと偶然共起するだけの真の散文を
#   取りこぼす構造的な抜け穴が残っている。同様にYAMLキー文脈判定も「行頭+`- `直後、直後が`:`」
#   という構文パターンのみで判定しファイル種別（実際にYAMLかどうか）を見ないため、"issue: <説明>"
#   のような箇条書き定義文（本当のYAMLキーではない）も同様に除外される（`issue: これは会議の議題
#   そのものを指す言葉です。`という文単体を含むファイルでも検出されないことを実測確認済み）。
#   対応方針の決定（動詞リストを絞る、backtick必須化、ファイル拡張子で判定を出し分ける等）は
#   DESIGN.mdの識別子文脈判定方式そのものの見直しを要するため、独立検証者としては修正せず
#   未決事項として記録する。
#
# finding-2（AC-7関連、プロセス整合性の指摘。ADR本文・statusの内容自体は正しい）:
#   .agent-skill-chain/templates/adr/ADR.md が定めるADR finalizationライフサイクルは
#   「proposed → accepted は設計ゲート承認時に遷移し、進行役が adr-finalize.sh を起動、
#   専任のadr_finalization_workerがwriter leaseを取得したうえで status のみを更新する」
#   （`agent-skill-chain adr finalize <issue_id> <adr_id>` CLI、src/commands/adr.ts の
#   finalize()は design gate の gate-report.approved_artifacts に当該ADRパスが含まれることを
#   事前条件として要求する実装になっている）。しかし本Issueでは、ADR-0002のstatus更新は
#   commit 30acd1e（design/planフェーズ、DESIGN.md・PLAN.md作成と同一commit）で直接
#   ファイル編集されており、本Issue自身の設計ゲート承認を経ておらず、`adr finalize` CLIも
#   専任workerのwriter leaseも介していない。SPEC.md/PLAN.mdはこれを意図的な選択として
#   明記している（PLAN.md「design/planフェーズで実施済み。実装フェーズでの追加作業は不要」）。
#   結果として反映された内容（statusフィールドのみ変更、Context/Decision/Consequences/
#   supersedes不変）はadr_finalization_workerのscope制約（adr_status_only）を実質的には
#   満たしているが、正規の手順（ゲート承認後・専任worker・CLI経由）を経ていない点は
#   AGENTS.md/ADR.mdが定めるライフサイクル規約からの逸脱である。これはSPEC.md/PLAN.mdの
#   設計判断そのものに起因するため独立検証者としては修正せず、未決事項として記録する。
#
# finding-3（AC-10、致命的。実装フェーズへの差し戻しではなくインフラ設定の追加適用が必要）:
#   secret scanのrequired check化は、本リポジトリの現在のライブ設定では機能していない。
#   実測（すべてこのセッションで直接実行、証跡は下記AC-10のprocedure参照）:
#     - `gh api repos/techbeansjp-free/AGENTS.md/rulesets` → `[]`（ruleset未適用、
#       .agent-skill-chain/templates/github/provisioning/rulesets/main.json はテンプレートの
#       ままでありこのリポジトリへ実際には適用されていない）
#     - `gh api repos/techbeansjp-free/AGENTS.md/branches/main/protection` →
#       required_status_checks.contexts は `["self-enforce"]` のみ。"verify"・
#       "agent-skill-chain/*-gate" はいずれも含まれない
#     - `gh api repos/techbeansjp-free/AGENTS.md/branches/chore%2F162-agent-skill-chain-bootstrap/protection`
#       → 404 "Branch not protected"（本Issueのマージ先ブランチ自体に保護が一切無い）
#     - 実PR #179（本Issue自身）: `verify` job が現に FAILURE のCheck Runを持つ状態でも
#       `gh pr view 179 --json mergeable,mergeStateStatus` は `mergeable: MERGEABLE`
#       （`mergeStateStatus: UNSTABLE`。ブロックされていない）
#   DESIGN.mdは「main.jsonのrequired_status_checksには既に{"context": "verify"}が含まれているため
#   ruleset側の変更は不要」と判断しているが、これはテンプレートファイルの内容であり、実際に
#   ライブのGitHubリポジトリ設定へ適用されているかどうかは別問題である。本Issueのスコープ
#   （要件6「実際に適用してrequired checkとして機能することを確認する」）は、この適用状態の
#   実機確認までを含んでおり、確認の結果は不合格である。
#   是正には `.agent-skill-chain/scripts/setup-ruleset.sh` 等によるライブリポジトリへの
#   ruleset適用が必要だが、これはリポジトリ全体の保護設定を変更する強い副作用を持ち、
#   このリポジトリで並行稼働中の他の独立worktree/セッション（.worktrees/配下に本セッション
#   以外の複数のfeatureブランチが存在することを`git worktree list`で確認済み）に影響しうるため、
#   独立検証者・セグメント作業ワーカーの権限で一存で実行すべきでないと判断し、実行しなかった。
#   進行役の判断を要する事項として記録する。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-178
target_sha: dfc07641be14694c7a1f160a6a6c40da9ba0c7bb

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
      reason: "自動テストに加え、独立して同一シナリオ（YAMLキー・flow-sequence・コード識別子・CLIサブコマンド・外部語彙許可リスト）を再現し誤検出されないことを実測した"
      procedure: "1) test/integration/lint.test.tsの『識別子文脈としての禁止語利用は誤検出されない（ISSUE-178 AC-1）』テストを含むnpm test全体を実行しpassを確認。2) node bin/agents-md.js lint vocab を、SPEC.md AC-1のGivenが挙げる3種（issue:キー、issue_id、agent-skill-chain issue start）を含む自作ファイルに対して実行し、いずれも違反として報告されないこと（exit 0）を確認した"
      executor: claude
    evidence:
      - "test/integration/lint.test.ts（識別子文脈としての禁止語利用は誤検出されない、ISSUE-178 AC-1）"
      - "src/commands/lint.ts（isIdentifierContext, isCodeIdentifierContext, isYamlIdentifierContext, isCliSubcommandContext）"
      - "finding-1参照: 形式的なAC-1のGiven/When/Thenは満たすが、CLIサブコマンド文脈判定に構造的な過剰除外余地があることを別途発見（AC-2側の未決事項として記録）"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
      reason: "自動テストに加え、SPEC.md AC-2のGiven通りの散文誤用行が識別子文脈と同一行・別行いずれでも検出されることを独立実測した"
      procedure: "1) test/integration/lint.test.tsの『識別子文脈に隣接していても、散文としての禁止語混入は引き続き検出される（regressionなし、ISSUE-178 AC-2）』テストを含むnpm test全体を実行しpassを確認。2) 同一行内に識別子文脈（issue_id）と散文誤用（issueそのもの）が混在する行、複合境界の無い『issues』の行が、いずれも正しく違反として検出されることを確認した"
      executor: claude
    evidence:
      - "test/integration/lint.test.ts（識別子文脈に隣接していても、散文としての禁止語混入は引き続き検出される、ISSUE-178 AC-2）"
      - "finding-1（未決事項）: SPEC.md AC-2が指定する固定シナリオはpassするが、CLIサブコマンド文脈判定の動詞ホワイトリストに偶然共起する散文（例: 「issue create」「issue status」を含む文）は誤って識別子文脈とみなされ検出されない実例を独立して発見した。要件1が意図する一般原則（散文中の禁止語混入は引き続き検出される）には抜け穴が残っている"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
      reason: "既存4テスト（バッククォート・placeholder・パストークン除外、パス形式禁止語特例）がすべてpassすることをnpm test全件実行で確認した"
      procedure: "npm test をフルで実行し、test/integration/lint.test.tsの既存テストケース（識別子文脈拡張前から存在する4件）が引き続き394件中に含まれ全てpassすることを確認した"
      executor: claude
    evidence:
      - "test/integration/lint.test.ts（既存4テストケース: 禁止語検出/バッククォート等除外/パス形式禁止語特例/デフォルト対象）"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
      reason: "引数無しデフォルト対象での実行をこのworktreeで直接再実行し、exit 0を実測した"
      procedure: "node bin/agents-md.js lint vocab（引数無し）をリポジトリルートで実行しexit 0を確認した。DESIGN.md『B. 残存誤検出の内容是正』表の3件（.github/ISSUE_TEMPLATE/docs.ymlの『ドキュメント』→『資料』、config/roles.yaml・agent-skill-chain-gate.ymlの『ブロック』→『停止/中断』、roles.yaml・issue-start.shのドット区切り識別子へのバッククォート付与）が実際にファイルへ反映されていることをgrep/sedで個別に確認した"
      executor: claude
    evidence:
      - "src/lib/scan.ts（defaultVocabFileRoots）"
      - "実機確認: node bin/agents-md.js lint vocab（引数無し）exit 0"
      - "実機確認: .github/ISSUE_TEMPLATE/docs.yml・.agent-skill-chain/config/roles.yaml・.github/workflows/agent-skill-chain-gate.yml・.agent-skill-chain/scripts/issue-start.shの是正内容"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
      reason: "docs/GLOSSARY.mdを明示的に対象指定した場合は自己言及により多数の違反が検出される一方、デフォルト対象実行では対象外のままであることを実測し、恒久除外が実効的であることを確認した"
      procedure: "1) node bin/agents-md.js lint vocab docs/GLOSSARY.md を明示指定で実行し、GLOSSARY.md自身の『禁止同義語』列挙により19件の違反が検出されexit 1になることを確認（除外が無ければ自己検出される実証）。2) node bin/agents-md.js lint vocab（引数無し）がexit 0で完走することを確認し、デフォルト対象からGLOSSARY.mdが除外されていることを確認した"
      executor: claude
    evidence:
      - "src/lib/scan.ts（defaultVocabFileRoots: docs/GLOSSARY.mdのみ恒久除外）"
      - "実機確認: 明示指定時は19件検出（exit 1）、デフォルト対象時はexit 0"

  - ac_id: AC-6
    verification:
      mode: manual
      result: pass
      reason: "実機push検証は一回性の行為であり事後の機械的再現ができないため、証跡（コマンド出力）を確認する形の手動検証となる"
      procedure: "DESIGN.md『ADR-0002実機検証結果』節に記載された実行コマンド・出力（acquire成功、非fast-forward pushの[rejected]、release成功、ls-remoteでの残存確認）を読み、3項目すべてが実測どおり成功したという結論が記載内容と整合していることを確認した。git ls-remote origin 'refs/agent-skill-chain/*' を実行し、検証用の一時ref（adr0002-verification-178）が現在のリモートに残存していないこと（クリーンアップ済み）を独立に確認した"
      executor: claude
    evidence:
      - "DESIGN.md（ADR-0002実機検証結果節、実行コマンドと出力）"
      - "実機確認: git ls-remote origin 'refs/agent-skill-chain/*' が残存refなしを返すこと"

  - ac_id: AC-7
    verification:
      mode: hybrid
      result: pass
      reason: "adr-lint.sh checkによる構造検査（自動）に加え、status遷移がADR本文を変更していないことをgit diffで、finalizationライフサイクル規約との整合性を目視で確認した（手動）"
      procedure: "1) node bin/agents-md.js lint adr check（.agent-skill-chain/scripts/adr-lint.sh checkのラッパー先）を実行しexit 0を確認。2) git log -p --follow -- docs/adr/ADR-0002-github-lease-git-ref-cas.md でADR新規作成commit(e97f647)とstatus更新commit(30acd1e)の差分を確認し、後者がstatusフィールド1行のみの変更でありContext/Decision/Consequences/supersedesが一切変更されていないことを確認した。3) status: proposedがリポジトリ内に残っていないことを確認した"
      executor: claude
    evidence:
      - "docs/adr/ADR-0002-github-lease-git-ref-cas.md（status: accepted）"
      - "git diff（commit 30acd1e）: statusフィールドのみの変更"
      - "実機確認: node bin/agents-md.js lint adr check exit 0"
      - "finding-2（未決事項）: status遷移の内容（scope）は adr_status_only を満たすが、正規の手順（設計ゲート承認後にadr_finalization_workerが`adr finalize` CLI経由でwriter leaseを取得して更新する）を経ておらず、design/planフェーズの同一commitで直接編集されている。ライフサイクル規約との手順上の乖離として記録する（AC-7自体のpass/fail判定は内容面で行い、手順面はプロセス上の未決事項として別記）"

  - ac_id: AC-8
    verification:
      mode: hybrid
      result: pass
      reason: "自動テストに加え、正しい長さのダミーsecret文字列7種すべてを独立に再現し検知・exit 1を実測、diffモードも独立ローカルリポジトリで再現した。ただしSPEC.mdが要求する『実際のGitHub Actions実行結果（run URL）』での確認は、ツール権限制約により本worktree外からのpush・PR作成がClaude Codeのauto modeクラシファイアに拒否されたため実施できなかった（未コミット・未pushで安全に終了）"
      procedure: "1) test/integration/lint-secrets.test.tsを含むnpm test全体でpassを確認。2) node bin/agents-md.js lint secrets <path> を、AKIA/AIza/aws_secret_access_key/ghp_/xoxb-/sk_live_/PEMヘッダの7パターンそれぞれ正規表現が要求する正確な長さのダミー文字列で個別に実行し、全パターンでexit 1・該当パターン名が報告されることを確認した。3) /tmp配下に独立したローカルbare remote（実GitHubとは無関係）を構築し、lint secrets --diff origin/main が新規追加行のダミーAWSキーを検知しexit 1になることを確認した。4) 使い捨てブランチ・PRをtechbeansjp-free/AGENTS.mdへ作成し実GitHub Actions実行結果を確認しようと試みたが、auto modeクラシファイアによりpush・PR作成が拒否され実施できなかった（何もコミット・pushされていないことをgit log/git statusで確認済み）"
      executor: claude
    evidence:
      - "test/integration/lint-secrets.test.ts"
      - "src/commands/lint.ts（SECRET_PATTERNS, scanFilesForSecrets, scanDiffForSecrets）"
      - "実機確認: 7パターン全てのダミー文字列でexit 1、独立ローカルbare remoteでの--diffモード検証"
      - "未実施（ツール権限制約）: 実GitHub Actions run URLでの確認。finding-3も参照"

  - ac_id: AC-9
    verification:
      mode: automated
      result: pass
      reason: "自動テストに加え、通常のソースファイル群・通常のgit diffのいずれに対しても誤検知が無いことを独立に実測した"
      procedure: "1) node bin/agents-md.js lint secrets を本リポジトリの通常ソースファイル（src/commands/lint.ts, src/lib/scan.ts, README.md, AGENTS.md, package.json, package-lock.json）に対して実行しexit 0（誤検知なし）を確認した。2) 独立ローカルbare remoteで、secretを含まない通常の変更（README.mdへの1行追記）に対しlint secrets --diffを実行しexit 0を確認した。3) secretを含むファイルを削除するcommitに対しlint secrets --diffを実行し、削除行は検査対象外のためexit 0になることを確認した（DESIGN.mdの『追加された行のみ』契約どおり）"
      executor: claude
    evidence:
      - "test/integration/lint-secrets.test.ts"
      - "実機確認: 通常ソースファイル・通常diff・削除diffのいずれも誤検知なし（exit 0）"

  - ac_id: AC-10
    verification:
      mode: manual
      result: fail
      reason: "secret scanを含む`verify`ジョブが、本リポジトリのライブ設定では required check として機能していないことを、branch protection/ruleset APIおよび実PRのmergeable状態で実測確認した。この実測結果（fail）はコード実装の不備ではなく、本リポジトリのライブbranch protection/ruleset設定が未適用であるというインフラ設定の不備に起因する（finding-3参照）。進行役はこれを本Issue（ISSUE-178）のコード実装スコープ外と判断し、SPEC.md AC-10・スコープ外節を『テンプレート設定への反映まで』に改定したうえで、ライブ適用・実機確認の完了はIssue #180へ切り出すことを決定した。本エントリのresult: failはこの判断後も実測事実として書き換えず、そのまま保持する"
      procedure: "1) gh api repos/techbeansjp-free/AGENTS.md/rulesets を実行し空配列（ruleset未適用）であることを確認。2) gh api repos/techbeansjp-free/AGENTS.md/branches/main/protection を実行し、required_status_checks.contexts が['self-enforce']のみで'verify'を含まないことを確認。3) gh api repos/techbeansjp-free/AGENTS.md/branches/chore%2F162-agent-skill-chain-bootstrap/protection を実行し404『Branch not protected』（本Issueのマージ先ブランチに保護が一切無い）ことを確認。4) 本Issue自身のPR #179（対chore/162-agent-skill-chain-bootstrap）で、'verify' Check RunがFAILUREである現在の状態でも gh pr view --json mergeable,mergeStateStatus が mergeable: MERGEABLE を返すこと（ブロックされていない）を確認した。使い捨てPRによる直接実験はツール権限制約により実施できなかったが、上記4点で十分な実測証跡と判断した"
      executor: claude
    evidence:
      - "実機確認: gh api .../rulesets → []"
      - "実機確認: gh api .../branches/main/protection → required_status_checks.contexts = ['self-enforce']"
      - "実機確認: gh api .../branches/chore%2F162-agent-skill-chain-bootstrap/protection → 404 Branch not protected"
      - "実機確認: gh pr view 179 --json mergeable,mergeStateStatus → mergeable: MERGEABLE（verify job FAILURE中でも）"
      - "finding-3参照: 是正には.agent-skill-chain/scripts/setup-ruleset.sh等によるライブリポジトリへの適用が必要だが、他worktree/セッションへの影響を考慮し独立検証者の権限では実行しなかった"
      - "進行役判断: この不合格はコード実装の不備ではなくライブ設定の不備であるため、ライブ適用・実機確認の完了をIssue #180へ切り出す（SPEC.md AC-10・スコープ外節を改定済み）。result: failは実測事実として維持する"

  - ac_id: AC-11
    verification:
      mode: automated
      result: pass
      reason: "verify-template-syncスクリプトの実行、および2ファイルの直接diffの両方で同期を確認した"
      procedure: "1) ./.agent-skill-chain/ci/verify-template-sync.sh を実行しexit 0を確認した（注記: SPEC.md/PLAN.mdは`.agent-skill-chain/scripts/verify-template-sync.sh`と記載しているが実体は`.agent-skill-chain/ci/verify-template-sync.sh`であり、これはドキュメント上のパス表記の軽微な誤りであって動作に影響しない）。2) diff .agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml .github/workflows/agent-skill-chain-ci.yml を実行し差分が無いことを確認した"
      executor: claude
    evidence:
      - ".agent-skill-chain/ci/verify-template-sync.sh"
      - "実機確認: verify-template-sync.sh exit 0、diffコマンドで2ファイル完全一致"

  - ac_id: AC-12
    verification:
      mode: automated
      result: pass
      reason: "npm testをフルで実行し、実測件数を確認した"
      procedure: "npm ci && npm run build && npm test を本worktreeでフル実行し、394 tests / 394 pass / 0 fail / 0 skipped / 0 cancelled を実測した（実装フェーズ報告の394件と一致、regressionなし）"
      executor: claude
    evidence:
      - "npm test実行結果: 1..394, tests 394, pass 394, fail 0, cancelled 0, skipped 0"

regression:
  executed: true
  evidence:
    - "npm test実行結果: 394/394 pass, 0 fail, 0 skipped"
    - "node bin/agents-md.js lint vocab（引数無し）exit 0"
    - "node bin/agents-md.js lint adr check exit 0"
    - "./.agent-skill-chain/ci/verify-template-sync.sh exit 0"
