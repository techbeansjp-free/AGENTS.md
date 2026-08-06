# 正本: AGENTS.md §不変条件I7
#
# このファイルは Issue 毎に複製して使う雛形である（セグメント: validation、ゲート: validation-gate）。
# フィールドは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）と完全一致させること。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-429
target_sha: 74bb08b64255733a346e0afaf5d9552a6cbc31d1

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/verify.test.ts: 'verify config-doc-sync: スキーマの全トップレベル項目と見出しが一致すれば成功する' (node --test, ok 13)"
      - "node bin/agents-md.js verify config-doc-sync 実行結果: exit=0（着手時点のconfig.schema.yamlトップレベル17項目全てにdocs/CONFIGURATION.mdの`### `<key>`` 見出しが対応）"

  - ac_id: AC-2
    verification:
      mode: manual
      result: pass
      reason: "各エントリの5要素（見出し=設定名・既定値・取りうる値・影響・詳細リンク）の充足は文章内容の質的判断のため自動化不可"
      procedure: "docs/CONFIGURATION.mdの17見出し全てについて、'### `<key>`' 見出し・'**既定値**'・'**取りうる値**'・'**影響**'・'**詳細**' の出現数をawkで突合（各17件で一致を確認）した上で、各エントリの記述内容を目視確認した"
      executor: validation_worker (claude)
    evidence:
      - "docs/CONFIGURATION.md 「設定項目一覧」節（17項目、各見出しに既定値・取りうる値・影響・詳細リンクを記載）"
      - "awk突合結果: headings=17 既定値=17 取りうる値=17 影響=17 詳細=17"

  - ac_id: AC-3
    verification:
      mode: manual
      result: pass
      reason: "独立軸同士の関係整理の妥当性は文章内容の質的判断のため自動化不可"
      procedure: "docs/CONFIGURATION.mdの「独立な設定軸の関係」節を読み、autonomyとhuman_confirmation.*が独立軸であること、riskとautonomyの組み合わせがI8のstrict review発動条件（risk != normal OR autonomy == full）を導くことが明文化されているかを確認した"
      executor: validation_worker (claude)
    evidence:
      - "docs/CONFIGURATION.md 「独立な設定軸の関係」節（設定軸一覧表＋merge.autonomousとhuman_confirmation.before_implementationの極性差の説明を含む）"

  - ac_id: AC-4
    verification:
      mode: manual
      result: pass
      reason: "役割分担の記述内容・重複の有無の判断は自動化不可"
      procedure: "docs/ARCHITECTURE.md冒頭の「目的・対象範囲」節とdocs/CONFIGURATION.mdの「ARCHITECTURE.mdとの役割分担」節を突き合わせ、動作フロー図解（ARCHITECTURE.md）と設定項目一覧（CONFIGURATION.md）の役割分担が明記され実質的な重複記載が無いことを確認した"
      executor: validation_worker (claude)
    evidence:
      - "docs/ARCHITECTURE.md 冒頭「目的・対象範囲」節"
      - "docs/CONFIGURATION.md 「ARCHITECTURE.mdとの役割分担」節"

  - ac_id: AC-5
    verification:
      mode: manual
      result: pass
      reason: "SPEC.mdはautomatedを見込んでいたが、README.mdのリンク存在を機械的に検査する専用CIチェックは実装されていない（PLAN.md変更単位#2に対応テスト計画無し、src/commands/verify.tsのconfigDocSyncもREADME.mdは検査対象外）。目視+grepで直接確認した"
      procedure: "README.md「## 設定」節を確認し、docs/CONFIGURATION.mdへのリンクが含まれることをgrepで確認した"
      executor: validation_worker (claude)
    evidence:
      - "README.md:59: '全設定項目の既定値・取りうる値・影響は [docs/CONFIGURATION.md](docs/CONFIGURATION.md) に一覧化している。'"

  - ac_id: AC-6
    verification:
      mode: manual
      result: pass
      reason: "記載内容と実ファイルの一致確認は文章内容の質的突合のため自動化不可（AC-1/AC-7の機械検査は見出しの存在のみを検査し、既定値・取りうる値の内容一致は検査しない）"
      procedure: ".agent-skill-chain/config/agent-skill-chain.yaml と .agent-skill-chain/schemas/config.schema.yaml の全17トップレベル項目の実際値・許容値を読み、docs/CONFIGURATION.mdの対応する既定値・取りうる値の記載と突き合わせ、架空項目・存在しない既定値が無いことを確認した"
      executor: validation_worker (claude)
    evidence:
      - "docs/CONFIGURATION.md 「設定項目一覧」節と .agent-skill-chain/config/agent-skill-chain.yaml・.agent-skill-chain/schemas/config.schema.yaml の突合結果（不一致無し）"

  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/verify.test.ts: 'verify config-doc-sync: スキーマ側にのみ存在するトップレベル項目を報告して失敗する' (node --test, ok 14)"
      - "test/integration/verify.test.ts: 'verify config-doc-sync: バッククォートを欠く見出しは未記載として失敗する' (node --test, ok 15)"
      - ".github/workflows/agent-skill-chain-config-doc-sync.yml（pull_request起動、verify-config-doc-sync.sh実行）"

  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/verify.test.ts: 'verify config-doc-sync: workflowとその呼出しはconsumer向けテンプレートに存在しない' (node --test, ok 16)"
      - "find .agent-skill-chain/templates/github/.github -iname '*config-doc-sync*' 実行結果: 空（配布テンプレートに未混入）"
      - "node bin/agents-md.js verify template-sync 実行結果: exit=0（新設workflowの追加が既存template-sync検査を誤検知させない）"

  - ac_id: AC-9
    verification:
      mode: automated
      result: fail
      reason: "'node bin/agents-md.js lint references' は成功（exit=0）だが、'node bin/agents-md.js lint vocab' が失敗する（exit=1）。原因はsrc/lib/review-light.ts:60の禁止語'issue'誤検知であり、本Issueの変更差分（git diff main...HEAD --name-only）には同ファイルが含まれず、mainに既存の別バグ（GitHub Issue #469で追跡済み、2026-08-06起票、全PR CI恒久赤化の既知事象）に起因する。本Issueが新設・変更した対象（docs/CONFIGURATION.md・README.md・src/commands/verify.ts・src/lib/cli-routes.ts・.agent-skill-chain/ci/verify-config-doc-sync.sh・.github/workflows/agent-skill-chain-config-doc-sync.yml・test/integration/verify.test.ts）はlint vocab違反を1件も追加していないが、SPEC.md AC-9のThen（'いずれもエラー無しで終了する'）はコマンド全体の終了状態を要求しており、現状ではこの条件を満たさない"
      procedure: "node bin/agents-md.js lint vocab / node bin/agents-md.js lint references をリポジトリルートで実行した"
      executor: validation_worker (claude)
    evidence:
      - "node bin/agents-md.js lint vocab 実行結果: '/home/adachi/projects/AGENTS.md/src/lib/review-light.ts:60: 禁止語 'issue' が見つかりました（'成果物' を使用してください）' exit=1"
      - "node bin/agents-md.js lint references 実行結果: exit=0"
      - "git diff main...HEAD --name-only: src/lib/review-light.ts を含まない（本Issue差分は11ファイルのみ）"
      - "GitHub Issue #469 (OPEN): 'lint-vocab: gh CLIサブコマンド引数リテラル'issue'を禁止語として誤検知し全PR CIが恒久赤化する'（2026-08-06起票、本Issueと無関係の既存バグ）"

regression:
  executed: true
  evidence:
    - "npm run build（tsc）実行結果: 成功（型エラー無し）"
    - "node --import tsx --test $(find test/unit test/integration -name '*.test.ts') 初回実行: 787件中786 pass・1 fail（test/unit/paths.test.ts の 'repoRoot: .git がどこにも見つからない場合は例外を投げる（AC-2）'）"
    - "上記失敗テストの単体再実行（test/unit/paths.test.ts単独）: 3/3 pass（再現せず）。src/lib/paths.ts・test/unit/paths.test.ts は本Issue差分に含まれず、直近変更は2026-07マージ済みの別コミット(54ccc74e)であり、本Issueの変更とは無関係のorder依存フレーク"
    - "全787テストの再実行（2回目）: 787/787 pass（duration_ms 469098）。フレーク再現せず、リグレッション無しと判断"
    - "node bin/agents-md.js verify doc-length 実行結果: exit=0"
    - "node bin/agents-md.js verify template-sync 実行結果: exit=0"
