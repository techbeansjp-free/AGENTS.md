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
#       対象 SHA 98ebfd0bc724f4a5cd6b9ec05e463462b7f2da75 の実装
#       （.agent-skill-chain/adapters/claude.sh・codex.sh）と自動テスト。
# 出力: 本ファイルの acceptance_criteria（AC ごとの検証方法・結果・証跡）と regression。
#
# 検証対象の実装 SHA と、本成果物を載せるコミットの関係:
#   本ファイルが書く「対象 SHA」「target_sha」「regression の npm test の対象」はいずれも、独立検証を
#   実施した実装コミット 98ebfd0bc724f4a5cd6b9ec05e463462b7f2da75 を指す。本ファイル自身は、それを追加する
#   コミットの SHA を内容として持てない（コミット SHA は本ファイルの内容を入力として決まるため）。
#   そこで SHA を書く代わりに、次の不変を成果物内に宣言する。
#
#   不変: 本成果物を追加するコミットは、検証対象の実装 SHA 98ebfd0bc724f4a5cd6b9ec05e463462b7f2da75 に
#   VALIDATION.md のみを追加した差分であり、実装ファイル（.agent-skill-chain/ 配下・src/ 配下・test/ 配下・
#   docs/ 配下を含む）を一切変更しない。SPEC.md・DESIGN.md・PLAN.md も変更しない。したがって
#   AC-1〜AC-8 の evidence と regression の結果は、実装内容が同一である本成果物のコミットに対しても
#   そのまま適用可能である。
#
#   根拠（本セグメントで commit 直前に実行した実際の出力の原文引用）:
#
#     $ git rev-parse HEAD
#     98ebfd0bc724f4a5cd6b9ec05e463462b7f2da75
#
#     $ git log --oneline 98ebfd0bc724f4a5cd6b9ec05e463462b7f2da75..HEAD
#
#     （出力なし＝実装 SHA と現 HEAD が同一コミットであり、間に別のコミットが無い）
#
#     $ git status --porcelain
#      M VALIDATION.md
#     ?? test/integration/iv744-independent.test.ts
#
#     `??` の行は下記「独立検証の実行方法」で述べる一時的な検証足場であり、追跡対象ではない。
#     本コミットは `git add VALIDATION.md` だけを行うため、この未追跡ファイルはコミットに含まれない。
#     本セグメントの実行環境はファイル削除が許可されておらず、この足場を worktree から取り除けなかった。
#     マージ前に `git clean -f -- test/integration/iv744-independent.test.ts` で削除する必要がある
#     （進行役への申し送り。追跡対象ではないため CI と PR の差分には一切現れない）。
#
#     $ git diff --name-only 98ebfd0bc724f4a5cd6b9ec05e463462b7f2da75
#     VALIDATION.md
#
#     $ git diff --stat 98ebfd0bc724f4a5cd6b9ec05e463462b7f2da75 -- ':!VALIDATION.md'
#
#     （出力なし＝VALIDATION.md 以外に差分が1行も無い。実装ファイルは一切変更していない）
#
#     $ git diff --stat 98ebfd0bc724f4a5cd6b9ec05e463462b7f2da75
#      VALIDATION.md | 489 ++++++++++++++++++++++++++++++++++++++--------------------
#      1 file changed, 325 insertions(+), 164 deletions(-)
#
#   上の `git diff --stat` は本ファイルを書き上げた後に実行し、その実出力をこの引用箇所へ書き戻した
#   （書き戻しは同一行数の置換であり、--stat が数える行数を変えない。書き戻し後に再実行して同一値で
#   あることを確認済み）。deletions は前回ラウンドの VALIDATION.md（対象 SHA 7a14bc69 に対する検証報告）
#   を本ラウンドの内容へ全面的に書き換えたことによる。
#
#   よって実装 SHA から本成果物のコミットまでの累積差分は VALIDATION.md に閉じており、上記の不変は成立する。
#
# 前回ラウンドからの再検証範囲（前回検証 SHA 7a14bc69 → 本 SHA 98ebfd0 の実装差分）:
#   前回の VALIDATION.md は 7a14bc69 を対象としていた。本ラウンドはその後の3種類の変更を含めて
#   AC-1〜AC-8 を再検証した。差分の内訳は `git diff --stat 7a14bc69 98ebfd0` で確認した。
#   (a) main のマージ（3d6ab23）: Issue #751 の判定プロンプト入力閉包により
#       .agent-skill-chain/adapters/claude.sh の launch_gate_reviewer が reviewer-context の解決順序を
#       変更した（23行）。reviewer stderr 分類・envelope・cleanup の各関数自体は無変更である。
#   (b) 163f538: .agent-skill-chain/adapters/codex.sh の TOML 層 escape（_codex_toml_basic_string）と
#       shell 層 quote（_codex_shell_command）の分離、および reviewer 起動列の手書きバックスラッシュ除去。
#       test/helpers/codex-config-arg.ts と reviewer/worker 両経路の回帰テストが追加された。
#   (c) 8f67804 / 9babcf3 / 98ebfd0: DESIGN.md D2 と ADR-0079 の文書側整合（ADR-0079 を accepted 化、
#       ADR-0076 を superseded 化）。実装コードの変更を伴わない。
#
# 全ACに共通する検証環境（個々のACのevidenceでは繰り返さない）:
#   - ホスト: Linux / Node.js v24.19.0（node --version で確認）。
#     branch bugfix/744-codex-reviewer-stderr-diagnostics、HEAD 98ebfd0。
#     setsid(1) は利用可能である（detach 反例テストが hasSetsid() による skip ではなく実行され、
#     6546.164113ms の実測時間つきで成功しているため）。bash はアダプタが使う名前付き file descriptor・
#     printf -v・set -m を解釈できる版であり、これらを通る全テストが成功している。
#   - 全件回帰: npm test（pretest で npm run build を実行）。
#     tests 1441 / pass 1440 / fail 0 / cancelled 0 / skipped 1 / todo 0 / duration_ms 601919.88822。
#     skip 1件は「GitHub導入元へ実際に到達してpackage versionを取得できる」であり、
#     ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 指定時だけ動く live 到達性の opt-in テストである。
#     本Issueの変更経路を通らない既存テストであり、実行系の都合で無効化したものではない。
#   - 実装セグメント由来の Issue #744 テストは全件成功した（gate-adapters.test.ts 11件・
#     worker-adapters.test.ts 1件）。個々の結果は各 AC の evidence に記す。
#   - 進行役が「既知の偽陽性」として名指しした worker-adapters.test.ts の codex launch_worker 群
#     8件（Issue #797、WORKER_CMD の漏洩に起因）は本ラウンドでは再現せず、fail 0 であった。
#     したがって env -u による再実行は行っていない。
#
# 独立検証の実行方法（本セグメント固有。実装セグメントのテストとは別の入力・別の観測点）:
#   実装セグメントが書いたテストを再実行するだけでは、テストが反例を取り違えていた場合に同じ
#   見落としを繰り返す。そこで本セグメントは、AC ごとに実装セグメントが使っていない入力を与える
#   独立検証テスト14件を一時ファイル test/integration/iv744-independent.test.ts として作成し、
#   npm test で実行した（全件 pass、下記 IV744 として各 AC の evidence に記載）。
#   この一時ファイルは検証のための足場であり、成果物ではないため commit していない
#   （本コミットは VALIDATION.md のみを追加するという上記の不変を維持するため）。未追跡のまま
#   worktree に残っている理由と後始末は、上記 `git status --porcelain` の注記に記した。
#   実行時の全体結果は tests 1455 / pass 1454 / fail 0 / cancelled 0 / skipped 1 / todo 0 /
#   duration_ms 820270.315323 であり、既存1441件に独立検証14件を加算した値と一致する。
#   独立検証が用いた駆動経路は次の3つである。
#   (a) 分類器 _reviewer_classify_stderr を bash から直接起動し stdin へ注入して state_file を読む。
#   (b) 外部診断 _reviewer_failure_envelope を bash から直接起動し、環境変数で分岐条件を与える。
#   (c) .agent-skill-chain/scripts/gate-launch-reviewer.sh を stub reviewer で起動し、
#       gate-report の final・launcher の終了コード・stdout/stderr・stub が受領した argv・
#       隔離 root の残存有無を観測する。
#
# codex CLI の実起動について（進行役の指示に対する回答）:
#   本Issueの対象は codex レビュア経路の診断保全であるが、codex のクォータ枯渇（2026-08-21 04:25 まで）
#   により codex CLI の実起動は行えない。ただし AC-1〜AC-8 のいずれも実 CLI の起動成功を Then に
#   置いておらず、SPEC.md は「実サービスや実資格情報への疎通を前提にしない」ことを制約として明記している。
#   代替検証手段として、(a) CODEX_REVIEWER_CMD による完全 command 上書き、(b) CODEX_EXECUTABLE による
#   codex exec 互換 stub（受領 argv を1行1引数で記録し、-m の値を含む model unavailable の stderr を
#   出して非ゼロ終了する／verdict を返して正常終了する2種）、(c) 分類器・envelope 関数への直接注入、
#   の3経路を用いた。実 codex CLI でしか観測できないのは「実在 model slug が実サービス側で利用可能か」
#   だけであり、これは SPEC.md がスコープ外とする実サービスの可用性保証に該当する。
#
# 独立検証で観測した事実（origin 付き。実装の是正は行わず進行役の判断へ委ねる）:
#   1. origin=design / 重大度=info / 前回ラウンドの警告 DESIGN_MODEL_ID_CHARSET_DIVERGENCE は解消済み:
#      前回の VALIDATION.md は「DESIGN.md D2 と ADR-0076 が model identifier を
#      `[a-z0-9][a-z0-9._-]{0,127}` に制限すると記述する一方、実装はより広い集合を受理する」ことを
#      origin=design の warning として記録していた。本 SHA では ADR-0079（accepted）が
#      「1〜128 byte、各 byte が単一引用符（0x27）以外の ASCII 可視文字（0x21〜0x7E）」と定義し、
#      DESIGN.md D2 も同一の定義へ書き換えられ、related_adrs も ADR-0079（adopts）へ更新されている。
#      ADR-0076 は superseded である。実装（claude.sh の identifier 遷移は
#      「[[:graph:]] かつ 単一引用符でない かつ 長さ 128 未満」を LC_ALL=C 固定で判定）は
#      この定義と一致する。独立検証は境界値（128 byte 成立 / 129 byte 不成立、区切り記号・大文字成立、
#      空白・タブ・DEL・非ASCII・単一引用符 不成立）を実測し、文書と実装の一致を確認した。
#      本ラウンドで新たに是正すべき乖離は無い。
#   2. origin=implementation / 重大度=warning / 既知の持ち越し（Issue #796 で追跡中、本ラウンドでは是正禁止）:
#      TRUNCATED_FLAG_LOST_ON_FORCED_REAP・NONCORE_DEFAULT_CODE_OVERCLAIM・TOML_CONTROL_CHAR_NOT_ESCAPED
#      の3件。いずれも implementation-gate のレビュア2体が非 blocking と判断し、進行役が Issue #796 へ
#      転記済みである。本ラウンドでは是正しておらず、独立検証もこの3件が指す固有の入力条件
#      （detach と 64 KiB 超過の同時成立、完全 command override 下の model 選択元、制御文字を含む
#      設定値）を再現していない。したがって本報告はこの3件について新たな確認も反証も与えていない。
#      各 AC の evidence では、それぞれの AC が要求する Then が別の入力で満たされていることだけを示す。
#   3. origin=implementation / 重大度=info / 既知の持ち越し（Issue #795 で追跡中、本ラウンドでは是正禁止）:
#      CodeRabbit の Minor 指摘3件（claude.sh の上限到達時 state 先行書き出し、テスト側の /usr/bin/head
#      絶対パス、テスト側の indexOf 戻り値未検査）。人間の判断により follow-up Issue へ分離済みである。
#   4. origin=validation / 重大度=info / REAL_CODEX_CLI_NOT_EXERCISED:
#      上記「codex CLI の実起動について」のとおり、実 codex CLI の起動は本ラウンドでも行っていない。
#
# 未決事項: 無い。範囲外に真因があると判明した事象も無い。
# 対象外: Issue #751 の prompt 入力閉包、Issue #715 の verdict stdout secret 検査と実行パス信頼境界、
#         Claude 固有の認証成立条件・model 選択、実サービス疎通、provider CLI の将来互換層。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-744
target_sha: 98ebfd0bc724f4a5cd6b9ec05e463462b7f2da75

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::reviewer stderr classifier: model/authの完全一致だけを
        相互排他的に分類する（Issue #744 AC-1）: 成功（735.745835ms）。model 4形式は MODEL_UNAVAILABLE、
        auth 7形式は AUTHENTICATION_FAILURE、`unknown option for model command`・suffix追加・model/auth複合は
        いずれも EXECUTION_FAILURE。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 組込み既定のmodel unavailableを安全な専用診断に
        する（Issue #744 AC-1/AC-5）: 成功（9349.061377ms）。外部診断が
        code=NONCORE_DEFAULT_MODEL_UNAVAILABLE classification=MODEL_UNAVAILABLE rc=41 attempts=2
        stderr_truncated=false となり、注入した偽秘密値が出力に現れないこと。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: chunk分割された認証失敗をretry後の固定診断に
        する（Issue #744 AC-1/AC-8）: 成功（9041.106841ms）。signature を2回の write に分割しても
        classification=AUTHENTICATION_FAILURE rc=42 attempts=2 になること。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 区切り文字を含む明示modelのmodel unavailableを
        誤分類しない（Issue #744 AC-1/AC-6）: 成功（7665.365021ms）。
      - |-
        独立検証 IV744 AC-1「実装テストと別の identifier・別の行形で4分類が相互排他になる」: 成功
        （1886.550992ms）。実装テストが使う gpt-5.6-* ではなく acme-x1 系 identifier で model 4形式が
        MODEL_UNAVAILABLE、auth 7形式が AUTHENTICATION_FAILURE になること、ASCII case 非依存・CRLF 終端・
        終端改行なしの最終行・無関係行に挟まれた完全一致がいずれも成立すること、行頭 prefix 付き・
        行末 suffix 付き・先頭空白・末尾空白・空 identifier・identifier 内空白・空 stderr・無関係行のみ・
        model 先行の複合・auth 先行の複合がいずれも EXECUTION_FAILURE へ縮退することを実測した。
      - |-
        独立検証 IV744 AC-3/AC-8「timeout 経路でも秘密値を出さず隔離 root を削除する」: 成功
        （13139.337653ms）。GATE_REVIEWER_TIMEOUT_SEC=3 で sleep する stub reviewer を起動し、
        launcher stderr が classification=TIMEOUT rc=124 attempts=1 を示すこと、すなわち TIMEOUT が
        他の3分類と判別できることを実測した。

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::reviewer stderr classifier: 64 KiBだけを検査し、超過後も入力を
        drainする（Issue #744 AC-2）: 成功（22407.87559ms）。65536バイトちょうどで stderr_truncated=false、
        65537バイトで stderr_bytes=65536・stderr_truncated=true。上限位置を偽の行末として完全一致を
        成立させないことも検証。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 64 KiB超過をraw非保持でdrainし外部診断へ
        truncatedを示す（Issue #744 AC-2）: 成功（16725.000034ms）。65537バイトの stderr を出して rc=43 で
        終わる reviewer に対し、外部診断が classification=EXECUTION_FAILURE rc=43 attempts=1
        stderr_truncated=true となり、外部診断全体が 4096 バイト以下であること。
      - |-
        独立検証 IV744 AC-2「検査上限を独自サイズで実測し、上限後の signature を採用しない」: 成功
        （34885.381357ms）。65535 byte → stderr_bytes=65535・truncated=false、65536 byte →
        stderr_bytes=65536・truncated=false、65537 byte → stderr_bytes=65536・truncated=true、
        1 MiB → stderr_bytes=65536・truncated=true（停止せず終端する）。さらに 64 KiB の後ろに置いた
        `error: unauthorized` の完全一致行が分類へ影響せず EXECUTION_FAILURE のままであることを実測した。
      - |-
        独立検証 IV744 AC-2「外部診断は最大構成でも 4 KiB を大きく下回る」: 成功（50.047591ms）。
        rc=4294967295・attempts=999999999・truncated=true という最大構成の envelope でも 200 バイト未満
        であることを実測した（allowlist が固定 code・分類・数値・真偽値だけを出すため、入力サイズに
        依存しない）。
      - |-
        持ち越し warning（Issue #796、本ラウンドでは是正しない）: TRUNCATED_FLAG_LOST_ON_FORCED_REAP。
        detach した書き手が FIFO の write 端を保持したまま 64 KiB を超える stderr が出た経路では、
        分類プロセスの強制回収により state_file が書かれず stderr_truncated=false となりうる。
        本ラウンドの独立検証はこの複合条件（detach と 64 KiB 超過の同時成立）を再現していないため、
        当該 warning に対する新たな確認も反証も与えていない。AC-2 が要求する「捕捉は 64 KiB で
        打ち切られ、外部診断は 4 KiB 以下で切り詰め有無を示す」ことは、上記の 65535/65536/65537/1 MiB の
        実測と 4 KiB 上限の実測により、detach を伴わない到達可能な入力で満たされている。

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 成功・失敗ともraw stderrと秘密値を外へ出さず
        隔離rootを削除する（Issue #744 AC-3/AC-8）: 成功（13219.19004ms）。成功経路と非ゼロ経路の双方で、
        reviewer が stderr へ出した偽秘密値が launcher の stdout/stderr に現れないこと、reviewer が観測した
        隔離 root が実行後に存在しないこと。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 別sessionへdetachした子がstderr FIFOを保持しても
        回収が停止しない（Issue #744 AC-3/AC-8）: 成功（6546.164113ms）。setsid で別 session へ detach した子が
        stderr FIFO の write 端を保持したまま reviewer が正常終了する反例を再現し、20秒未満で完了して
        隔離 root（＝複製した認証素材の置き場）が削除されること。
      - |-
        test/integration/gate-adapters.test.ts::gate reviewer credential boundary: caller HOME・Issue worktree・
        GitHub token・git/gh configをAI subprocessへ継承しない: 成功（隔離条件の非回帰）。
      - |-
        独立検証 IV744 AC-3「state_file は固定 grammar 3 key だけで raw/秘密値を含まない」: 成功
        （78.864661ms）。stderr へ秘密値を含む行を注入した後、隔離領域内 state_file の全内容が
        classification・stderr_bytes・stderr_truncated の3 key だけであり、注入した秘密値の断片を
        含まないことを実測した（分類器の出力面に raw を戻す経路が無いことの直接観測）。
      - |-
        独立検証 IV744 AC-3/AC-8「timeout 経路でも秘密値を出さず隔離 root を削除する」: 成功
        （13139.337653ms）。実装セグメントのテストが見ていない timeout 経路について、実装セグメントとは
        別の秘密値文字列を stderr へ出させたうえで、launcher の stdout/stderr に秘密値が現れないこと、
        reviewer が観測した隔離 root が実行後に存在しないこと、gate final=human_required になることを実測した。
      - |-
        独立検証 IV744 AC-8「成功経路は verdict を返し診断を生成しない」: 成功（6822.544648ms）。
        成功経路でも stderr の秘密値が外へ出ず、隔離 root が削除され、かつ launcher 出力に
        `classification=` を含む診断文字列自体が生成されないことを実測した。
      - |-
        追跡対象ファイルの非汚染: 本ラウンドの commit は VALIDATION.md 単独である
        （上記「検証対象の実装 SHA と、本成果物を載せるコミットの関係」の
        `git diff --name-only` と `git status --porcelain` の実出力を参照）。reviewer が出力した
        raw stderr、prompt、reviewer stdout の一時ファイル、複製した認証素材はいずれも隔離 root の
        内側にのみ存在し、隔離 root は全経路で削除されるため追跡対象へは一切入らない。

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::reviewer failure envelope: allowlist検証不能時は固定分類とrcだけへ
        縮退する（Issue #744 AC-4）: 成功（15.503535ms）。
        `classification=MODEL_UNAVAILABLE;stderr_truncated=false;raw=secret-fragment` のように許可外
        フィールドが混入した内部診断を与えると、出力が `classification=EXECUTION_FAILURE rc=41` へ縮退し、
        混入断片が現れず 4096 バイト以下であること。
      - |-
        独立検証 IV744 AC-4「envelope は独自の混入値でも分類と rc だけへ縮退する」: 成功（348.84314ms）。
        実装テストとは別の混入値で次を実測した。許可外 key `token=iv744-secret` の混入 →
        `classification=EXECUTION_FAILURE rc=41`、完全非該当 `AZURE_KEY=...` → `... rc=7`、
        未知 classification `DISK_FULL` → `classification=EXECUTION_FAILURE rc=9`、
        rc が非整数（`rc; rm -rf /`）→ `classification=EXECUTION_FAILURE rc=1`、
        attempts=0 → `classification=TIMEOUT rc=124`、attempts が非数値 →
        `classification=AUTHENTICATION_FAILURE rc=42`。正常入力では truncated=true が保持される。
        いずれの縮退経路でも混入した文字列断片が出力に現れない。
      - |-
        縮退時に承認へ倒れないことの根拠: AC-4 の縮退は _reviewer_failure_envelope の内部で起き、
        呼び出し側の rc とゲート状態遷移を変えない。独立検証は launcher 経由の失敗3経路
        （認証失敗 retry・timeout・明示 model の model unavailable、IV744 AC-8／AC-3・AC-8／AC-6）で
        いずれも gate final=human_required・exit≠0 になることを実測しており、診断の生成に失敗しても
        approved へ倒れる経路が無いことを裏づける。なお AC-4 が要求する「stderr 内容の省略と
        分類・終了コードだけの出力」自体は、上記の envelope 直接駆動で確定している。

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 組込み既定のmodel unavailableを安全な専用診断に
        する（Issue #744 AC-1/AC-5）: 成功（9349.061377ms）。CODEX_REVIEWER_MODEL 未指定の non-core で
        model unavailable を注入すると外部診断が code=NONCORE_DEFAULT_MODEL_UNAVAILABLE になること。
      - |-
        test/integration/gate-adapters.test.ts::codex launch_gate_reviewer: 既定起動はread-only sandboxと
        high-capabilityモデルを使う: 成功（6974.956342ms）。non-core 既定 model が gpt-5.6-sol であることを固定。
      - |-
        独立検証 IV744 AC-5「non-core 既定は gpt-5.6 を渡さず gpt-5.6-sol を渡す（stub 受領 argv で実測）」:
        成功（9306.11866ms）。-m の受領値を1行1引数で記録する codex exec 互換 stub を CODEX_EXECUTABLE で
        差し込み、CODEX_REVIEWER_MODEL 未指定で起動した。stub が受領した argv の `-m` の次要素が
        `gpt-5.6-sol` であり、汎用名 `gpt-5.6` が argv のどこにも現れないこと、その model の
        model unavailable に対する外部診断が
        code=NONCORE_DEFAULT_MODEL_UNAVAILABLE classification=MODEL_UNAVAILABLE rc=41 attempts=1
        stderr_truncated=false であり gate final=human_required になることを実測した。
      - |-
        独立検証 IV744 AC-5「NONCORE_DEFAULT_MODEL_UNAVAILABLE の成立条件を分岐ごとに実測する」: 成功
        （251.623737ms）。envelope の分岐を環境変数で直接駆動し、adapter=codex かつ
        core_review_required≠true かつ model 選択元=default のときだけ NONCORE_DEFAULT_MODEL_UNAVAILABLE と
        なり、model 選択元=explicit・core_policy、core_review_required=true、adapter=claude では
        REVIEWER_MODEL_UNAVAILABLE のままであることを実測した。
      - |-
        持ち越し warning（Issue #796、本ラウンドでは是正しない）: NONCORE_DEFAULT_CODE_OVERCLAIM。
        CODEX_REVIEWER_CMD / GATE_REVIEWER_CMD による完全 override 経路でも ASC_CODEX_MODEL_SOURCE=default が
        export されるため、組込み既定と異なる model の unavailable も「組込み既定が利用不能」と読める
        診断になりうる、というレビュアの指摘である。本ラウンドの独立検証はこの完全 override 経路での
        model 選択元を再現していないため、当該 warning に対する新たな確認も反証も与えていない。
        AC-5 の Then（reviewer 起動に暗黙の `gpt-5.6` を使わず、利用不能時は
        NONCORE_DEFAULT_MODEL_UNAVAILABLE と判別できる）は、上記の stub 受領 argv による実測と
        分岐ごとの実測により、model 未指定の到達可能な入力で満たされている。

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 明示model overrideを無改変で最優先にする
        （Issue #744 AC-6）: 成功（7500.151288ms）。CODEX_REVIEWER_MODEL に明示した値が codex exec 互換 stub の
        受領引数へ一致し、既定へ置換されないこと。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 区切り文字を含む明示modelのmodel unavailableを
        誤分類しない（Issue #744 AC-1/AC-6）: 成功（7665.365021ms）。`vendor/model` が無改変で reviewer へ渡り、
        その model の model unavailable が MODEL_UNAVAILABLE になること。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 引用符・空白・バックスラッシュを含む値を
        TOML層とshell層の両方で無改変に渡す（Issue #744）: 成功（5701.682397ms）。
        test/integration/worker-adapters.test.ts::codex launch_worker: 引用符・空白・バックスラッシュを含む値を
        TOML層とshell層の両方で無改変に渡す（Issue #744）: 成功（2203.627235ms）。reviewer 経路・worker 経路の
        双方で、stub が受領した argv の model_reasoning_effort を TOML basic string として復号すると原文へ
        戻ること、静的 config 引数に手書き escape 由来の余分なバックスラッシュが混入しないこと。
      - |-
        独立検証 IV744 AC-6「ADR-0079 が定める identifier 集合の境界を実測する」: 成功（1377.940274ms）。
        成立する側として `vendor/model`・`org:model`・`model+preview`・`org/team/model:2026-08+preview`・
        `Vendor/Model-V2`・記号のみの identifier・128 byte ちょうどを、成立しない側として 129 byte・
        空白入り・タブ入り・DEL(0x7F) 入り・非ASCII を実測し、いずれも ADR-0079 の Decision および
        DESIGN.md D2 の記述と一致した。
      - |-
        独立検証 IV744 AC-6「実装テストと別の敵対的値でも TOML 層・shell 層が無改変で通る」: 成功
        （7121.827901ms）。実装テストが使う値とは別に、単一引用符・二重引用符・空白・バックスラッシュ・
        区切り記号を同時に含む reasoning effort（`hi'gh "x" a\b c`）と model（`ns/mod:v1+beta "q" \z`）を
        到達可能な環境変数から与え、stub が受領した argv で -m が1引数として原文どおりであること、
        model_reasoning_effort が妥当な TOML basic string として復号できて原文へ戻ること、
        静的 config 5引数（approval_policy・shell_environment_policy.inherit・
        shell_environment_policy.include_only・default_permissions・permissions.review.filesystem）が
        無改変で届くこと、prompt を stdin から読む末尾の `-` が失われないことを実測した。gate は approved。
      - |-
        独立検証 IV744 AC-6「明示 model が shell metacharacter を含んでも評価されず無改変で渡る」: 成功
        （7624.489189ms）。コマンド置換・バッククォート・パイプ・リダイレクト・グロブを含む次の値を
        明示 model として与えた（引用符を含まないため identifier 集合の内側にある）。

            ns/$(id)`id`|&;<>*?[]{}~!#%^model

        stub が受領した argv の -m の次要素がこの値と完全一致すること、argv のどこにも id(1) の
        実行結果（`uid=` を含む文字列）が現れない＝組立て時にコマンド置換が評価されないこと、
        外部診断が code=REVIEWER_MODEL_UNAVAILABLE であり NONCORE_DEFAULT_MODEL_UNAVAILABLE へ
        倒れないこと、gate final=human_required になることを実測した。
      - |-
        持ち越し warning（Issue #796、本ラウンドでは是正しない）: TOML_CONTROL_CHAR_NOT_ESCAPED。
        _codex_toml_basic_string は `\` と `"` だけを escape し、改行・タブ等の制御文字を escape しない。
        本ラウンドの独立検証は制御文字を含む設定値を入力に用いていないため、当該 warning に対する
        新たな確認も反証も与えていない。AC-6 が要求する「明示値が変更されず最優先で reviewer へ渡り、
        暗黙既定へ置換されない」ことは、単一引用符・二重引用符・空白・バックスラッシュ・
        shell metacharacter を含む上記の全入力で成立している。

  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::codex core reviewer: gpt-5.6-sol/xhigh/read-onlyのattested
        overrideだけを許可する: 成功（6356.137871ms）。
      - |-
        test/integration/gate-adapters.test.ts::codex core reviewer: modelまたはeffortの不一致は起動せず
        human_requiredへ止める: 成功（3927.880058ms）。
      - |-
        test/integration/gate-adapters.test.ts::claude core reviewer: 能力attestationまたはreasoning probe不足は
        human_requiredへ止める: 成功（5538.743358ms）。
      - |-
        test/integration/gate-adapters.test.ts::gate-launch-reviewer: core reviewをstandardで起動すると
        adapter前にhuman_requiredへ止める: 成功（4828.149268ms）。
      - |-
        独立検証 IV744 AC-7「core review は policy 不一致時に reviewer を起動せず human_required で止まる」:
        成功（16024.372837ms）。review_subject=core_audit・profile=strict の3条件（(a) model 不一致、
        (b) reasoning effort 不一致、(c) 完全 command 上書きの attestation 不足）それぞれで、
        reviewer stub の引数ログが1件も生成されない（＝reviewer が一度も起動されない）こと、
        gate final=human_required・exit≠0 となること、診断に NONCORE_DEFAULT_MODEL_UNAVAILABLE が
        現れない（＝non-core の既定解決で代替されない）ことを実測した。

  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts 全48件成功・0件失敗。認証 probe（認証不成立・env 資格情報の
        引継ぎ・設定ディレクトリ複製）、read-only 隔離（caller HOME・GitHub token・git/gh config の非継承、
        symlink 脱出不可）、watchdog（TERM を無視する reviewer のプロセスグループ KILL）、
        不正 timeout 値の起動前拒否、再試行、非ゼロ終了、never-approved、human_required、成功時 verdict、
        起動ラッパーの終了コード分岐（0/3/その他）がいずれも回帰していない。
        同じ隔離実行経路を共有する test/integration/gate-credential-store.test.ts（分類C・外部資格情報
        ストア限定構成、Issue #758）も全件成功しており、stderr 分類の追加が当該経路を壊していない。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 別sessionへdetachした子がstderr FIFOを保持しても
        回収が停止しない（Issue #744 AC-3/AC-8）: 成功（6546.164113ms）。
      - |-
        独立検証 IV744 AC-8「retry 回数が診断の attempts と一致し、never-approved が維持される」: 成功
        （7762.75887ms）。GATE_REVIEWER_RETRIES=3 で認証 signature を出して rc=55 で終わる reviewer を起動し、
        stub が実際に3回起動されたこと（試行ごとに追記したカウンタが3行）、外部診断が
        code=REVIEWER_AUTHENTICATION_FAILURE classification=AUTHENTICATION_FAILURE rc=55 attempts=3
        stderr_truncated=false であること、gate final=human_required になることを実測した。
      - |-
        独立検証 IV744 AC-8「成功経路は verdict を返し診断を生成しない」: 成功（6822.544648ms）。
        成功経路で gate final=approved・exit 0 という既存挙動が維持され、診断が生成されず、
        隔離 root が削除されることを実測した。
      - |-
        独立検証 IV744 AC-3/AC-8「timeout 経路でも秘密値を出さず隔離 root を削除する」: 成功
        （13139.337653ms）。watchdog による打ち切りで rc=124・classification=TIMEOUT・
        gate final=human_required・exit≠0 となり隔離 root が削除されること。
      - |-
        全件回帰: npm test で tests 1441 / pass 1440 / fail 0 / skip 1。前回検証 SHA 7a14bc69 の時点は
        1426件であり15件増えている。増分の主因は main のマージが持ち込んだ Issue #751 の新規ファイル
        test/integration/gate-reviewer-prompt-input-closure.test.ts（10件）と、本ブランチが 163f538 で
        追加した TOML 層／shell 層の回帰テスト2件（gate-adapters.test.ts・worker-adapters.test.ts 各1件）
        である。`git diff --name-status --diff-filter=D 7a14bc69 98ebfd0` は出力なしであり、
        この区間で削除されたファイルは1件も無い（＝既存テストの削除による見かけ上の pass は生じていない）。

regression:
  executed: true
  evidence:
    - 'npm test（対象 SHA 98ebfd0bc724f4a5cd6b9ec05e463462b7f2da75、独立検証の一時ファイル無し）: tests 1441 / pass 1440 / fail 0 / cancelled 0 / skipped 1 / todo 0 / duration_ms 601919.88822、プロセス終了コード 0'
    - 'npm test（同 SHA + 独立検証14件を一時ファイルとして追加）: tests 1455 / pass 1454 / fail 0 / cancelled 0 / skipped 1 / todo 0 / duration_ms 820270.315323、プロセス終了コード 0。独立検証14件はすべて pass'
    - 'npm run build（pretest として2回実行、tsc）: いずれも成功'
    - 'npm run typecheck（tsc --noEmit -p tsconfig.test.json）: 成功。tsconfig.test.json の include は src/**/*.ts と test/**/*.ts であり、独立検証の一時ファイルも型検査の対象に含めたうえで成功している'
    - 'test/integration/gate-adapters.test.ts（Issue #744 の主対象）: 48件中 48件成功・0件失敗。うち Issue #744 由来は11件'
    - 'test/integration/worker-adapters.test.ts の codex launch_worker 群: 全件成功。Issue #797 として分離済みの WORKER_CMD 漏洩による偽陽性8件は本ラウンドで再現せず'
    - 'skip 1件は「GitHub導入元へ実際に到達してpackage versionを取得できる」（ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 指定時のみ動く live 到達性の opt-in テスト）であり、本Issueの変更経路を通らない'
    - '本セグメントでローカル実行した機械検査（いずれも VALIDATION.md 書き換え後、終了コード 0・違反出力なし）: verify ac-coverage ISSUE-744 / verify artifacts ISSUE-744 --started-segments spec,design,implementation,validation / verify spec-bdd SPEC.md / verify design-diagram DESIGN.md / verify adr docs/adr/ADR-0079-reviewer-model-identifier-charset-ascii-visible.md / verify adr docs/adr/ADR-0076-bounded-reviewer-stderr-and-noncore-codex-model-default.md / verify doc-length / verify template-sync / lint vocab / lint references / lint adr check / lint secrets --diff origin/main'
    - 'PR #792 の Check Run（head 98ebfd0bc724f4a5cd6b9ec05e463462b7f2da75）: agent-skill-chain / ci の verify が SUCCESS（2026-08-19T08:47:53Z 完了）。同ジョブは verify-branch-name・verify-worktree-path・verify-template-sync・verify-artifacts・verify-spec-bdd・verify-design-diagram・verify-ac-coverage・verify-adr・lint-vocab・lint-references・lint-secrets・adr-lint を実行する'
    - 'PR #792 の Check Run（同 head）: agent-skill-chain / config documentation sync の verify-config-doc-sync が SUCCESS（2026-08-19T08:47:49Z 完了）、CodeRabbit が SUCCESS'
