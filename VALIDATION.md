# 正本: AGENTS.md §不変条件I7
#
# ISSUE-462: codex CLI: stdinへ渡すpromptが約64KB付近でUTF-8マルチバイト文字の
# 境界破損を起こし起動失敗する — validation segment 実施結果。
# フィールドは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）と完全一致させること。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-462
target_sha: 4d8ab1889befa9a37dfc0c1430b86e3c0657a9b8

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts: 'codex launch_worker: role_contractが安全閾値を超える場合は位置引数で全文を渡し、外側redirectがあってもstdinを空にする（ISSUE-462 AC-1/AC-3）'"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts: 'codex launch_worker: role_contractが安全閾値以下の場合は従来どおり末尾-とstdinで渡す（ISSUE-462 AC-2）'"
      - "test/integration/worker-adapters.test.ts: 'codex launch_worker: CODEX_WORKER_CMD完全上書きは設定由来のモデル・閾値解決そのものを行わせない（AC-2, ISSUE-462 AC-4）'（既存stdin経由の回帰確認を含む）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts: 'codex launch_worker: role_contractが安全閾値を超える場合は位置引数で全文を渡し、外側redirectがあってもstdinを空にする（ISSUE-462 AC-1/AC-3）'（model・reasoning effort・sandbox network_accessの一致をargv上で検証）"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/worker-adapters.test.ts: 'codex launch_worker: CODEX_WORKER_CMD完全上書きは設定由来のモデル・閾値解決そのものを行わせない（AC-2, ISSUE-462 AC-4）'"
      - "test/integration/worker-adapters.test.ts: 'codex launch_worker: WORKER_CMD完全上書きも閾値判定より優先される（ISSUE-462 AC-4）'"

  - ac_id: AC-5
    verification:
      mode: hybrid
      result: pass
      reason: "実際のCodex CLI（codex exec本体）のstdin UTF-8境界破損不具合を発生させないことは、CIで用いるcodexスタブ（stub実行系）では検証できない（スタブはstdin読み取り実装自体を模倣していない）ため、実バイナリへの手動起動確認を要する。"
      procedure: |-
        1. .agent-skill-chain/adapters/claude.sh・codex.sh をsourceし、
           _worker_default_cmd implementation "$contract" を、AGENTS.md+DESIGN.md+PLAN.md+
           SPEC.md+ADR-0032（日本語マルチバイト文字を多く含む、計69200バイト。実測破損境界
           65534バイトおよび既定閾値32768バイトの双方を超える）を contract として呼び出し、
           実際に組み立てられるコマンド文字列（-- 位置引数 + 末尾 </dev/null）を取得した。
        2. 呼び出し元 claude.sh: launch_worker の外側redirect（bash -c "$worker_cmd" <"$prompt_file"）
           を再現するため、git init 済みの隔離された一時ディレクトリ（/tmp配下、対象リポジトリ外）で
           timeout 40 bash -c "$CMD" < contract.txt を実行し、CODEX_AUTH_PROBE_CMD=true以外は
           worker-launch.sh を経由しない直接実行としたうえで、実際の codex（v0.146.0、
           ChatGPTログイン済み）バイナリへ到達させた。
        3. 起動直後のstderrに「Failed to read prompt from stdin: input is not valid UTF-8」が
           process起動レベルのエラーとして出力されないこと（OpenAI Codexバナー・workdir・model・
           sandbox・reasoning effort・session idが正常に表示され、以降 role_contract 全文が
           "user" ターンとして正常に受理・エコーされること）、および </dev/null の効果により
           プロンプト本文中に外側redirect由来の追加 <stdin> ブロックが出現しないことを確認した
           （実応答は実際のLLM呼び出しのため長時間かかるためtimeoutで打ち切り、起動可否のみを
           確認対象とした）。
        4. 検証は対象リポジトリ外の一時ディレクトリで実施し、生成物（一時契約ファイル・実行ログ）は
           作業固有の一時メモとしてリポジトリへコミットしていない（本規約「対象外」節）。
      executor: validation_worker（claude, 対話セッション内で直接実行）
    evidence:
      - "手動実機確認: codex-cli v0.146.0 / model gpt-5.6-terra / reasoning effort medium / contract 69200バイト（マルチバイト文字含む） / 起動コマンド末尾 -- <quoted contract> </dev/null / 結果: 「Failed to read prompt from stdin: input is not valid UTF-8」エラー発生せず正常起動、追加<stdin>ブロックの混入も無し"
      - "上記procedure欄に記載の手順で再現可能（実行ログ自体は対象外の一時生成物のためリポジトリ非追跡）"

regression:
  executed: true
  evidence:
    - "npm test（node --test、test/unit + test/integration 全体、target_sha 4d8ab1889befa9a37dfc0c1430b86e3c0657a9b8 で実行）: 888 tests, 887 pass, 1 fail"
    - "唯一の失敗: test/integration/worker-adapters.test.ts 'worker-launch.sh: 複数issue worktree並存下でmainの絶対パスから起動しても対象worktreeへ再実行し、そのHEADで完了確認する（ISSUE-442 AC-1, AC-2, AC-3, AC-5）'。design-gate完了時点のcommit db06453e（本Issueのadapter変更を含まない）でも同一テストを単独実行し同一エラー（対象worktreeへ再実行後も実行位置が一致しない）で再現することを確認済みであり、本Issueの変更（codex.sh/claude.shのprompt伝達経路変更）による回帰ではない、環境依存の既存問題である。"
