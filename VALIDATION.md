# 由来: AGENTS.mdが定める不変条件I7（仕様⇔検証の追跡）の規約に基づく検証報告である。
#
# 目的: Issue ISSUE-744「Codex ゲートレビュアの起動失敗を安全に診断可能にする」の実装を、
#       実装セグメントとは独立に受入・統合・回帰の観点で検証し、SPEC.md が定める AC-1〜AC-8
#       それぞれの充足可否と証跡を確定する。
#
# 対象範囲: Codex/Claude アダプタが共有する隔離レビュア実行系（reviewer stderr の有界分類、
#       安全な失敗診断 envelope、隔離領域の削除）と、Codex non-core レビュアの model 解決、
#       および既存フェイルセーフ（認証 probe・watchdog・再試行・非ゼロ終了・never-approved・
#       human_required）の非回帰。
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
#
# 入力: SPEC.md（AC-1〜AC-8）、DESIGN.md、PLAN.md、対象 SHA 7a14bc691dc4c1a1370094a0695cc4c661845867
#       の実装（.agent-skill-chain/adapters/claude.sh・codex.sh）と自動テスト。
# 出力: 本ファイルの acceptance_criteria（AC ごとの検証方法・結果・証跡）と regression。
#
# 検証対象の実装 SHA と、本成果物を載せるコミットの関係:
#   本ファイルが書く「対象 SHA」「target_sha」「regression の npm test の対象」はいずれも、独立検証を
#   実施した実装コミット 7a14bc691dc4c1a1370094a0695cc4c661845867 を指す。本ファイル自身は、それを追加する
#   コミットの SHA を内容として持てない（コミット SHA は本ファイルの内容を入力として決まるため）。
#   そこで SHA を書く代わりに、次の不変を成果物内に宣言する。
#
#   不変: 本成果物を追加するコミットは、検証対象の実装 SHA 7a14bc691dc4c1a1370094a0695cc4c661845867 に
#   VALIDATION.md のみを追加した差分であり、実装ファイル（.agent-skill-chain/ 配下・src/ 配下・test/ 配下を
#   含む）を一切変更しない。SPEC.md・DESIGN.md・PLAN.md も変更しない。したがって AC-1〜AC-8 の evidence と
#   regression の結果は、実装内容が同一である本成果物のコミットに対してもそのまま適用可能である。
#
#   根拠（本セグメントで再実行した実際の出力の原文引用）:
#
#     $ git diff --stat 7a14bc691dc4c1a1370094a0695cc4c661845867 be6869746962e62149399a66a29ccdb89b98e714
#      VALIDATION.md | 270 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++
#      1 file changed, 270 insertions(+)
#
#     $ git log --oneline 7a14bc69..be686974
#     be68697 validation(ISSUE-744): AC-1〜AC-8の独立検証結果と回帰実行証跡を記録する
#
#     $ git diff --name-only 7a14bc691dc4c1a1370094a0695cc4c661845867 be6869746962e62149399a66a29ccdb89b98e714
#     VALIDATION.md
#
#     $ git merge-base --is-ancestor 7a14bc69 be686974; echo "exit=$?"
#     exit=0
#
#     $ git rev-list --count 7a14bc69..be686974
#     1
#
#   上記の be6869746962e62149399a66a29ccdb89b98e714 は本改訂の直前 HEAD である。本改訂は AC-1〜AC-8 の
#   検証内容・結果・証跡と実装コードを一切変更せず、本ファイルへ SHA 関係の記述だけを追記したものであり、
#   直前 HEAD の上に VALIDATION.md 単独の変更として重なる。commit 直前の作業ツリー状態がそれを示す:
#
#     $ git status --porcelain
#      M VALIDATION.md
#
#   よって実装 SHA から本成果物のコミットまでの累積差分は VALIDATION.md に閉じており、上記の不変は
#   本改訂でも成立する。実装 SHA は本成果物のコミットの祖先であり、両者の実装内容は同一である。
#
# 全ACに共通する検証環境（個々のACのevidenceでは繰り返さない）:
#   - ホスト: Linux / bash 5 / Node.js 20系 / setsid(1) 利用可。branch bugfix/744-codex-reviewer-stderr-diagnostics。
#   - 自動テスト: npm test（pretest で npm run build を実行）。1426件中 pass 1425・fail 0・skip 1。
#     skip 1件は ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 指定時だけ動く live 到達性の opt-in テストであり、
#     本Issueの変更経路を通らない既存テストである。
#   - 対象統合テスト単独実行: test/integration/gate-adapters.test.ts は 47件中 47件成功・0件失敗。
#   - 独立検証で追加実行した観測: 本セグメントが実装セグメントのテストとは別の入力を与えて
#     .agent-skill-chain/scripts/gate-launch-reviewer.sh と分類器を直接駆動したもの。以下 evidence 中で
#     「独立検証」と明記する。実装は一切変更していない。
#
# codex CLI の実起動について（進行役の指示に対する回答）:
#   本Issueの対象は codex レビュア経路の診断保全であるが、codex のクォータ枯渇（2026-08-21 04:25 まで）
#   により codex CLI の実起動は行えない。ただし AC-1〜AC-8 のいずれも実 CLI の起動成功を Then に
#   置いておらず、SPEC.md は「実サービスや実資格情報への疎通を前提にしない」ことを制約として明記している。
#   代替検証手段として、(a) CODEX_REVIEWER_CMD による完全 command 上書き、(b) CODEX_EXECUTABLE による
#   codex exec 互換 stub（受領した -m の値をログし、その値を含む model unavailable の stderr を出して
#   非ゼロ終了する）、(c) 分類器関数 _reviewer_classify_stderr への stdin 直接注入、の3経路を用いた。
#   実 codex CLI でしか観測できないのは「実在 model slug が実サービス側で利用可能か」だけであり、
#   これは SPEC.md がスコープ外とする実サービスの可用性保証に該当する。
#
# 独立検証で観測した事実（origin 付き。実装の是正は行わず進行役の判断へ委ねる）:
#   1. origin=design / 重大度=warning / DESIGN_MODEL_ID_CHARSET_DIVERGENCE:
#      accepted な DESIGN.md の設計判断 D2 と accepted な ADR-0076 は、model identifier を
#      `[a-z0-9][a-z0-9._-]{0,127}` に制限すると記述する。実装は「引用符以外の非空白可視文字・128字以内」
#      を受理する。乖離は実装セグメントが implementation-gate round 1 の blocking
#      MODEL_ID_CHARSET_FALSE_NEGATIVE を是正した結果であり、SPEC.md の AC-6（任意の明示 model
#      identifier を許可）と AC-1（その model unavailable を判別）を満たすには実装側の集合が必要である。
#      したがって実装の挙動は SPEC 適合であり、陳腐化しているのは DESIGN.md・ADR-0076 の記述である。
#      成果物の自己完結性・追跡可能性（I1）の観点で、superseding ADR 等による整合は別途必要と判断する。
#   2. origin=design / 重大度=info / 分類器の安全側縮退の境界:
#      model identifier に空白・引用符・非ASCIIバイトを含む stderr 行は model signature を成立させず
#      EXECUTION_FAILURE へ縮退する（独立検証で実測）。これは DESIGN.md D2 が定める「行全体の完全一致」
#      および「原因を推測せず EXECUTION_FAILURE」に一致する意図された挙動であり、欠陥ではない。
#      いずれの経路でも gate は human_required であり silent approval は生じない。
#
# 未決事項: 上記1の DESIGN.md・ADR-0076 の整合方法（superseding ADR の要否）は進行役の判断事項。
# 対象外: Issue #751 の prompt 入力閉包、Issue #715 の verdict stdout secret 検査と実行パス信頼境界、
#         Claude 固有の認証成立条件・model 選択、実サービス疎通、provider CLI の将来互換層。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-744
target_sha: 7a14bc691dc4c1a1370094a0695cc4c661845867

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::reviewer stderr classifier: model/authの完全一致だけを
        相互排他的に分類する（Issue #744 AC-1）（model 4形式は MODEL_UNAVAILABLE、auth 7形式は
        AUTHENTICATION_FAILURE、`unknown option for model command`・suffix追加・model/auth複合はいずれも
        EXECUTION_FAILURE。成功）
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 組込み既定のmodel unavailableを安全な専用診断に
        する（Issue #744 AC-1/AC-5）（stub reviewer に model unavailable と偽秘密値を注入し、外部診断が
        code=NONCORE_DEFAULT_MODEL_UNAVAILABLE classification=MODEL_UNAVAILABLE rc=41 attempts=2
        stderr_truncated=false になること、偽秘密値が出力に現れないことを検証。成功）
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: chunk分割された認証失敗をretry後の固定診断に
        する（Issue #744 AC-1/AC-8）（signature を2回の write に分割しても
        classification=AUTHENTICATION_FAILURE rc=42 attempts=2 になることを検証。成功）
      - |-
        独立検証（分類器へ stdin 直接注入、実装セグメントのテストとは別入力）: model 4形式・auth 7形式が
        設計どおり相互排他に分類される一方、先頭空白付き・末尾空白付き・行頭 prefix 付き・空 identifier・
        identifier 内空白・model+auth 複合・auth+model 複合はすべて EXECUTION_FAILURE へ縮退した。
        終端改行の無い最終行と CRLF 終端は完全一致として扱われ、ASCII case 非依存であることも確認した。
      - |-
        独立検証（gate-launch-reviewer.sh を stub reviewer で起動）: 認証 signature を出して rc=55 で終わる
        reviewer を retries=3 で実行し、外部診断が
        code=REVIEWER_AUTHENTICATION_FAILURE classification=AUTHENTICATION_FAILURE rc=55 attempts=3
        stderr_truncated=false となり、gate final=human_required・exit≠0 になることを確認した。
        timeout 経路では code=REVIEWER_TIMEOUT classification=TIMEOUT rc=124 となり、他の3分類と判別できた。

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::reviewer stderr classifier: 64 KiBだけを検査し、超過後も入力を
        drainする（Issue #744 AC-2）（65536バイトちょうどで stderr_truncated=false、65537バイトで
        stderr_bytes=65536・stderr_truncated=true。上限位置を偽の行末として完全一致を成立させないことも検証。成功）
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 64 KiB超過をraw非保持でdrainし外部診断へ
        truncatedを示す（Issue #744 AC-2）（65537バイトの stderr を出して rc=43 で終わる reviewer に対し、
        外部診断が classification=EXECUTION_FAILURE rc=43 attempts=1 stderr_truncated=true となり、
        外部診断全体が 4096 バイト以下であることを検証。成功）
      - |-
        独立検証（分類器へ stdin 直接注入）: 65536バイト → stderr_bytes=65536・truncated=false、
        65537バイト → stderr_bytes=65536・truncated=true、1048576バイト（1 MiB）→ stderr_bytes=65536・
        truncated=true。1 MiB 入力でも停止せず終端した（上限超過分を raw 非保持で読み捨てる経路の実測）。
      - |-
        独立検証（launcher 実行時の外部診断サイズ実測）: timeout 経路の launcher stderr は 214 バイトであり、
        4 KiB 上限に対して十分小さい。envelope 関数へ attempts=999999999 を与えた場合も 111 バイトであった。

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 成功・失敗ともraw stderrと秘密値を外へ出さず
        隔離rootを削除する（Issue #744 AC-3/AC-8）（成功経路と非ゼロ経路の双方で、reviewer が stderr へ出した
        偽秘密値が launcher の stdout/stderr に現れないこと、reviewer が観測した隔離 root が実行後に存在しない
        ことを検証。成功）
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 別sessionへdetachした子がstderr FIFOを保持しても
        回収が停止しない（Issue #744 AC-3/AC-8）（setsid で別 session へ detach した子が stderr FIFO の write
        端を保持したまま reviewer が正常終了する反例を再現し、20秒未満で完了して隔離 root が削除されることを
        検証。実装セグメントの是正前は子の生存時間ぶん停止し、隔離領域内の複製認証ファイルが残っていた。成功）
      - |-
        test/integration/gate-adapters.test.ts::gate reviewer credential boundary: caller HOME・Issue worktree・
        GitHub token・git/gh configをAI subprocessへ継承しない（隔離条件の非回帰。成功）
      - |-
        独立検証（launcher を stub reviewer で起動、実装セグメントとは別の秘密値文字列を使用）: (a) timeout 経路
        （秘密値を stderr へ出した後 sleep し watchdog で打ち切り）、(b) 成功経路（秘密値を stderr へ出しつつ
        verdict を返す）の双方で、launcher の stdout/stderr に秘密値が現れず、reviewer が観測した隔離 root が
        実行後に存在しないことを確認した。成功経路では診断文字列自体が生成されない（classification= を含まない）
        ことも併せて確認した。

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::reviewer failure envelope: allowlist検証不能時は固定分類とrcだけへ
        縮退する（Issue #744 AC-4）（`classification=MODEL_UNAVAILABLE;stderr_truncated=false;raw=secret-fragment`
        のように許可外フィールドが混入した内部診断を与えると、出力が `classification=EXECUTION_FAILURE rc=41` へ
        縮退し混入断片が現れないこと、4096バイト以下であることを検証。成功）
      - |-
        独立検証（envelope 関数を直接駆動）: 内部診断が完全に非該当（`AWS_SECRET=...`）の場合も
        `classification=EXECUTION_FAILURE rc=7` へ縮退した。rc が非整数の場合は rc=1 へ、attempts が
        `^[1-9][0-9]*$` に非適合（0）の場合は classification と rc だけの固定文へ縮退した。
        いずれの縮退経路でも gate final=human_required・exit≠0 が維持される（AC-8 の証跡と同一実行で確認）。

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 組込み既定のmodel unavailableを安全な専用診断に
        する（Issue #744 AC-1/AC-5）（CODEX_REVIEWER_MODEL 未指定の non-core で model unavailable を注入すると
        外部診断が code=NONCORE_DEFAULT_MODEL_UNAVAILABLE になることを検証。成功）
      - |-
        test/integration/gate-adapters.test.ts::codex launch_gate_reviewer: 既定起動はread-only sandboxと
        high-capabilityモデルを使う（既定 model が gpt-5.6-sol であることを固定。成功）
      - |-
        独立検証（-m の受領値をログする codex exec 互換 stub を CODEX_EXECUTABLE で差し込み、
        CODEX_REVIEWER_MODEL 未指定で起動）: reviewer が受け取った引数列に gpt-5.6-sol が含まれ、
        汎用名 gpt-5.6 は含まれなかった。その model の model unavailable に対する外部診断は
        code=NONCORE_DEFAULT_MODEL_UNAVAILABLE classification=MODEL_UNAVAILABLE rc=41 attempts=1 であり、
        gate final=human_required になった。
      - |-
        独立検証（envelope 関数の分岐を直接駆動）: NONCORE_DEFAULT_MODEL_UNAVAILABLE は
        adapter=codex かつ core_review_required≠true かつ model 選択元=default のときだけ生成され、
        model 選択元=explicit・core_policy、および adapter=claude では REVIEWER_MODEL_UNAVAILABLE のままである。

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 明示model overrideを無改変で最優先にする
        （Issue #744 AC-6）（CODEX_REVIEWER_MODEL に明示した値が codex exec 互換 stub の受領引数へ
        一致すること、既定へ置換されないことを検証。成功）
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 区切り文字を含む明示modelのmodel unavailableを
        誤分類しない（Issue #744 AC-1/AC-6）（`vendor/model` が無改変で reviewer へ渡り、その model の
        model unavailable が MODEL_UNAVAILABLE になることを検証。実装セグメントの是正前は EXECUTION_FAILURE
        へ誤分類されていた。成功）
      - |-
        独立検証（shell metacharacter を含む明示 model の透過性）: CODEX_REVIEWER_MODEL に
        コマンド置換・パイプ・リダイレクト・引用符を含む値を与え、reviewer が受け取った引数がバイト単位で
        同一であること、および reviewer 起動コマンドの組立て時にコマンド置換が実行されないこと
        （stub の引数ログに id(1) の出力が現れないこと）を確認した。この経路の外部診断は
        code=REVIEWER_MODEL_UNAVAILABLE であり、NONCORE_DEFAULT_MODEL_UNAVAILABLE へは倒れなかった。
      - |-
        独立検証（identifier 文字集合の境界実測）: 空白・引用符を含まない可視文字だけからなる identifier
        （`ns/model;$(id)|&<>*?[]{}~!#%^`・`ns:model@v1`・128字ちょうど）は MODEL_UNAVAILABLE、
        129字・空白入り・引用符入り・タブ入り・非ASCIIは EXECUTION_FAILURE へ縮退した。
        本結果は上記コメント「独立検証で観測した事実」の1・2に対応する。AC-6 が要求する
        「明示値を無改変で最優先に渡す」ことはすべての入力で成立している。

  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts::codex core reviewer: gpt-5.6-sol/xhigh/read-onlyのattested
        overrideだけを許可する（core の完全 command 上書きは attestation が揃う場合だけ許可されることを検証。成功）
      - |-
        test/integration/gate-adapters.test.ts::codex core reviewer: modelまたはeffortの不一致は起動せず
        human_requiredへ止める（成功）
      - |-
        test/integration/gate-adapters.test.ts::claude core reviewer: 能力attestationまたはreasoning probe不足は
        human_requiredへ止める（成功）
      - |-
        test/integration/gate-adapters.test.ts::gate-launch-reviewer: core reviewをstandardで起動すると
        adapter前にhuman_requiredへ止める（成功）
      - |-
        独立検証（core_audit を review_subject に指定して strict で launcher を起動）: (a) model 不一致、
        (b) reasoning effort 不一致、(c) 完全 command 上書きの attestation 不足 の3条件それぞれで、
        reviewer stub が一度も起動されず（引数ログが生成されない）、gate final=human_required・exit≠0 となり、
        診断に NONCORE_DEFAULT_MODEL_UNAVAILABLE が現れない（non-core の既定解決で代替されない）ことを確認した。

  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-adapters.test.ts 47件全件成功。認証 probe（認証不成立・env 資格情報の引継ぎ・
        設定ディレクトリ複製）、read-only 隔離（caller HOME・GitHub token・git/gh config の非継承、symlink 脱出不可）、
        watchdog（TERM を無視する reviewer のプロセスグループ KILL）、再試行、非ゼロ終了、never-approved、
        human_required、成功時 verdict の既存挙動がいずれも回帰していないことを確認した。
      - |-
        test/integration/gate-adapters.test.ts::codex reviewer: 別sessionへdetachした子がstderr FIFOを保持しても
        回収が停止しない（Issue #744 AC-3/AC-8）（成功経路で watchdog・分類 drain の回収が停止せず、
        隔離 root が削除されることを検証。成功）
      - |-
        独立検証（timeout 経路の実測）: GATE_REVIEWER_TIMEOUT_SEC=3 で sleep する reviewer を起動し、
        rc=124・classification=TIMEOUT・gate final=human_required・exit≠0 となり隔離 root が削除されることを
        確認した。retries=3 の失敗経路では実際の試行回数 3 が診断の attempts と一致した。
      - |-
        全件回帰: npm test で 1426件中 pass 1425・fail 0・skip 1。skip 1件は live 到達性の opt-in テストであり、
        本Issueの変更経路を通らない。npm run build・npm run typecheck はいずれも成功。

regression:
  executed: true
  evidence:
    - 'npm test（対象 SHA 7a14bc691dc4c1a1370094a0695cc4c661845867）: tests 1426 / pass 1425 / fail 0 / skip 1'
    - 'npm run build（tsc）: 成功'
    - 'npm run typecheck（tsc --noEmit -p tsconfig.test.json）: 成功'
    - 'test/integration/gate-adapters.test.ts 単独実行: tests 47 / pass 47 / fail 0 / skip 0'
    - '.agent-skill-chain/scripts/lint-vocab.sh: 違反0件'
    - '.agent-skill-chain/scripts/lint-references.sh: 違反0件'
    - '.agent-skill-chain/ci/verify-doc-length.sh: 違反0件'
    - '.agent-skill-chain/scripts/adr-lint.sh check: 違反0件'
    - 'PR #792 の Check Run（agent-skill-chain / ci の verify、config documentation sync の verify-config-doc-sync）: いずれも pass'
