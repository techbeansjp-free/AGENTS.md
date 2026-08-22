# 由来: AGENTS.mdが定める不変条件I7（仕様⇔検証の追跡）の規約に基づく検証報告である。
#
# 目的: Issue ISSUE-744「Codex ゲートレビュアの起動失敗を安全に診断可能にする」の実装を、
#       実装セグメントとは独立に受入・統合・回帰の観点で検証し、SPEC.md が定める AC-1〜AC-8
#       それぞれの充足可否と証跡を確定する。本ラウンドは current main を取り込んだ統合ヘッドを
#       対象とし、統合後も全 AC と既存挙動が成立することまでを確定する。
#
# 対象範囲: Codex/Claude アダプタが共有する隔離レビュア実行系（reviewer stderr の有界分類、
#       安全な失敗診断 envelope、隔離領域の削除）と、Codex non-core レビュアの model 解決、
#       Codex 起動列の TOML 層 escape / shell 層 quote の分離、および既存フェイルセーフ
#       （認証 probe・watchdog・再試行・非ゼロ終了・never-approved・human_required）の非回帰。
#
# 前提: 検証は代替レビュア（stub）と注入した stderr・偽の秘密値だけで行い、実サービス疎通・
#       実資格情報を用いない。これは SPEC.md が「実サービス成功や実認証疎通を完了条件にしない」
#       と定めているためであり、実行系の都合による省略ではない。
#
# 用語:
#   - 安全な診断: 固定の分類値・終了コード・試行回数・切り詰め有無だけからなり、raw stderr の
#     全文・抜粋・未検査断片と秘密値を含まない外部出力。
#   - 分類: MODEL_UNAVAILABLE / AUTHENTICATION_FAILURE / TIMEOUT / EXECUTION_FAILURE の閉じた集合。
#   - 隔離領域: レビュア1回の起動ごとに作られ、prompt・出力・複製認証素材だけを置く一時 root。
#   - TOML 層 / shell 層: Codex の `-c key=value` は消費側の `/bin/bash -c` で shell として
#     再解釈され（shell 層）、その argv の value は Codex 側で TOML として解釈される（TOML 層）。
#   - 統合ヘッド: 本ブランチの検証済みヘッドと current main を統合したマージコミット。本ラウンドの
#     検証対象 SHA である。
#
# 入力: SPEC.md（AC-1〜AC-8）、DESIGN.md、PLAN.md、docs/adr/ADR-0079（accepted、ADR-0076 を supersede）、
#       対象 SHA 3e72228b268561e5f688753c8f99eb753a5d0ae7 の実装
#       （.agent-skill-chain/adapters/claude.sh・codex.sh）と自動テスト。
# 出力: 本ファイルの acceptance_criteria（AC ごとの検証方法・結果・証跡）と regression。
#
# 検証対象の実装 SHA と、本成果物を載せるコミットの関係:
#   本ファイルが書く「対象 SHA」「target_sha」「regression の npm test の対象」はいずれも、独立検証を
#   実施した統合ヘッド 3e72228b268561e5f688753c8f99eb753a5d0ae7 を指す。本ファイル自身は、それを追加する
#   コミットの SHA を内容として持てない（コミット SHA は本ファイルの内容を入力として決まるため）。
#   そこで SHA を書く代わりに、次の不変を成果物内に宣言する。
#
#   不変: 本成果物を載せるコミットは、検証対象の実装 SHA 3e72228b268561e5f688753c8f99eb753a5d0ae7 に
#   VALIDATION.md のみを変更した差分であり、実装ファイル（.agent-skill-chain/ 配下・src/ 配下・test/ 配下・
#   docs/ 配下を含む）を一切変更しない。SPEC.md・DESIGN.md・PLAN.md も変更しない。したがって
#   AC-1〜AC-8 の evidence と regression の結果は、実装内容が同一である本成果物のコミットに対しても
#   そのまま適用可能である。
#
#   根拠（本セグメントで commit 直前に実行した実際の出力の原文引用）:
#
#     $ git rev-parse HEAD
#     3e72228b268561e5f688753c8f99eb753a5d0ae7
#
#     $ git diff --name-only 3e72228b268561e5f688753c8f99eb753a5d0ae7
#     VALIDATION.md
#
#     $ git diff --stat 3e72228b268561e5f688753c8f99eb753a5d0ae7 -- ':!VALIDATION.md'
#
#     （出力なし＝VALIDATION.md 以外に差分が1行も無い。実装ファイルは一切変更していない）
#
#     $ git log --oneline 3e72228b268561e5f688753c8f99eb753a5d0ae7..HEAD
#
#     （出力なし＝実装 SHA と現 HEAD が同一コミットであり、間に別のコミットが無い）
#
#     $ git status --porcelain
#      M VALIDATION.md
#
#   除外なしの `git diff --stat <対象SHA>` は、数える行数が本ファイル自身の長さに依存する自己参照に
#   なるため根拠に用いない。上の `-- ':!VALIDATION.md'` 付きの空出力が、実装ファイル無変更という
#   主張そのものを本ファイルの長さと独立に立証する。
#
#   よって実装 SHA から本成果物のコミットまでの累積差分は VALIDATION.md に閉じており、上記の不変は成立する。
#
# 統合ヘッドの構成と、マージが両側を保存したことの検証:
#   対象 SHA 3e72228 は2親のマージコミットであり、`git log --format='%H %P' -1` の実出力は
#   `3e72228b268561e5f688753c8f99eb753a5d0ae7 bdb7a3a956f08000dfbdc1469bd79c34aa5a24c6
#   a4c4cbb42eeb6fb7b95658857f9e166591448bd9` である。第1親 bdb7a3a は前ラウンドで validation-gate を
#   通過した本ブランチのヘッド、第2親 a4c4cbb は current main であり、両者の merge-base は
#   0440e86347de8411ea4f97d968944bda67cf5c43（`git merge-base` の実出力）である。
#
#   マージが片側の変更を巻き戻していないことを、内容読解に依存しない2本の name-only 差分で確かめた。
#   これは「マージが競合を報告せず mergeable のまま片側を落とす」事象を検出するための検査である。
#
#   (a) main 側が merge-base から変更したファイル集合（`git diff --name-only 0440e86 a4c4cbb`）は31件で、
#       マージが本ブランチ側から見て取り込んだ集合（`git diff --name-only bdb7a3a 3e72228`）と完全に
#       一致した（両出力を行単位で突合し、差分なし）。
#   (b) 本ブランチ側が merge-base から変更したファイル集合（`git diff --name-only 0440e86 bdb7a3a`）は11件で、
#       マージが main 側から見て取り込んだ集合（`git diff --name-only a4c4cbb 3e72228`）と完全に一致した。
#
#   この2本は同時に byte 単位の保存も立証する。(a) の右辺が31件だけであることは、本ブランチ側の11件が
#   bdb7a3a と統合ヘッドで byte 単位に同一であることを意味し、(b) の右辺が11件だけであることは、main 側の
#   31件が a4c4cbb と統合ヘッドで byte 単位に同一であることを意味する。すなわち統合ヘッドの tree は
#   両親の変更の純粋な合併であり、マージ時に第三の内容が混入した箇所も、片側が巻き戻された箇所も無い。
#   `git diff --name-status --diff-filter=D bdb7a3a 3e72228` は出力なしであり、この区間で削除された
#   ファイルは1件も無い（＝既存テストの削除によって見かけ上 fail が消える経路は生じていない）。
#
#   本 Issue の実装・テスト・成果物の同一性は blob hash でも直接確認した。
#   `git rev-parse <SHA>:<path>` を bdb7a3a と 3e72228 の双方で取り、claude.sh は
#   3ca90b4d5e99922ec6240ece89d4aece8a9a27c0、codex.sh は 280fb45c948d132f3caeb3109493b40dc2e45dd9、
#   gate-adapters.test.ts は 65a0d73e77ed2947b42f30e9fde66887c9257937、worker-adapters.test.ts は
#   7aabef71d92bf50b2b632f744545cfac46c35106、test/helpers/codex-config-arg.ts は
#   9fd22b8cfe2f0309ef31e079177e425fd739cf76 で、5件とも両 SHA で同値であった。
#
# 前ラウンドからの再検証範囲（前回検証 SHA 771a329 / 成果物コミット bdb7a3a → 本 SHA 3e72228）:
#   統合により main の ISSUE-786（ゲートのラウンド予算・是正方針、PR #791）が入った。本 Issue の AC が
#   対象とする経路に影響が及んでいないことを、次のとおり自分で実行した git コマンドの出力から確定した。
#
#   (a) 本 Issue が所有するファイルは 1件も変わっていない。`git diff --name-only bdb7a3a 3e72228 --
#       .agent-skill-chain/adapters/ test/helpers/codex-config-arg.ts SPEC.md DESIGN.md PLAN.md
#       VALIDATION.md docs/adr/` の出力は
#       docs/adr/ADR-0078-finding-reclassification-effective-subverdict-and-control-record-trust.md
#       の1件だけで、これは main 由来の ISSUE-786 の ADR であり本 Issue とは無関係である。
#       claude.sh・codex.sh・codex-config-arg.ts・SPEC.md・DESIGN.md・PLAN.md・ADR-0076・ADR-0079 は
#       1行も変わっていない。すなわち AC の判定対象である実装そのものは統合によって変化していない。
#   (b) `git diff --name-only bdb7a3a 3e72228 -- test/integration/gate-adapters.test.ts
#       test/integration/worker-adapters.test.ts test/integration/gate-credential-store.test.ts` は
#       出力なしであり、本 Issue の AC 検証に用いる3つのテストファイルは統合前後で同一である。
#       したがって前ラウンドで確定した AC ごとの検証内容は、そのまま本 SHA の検証内容でもある。
#   (c) main が `.agent-skill-chain/` 配下へ持ち込んだ変更は roles.yaml、gate-report/state/worker-report の
#       3スキーマ、gate-classify-finding.sh、gate-declare-final-round.sh、gate-local-review.sh、
#       templates/claude/skills/gate-review/SKILL.md の8件である（`git diff --name-only bdb7a3a 3e72228 --
#       .agent-skill-chain/` の出力）。本 Issue の AC が対象とする実行経路は
#       gate-launch-reviewer.sh → adapters/{claude,codex}.sh であり、この8件に含まれない。
#       gate-local-review.sh の差分は attempt ID の生成位置を gate-review.sh 呼び出しの前へ移し、
#       ASC_EVIDENCE_BASE_SHA・ASC_EVIDENCE_PR_NUMBER・ASC_REVIEW_ATTEMPT_ID を渡すだけであり
#       （差分原文を読んで確認した）、レビュア起動列・stderr 分類・隔離領域のいずれにも触れていない。
#   (d) main が持ち込んだ src/ 配下の変更（gate.ts・report.ts・cli-routes.ts・review-evidence.ts・
#       round-budget-policy.ts・trusted-gate-recorder.ts）はゲート判定と証跡集約の側にあり、
#       stderr 分類・失敗 envelope・隔離領域削除のいずれにも触れていない。
#
# 引用証跡の突合結果（本セグメントで機械的に実施）:
#   本ファイルが引用するテスト題名18件と、ディレクトリ成分または拡張子を伴うファイルパス18件、
#   合計36件を、対象 SHA の実体と突合した。
#   題名は `grep -n -F` により固定文字列として照合し、部分一致による見逃しを避けるため `test('` からの
#   前方一致で列挙した実体側の一覧と1件ずつ対応づけた。結果は題名18件すべて一致（gate-adapters.test.ts
#   17件・worker-adapters.test.ts 1件）であった。パスは `ls -1` へ18件を一括で与えて全件が実在すること
#   を確認した。対象は claude.sh・codex.sh・gate-launch-reviewer.sh・gate-local-review.sh・roles.yaml・
#   ADR-0076・ADR-0078・ADR-0079・codex-config-arg.ts・gate-adapters.test.ts・worker-adapters.test.ts・
#   gate-credential-store.test.ts・cli-resolve.test.ts・package.json・SPEC.md・DESIGN.md・PLAN.md・
#   VALIDATION.md である。不一致・不在は0件であった。
#   件数も実体から数え直した。`grep -c "^test("` は gate-adapters.test.ts 51件・
#   worker-adapters.test.ts 83件・gate-credential-store.test.ts 14件であり、`grep -c -F "#744"` は
#   gate-adapters.test.ts 12件・worker-adapters.test.ts 1件、うち gate-adapters.test.ts の12件のうち
#   1件は `test(` ではなくコメント行であるため、本 Issue 由来の test 宣言は11件＋1件＝12件である。
#
# 本セグメントの独立検証方法と、その実行系の制約:
#   本セグメントの実行環境は、`npm test`・`npm run build`・`npm run typecheck`・
#   `node bin/agents-md.js <subcommand>`・`bash .agent-skill-chain/ci/<script>`・`git`・`grep`・`gh` の
#   実行は許可される一方、`node --import tsx --test <file>` の直接実行が許可されていない。
#   このため「本 Issue の AC に対応するテストファイルだけを個別に実行する」方式は本ラウンドでは
#   実施できなかった。実行系の制約であり、検証を省略した判断ではない。代わりに全件回帰
#   （`npm test`）を対象 SHA で自ら前景実行し、その集計と、題名の機械突合を組み合わせて
#   個別テストの成否を確定した。導出は次のとおりで、途中に他者の報告を挟まない。
#     (i)  `npm test` は package.json の定義どおり test/unit と test/integration 配下の全 *.test.ts を
#          実行する。本ラウンドの実測集計は tests 1589 / pass 1588 / fail 0 / cancelled 0 /
#          skipped 1 / todo 0 / duration_ms 406297.008657 であった。
#     (ii) fail 0 かつ cancelled 0 であるから、実行された1589件のうち skip された1件を除く全件が成功した。
#     (iii) skip された1件は cli-resolve.test.ts の `ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 が指定された
#          場合だけlive到達性を確認する` であり（`grep -rn ASC_TEST_LIVE_CLI_INSTALL_SOURCE test/` の
#          実出力で特定した）、本 Issue の変更経路を通らない。
#     (iv) 本ファイルが引用する題名18件はいずれも対象 SHA の当該テストファイルに実在する（上記の突合）。
#          よって18件はすべて (ii) の成功集合に含まれる。
#   この方式では個々のテストの実行時間（duration）を観測していない。前ラウンドまでの本ファイルは
#   個別 duration を併記していたが、それらは前回の SHA での測定値であり、本 SHA で測り直していない値を
#   転記すれば実測でない数値を書くことになる。したがって本ラウンドは duration の引用を行わず、
#   上記 (i)〜(iv) の導出で置き換えた。
#
#   全件回帰に加えて、実装セグメントの主張に依存しない次の観測を行った。
#   (a) 実装原文の独立読解: claude.sh の _reviewer_classify_stderr・_reviewer_reap_classifier・
#       _reviewer_internal_diagnostic・_reviewer_failure_envelope・_run_reviewer_sanitized と、
#       codex.sh の launch_gate_reviewer・_codex_toml_basic_string・_codex_shell_command を対象 SHA の
#       worktree 上で読み、各 AC の Then が実装のどの制御で成立するかをテストの主張と独立に確認した。
#       結果は各 AC の evidence へ「実装原文の独立読解」として記す。
#   (b) 統合の健全性検査と引用突合: 上記「統合ヘッドの構成と、マージが両側を保存したことの検証」
#       「前ラウンドからの再検証範囲」「引用証跡の突合結果」。
#   (c) 対象 SHA と外部証跡の対応検査: `gh pr view 792` の実出力で PR #792 の headRefOid が
#       3e72228b268561e5f688753c8f99eb753a5d0ae7 であること、
#       `gh api repos/techbeansjp-free/AGENTS.md/commits/3e72228.../check-runs` の実出力で
#       当該 SHA の check-runs が総数2件・verify と verify-config-doc-sync がいずれも
#       status=completed / conclusion=success であることを確認した。PR 一覧表示ではなく対象 SHA の
#       check-runs を直接数えており、head が古いまま緑に見える経路を避けている。
#   この構成では、全件回帰が挙動を、実装原文の読解が挙動の根拠を、統合検査と引用突合が証跡と対象の
#   対応を、それぞれ別の情報源から裏づける。実サービスへの疎通は SPEC.md がスコープ外とするため、
#   いずれの観測にも含めていない。
#
# codex CLI の実起動について:
#   本Issueの対象は codex レビュア経路の診断保全であるが、codex のクォータ枯渇により codex CLI の
#   実起動は行えない。ただし AC-1〜AC-8 のいずれも実 CLI の起動成功を Then に置いておらず、
#   SPEC.md は「実サービスや実資格情報への疎通を前提にしない」ことを制約として明記している。
#   代替検証手段は、(a) CODEX_REVIEWER_CMD による完全 command 上書き、(b) CODEX_EXECUTABLE による
#   codex exec 互換 stub（受領 argv を1行1引数で記録し、-m の値を含む model unavailable の stderr を
#   出して非ゼロ終了する／verdict を返して正常終了する2種）、(c) 分類器・envelope 関数への直接注入の
#   3経路であり、これらは対象 SHA のテストが実際に用いている。実 codex CLI でしか観測できないのは
#   「実在 model slug が実サービス側で利用可能か」だけであり、SPEC.md がスコープ外とする
#   実サービスの可用性保証に該当する。
#
# 独立検証で観測した事実（origin 付き。実装の是正は行わず進行役の判断へ委ねる）:
#   1. origin=design / 重大度=info / 過去ラウンドの警告 DESIGN_MODEL_ID_CHARSET_DIVERGENCE は解消済み:
#      ADR-0079（accepted）は model identifier を「1〜128 byte、各 byte が単一引用符（0x27）以外の
#      ASCII 可視文字（0x21〜0x7E）」と定義し、DESIGN.md の設計判断 D2 も同一の定義を持ち、
#      related_adrs は ADR-0079 を adopts として指す。ADR-0076 は superseded である（両ファイルの
#      status 行を対象 SHA の worktree で直接読んで確認した）。実装原文の独立読解でも、claude.sh の
#      identifier 遷移が「[[:graph:]] かつ 単一引用符でない かつ 長さ 128 未満」を LC_ALL=C 固定で
#      判定し、閉じ引用符を受理する条件が長さ1以上であることを確認した。すなわち受理集合は
#      1〜128 byte・0x21〜0x7E・0x27 除外であり、文書の定義と一致する。本ラウンドで新たに是正すべき
#      乖離は無い。
#   2. origin=implementation / 重大度=warning / 既知の持ち越し（Issue #796 で追跡中、是正禁止）:
#      TRUNCATED_FLAG_LOST_ON_FORCED_REAP・NONCORE_DEFAULT_CODE_OVERCLAIM・TOML_CONTROL_CHAR_NOT_ESCAPED
#      の3件。いずれも implementation-gate のレビュア2体が非 blocking と判断し、進行役が Issue #796 へ
#      転記済みである。本ラウンドでは是正しておらず、3件が指す固有の入力条件（detach と 64 KiB 超過の
#      同時成立、完全 command override 下の model 選択元、制御文字を含む設定値）を再現する観測も
#      行っていない。したがって本報告はこの3件について新たな確認も反証も与えていない。各 AC の
#      evidence では、それぞれの AC が要求する Then が別の到達可能な入力で満たされていることを示す。
#   3. origin=implementation / 重大度=info / 既知の持ち越し（Issue #795 で追跡中、是正禁止）:
#      CodeRabbit の Minor 指摘3件（claude.sh の上限到達時 state 先行書き出し、テスト側の /usr/bin/head
#      絶対パス、テスト側の indexOf 戻り値未検査）。人間の判断により follow-up Issue へ分離済みである。
#   4. origin=validation / 重大度=info / REAL_CODEX_CLI_NOT_EXERCISED:
#      上記「codex CLI の実起動について」のとおり、実 codex CLI の起動は本ラウンドでも行っていない。
#   5. origin=validation / 重大度=info / PER_TEST_DURATION_NOT_OBSERVED:
#      上記「本セグメントの独立検証方法と、その実行系の制約」のとおり、個別テスト実行の duration は
#      本ラウンドで観測していない。個別テストの成否は全件回帰の集計と題名突合から導出している。
#
# 未決事項: 無い。範囲外に真因があると判明した事象も無い。current main（ISSUE-786 を含む）を統合した
#         後も、本 Issue の AC を壊す事象は観測されていない（fail 0）。
# 対象外: Issue #751 の prompt 入力閉包、Issue #715 の verdict stdout secret 検査と実行パス信頼境界、
#         Claude 固有の認証成立条件・model 選択、実サービス疎通、provider CLI の将来互換層。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-744
target_sha: 3e72228b268561e5f688753c8f99eb753a5d0ae7

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::reviewer stderr classifier: model/authの完全一致だけを
        相互排他的に分類する（Issue #744 AC-1）。model 4形式は MODEL_UNAVAILABLE、auth 7形式は
        AUTHENTICATION_FAILURE、`unknown option for model command`・suffix追加・model/auth複合は
        いずれも EXECUTION_FAILURE であることを検証する。対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 組込み既定のmodel unavailableを安全な専用診断に
        する（Issue #744 AC-1/AC-5）。外部診断が code=NONCORE_DEFAULT_MODEL_UNAVAILABLE
        classification=MODEL_UNAVAILABLE となり、注入した偽秘密値が出力に現れないことを検証する。
        対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: chunk分割された認証失敗をretry後の固定診断に
        する（Issue #744 AC-1/AC-8）。signature を2回の write に分割しても
        classification=AUTHENTICATION_FAILURE になり、attempts が実試行回数と一致することを検証する。
        対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 区切り文字を含む明示modelのmodel unavailableを
        誤分類しない（Issue #744 AC-1/AC-6）。対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        実装原文の独立読解: claude.sh の _reviewer_classify_stderr は、model 4形式と auth 7形式を
        byte 単位の streaming DFA で照合し、行頭からの完全一致だけを signature 成立とする
        （改行・CR+改行で行状態を reset し、いずれの候補も進めない byte が来た時点で当該行を
        line_invalid にする）。最終分類は model_seen と auth_seen の排他条件でのみ MODEL_UNAVAILABLE /
        AUTHENTICATION_FAILURE となり、両立時と不成立時は EXECUTION_FAILURE へ倒れる。TIMEOUT は
        stderr 内容に依存せず _run_reviewer_sanitized が timeout marker から rc=124 とともに与える。
        よって4分類は相互排他であり、AC-1 の Then が実装上成立する。
      - |-
        分類集合の閉包: _reviewer_internal_diagnostic は MODEL_UNAVAILABLE・AUTHENTICATION_FAILURE・
        TIMEOUT・EXECUTION_FAILURE 以外の値を受け取ると EXECUTION_FAILURE へ畳み込む。分類が
        この4値の外へ出る経路が実装に無いことを確認した。

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::reviewer stderr classifier: 64 KiBだけを検査し、超過後も入力を
        drainする（Issue #744 AC-2）。65536バイトちょうどで stderr_truncated=false、65537バイトで
        stderr_bytes=65536・stderr_truncated=true となり、上限位置を偽の行末として完全一致を
        成立させないことを検証する。対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 64 KiB超過をraw非保持でdrainし外部診断へ
        truncatedを示す（Issue #744 AC-2）。65537バイトの stderr を出して非ゼロで終わる reviewer に対し、
        外部診断が classification=EXECUTION_FAILURE stderr_truncated=true となり、外部診断全体が
        4096 バイト以下であることを検証する。対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        実装原文の独立読解（捕捉の上界）: _reviewer_classify_stderr は max_bytes=65536 を保持し、
        inspected_bytes が上限へ達した時点で truncated=true と line_invalid=true を立て、残りを
        `/bin/cat >/dev/null` で読み捨てて DFA へ入力しない。したがって検査対象は先頭 64 KiB に閉じ、
        上限直後の byte を行末と誤認して完全一致を成立させることもない。
      - |-
        実装原文の独立読解（外部診断の上界）: _reviewer_failure_envelope の出力は
        `code=%s classification=%s rc=%s attempts=%s stderr_truncated=%s` の固定書式であり、
        code と classification は固定 enum、rc と attempts は数値正規表現を通過した値、
        stderr_truncated は true/false のみである。入力サイズに依存する項が無いため、
        出力長は入力の大小によらず 4 KiB を大きく下回る。raw stderr 由来の文字列を運ぶ経路も無い。
      - |-
        持ち越し warning（Issue #796、本ラウンドでは是正しない）: TRUNCATED_FLAG_LOST_ON_FORCED_REAP。
        detach した書き手が FIFO の write 端を保持したまま 64 KiB を超える stderr が出た経路では、
        分類プロセスの強制回収により state_file が書かれず stderr_truncated=false となりうる。
        本ラウンドはこの複合条件（detach と 64 KiB 超過の同時成立）を再現する観測を行っていないため、
        当該 warning に対する新たな確認も反証も与えていない。AC-2 が要求する「捕捉は 64 KiB で
        打ち切られ、外部診断は 4 KiB 以下で切り詰め有無を示す」ことは、上記の 65536/65537 バイトの
        実測と固定書式の読解により、detach を伴わない到達可能な入力で満たされている。

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 成功・失敗ともraw stderrと秘密値を外へ出さず
        隔離rootを削除する（Issue #744 AC-3/AC-8）。成功経路と非ゼロ経路の双方で、reviewer が stderr へ
        出した偽秘密値が launcher の stdout/stderr に現れないこと、reviewer が観測した隔離 root が
        実行後に存在しないことを検証する。対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 別sessionへdetachした子がstderr FIFOを保持しても
        回収が停止しない（Issue #744 AC-3/AC-8）。setsid で別 session へ detach した子が stderr FIFO の
        write 端を保持したまま reviewer が正常終了する反例を再現し、停止せず完了して隔離 root
        （＝複製した認証素材の置き場）が削除されることを検証する。対象 SHA の全件回帰（fail 0）に
        含まれ成功。
      - |-
        test/integration/gate-adapters.test.ts::gate reviewer credential boundary: caller HOME・Issue worktree・
        GitHub token・git/gh configをAI subprocessへ継承しない。隔離条件の非回帰。
        対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        実装原文の独立読解（raw の非永続化）: reviewer の stderr は隔離 root 内の名前付き pipe へ
        redirect され、その唯一の読み手が _reviewer_classify_stderr である。分類器が書き出すのは
        state_file の classification・stderr_bytes・stderr_truncated の3 key だけで、raw byte・行・
        断片を書く printf は存在しない。呼び出し側も state_file から classification と
        stderr_truncated だけを allowlist 照合して読み戻す。したがって raw stderr の sink が
        隔離領域の内外いずれにも作られない。
      - |-
        実装原文の独立読解（隔離領域の削除）: _run_reviewer_sanitized の全ての return 経路
        （watchdog 起動失敗、FIFO 作成失敗、watchdog 準備失敗、および成功・非ゼロ・timeout を含む
        通常終了）の直前に `/bin/rm -rf -- "$isolated_root"` が置かれている。prompt・reviewer 出力・
        複製した認証素材はすべてこの root の内側にのみ作られるため、全経路で残存しない。
      - |-
        追跡対象ファイルの非汚染: 本ラウンドの commit は VALIDATION.md 単独である
        （上記「検証対象の実装 SHA と、本成果物を載せるコミットの関係」の `git diff --name-only`・
        `git diff --stat ... -- ':!VALIDATION.md'`・`git status --porcelain` の実出力を参照）。
        全件回帰の実行直後に `git status --short` を実行し、出力が空である（変更・削除・未追跡
        ファイルが1件も無い）ことを確認した。テスト実行が隔離領域外へ残存物を作っておらず、
        root 直下の4成果物も消えていない。

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::reviewer failure envelope: allowlist検証不能時は固定分類とrcだけへ
        縮退する（Issue #744 AC-4）。
        `classification=MODEL_UNAVAILABLE;stderr_truncated=false;raw=secret-fragment` のように許可外
        フィールドが混入した内部診断を与えると、出力が `classification=EXECUTION_FAILURE rc=41` へ縮退し、
        混入断片が現れず 4096 バイト以下であることを検証する。対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        実装原文の独立読解（縮退条件）: _reviewer_failure_envelope は内部診断を
        `^classification=(4値のいずれか);stderr_truncated=(true|false)$` の完全一致正規表現でのみ受理する。
        不一致なら本文を捨てて `classification=EXECUTION_FAILURE rc=<数値>` だけを出す。一致しても
        rc が非負整数でない、または attempts が正整数でない場合は `classification=<分類> rc=<数値>` へ
        縮退する。いずれの縮退経路でも入力由来の文字列を出力へ運ばず、rc が数値でなければ 1 へ
        置き換えるため、stderr 断片が rc の位置から漏れることもない。
      - |-
        実装原文の独立読解（縮退時に承認へ倒れないこと）: envelope は診断文字列を組み立てるだけで
        呼び出し側の rc とゲート状態遷移を変えない。launch_gate_reviewer は rc が非ゼロまたは verdict が
        空のとき envelope を _fail_safe へ渡し、_fail_safe が human_required の記録と非ゼロ返却を行う。
        診断の生成に失敗しても approved へ倒れる分岐が存在しない。

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 組込み既定のmodel unavailableを安全な専用診断に
        する（Issue #744 AC-1/AC-5）。CODEX_REVIEWER_MODEL 未指定の non-core で model unavailable を
        注入すると外部診断が code=NONCORE_DEFAULT_MODEL_UNAVAILABLE になることを検証する。
        対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        test/integration/gate-adapters.test.ts::codex launch_gate_reviewer: 既定起動はread-only sandboxと
        high-capabilityモデルを使う。non-core 既定 model が gpt-5.6-sol であることを固定する。
        対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        実装原文の独立読解: codex.sh の launch_gate_reviewer は non-core かつ CODEX_REVIEWER_MODEL 未指定の
        分岐で model を gpt-5.6-sol へ設定し、model_source を default のままとする。汎用名 gpt-5.6 を
        reviewer 起動列へ渡す分岐は non-core レビュア経路に存在しない（gpt-5.6 は worker 側の
        _codex_worker_model が持つ非 implementation セグメント用フォールバックであり、レビュア起動列とは
        別の関数である）。この model 選択元は ASC_CODEX_MODEL_SOURCE として export され、
        _reviewer_failure_envelope が adapter=codex かつ core_review_required≠true かつ
        model 選択元=default の3条件が揃うときだけ code を NONCORE_DEFAULT_MODEL_UNAVAILABLE へ切り替える。
        したがって AC-5 の Then（暗黙の gpt-5.6 を使わず、利用不能時は専用 code で判別できる）が成立する。
      - |-
        持ち越し warning（Issue #796、本ラウンドでは是正しない）: NONCORE_DEFAULT_CODE_OVERCLAIM。
        CODEX_REVIEWER_CMD / GATE_REVIEWER_CMD による完全 override 経路でも ASC_CODEX_MODEL_SOURCE=default が
        export されるため、組込み既定と異なる model の unavailable も「組込み既定が利用不能」と読める
        診断になりうる、というレビュアの指摘である。本ラウンドはこの完全 override 経路での model 選択元を
        再現する観測を行っていないため、当該 warning に対する新たな確認も反証も与えていない。
        AC-5 の Then は、model 未指定という到達可能な入力について上記の実測と読解で満たされている。

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 明示model overrideを無改変で最優先にする
        （Issue #744 AC-6）。CODEX_REVIEWER_MODEL に明示した値が codex exec 互換 stub の受領引数へ一致し、
        既定へ置換されないことを検証する。対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 区切り文字を含む明示modelのmodel unavailableを
        誤分類しない（Issue #744 AC-1/AC-6）。`vendor/model` が無改変で reviewer へ渡り、その model の
        model unavailable が MODEL_UNAVAILABLE になることを検証する。対象 SHA の全件回帰（fail 0）に
        含まれ成功。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 引用符・空白・バックスラッシュを含む値を
        TOML層とshell層の両方で無改変に渡す（Issue #744）。
        test/integration/worker-adapters.test.ts::codex launch_worker: 引用符・空白・バックスラッシュを含む値を
        TOML層とshell層の両方で無改変に渡す（Issue #744）。reviewer 経路・worker 経路の双方で、
        stub が受領した argv の model_reasoning_effort を TOML basic string として復号すると原文へ
        戻ること、静的 config 引数に手書き escape 由来の余分なバックスラッシュが混入しないことを
        検証する。両件とも対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        実装原文の独立読解（優先度）: codex.sh の launch_gate_reviewer は non-core において
        CODEX_REVIEWER_MODEL が非空ならその値をそのまま model とし model_source を explicit にする。
        値を加工・検証・置換する処理はこの分岐に無く、既定 gpt-5.6-sol への差し替えは
        当該環境変数が空のときだけ起こる。したがって明示 override は無改変かつ最優先である。
      - |-
        実装原文の独立読解（2層 escape）: 起動列は _codex_toml_basic_string（TOML 層。`\` と `"` を
        TOML 規則で escape し basic string リテラルへ包む）と _codex_shell_command（shell 層。各引数を
        `%q` で quote して1本の文字列にする）の2関数だけを通す。手書きのバックスラッシュを起動列へ
        残す箇所が無いため、引用符・空白・バックスラッシュを含む値でも TOML と argv の双方が壊れない。
      - |-
        実装原文の独立読解（identifier 集合の一致）: 分類器の identifier 遷移は
        「[[:graph:]] かつ 単一引用符でない かつ 長さ 128 未満」を LC_ALL=C 固定で判定し、
        閉じ引用符は長さ1以上のときだけ受理する。受理集合は 1〜128 byte・0x21〜0x7E・0x27 除外であり、
        ADR-0079 の Decision および DESIGN.md の設計判断 D2 の記述と一致する。よって AC-6 が許す
        区切り文字入り identifier（vendor/model 等）の model unavailable が AC-1 の判別対象から
        落ちることはない。
      - |-
        持ち越し warning（Issue #796、本ラウンドでは是正しない）: TOML_CONTROL_CHAR_NOT_ESCAPED。
        _codex_toml_basic_string は `\` と `"` だけを escape し、改行・タブ等の制御文字を escape しない。
        本ラウンドは制御文字を含む設定値を入力とする観測を行っていないため、当該 warning に対する
        新たな確認も反証も与えていない。AC-6 が要求する「明示値が変更されず最優先で reviewer へ渡り、
        暗黙既定へ置換されない」ことは、引用符・空白・バックスラッシュ・区切り文字を含む上記の
        到達可能な入力で成立している。

  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::codex core reviewer: gpt-5.6-sol/xhigh/read-onlyのattested
        overrideだけを許可する。対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        test/integration/gate-adapters.test.ts::codex core reviewer: modelまたはeffortの不一致は起動せず
        human_requiredへ止める。対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        test/integration/gate-adapters.test.ts::claude core reviewer: 能力attestationまたはreasoning probe不足は
        human_requiredへ止める。対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        test/integration/gate-adapters.test.ts::gate-launch-reviewer: core reviewをstandardで起動すると
        adapter前にhuman_requiredへ止める。対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        実装原文の独立読解: codex.sh の launch_gate_reviewer は core_review_required=true の分岐で
        model_source を core_policy に固定し、(a) ASC_CODEX_REQUIRED_MODEL が空、または解決した model と
        不一致、(b) ASC_CODEX_REQUIRED_REASONING_EFFORT が空、または解決した effort と不一致、
        (c) CODEX_REVIEWER_CMD / GATE_REVIEWER_CMD による完全 command 上書きがあるのに
        CODEX_CORE_REVIEWER_ATTESTED が true でない、のいずれでも _codex_fail_safe を呼んで
        human_required を記録し 2 を返す。この分岐は non-core の既定解決（gpt-5.6-sol）へ合流せず、
        reviewer を起動しないまま return する。よって AC-7 の Then が成立する。

  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts 全51件（`grep -c "^test("` の実測）が対象 SHA の全件回帰
        （fail 0）に含まれ成功。認証 probe（認証不成立・env 資格情報の引継ぎ・設定ディレクトリ複製）、
        read-only 隔離（caller HOME・GitHub token・git/gh config の非継承、symlink 脱出不可）、
        watchdog（TERM を無視する reviewer のプロセスグループ KILL）、不正 timeout 値の起動前拒否、
        再試行、非ゼロ終了、never-approved、human_required、成功時 verdict、起動ラッパーの終了コード
        分岐（0/3/その他）がいずれも回帰していない。当該ファイルは前ラウンドの検証済みヘッド bdb7a3a と
        blob hash が一致し、統合によって1件も増減・改変されていない。
      - |-
        同じ隔離実行経路を共有する test/integration/gate-credential-store.test.ts（分類C・外部資格情報
        ストア限定構成、Issue #758）全14件（`grep -c "^test("` の実測）も対象 SHA の全件回帰に含まれ成功。
        stderr 分類の追加が当該経路を壊していない。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 別sessionへdetachした子がstderr FIFOを保持しても
        回収が停止しない（Issue #744 AC-3/AC-8）。対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: chunk分割された認証失敗をretry後の固定診断に
        する（Issue #744 AC-1/AC-8）。retry 後も attempts が実試行回数と一致し、認証失敗が承認へ
        倒れないことを検証する。対象 SHA の全件回帰（fail 0）に含まれ成功。
      - |-
        実装原文の独立読解（成功経路の非回帰）: _run_reviewer_sanitized は rc==0 のとき出力ファイルの
        内容だけを返し、分類状態から診断を組み立てる分岐へ入らない。すなわち成功時の verdict は
        診断追加前と同一であり、一時的な stderr や認証素材も隔離 root の削除により残らない。
      - |-
        実装原文の独立読解（回収の有界性）: _reviewer_reap_classifier は writer_done marker を立てた後、
        drain 完了 marker を上限付き（0.05秒×1800回）で待ち、期限内に終わらなければ分類プロセス
        グループごと TERM→KILL する。分類器側も writer_done がある場合は読み取りにタイムアウトを与えて
        終端とみなす。したがって detach した子が FIFO の write 端を保持しても回収は停止せず、
        watchdog・非ゼロ終了・隔離領域削除の既存契約へ到達する。
      - |-
        統合後の全件回帰: 対象 SHA で npm test を自ら前景実行し、tests 1589 / pass 1588 / fail 0 /
        cancelled 0 / skipped 1 / todo 0 / duration_ms 406297.008657 を観測した。前ラウンドの検証 SHA
        771a329 の時点は 1562 件であり27件増えている。増分は current main の統合が持ち込んだ ISSUE-786 の
        新規テスト（round-budget-policy・gate-round-budget-convergence・gate-round-policy-assets・
        review-evidence 等への追加）であり、`git diff --name-status --diff-filter=D bdb7a3a 3e72228` が
        出力なしであることから、この区間で削除されたファイルは1件も無い（＝既存テストの削除による
        見かけ上の pass は生じていない）。

regression:
  executed: true
  evidence:
    - 'npm test（対象 SHA 3e72228b268561e5f688753c8f99eb753a5d0ae7）: tests 1589 / pass 1588 / fail 0 / cancelled 0 / skipped 1 / todo 0 / duration_ms 406297.008657。本セグメントが前景で自ら実行し集計行を直接観測した'
    - 'npm run build（tsc）: 対象 SHA で単独実行し成功、終了コード 0'
    - 'npm run typecheck（tsc --noEmit -p tsconfig.test.json）: 対象 SHA で単独実行し成功、終了コード 0'
    - 'test/integration/gate-adapters.test.ts（Issue #744 の主対象）: 51件。うち Issue #744 由来の test 宣言は11件。全件回帰の fail 0 に含まれ成功'
    - 'test/integration/worker-adapters.test.ts: 83件。うち Issue #744 由来は1件（codex launch_worker のTOML層／shell層）。全件回帰の fail 0 に含まれ成功。Issue #797 として分離済みの WORKER_CMD 漏洩による偽陽性は本ラウンドで再現していない'
    - 'test/integration/gate-credential-store.test.ts（同じ隔離実行経路を共有、Issue #758）: 14件。全件回帰の fail 0 に含まれ成功'
    - 'skip 1件は test/integration/cli-resolve.test.ts の「ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 が指定された場合だけlive到達性を確認する」であり、本Issueの変更経路を通らない opt-in の live 到達性テストである'
    - '全件回帰の実行直後に git status --short を実行し出力が空であることを確認した（変更・削除・未追跡ファイルが1件も無く、Issue #801 が記録する root 直下成果物の消失は本ラウンドでは発生していない）'
    - '統合の健全性: マージ両親の変更ファイル集合を2本の name-only 差分（0440e86→a4c4cbb と bdb7a3a→3e72228、0440e86→bdb7a3a と a4c4cbb→3e72228）で突合し、いずれも完全一致。片側の巻き戻しも第三の内容の混入も無い。本Issueの実装・テスト5ファイルは bdb7a3a と blob hash が一致'
    - 'PR #792 の外部証跡: gh pr view の headRefOid が 3e72228b268561e5f688753c8f99eb753a5d0ae7 と一致し、当該 SHA の check-runs（gh api で直接取得）は総数2件・verify と verify-config-doc-sync がいずれも status=completed / conclusion=success'
    - '本セグメントでローカル実行した機械検査（VALIDATION.md 書き換え後、いずれも終了コード 0・違反出力なし）: verify ac-coverage ISSUE-744 / verify artifacts ISSUE-744 --started-segments spec,design,implementation,validation / verify spec-bdd SPEC.md / verify design-diagram DESIGN.md / verify adr docs/adr/ADR-0079-reviewer-model-identifier-charset-ascii-visible.md / verify adr docs/adr/ADR-0076-bounded-reviewer-stderr-and-noncore-codex-model-default.md / verify doc-length / verify template-sync / lint vocab / lint references / lint adr check / lint secrets --diff origin/main'
    - '引用証跡の突合: 本ファイルが引用するテスト題名18件・ファイルパス18件の合計36件を対象 SHA の実体と突合し（題名は grep -n -F、パスは ls -1 へ一括指定）、題名18件すべて一致・パス18件すべて実在、不一致0件であった'
