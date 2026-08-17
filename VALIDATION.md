# 独立検証レポート（セグメント④・validation-gate 入力）
#
# 対象: ISSUE-721「bash_direct ディスパッチが提示する起動コマンドを常に実行可能にする」
# 形式: .agent-skill-chain/schemas/validation-report.schema.yaml（agent-skill-chain/validation-report/v1）
#       に完全一致する純YAML。見出し相当はコメントで表現する。
#
# target_sha は本レポートが検証した実装状態のコミットである（本レポート自身のコミットはこれより
# 後になる）。前ラウンドの検証対象は 349683e91a32c12d868ae628551c83448e0cc737 であり、そこで
# AC-3 を fail と判定した。本ラウンドは是正コミット 1da2e61 を対象に再実行した結果である。
#
# 検証環境（本レポートの全結果はこの環境での実測である）:
#   Linux / bash / node --test（npm test = build + test/unit + test/integration 全件）
#   getconf ARG_MAX = 2097152、Linux の単一引数長上限 MAX_ARG_STRLEN = 131072 バイト
#
# 総合判定: 全6ACが pass。回帰は既存の不安定テスト1件のみが fail（本 Issue 起因ではない。後述）。
#
# ---- 前ラウンド fail だった AC-3 の再検証（独立実測） ----
# 前ラウンドは、閾値超過時に起動コマンドがコマンド置換で contract 本文を単一の argv 要素へ展開し、
# execve が MAX_ARG_STRLEN 超過で E2BIG となってワーカーが起動しないことを実測した。是正後は
# dispatch 経路（contract_file 指定時）が本文サイズによらず常に `<base> - < <contract.mdのパス>`
# を返し、本文は通常ファイルから標準入力へ渡る。
#
# 本ワーカーはテストスイートとは独立に、adapter を直接呼び出す最小ハーネスで両実装を同一入力で
# 実測した（敵対的入力集合の全要素を含む本文を 140,101 バイトまで反復。前ラウンドで E2BIG を
# 観測した 140,019 バイトおよび本 Issue の起点となった実障害 138,274 バイトのいずれも上回る）。
#
#   是正後（1da2e61 の codex.sh）:
#     生成コマンド長 313 バイト / 本文断片を含まない / bash -n 通過 / 実行 exit 0
#     Codex が受け取ったバイト列の SHA256 = 405d1ffe8213fb29bd35ab35c1e11e1eb3a4c13d94ec684017cdf620a44adbc1
#     （contract.md の値と一致）、行数 2487（一致）、受領バイト数 140101（欠落なし）
#     argv には本文が現れず末尾要素は `-` のみ。
#   是正前（72747b9 の codex.sh、同一入力・同一ハーネス）:
#     生成コマンド長 578 バイト / bash -n は通過するが実行は exit 126、
#     stderr「引数リストが長すぎます」（E2BIG）。標準入力は捕捉されない＝ワーカー未起動。
#
# 同ハーネスを閾値以下（1,014 バイト）でも実行し、SHA256・行数・バイト数の一致と exit 0 を確認した。
# すなわち「前ラウンドの破壊を確実に検出する検証手段」が是正後には通り、是正前には落ちる。
#
# ---- 回帰実行で残る唯一の fail（本 Issue とは無関係） ----
# test/unit/paths.test.ts の「repoRoot: .git がどこにも見つからない場合は例外を投げる（AC-2）」は、
# os.tmpdir() の祖先に .git が存在しないことを暗黙の前提にしている。本ラウンドの実行中、別セッション
# の並行テストが残した空ディレクトリ /tmp/.git（作成時刻を実測）が存在したため、当該前提が崩れて
# 失敗した。TMPDIR を /tmp 外の清浄なディレクトリへ向けて同ファイルを単独実行すると tests 10 /
# pass 10 / fail 0 となる。本ブランチは origin/main との差分に src/paths.ts も test/unit/paths.test.ts
# も含まないため（差分は claude.sh・codex.sh・worker-launch.sh・AGENT_TOOL_DISPATCH.md・SPEC.md・
# VALIDATION.md・test/integration/worker-adapters.test.ts の7ファイル）、本 Issue に起因する回帰では
# ない。既に別 Issue として起票済みである。
#
# ---- 非 blocking の観測事項（origin: implementation、severity: warning） ----
# .agent-skill-chain/adapters/claude.sh の codex 分岐直前に、是正前の設計を説明したコメントが
# 残っている（「小さいcontractはstdin redirect、大きいcontractは実行時にcontract.mdを読み込む
# 位置引数とし」）。当該コメントは ae5657d で追加され、位置引数経路を廃した 1da2e61 で更新され
# なかった。現在の実装は dispatch 経路でサイズ分岐を持たず、常に標準入力へ渡す。どの AC の成否
# にも影響しないため本レポートは全 AC を pass とするが、記述が実装と逆であり、読んだ者が E2BIG を
# 再導入する誘因になりうる。なお codex.sh 側の同趣旨のコメントは是正済みで実装と一致している。
#
# ---- 参考（AC-6 手動突き合わせの副産物、info） ----
# .agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md の「dispatch一時ディレクトリ」の説明は
# contract.sha256 の保持項目として SHA256・行数・DISPATCH_STARTED_AT・DISPATCH_TOKEN を挙げるが、
# 実装が書き出し verify が照合する STARTED_SHA に触れていない。AC-6 が対象とする「起動コマンドの
# 提示位置・抽出規則・失敗時の扱い」には含まれないため判定には用いていない。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-721
target_sha: 1da2e61267de79023f946e1160e130d868b03c69

acceptance_criteria:
  # 任意のcontract本文でも起動コマンドが構文として妥当（本文断片を含まない・両サイズ条件）
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test: Agent tool dispatch (ISSUE-721 AC-1/AC-2/AC-3, ISSUE-647 AC-1/AC-2): 閾値超過の敵対的contractをstdinで対象worktreeのCodexへ渡す — PASS（閾値を1バイトへ下げた超過条件。bash -n 通過、コマンドにcontract固有断片を含まないことを2種の文字列で確認）"
      - "npm test: Agent tool dispatch (ISSUE-721 AC-1/AC-2/AC-3): 小さい敵対的contractもcontract.mdから同一バイト列で渡す — PASS（閾値以下条件）"
      - "独立ハーネス実測（テストスイート外）: 敵対的入力集合を全て含む140,101バイトの本文で生成されたコマンドは313バイト、生の改行0本、bash -n 通過、本文断片『行中 CODEX_CMD= token』を含まない。1,014バイトの本文でも同結果"

  # 起動コマンドの範囲が一意に抽出できる（行頭CODEX_CMD=がちょうど1本・promptは再掲しない）
  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test: Agent tool dispatch (ISSUE-721 AC-1/AC-2/AC-3, ISSUE-647 AC-1/AC-2): 閾値超過の敵対的contractをstdinで対象worktreeのCodexへ渡す — PASS（contract本文が行頭 CODEX_CMD= を含む状態で、出力全体の行頭 CODEX_CMD= 一致数がちょうど1。prompt行は codex exec を含まず正本行の抽出規則のみを指す）"
      - "npm test: Agent tool dispatch (ISSUE-721 AC-1/AC-2/AC-3): 小さい敵対的contractもcontract.mdから同一バイト列で渡す — PASS（同上に加え、抽出したコマンドが本文の『行中 CODEX_CMD= token』を含まないことを確認）"

  # 起動時に渡るcontractが監査値と一致する（閾値以下・超過の双方。前ラウンドfailの再検証対象）
  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test: Agent tool dispatch (ISSUE-721 AC-3): 単一引数長上限を超えるcontractでも本文長に起因して起動が失敗しない — PASS（MAX_ARG_STRLEN 131,072バイトおよび前ラウンド実測の140,019バイトを超える本文で、抽出したコマンドを実行し、Codexが受け取ったバイト列のSHA256とCONTRACT_SHA256、行数とCONTRACT_LINESの一致を確認）"
      - "npm test: Agent tool dispatch (ISSUE-721 AC-1/AC-2/AC-3, ISSUE-647 AC-1/AC-2): 閾値超過の敵対的contractをstdinで対象worktreeのCodexへ渡す — PASS（閾値超過条件でSHA256・行数一致）"
      - "npm test: Agent tool dispatch (ISSUE-721 AC-1/AC-2/AC-3): 小さい敵対的contractもcontract.mdから同一バイト列で渡す — PASS（閾値以下条件でSHA256・行数一致）"
      - "独立ハーネス実測（テストスイート外）: 140,101バイトの本文で実行 exit 0、受領SHA256 405d1ffe8213fb29bd35ab35c1e11e1eb3a4c13d94ec684017cdf620a44adbc1・行数2487・バイト数140101が contract.md と一致。同一ハーネスを是正前（72747b9）のcodex.shに適用すると exit 126・stderr『引数リストが長すぎます』（E2BIG）となり標準入力は捕捉されない＝検証手段が前ラウンドの破壊を確実に検出する"

  # 妥当性検査失敗時は安全側（renew停止・一時資源削除・lease解放・exit 5）へ倒す
  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test: Agent tool dispatch (ISSUE-721 AC-4/AC-6): 検証時限定の構文エラー注入はrenew・一時資源・leaseを後始末してexit 5へ倒す — PASS（終了コード5、日本語診断の標準エラー出力、dispatch一時ディレクトリの空化、psによるrenewプロセス不在確認、直後のlease再取得成功、CODEX_CMD=行・AGENT_TOOL_DISPATCH_REQUIRED行の非出力を確認。有効化条件を与えない対照実行では終了コード4と正本行が提示される）"

  # 既存経路（claude dispatch・非dispatch・verifyの完了判定契約）が回帰しない
  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test 全件: tests 1257 / pass 1255 / fail 1 / skipped 1。唯一のfailは本Issueの差分が触れていない test/unit/paths.test.ts の実行環境依存の既存不安定テスト"
      - "npm test: Agent tool dispatch (ISSUE-448 AC-1/AC-4/AC-8, ISSUE-665 AC-1/AC-2/AC-4): Claude向けcontractへdispatchトークンを埋め込み監査メタデータを返す — PASS（claude adapterのdispatch経路が不変）"
      - "npm test: codex launch_worker: role_contractが安全閾値を超える場合は位置引数で全文を渡し、外側redirectがあってもstdinを空にする（ISSUE-462 AC-1/AC-3） — PASS（非dispatch経路の閾値超過時の既存挙動が不変）"
      - "npm test: codex launch_worker: role_contractが安全閾値以下の場合は従来どおり末尾-とstdinで渡す（ISSUE-462 AC-2） — PASS"
      - "npm test: worker-launch-verify (ISSUE-448 AC-3): renew停止を確認してからleaseを解放する / PID再利用を検知した場合は無関係プロセスをkillしない / renew.pid不在でもkillを試みず正常にreport照合へ進む — いずれもPASS（完了判定契約が不変）"
      - "npm test: Agent tool dispatch (ISSUE-609 AC-3): adapter: humanまたは未知値はlease解放のうえエラーを返し、AIを自動起動しない — PASS"

  # 運用手順書が実出力と一致する（自動部分＋手動突き合わせ）
  - ac_id: AC-6
    verification:
      mode: hybrid
      result: pass
      reason: "抽出規則の識別子と失敗時終了コードの二重定義の乖離は自動検出できるが、進行役が推測せず実行できる程度に説明が整合しているかの判断は自動化できない"
      procedure: "自動: .agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md が行頭固定プレフィックス CODEX_CMD= と終了コード 5 を記載していることをテストで検査し、同一の行・終了コードが実出力に現れることを同テスト内で照合する。手動: 手順書のcodex手順（実行手順・出力/完了条件・制約/異常時の扱い）を通読し、起動コマンドの提示位置・抽出規則・失敗時の扱いを実出力および実装の分岐と突き合わせる"
      executor: "validation_worker（claude）"
    evidence:
      - "npm test: Agent tool dispatch (ISSUE-721 AC-4/AC-6): 検証時限定の構文エラー注入はrenew・一時資源・leaseを後始末してexit 5へ倒す — PASS（手順書が『行頭固定プレフィックス`CODEX_CMD=`』と『終了コード`5`』を記載していることを検査し、同一実行内で実出力の終了コード5・CODEX_CMD=行非出力・対照実行の終了コード4と正本行提示を照合）"
      - "手動突き合わせ結果: 一致。codex手順の記述『role_contract本文は起動コマンドや位置引数へ展開されず、contract.mdの通常ファイルから標準入力へredirectする codex exec ... - < <contract.mdのパス> の形に解決済み。この経路は本文サイズにかかわらず同一で、単一引数長の上限に起因する起動失敗は発生しない』は、独立ハーネスで実測した生成コマンドの形（cd <worktree> && <codex> exec ... - < <contract.mdのパス>）およびサイズ非依存の挙動と一致する。前ラウンドで指摘した『本文長に起因する起動失敗が失敗時の扱いに未記載』は解消済み"
      - "手動突き合わせ結果: 終了コード体系の記載（0=非dispatch完了、3=human deferred、4=dispatch要求、5=bash_direct起動コマンドの構文検査失敗、その他=エラー）が worker-launch.sh 冒頭の伝播規定と一致する"

regression:
  executed: true
  evidence:
    - "npm test（build + test/unit + test/integration 全件、対象 1da2e61）: tests 1257 / pass 1255 / fail 1 / cancelled 0 / skipped 1 / duration_ms 1136166"
    - "唯一のfail: test/unit/paths.test.ts『repoRoot: .git がどこにも見つからない場合は例外を投げる（AC-2）』。並行実行中の別プロセスが残した空ディレクトリ /tmp/.git により os.tmpdir() の祖先探索が .git を発見したことによる。TMPDIR を /tmp 外の清浄ディレクトリへ向けた単独実行では tests 10 / pass 10 / fail 0"
    - "本ブランチと origin/main の差分は .agent-skill-chain/adapters/claude.sh・.agent-skill-chain/adapters/codex.sh・.agent-skill-chain/scripts/worker-launch.sh・.agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md・SPEC.md・VALIDATION.md・test/integration/worker-adapters.test.ts の7ファイルのみで、src/paths.ts・test/unit/paths.test.ts を含まない"
    - "前ラウンド（349683e）のベースライン: tests 1256 / pass 1255 / fail 0 / skipped 1。本ラウンドの tests 1257 との差は受入テストの構成変更による"
