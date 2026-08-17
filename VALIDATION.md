# 独立検証レポート（セグメント④・validation-gate 入力）
#
# 対象: ISSUE-721「bash_direct ディスパッチが提示する起動コマンドを常に実行可能にする」
# 形式: .agent-skill-chain/schemas/validation-report.schema.yaml（agent-skill-chain/validation-report/v1）
#       に完全一致する純YAML。見出し相当はコメントで表現する。
#
# ---- target_sha と本レポート自身のコミットの関係（ゲート判定の前提） ----
# target_sha は、本レポートに記録した全結果を実際に実行したときのブランチ先端 SHA である。
# 本レポート自身のコミットは VALIDATION.md 以外のファイルを一切変更しない。したがってゲートの
# 判定対象（本レポートのコミット）と target_sha の差分は VALIDATION.md のみであり、レビュアは
# 与えられた差分だけでこの事実を機械的に確認できる。すなわち本レポートの全証跡は判定対象 SHA の
# 実装状態にそのまま適用できる。
#
# ---- 本ラウンドの位置づけ ----
# 前ラウンド（validation round 1）の validation-gate は rejected であった。指摘は2件で、いずれも
# origin: validation（本レポートの記述・実行時点の問題）であった。
#   TARGET_SHA_MISMATCH: 判定対象がブランチ先端 c2be5ef8c48d55bfbbab4c62cffe5d84cc94e958 であるのに
#     本レポートの target_sha が 1da2e61267de79023f946e1160e130d868b03c69 のままで、証跡が判定対象へ
#     適用可能であることを機械的に確認できなかった。差の実体は main 取り込みのマージであった。
#   AC4_CLEANUP_UNPROVEN: AC-4 の evidence 文が、テストが実際に検査している内容より弱い記述で
#     あった（一時ディレクトリ自体の非存在・ワーカー非起動の立証が読み取れなかった）。
# 本ラウンドは、ブランチ先端 c2be5ef8c48d55bfbbab4c62cffe5d84cc94e958 の状態で受入検証・回帰検証を
# すべて実行し直した結果である。AC-4 の evidence は、テストの検査内容と一致する形へ書き直した
# （テストコードは変更していない。現行テストで当該性質は既に検査済みである）。
#
# 検証環境（本レポートの全結果はこの環境での実測である）:
#   Linux / bash / node --test（npm test = build + test/unit + test/integration 全件）
#   getconf ARG_MAX = 2097152、Linux の単一引数長上限 MAX_ARG_STRLEN = 131072 バイト
#
# 総合判定: 全6ACが pass。回帰は fail 0 件。
#
# ---- AC-3（本 Issue の中心要求）の独立実測 ----
# 是正後の dispatch 経路（contract_file 指定時）は本文サイズによらず常に
# `<base> - < <contract.mdのパス>` を返し、本文は通常ファイルから標準入力へ渡る。本ワーカーは
# テストスイートとは独立に、adapter を直接呼び出す最小ハーネスで判定対象 SHA の実装を実測した
# （敵対的入力集合の全要素を含む本文。前ラウンドで E2BIG を観測した 140,019 バイトおよび本 Issue の
# 起点となった実障害 138,274 バイトのいずれも上回る長さを用いた）。
#
#   閾値超過条件（contract.md = 140,068 バイト / 2,476 行 /
#     SHA256 39026071fdf05a12a3324d15cd913c82d52024e018b56209659debe79da38155）:
#     生成コマンド 552 バイト / 生の改行バイト 0 / bash -n 通過 / 実行 exit 0
#     Codex が受け取ったバイト列の SHA256・行数・バイト数が contract.md と一致、argv 末尾要素は `-`
#     のみで本文は argv に現れない。
#   閾値以下条件（contract.md = 1,020 バイト / 20 行 /
#     SHA256 e859495d27e1c27bfa370709949ef59648f7270a85e52c2644a9d0dc7d70e9cd）:
#     生成コマンド 547 バイト / 生の改行バイト 0 / bash -n 通過 / 実行 exit 0 / 同一性一致。
#   対照（是正前 72747b9 の adapter、同一入力・同一ハーネス）:
#     生成コマンド 689 バイト / bash -n は通過するが実行は exit 126、
#     stderr「引数リストが長すぎます」（E2BIG）。標準入力は捕捉されない＝ワーカー未起動。
# すなわち本検証手段は、前ラウンドで実在した破壊を確実に検出する能力を持ったうえで、判定対象 SHA
# では通る。
#
# ---- 前ラウンドで観測した不安定テストの本ラウンドでの挙動 ----
# 前ラウンドは test/unit/paths.test.ts の「repoRoot: .git がどこにも見つからない場合は例外を投げる
# （AC-2）」が fail した。原因は os.tmpdir() の祖先に別プロセスが残した空ディレクトリ /tmp/.git が
# 存在したことであり、本 Issue の差分とは無関係である（本ブランチの差分に src/paths.ts も
# test/unit/paths.test.ts も含まない）。本ラウンドの実行時は当該ディレクトリが存在せず、同テストは
# pass した。既に別 Issue として起票済みである。
#
# ---- 非 blocking の観測事項（origin: implementation、severity: warning） ----
# .agent-skill-chain/adapters/claude.sh の codex 分岐直前に、是正前の設計を説明したコメントが
# 残っている（「小さいcontractはstdin redirect、大きいcontractは実行時にcontract.mdを読み込む
# 位置引数とし」）。現在の実装は dispatch 経路でサイズ分岐を持たず、常に標準入力へ渡す。どの AC の
# 成否にも影響しないため本レポートは全 AC を pass とするが、記述が実装と逆であり、読んだ者が E2BIG を
# 再導入する誘因になりうる。なお codex.sh 側の同趣旨のコメントは是正済みで実装と一致している。
# 本ラウンドの是正範囲（VALIDATION.md のみ）に含まれないため、修正は行っていない。
#
# ---- 参考（AC-6 手動突き合わせの副産物、info） ----
# .agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md の「dispatch一時ディレクトリ」の説明は
# contract.sha256 の保持項目として SHA256・行数・DISPATCH_STARTED_AT・DISPATCH_TOKEN を挙げるが、
# 実装が書き出し verify が照合する STARTED_SHA に触れていない。AC-6 が対象とする「起動コマンドの
# 提示位置・抽出規則・失敗時の扱い」には含まれないため判定には用いていない。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-721
target_sha: c2be5ef8c48d55bfbbab4c62cffe5d84cc94e958

acceptance_criteria:
  # 任意のcontract本文でも起動コマンドが構文として妥当（本文断片を含まない・両サイズ条件）
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test: Agent tool dispatch (ISSUE-721 AC-1/AC-2/AC-3, ISSUE-647 AC-1/AC-2): 閾値超過の敵対的contractをstdinで対象worktreeのCodexへ渡す — PASS（閾値を1バイトへ下げた超過条件。bash -n 通過、コマンドにcontract固有断片を含まないことを2種の文字列で確認）"
      - "npm test: Agent tool dispatch (ISSUE-721 AC-1/AC-2/AC-3): 小さい敵対的contractもcontract.mdから同一バイト列で渡す — PASS（閾値以下条件）"
      - "独立ハーネス実測（テストスイート外、判定対象SHAの実装）: 敵対的入力集合を全て含む140,068バイトの本文で生成されたコマンドは552バイト、生の改行バイト0、bash -n 通過、本文断片（行頭CODEX_CMD=行の残り・行中CODEX_CMD=トークンを含む語・非ASCII文字列）をいずれも含まない。1,020バイトの本文でもコマンド547バイトで同結果"

  # 起動コマンドの範囲が一意に抽出できる（行頭CODEX_CMD=がちょうど1本・promptは再掲しない）
  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test: Agent tool dispatch (ISSUE-721 AC-1/AC-2/AC-3, ISSUE-647 AC-1/AC-2): 閾値超過の敵対的contractをstdinで対象worktreeのCodexへ渡す — PASS（contract本文が行頭 CODEX_CMD= を含む状態で、出力全体の行頭 CODEX_CMD= 一致数がちょうど1。prompt行は codex exec を含まず正本行の抽出規則のみを指す）"
      - "npm test: Agent tool dispatch (ISSUE-721 AC-1/AC-2/AC-3): 小さい敵対的contractもcontract.mdから同一バイト列で渡す — PASS（同上に加え、抽出したコマンドが本文の『行中 CODEX_CMD= token』を含まないことを確認）"
      - "npm test: Agent tool dispatch (ISSUE-721 AC-3): 単一引数長上限を超えるcontractでも本文長に起因して起動が失敗しない — PASS（同テスト内で出力全体の行頭 CODEX_CMD= 一致数がちょうど1であることを検査）"

  # 起動時に渡るcontractが監査値と一致する（閾値以下・超過の双方）
  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test: Agent tool dispatch (ISSUE-721 AC-3): 単一引数長上限を超えるcontractでも本文長に起因して起動が失敗しない — PASS（MAX_ARG_STRLEN 131,072バイトおよび前ラウンド実測の140,019バイトを下回らない本文で、抽出したコマンドを実際に実行し、Codexが受け取ったバイト列のSHA256とCONTRACT_SHA256、行数とCONTRACT_LINESの一致、およびargv末尾が `-` で本文がargvへ展開されないことを確認）"
      - "npm test: Agent tool dispatch (ISSUE-721 AC-1/AC-2/AC-3, ISSUE-647 AC-1/AC-2): 閾値超過の敵対的contractをstdinで対象worktreeのCodexへ渡す — PASS（閾値超過条件でSHA256・行数一致）"
      - "npm test: Agent tool dispatch (ISSUE-721 AC-1/AC-2/AC-3): 小さい敵対的contractもcontract.mdから同一バイト列で渡す — PASS（閾値以下条件でSHA256・行数一致）"
      - "独立ハーネス実測（テストスイート外、判定対象SHAの実装）: 140,068バイトの本文で実行 exit 0、受領SHA256 39026071fdf05a12a3324d15cd913c82d52024e018b56209659debe79da38155・行数2,476・バイト数140,068が contract.md と一致。1,020バイトの本文でも受領SHA256 e859495d27e1c27bfa370709949ef59648f7270a85e52c2644a9d0dc7d70e9cd・行数20・バイト数1,020が一致。同一ハーネスを是正前（72747b9）のadapterへ適用すると exit 126・stderr『引数リストが長すぎます』（E2BIG）となり標準入力は捕捉されない＝本検証手段は前ラウンドの破壊を確実に検出する"

  # 妥当性検査失敗時は安全側（ワーカー非起動・renew停止・一時資源削除・lease解放・exit 5）へ倒す
  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test: Agent tool dispatch (ISSUE-721 AC-4/AC-6): 検証時限定の構文エラー注入はrenew・一時資源・leaseを後始末してexit 5へ倒す — PASS。同テストが検査する内容とAC-4の各項の対応は次のとおり。(a) ワーカー非起動: bash_direct dispatch においてワーカーは、進行役が正本行 CODEX_CMD= のコマンドを実行することによってのみ起動する。テストは標準出力に行頭 CODEX_CMD= の行が1本も現れないこと、AGENT_TOOL_DISPATCH_REQUIRED 行も現れないことを検査し、かつ終了コード5で停止することを検査する。起動の唯一の契機が出力されず停止するため、ワーカーは起動しない。(b) 日本語診断: 標準エラーに『シェル構文が妥当でないため、ワーカーを起動せず停止しました』が現れることを検査。(c) renewプロセス停止: ps -eo args= の全プロセス行のうち当該dispatch一時ディレクトリのパスを含む行が0件であることを検査。(d) 一時ディレクトリの削除: テストは dispatch 一時ディレクトリの生成先である親ディレクトリを TMPDIR として与え、実行後にその親ディレクトリの内容一覧が空であることを検査する。dispatch 一時ディレクトリそのものが contract.md・contract.sha256・renew.pid ごと削除されディレクトリが存在しない場合にのみこの検査は成立し、内容だけを取り除いてディレクトリの殻を残す実装は親ディレクトリに当該ディレクトリが列挙されるため成立しない。(e) lease解放: 実行直後に同一Issueへ lease acquire が成功し、続く lease release も成功することを検査。(f) 終了コード: 5であることを検査。(g) 固定プレフィックス非出力: 上記(a)と同一の検査。"
      - "npm test: 同テストの対照実行 — PASS（注入点の有効化条件を与えない同一設定では素材の差し替えが作用せず、終了コード4と正本行 CODEX_CMD= が提示される。すなわち注入点は検証時に限定され、正常運用時には無効である）"

  # 既存経路（claude dispatch・非dispatch・verifyの完了判定契約）が回帰しない
  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test 全件（判定対象 c2be5ef8c48d55bfbbab4c62cffe5d84cc94e958）: tests 1283 / pass 1282 / fail 0 / skipped 1"
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
      - "手動突き合わせ結果: 一致。codex手順の記述『role_contract本文は起動コマンドや位置引数へ展開されず、contract.mdの通常ファイルから標準入力へredirectする codex exec ... - < <contract.mdのパス> の形に解決済み。この経路は本文サイズにかかわらず同一で、単一引数長の上限に起因する起動失敗は発生しない』は、独立ハーネスで実測した生成コマンドの形（<codex> exec ... - < <contract.mdのパス>）およびサイズ非依存の挙動と一致する"
      - "手動突き合わせ結果: 終了コード体系の記載（0=非dispatch完了、3=human deferred、4=dispatch要求、5=bash_direct起動コマンドの構文検査失敗、その他=エラー）が worker-launch.sh 冒頭の伝播規定と一致する"

regression:
  executed: true
  evidence:
    - "npm test（build + test/unit + test/integration 全件、判定対象 c2be5ef8c48d55bfbbab4c62cffe5d84cc94e958）: tests 1283 / suites 0 / pass 1282 / fail 0 / cancelled 0 / skipped 1 / todo 0 / duration_ms 721083.056842"
    - "唯一のskipは『GitHub導入元へ実際に到達してpackage versionを取得できる』（ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 を指定した場合だけ live 到達性を確認する既定skip）"
    - "前ラウンドで唯一 fail した test/unit/paths.test.ts『repoRoot: .git がどこにも見つからない場合は例外を投げる（AC-2）』は本ラウンドでは PASS。前ラウンドの fail は os.tmpdir() の祖先に別プロセスが残した空ディレクトリ /tmp/.git による実行環境依存であり、本 Issue の差分に起因しない"
    - "本ブランチと origin/main の差分は .agent-skill-chain/adapters/claude.sh・.agent-skill-chain/adapters/codex.sh・.agent-skill-chain/scripts/worker-launch.sh・.agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md・SPEC.md・VALIDATION.md・test/integration/worker-adapters.test.ts の7ファイルのみで、src/paths.ts・test/unit/paths.test.ts を含まない"
    - "前ラウンド（1da2e61）のベースライン: tests 1257 / pass 1255 / fail 1 / skipped 1。本ラウンドの tests 1283 との差は、判定対象 c2be5ef が main を取り込んだことによる他 Issue のテスト追加分であり、本 Issue の差分による増減ではない"
