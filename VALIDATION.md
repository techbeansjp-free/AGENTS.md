# 独立検証レポート（セグメント④・validation-gate 入力）
#
# 対象: ISSUE-721「bash_direct ディスパッチが提示する起動コマンドを常に実行可能にする」
# 形式: .agent-skill-chain/schemas/validation-report.schema.yaml（agent-skill-chain/validation-report/v1）
#       に完全一致する純YAML。見出し相当はコメントで表現する。
#
# 検証環境（本レポートの全結果はこの環境での実測である）:
#   Linux / bash / node --test（npm test = build + test/unit + test/integration 全件）
#   getconf ARG_MAX = 2097152、Linux の単一引数長上限 MAX_ARG_STRLEN = 131072 バイト
#
# 総合判定: AC-3 が fail。他5件は pass。
#
# ---- AC-3 fail の内容（差し戻し先の判断材料。origin: implementation） ----
# 要求「起動コマンドを実行した結果ワーカーへ渡る contract 本文が contract.md と完全に一致する。
# この一致は標準入力安全閾値以下・超過の双方で成立する」のうち、超過側が実サイズ帯で成立しない。
#
# 実装は閾値超過時に、起動コマンドへ本文を直接埋め込む代わりにコマンド置換で contract.md を
# 読み、その結果を Codex CLI の位置引数へ渡す形を採っている。コマンド文字列には本文が現れない
# ため「埋め込まない」要求は満たすが、実行時には本文全体が単一の argv 要素へ展開される。
# Linux は execve の単一引数長を ARG_MAX とは別に MAX_ARG_STRLEN（131072 バイト）で制限する
# ため、本文がこれを超えると execve が E2BIG（「引数リストが長すぎます」）で失敗し、ワーカーが
# 起動しない。`bash -n` は当該コマンドを構文として妥当と判定するので、要件が定める提示前の
# 構文検査（唯一の検査条件）ではこの失敗を検出できず、終了コード 5 の安全側フォールバックにも
# 落ちない。すなわち「壊れる場合はワーカーを起動せずに検出・停止する」も成立しない。
#
# 実測: contract.md = 140,019 バイト（本 Issue の起点となった実障害は 138,274 バイト）で、
# worker-launch.sh は終了コード 4 と正本行 CODEX_CMD= を正常に提示し、抽出した文字列は
# bash -n を通過するが、そのまま実行すると execve が E2BIG で失敗する（bash が 126 を返す）。
# 32768 バイト未満の本文、および閾値を人為的に 1 バイトへ下げて小さい本文で超過側を再現した
# 既存の検証は成功するため、閾値超過側は「実サイズ帯でのみ」失敗する。
#
# 是正の方向（Issue #721 の Issue コメントで進行役が確定済み・本レポートは追認する）:
# 閾値超過側でも本文を argv へ展開せず、contract.md を標準入力へリダイレクトして渡す形にする。
# Codex CLI は PROMPT 位置引数を省略した場合 instructions を標準入力から読む。
#
# 是正時に併せて判断が必要な点（本レポートは判断せず、事実のみ記録する）: 閾値超過時に位置引数
# 経路を採る既存動作は、Codex CLI の標準入力での UTF-8 境界破損を回避する目的で導入されている。
# 標準入力へ寄せる是正はその回避を放棄することになる。dispatch 経路と非 dispatch 経路は別関数
# 経路であり、非 dispatch 経路の既存の閾値超過検証（位置引数で全文を渡し stdin を空にする）は
# dispatch 経路の是正では壊れない。
#
# ---- 回帰実行で観測した既存の不安定テスト（本 Issue とは無関係・要 follow-up） ----
# test/unit/paths.test.ts の「repoRoot: .git がどこにも見つからない場合は例外を投げる（AC-2）」
# は、os.tmpdir() の祖先に .git が存在しないことを暗黙の前提にしている。全件並列実行中に別の
# テストが /tmp/.git を一時的に作成するため、実行順序次第で偽陽性の失敗となる。単体実行では
# 常に成功する。この現象は本 Issue の変更を含まない main の全件実行中にも /tmp/.git の生成を
# 実測しており、本 Issue に起因する回帰ではない。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-721
target_sha: 349683e91a32c12d868ae628551c83448e0cc737

acceptance_criteria:
  # 任意のcontract本文でも起動コマンドが構文として妥当（本文断片を含まない）
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts: Agent tool dispatch (ISSUE-721 AC-1/AC-2/AC-3, ISSUE-647 AC-1/AC-2): 大きい敵対的contractを本文埋め込み無しで対象worktreeのCodexへ渡す"
      - "test/integration/worker-adapters.test.ts: Agent tool dispatch (ISSUE-721 AC-1/AC-2/AC-3): 小さい敵対的contractもcontract.mdから同一バイト列で渡す"
      - "test/integration/worker-adapters.test.ts: Agent tool dispatch (ISSUE-721 AC-3): 単一引数長上限を超えるcontractでも本文長に起因して起動が失敗しない（bash -n 通過部分のみ成立）"

  # 起動コマンドの範囲が一意に抽出できる（行頭CODEX_CMD=がちょうど1本）
  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts: Agent tool dispatch (ISSUE-721 AC-1/AC-2/AC-3, ISSUE-647 AC-1/AC-2): 大きい敵対的contractを本文埋め込み無しで対象worktreeのCodexへ渡す"
      - "test/integration/worker-adapters.test.ts: Agent tool dispatch (ISSUE-721 AC-1/AC-2/AC-3): 小さい敵対的contractもcontract.mdから同一バイト列で渡す"

  # 起動時に渡るcontractが監査値と一致する（閾値以下・超過の双方）。超過側が実サイズ帯で不成立。
  - ac_id: AC-3
    verification:
      mode: automated
      result: fail
    evidence:
      - "test/integration/worker-adapters.test.ts: Agent tool dispatch (ISSUE-721 AC-3): 単一引数長上限を超えるcontractでも本文長に起因して起動が失敗しない（FAIL: execve が E2BIG。contract.md 140,019バイト）"
      - "test/integration/worker-adapters.test.ts: Agent tool dispatch (ISSUE-721 AC-1/AC-2/AC-3): 小さい敵対的contractもcontract.mdから同一バイト列で渡す（閾値以下側はPASS）"

  # 妥当性検査失敗時は安全側（renew停止・一時資源削除・lease解放・exit 5）へ倒す
  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts: Agent tool dispatch (ISSUE-721 AC-4/AC-6): 検証時限定の構文エラー注入はrenew・一時資源・leaseを後始末してexit 5へ倒す"

  # 既存経路（claude dispatch・非dispatch・verifyの完了判定契約）が回帰しない
  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test 全件: 変更前 1256件中 fail 0、変更後（受入テスト追加後）は追加した AC-3 検証1件のみが fail"
      - "test/integration/worker-adapters.test.ts: Agent tool dispatch (ISSUE-448 AC-1/AC-4/AC-8, ISSUE-665 AC-1/AC-2/AC-4): Claude向けcontractへdispatchトークンを埋め込み監査メタデータを返す"
      - "test/integration/worker-adapters.test.ts: codex launch_worker: role_contractが安全閾値を超える場合は位置引数で全文を渡し、外側redirectがあってもstdinを空にする（ISSUE-462 AC-1/AC-3）"

  # 運用手順書が実出力と一致する（自動部分＋手動突き合わせ）
  - ac_id: AC-6
    verification:
      mode: hybrid
      result: pass
      reason: "抽出規則の識別子と失敗時終了コードの二重定義の乖離は自動検出できるが、進行役が推測せず実行できる程度に説明が整合しているかの判断は自動化できない"
      procedure: "自動: .agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md が行頭固定プレフィックス CODEX_CMD= と終了コード 5 を記載していることをテストで検査し、同一の行・終了コードが実出力に現れることを同テスト内で照合する。手動: 手順書のcodex手順を通読し、起動コマンドの提示位置・抽出規則・失敗時の扱いが実出力と一致するか突き合わせる"
      executor: "validation_worker（claude）"
    evidence:
      - "test/integration/worker-adapters.test.ts: Agent tool dispatch (ISSUE-721 AC-4/AC-6): 検証時限定の構文エラー注入はrenew・一時資源・leaseを後始末してexit 5へ倒す"
      - ".agent-skill-chain/standards/AGENT_TOOL_DISPATCH.md（codex手順・出力/完了条件の記述と実出力の突き合わせ結果: 一致。ただし本文長に起因する起動失敗〔AC-3 fail〕は手順書の失敗時の扱いに記載が無く、是正後に追記が必要）"

regression:
  executed: true
  evidence:
    - "npm test（build + test/unit + test/integration 全件、変更前ベースライン）: tests 1256 / pass 1255 / fail 0 / skipped 1"
    - "npm test（受入テスト追加後）: tests 1257 / pass 1254 / fail 2。fail の内訳は AC-3 検証1件と、実行順序依存で偽陽性となる既存テスト test/unit/paths.test.ts の repoRoot 検証1件（単体実行では成功、main の全件実行中にも同じ /tmp/.git 生成を実測）"
