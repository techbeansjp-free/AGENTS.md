# 由来: AGENTS.mdが定める不変条件I7（仕様⇔検証の追跡）の規約に基づく検証報告である。
#
# 目的: Issue ISSUE-744「Codex ゲートレビュアの起動失敗を安全に診断可能にする」の実装を、
#       実装セグメントとは独立に受入・統合・回帰の観点で検証し、SPEC.md が定める AC-1〜AC-8
#       それぞれの充足可否と証跡を確定する。
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
#
# 入力: SPEC.md（AC-1〜AC-8）、DESIGN.md、PLAN.md、docs/adr/ADR-0079（accepted、ADR-0076 を supersede）、
#       対象 SHA 771a329b91850b1994918b361981e62bc7c397d9 の実装
#       （.agent-skill-chain/adapters/claude.sh・codex.sh）と自動テスト。
# 出力: 本ファイルの acceptance_criteria（AC ごとの検証方法・結果・証跡）と regression。
#
# 検証対象の実装 SHA と、本成果物を載せるコミットの関係:
#   本ファイルが書く「対象 SHA」「target_sha」「regression の npm test の対象」はいずれも、独立検証を
#   実施した実装コミット 771a329b91850b1994918b361981e62bc7c397d9 を指す。本ファイル自身は、それを追加する
#   コミットの SHA を内容として持てない（コミット SHA は本ファイルの内容を入力として決まるため）。
#   そこで SHA を書く代わりに、次の不変を成果物内に宣言する。
#
#   不変: 本成果物を追加するコミットは、検証対象の実装 SHA 771a329b91850b1994918b361981e62bc7c397d9 に
#   VALIDATION.md のみを変更した差分であり、実装ファイル（.agent-skill-chain/ 配下・src/ 配下・test/ 配下・
#   docs/ 配下を含む）を一切変更しない。SPEC.md・DESIGN.md・PLAN.md も変更しない。したがって
#   AC-1〜AC-8 の evidence と regression の結果は、実装内容が同一である本成果物のコミットに対しても
#   そのまま適用可能である。
#
#   根拠（本セグメントで commit 直前に実行した実際の出力の原文引用）:
#
#     $ git rev-parse HEAD
#     771a329b91850b1994918b361981e62bc7c397d9
#
#     $ git diff --name-only 771a329b91850b1994918b361981e62bc7c397d9
#     VALIDATION.md
#
#     $ git diff --stat 771a329b91850b1994918b361981e62bc7c397d9 -- ':!VALIDATION.md'
#
#     （出力なし＝VALIDATION.md 以外に差分が1行も無い。実装ファイルは一切変更していない）
#
#     $ git log --oneline 771a329b91850b1994918b361981e62bc7c397d9..HEAD
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
# 前回ラウンドからの再検証範囲（前回検証 SHA 98ebfd0 → 本 SHA 771a329）:
#   前回の VALIDATION.md は 98ebfd0 を対象としていた。その後 771a329（`git merge origin/main`）で
#   main の ISSUE-733・ISSUE-759 を取り込んだため、本ラウンドは対象 SHA を 771a329 へ移して
#   AC-1〜AC-8 を再検証し、全証跡を取り直した。差分の性質は次のとおりで、いずれも自分で実行した
#   git コマンドの出力から確定した。
#
#   (a) 本 Issue の実装ファイルは 98ebfd0 と 771a329 で同一である。
#       `git diff --stat 98ebfd0 771a329 -- .agent-skill-chain/adapters/ test/helpers/codex-config-arg.ts
#       SPEC.md DESIGN.md PLAN.md docs/adr/` の出力は docs/adr/ 配下の新規追加4件
#       （ADR-0068・ADR-0070・ADR-0072・ADR-0073。いずれも main 由来で本 Issue とは無関係）だけであり、
#       claude.sh・codex.sh・codex-config-arg.ts・SPEC.md・DESIGN.md・PLAN.md・ADR-0076・ADR-0079 は
#       1行も変わっていない。すなわち AC の判定対象である実装そのものはマージによって変化していない。
#   (b) main が `.agent-skill-chain/` 配下へ持ち込んだ変更は cli-resolve.sh（ISSUE-759 の新規）と
#       gate-local-review.sh（同）の2件だけである（`git diff --name-only 98ebfd0 771a329 --
#       .agent-skill-chain/` の出力）。どちらも進行役がレビュアを起動する準備段であり、本 Issue の
#       AC が対象とする gate-launch-reviewer.sh → adapters/*.sh の実行経路には含まれない。
#       ISSUE-733 の変更（判定軸の分離・quick 免除・verdict 集約）は src/ 配下と gate 判定側にあり、
#       stderr 分類・envelope・隔離領域削除のいずれにも触れていない。
#   (c) gate-adapters.test.ts はマージで 48 件から 51 件へ増えたが、増分は ISSUE-733 が追加した3件
#       （quick 免除下の4ゲート起動、免除不成立の成果物不在、読み取り不能時の未起動）だけである。
#       本 Issue の12件を含む既存テストは題名・本文とも変更されていない
#       （`git diff 98ebfd0 771a329 -- test/integration/gate-adapters.test.ts` の追加行に現れる
#       test 宣言が上記3件のみであることを確認した）。
#   (d) この区間で削除されたファイルは1件も無い
#       （`git diff --name-status --diff-filter=D 98ebfd0 771a329` の出力なし）。既存テストの削除に
#       よって見かけ上 fail が消える経路は生じていない。
#
# 引用証跡の突合結果（本セグメントで機械的に実施）:
#   本ファイルが引用するテスト題名18件とファイルパス11件、合計29件を実体と突合した。題名は
#   `grep -c -F -f <題名一覧> <対象ファイル>` により固定文字列として照合し、部分一致による
#   見逃しを避けるため `test('` からの前方一致で列挙した。結果は題名18件すべて一致
#   （gate-adapters.test.ts 17件・worker-adapters.test.ts 1件）、パスは10件が実在、1件が不在であった。
#   不在の1件は前回ラウンドが独立検証の一時足場として作成した test/integration/iv744-independent.test.ts
#   であり、未追跡ファイルだったため現 worktree には存在しない。前回 VALIDATION.md が
#   「独立検証 IV744」として引用していた evidence はこの足場に対する 98ebfd0 時点の実行結果であり、
#   本ラウンドでは再現できないため、当該引用をすべて削除し、下記の方法で取り直した証跡へ置き換えた。
#   テスト題名を本ファイルへ合わせて変更する是正は行っていない（是正すべきは記述の側である）。
#
# 本セグメントの独立検証方法と、その実行系の制約:
#   本セグメントの実行環境は、`npm test`・`npm run typecheck`・`node bin/agents-md.js <subcommand>`・
#   `git`・`grep`・`ls` の実行は許可される一方、`bash <script>`・`bash -c`・`node <任意スクリプト>` の
#   実行が許可されていない。このため前回ラウンドが行った「別ファイルの独立検証テストを新規作成して
#   実行する」方式は本ラウンドでは実施できなかった。実行系の制約であり、検証を省略した判断ではない。
#   代わりに本セグメントは、実装セグメントの主張に依存しない次の3つの独立な観測を行った。
#   (a) 全件回帰の自力実行: npm test を対象 SHA で自ら実行し、終了コードと集計を直接観測した。
#       実装セグメントの報告値を転記していない。
#   (b) 実装原文の独立読解: claude.sh の _reviewer_classify_stderr・_reviewer_reap_classifier・
#       _reviewer_internal_diagnostic・_reviewer_failure_envelope・_run_reviewer_sanitized と、
#       codex.sh の launch_gate_reviewer・_codex_toml_basic_string・_codex_shell_command を読み、
#       各 AC の Then が実装のどの制御で成立するかを、テストの主張と独立に確認した。結果は
#       各 AC の evidence へ「実装原文の独立読解」として記す。
#   (c) 引用証跡の機械突合と差分検査: 上記「引用証跡の突合結果」および「前回ラウンドからの再検証範囲」。
#   この構成では、(a) が挙動を、(b) が挙動の根拠を、(c) が証跡と対象の対応を、それぞれ別の情報源から
#   裏づける。実サービスへの疎通は SPEC.md がスコープ外とするため、いずれの観測にも含めていない。
#
# codex CLI の実起動について:
#   本Issueの対象は codex レビュア経路の診断保全であるが、codex のクォータ枯渇（2026-08-21 04:25 まで）
#   により codex CLI の実起動は行えない。ただし AC-1〜AC-8 のいずれも実 CLI の起動成功を Then に
#   置いておらず、SPEC.md は「実サービスや実資格情報への疎通を前提にしない」ことを制約として明記している。
#   代替検証手段は、(a) CODEX_REVIEWER_CMD による完全 command 上書き、(b) CODEX_EXECUTABLE による
#   codex exec 互換 stub（受領 argv を1行1引数で記録し、-m の値を含む model unavailable の stderr を
#   出して非ゼロ終了する／verdict を返して正常終了する2種）、(c) 分類器・envelope 関数への直接注入の
#   3経路であり、これらは対象 SHA のテストが実際に用いている。実 codex CLI でしか観測できないのは
#   「実在 model slug が実サービス側で利用可能か」だけであり、SPEC.md がスコープ外とする
#   実サービスの可用性保証に該当する。
#
# 独立検証で観測した事実（origin 付き。実装の是正は行わず進行役の判断へ委ねる）:
#   1. origin=design / 重大度=info / 前ラウンドの警告 DESIGN_MODEL_ID_CHARSET_DIVERGENCE は解消済み:
#      ADR-0079（accepted）は model identifier を「1〜128 byte、各 byte が単一引用符（0x27）以外の
#      ASCII 可視文字（0x21〜0x7E）」と定義し、DESIGN.md の設計判断 D2 も同一の定義を持ち、
#      related_adrs は ADR-0079 を adopts として指す。ADR-0076 は superseded である。実装原文の
#      独立読解でも、claude.sh の identifier 遷移が「[[:graph:]] かつ 単一引用符でない かつ
#      長さ 128 未満」を LC_ALL=C 固定で判定し、閉じ引用符を受理する条件が長さ1以上であることを
#      確認した。すなわち受理集合は 1〜128 byte・0x21〜0x7E・0x27 除外であり、文書の定義と一致する。
#      本ラウンドで新たに是正すべき乖離は無い。
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
#   5. origin=validation / 重大度=info / INDEPENDENT_SCAFFOLD_NOT_REPRODUCIBLE:
#      上記「本セグメントの独立検証方法と、その実行系の制約」のとおり、前回ラウンドの独立検証足場は
#      実行系の制約により本ラウンドで再実行できていない。前回の当該 evidence は本ファイルから削除した。
#
# 未決事項: 無い。範囲外に真因があると判明した事象も無い。マージにより main の ISSUE-733・ISSUE-759 を
#         取り込んだ後も、本 Issue の AC を壊す事象は観測されていない（fail 0）。
# 対象外: Issue #751 の prompt 入力閉包、Issue #715 の verdict stdout secret 検査と実行パス信頼境界、
#         Claude 固有の認証成立条件・model 選択、実サービス疎通、provider CLI の将来互換層。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-744
target_sha: 771a329b91850b1994918b361981e62bc7c397d9

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::reviewer stderr classifier: model/authの完全一致だけを
        相互排他的に分類する（Issue #744 AC-1）: 成功（772.086794ms）。model 4形式は MODEL_UNAVAILABLE、
        auth 7形式は AUTHENTICATION_FAILURE、`unknown option for model command`・suffix追加・model/auth複合は
        いずれも EXECUTION_FAILURE。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 組込み既定のmodel unavailableを安全な専用診断に
        する（Issue #744 AC-1/AC-5）: 成功（4002.847286ms）。外部診断が
        code=NONCORE_DEFAULT_MODEL_UNAVAILABLE classification=MODEL_UNAVAILABLE となり、
        注入した偽秘密値が出力に現れないこと。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: chunk分割された認証失敗をretry後の固定診断に
        する（Issue #744 AC-1/AC-8）: 成功（4159.440736ms）。signature を2回の write に分割しても
        classification=AUTHENTICATION_FAILURE になり、attempts が実試行回数と一致すること。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 区切り文字を含む明示modelのmodel unavailableを
        誤分類しない（Issue #744 AC-1/AC-6）: 成功（3975.374251ms）。
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
        drainする（Issue #744 AC-2）: 成功（13145.942069ms）。65536バイトちょうどで stderr_truncated=false、
        65537バイトで stderr_bytes=65536・stderr_truncated=true。上限位置を偽の行末として完全一致を
        成立させないことも検証。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 64 KiB超過をraw非保持でdrainし外部診断へ
        truncatedを示す（Issue #744 AC-2）: 成功（8268.204279ms）。65537バイトの stderr を出して非ゼロで
        終わる reviewer に対し、外部診断が classification=EXECUTION_FAILURE stderr_truncated=true となり、
        外部診断全体が 4096 バイト以下であること。
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
        隔離rootを削除する（Issue #744 AC-3/AC-8）: 成功（7616.471994ms）。成功経路と非ゼロ経路の双方で、
        reviewer が stderr へ出した偽秘密値が launcher の stdout/stderr に現れないこと、reviewer が観測した
        隔離 root が実行後に存在しないこと。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 別sessionへdetachした子がstderr FIFOを保持しても
        回収が停止しない（Issue #744 AC-3/AC-8）: 成功（4444.902411ms）。setsid で別 session へ detach した子が
        stderr FIFO の write 端を保持したまま reviewer が正常終了する反例を再現し、停止せず完了して
        隔離 root（＝複製した認証素材の置き場）が削除されること。
      - |-
        test/integration/gate-adapters.test.ts::gate reviewer credential boundary: caller HOME・Issue worktree・
        GitHub token・git/gh configをAI subprocessへ継承しない: 成功（3547.214767ms）。隔離条件の非回帰。
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
        全件回帰の実行後にも `git status --short` は VALIDATION.md 以外の変更・未追跡ファイルを
        報告しておらず、テスト実行が隔離領域外へ残存物を作っていないことを確認した。

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::reviewer failure envelope: allowlist検証不能時は固定分類とrcだけへ
        縮退する（Issue #744 AC-4）: 成功（41.155419ms）。
        `classification=MODEL_UNAVAILABLE;stderr_truncated=false;raw=secret-fragment` のように許可外
        フィールドが混入した内部診断を与えると、出力が `classification=EXECUTION_FAILURE rc=41` へ縮退し、
        混入断片が現れず 4096 バイト以下であること。
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
        する（Issue #744 AC-1/AC-5）: 成功（4002.847286ms）。CODEX_REVIEWER_MODEL 未指定の non-core で
        model unavailable を注入すると外部診断が code=NONCORE_DEFAULT_MODEL_UNAVAILABLE になること。
      - |-
        test/integration/gate-adapters.test.ts::codex launch_gate_reviewer: 既定起動はread-only sandboxと
        high-capabilityモデルを使う: 成功（3981.288955ms）。non-core 既定 model が gpt-5.6-sol であることを固定。
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
        （Issue #744 AC-6）: 成功（3732.557592ms）。CODEX_REVIEWER_MODEL に明示した値が codex exec 互換 stub の
        受領引数へ一致し、既定へ置換されないこと。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 区切り文字を含む明示modelのmodel unavailableを
        誤分類しない（Issue #744 AC-1/AC-6）: 成功（3975.374251ms）。`vendor/model` が無改変で reviewer へ渡り、
        その model の model unavailable が MODEL_UNAVAILABLE になること。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 引用符・空白・バックスラッシュを含む値を
        TOML層とshell層の両方で無改変に渡す（Issue #744）: 成功（3660.165843ms）。
        test/integration/worker-adapters.test.ts::codex launch_worker: 引用符・空白・バックスラッシュを含む値を
        TOML層とshell層の両方で無改変に渡す（Issue #744）: 成功（2286.496619ms）。reviewer 経路・worker 経路の
        双方で、stub が受領した argv の model_reasoning_effort を TOML basic string として復号すると原文へ
        戻ること、静的 config 引数に手書き escape 由来の余分なバックスラッシュが混入しないこと。
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
        overrideだけを許可する: 成功（3196.829049ms）。
      - |-
        test/integration/gate-adapters.test.ts::codex core reviewer: modelまたはeffortの不一致は起動せず
        human_requiredへ止める: 成功（2476.50492ms）。
      - |-
        test/integration/gate-adapters.test.ts::claude core reviewer: 能力attestationまたはreasoning probe不足は
        human_requiredへ止める: 成功（2499.51864ms）。
      - |-
        test/integration/gate-adapters.test.ts::gate-launch-reviewer: core reviewをstandardで起動すると
        adapter前にhuman_requiredへ止める: 成功（2450.376622ms）。
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
        test/integration/gate-adapters.test.ts 全51件成功・0件失敗。認証 probe（認証不成立・env 資格情報の
        引継ぎ・設定ディレクトリ複製）、read-only 隔離（caller HOME・GitHub token・git/gh config の非継承、
        symlink 脱出不可）、watchdog（TERM を無視する reviewer のプロセスグループ KILL）、
        不正 timeout 値の起動前拒否、再試行、非ゼロ終了、never-approved、human_required、成功時 verdict、
        起動ラッパーの終了コード分岐（0/3/その他）がいずれも回帰していない。51件のうち3件は main の
        マージが持ち込んだ ISSUE-733 の新規テストであり、本 Issue の12件を含む既存48件は無変更である。
      - |-
        同じ隔離実行経路を共有する test/integration/gate-credential-store.test.ts（分類C・外部資格情報
        ストア限定構成、Issue #758）全14件も成功しており、stderr 分類の追加が当該経路を壊していない。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 別sessionへdetachした子がstderr FIFOを保持しても
        回収が停止しない（Issue #744 AC-3/AC-8）: 成功（4444.902411ms）。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: chunk分割された認証失敗をretry後の固定診断に
        する（Issue #744 AC-1/AC-8）: 成功（4159.440736ms）。retry 後も attempts が実試行回数と一致し、
        認証失敗が承認へ倒れないこと。
      - |-
        実装原文の独立読解（成功経路の非回帰）: _run_reviewer_sanitized は rc==0 のとき出力ファイルの
        内容だけを返し、分類状態から診断を組み立てる分岐へ入らない。すなわち成功時の verdict は
        診断追加前と同一であり、一時的な stderr や認証素材も隔離 root の削除により残らない。
      - |-
        実装原文の独立読解（回収の有界性）: _reviewer_reap_classifier は writer_done marker を立てた後、
        drain 完了 marker を上限付きで待ち、期限内に終わらなければ分類プロセスグループごと
        TERM→KILL する。分類器側も writer_done がある場合は読み取りにタイムアウトを与えて終端と
        みなす。したがって detach した子が FIFO の write 端を保持しても回収は停止せず、
        watchdog・非ゼロ終了・隔離領域削除の既存契約へ到達する。
      - |-
        全件回帰: npm test で tests 1562 / pass 1561 / fail 0 / skip 1、プロセス終了コード 0。
        前回検証 SHA 98ebfd0 の時点は 1441 件であり 121 件増えている。増分は main のマージが持ち込んだ
        ISSUE-733・ISSUE-759 の新規テスト（cli-resolve・gate-procurement-evidence・gate-launcher-digest・
        dependency-trace・gate-alternative-criteria・gate-artifacts・gate-judgment-rules・
        gate-quick-exemption・gate-verdict-aggregation・tree-digest・trusted-cli-marker 等の新規ファイルと、
        gate-judgment・gate-local-review・gate-evidence・verify・reconcile 等への追加）であり、
        `git diff --name-status --diff-filter=D 98ebfd0 771a329` が出力なしであることから、
        この区間で削除されたファイルは1件も無い（＝既存テストの削除による見かけ上の pass は生じていない）。

regression:
  executed: true
  evidence:
    - 'npm test（対象 SHA 771a329b91850b1994918b361981e62bc7c397d9）: tests 1562 / pass 1561 / fail 0 / cancelled 0 / skipped 1 / todo 0 / duration_ms 411409.547699、プロセス終了コード 0'
    - 'npm run build（pretest として実行、tsc）: 成功'
    - 'npm run typecheck（tsc --noEmit -p tsconfig.test.json）: 成功、終了コード 0'
    - 'test/integration/gate-adapters.test.ts（Issue #744 の主対象）: 51件中 51件成功・0件失敗。うち Issue #744 由来は11件'
    - 'test/integration/worker-adapters.test.ts: 全83件成功。うち Issue #744 由来は1件（codex launch_worker のTOML層／shell層）。Issue #797 として分離済みの WORKER_CMD 漏洩による偽陽性は本ラウンドで再現していない'
    - 'test/integration/gate-credential-store.test.ts（同じ隔離実行経路を共有、Issue #758）: 全14件成功'
    - 'skip 1件は「GitHub導入元へ実際に到達してpackage versionを取得できる」（ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 指定時のみ動く live 到達性の opt-in テスト）であり、本Issueの変更経路を通らない'
    - '全件回帰の実行後に git status --short を確認し、VALIDATION.md 以外の変更・削除・未追跡ファイルが無いことを確認した（Issue #801 が記録する root 直下成果物の消失は本ラウンドでは発生していない）'
    - '本セグメントでローカル実行した機械検査（VALIDATION.md 書き換え後、いずれも終了コード 0・違反出力なし）: verify ac-coverage ISSUE-744 / verify artifacts ISSUE-744 --started-segments spec,design,implementation,validation / verify spec-bdd SPEC.md / verify design-diagram DESIGN.md / verify adr docs/adr/ADR-0079-reviewer-model-identifier-charset-ascii-visible.md / verify adr docs/adr/ADR-0076-bounded-reviewer-stderr-and-noncore-codex-model-default.md / verify doc-length / verify template-sync / lint vocab / lint references / lint adr check / lint secrets --diff origin/main'
    - '引用証跡の突合: 本ファイルが引用するテスト題名18件・ファイルパス11件の合計29件を grep -F で実体と突合し、題名は18件すべて一致、パスは10件実在・1件不在（前回ラウンドの未追跡足場 test/integration/iv744-independent.test.ts）であった。不在の1件に依存していた前回の引用はすべて削除し、本ラウンドで取り直した証跡へ置き換えた'
