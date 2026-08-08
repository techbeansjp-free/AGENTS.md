# 正本: AGENTS.md §不変条件I7
#
# このファイルは Issue 毎に複製して使う雛形である（セグメント: validation、ゲート: validation-gate）。
# フィールドは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）と完全一致させること。
#
# 本ファイルは常に純粋なYAMLとして記述する（src/commands/verify.ts の acCoverage() が
# 本ファイル全体を単一YAML文書として readYamlFile() で読み込むため）。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-503
target_sha: 14a2d2a50f78f162b008f9ab014f2b097d9d4fea

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: hybrid
      result: pass
      reason: >-
        SPEC.mdの検証方法見込みどおりhybrid。AGENTS.md本体の各段落が「手続き（段階的な手順）を含まないか」の
        判定は目視確認を要し、行数上限は自動検査で担保する。
      procedure: >-
        (1) AGENTS.md本体（140行）を通読し、旧「4セグメント・4ゲート」節のASCIIフロー図（Issue作成→worktree作成→
        …→auto-mergeまたは人間マージ）と旧「設定」節の①〜⑥番号付き手順が除去され、それぞれSKILL.md
        （issue-start/segment-work/gate-review/pr-merge/cleanupおよびsegment-work）へ転記されていることを確認した。
        残存する各節（不変条件表・Coordination Backend・4セグメント対応表・役割権限とwriter lease・
        ブランチ/worktree命名規約・ゲートの継承無効化・ADRライフサイクル・成果物の自己完結性・
        参照コメントの陳腐化防止・docs/system-spec・GitHub配布・設定・プロジェクト固有ポリシー・
        ディレクトリ構成・用語）はいずれも「何を・いつ・なぜ」を定める事実・制約・原則の記述であり、
        「どのコマンドをどの順で呼ぶか」という段階的手順を含まないことを確認した。
        ディレクトリ構成節のroot直下許可リストに`.claude/`が追加されていることを確認した。
        (2) `.agent-skill-chain/ci/verify-doc-length.sh` を実行し終了コード0（AGENTS.md 140行が150行以内）
        であることを確認した。
      executor: validation_worker（Claude Code）
    evidence:
      - AGENTS.md（§ディレクトリ構成のroot直下許可リストに`.claude/`を含む140行、旧ASCIIフロー図・旧設定手順①〜⑥を含まない）
      - '.agent-skill-chain/ci/verify-doc-length.sh 実行結果: 終了コード0（AGENTS.md 140行 <= 150行上限）'
      - .agent-skill-chain/templates/claude/skills/issue-start/SKILL.md（ASCIIフロー図の該当範囲を転記）
      - .agent-skill-chain/templates/claude/skills/segment-work/SKILL.md（設定項目追加手順①〜⑥を転記）

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - .agent-skill-chain/templates/claude/skills/issue-start/SKILL.md
      - .agent-skill-chain/templates/claude/skills/segment-work/SKILL.md
      - .agent-skill-chain/templates/claude/skills/gate-review/SKILL.md
      - .agent-skill-chain/templates/claude/skills/pr-merge/SKILL.md
      - .agent-skill-chain/templates/claude/skills/cleanup/SKILL.md
      - "test/integration/init.test.ts: 'init: プロファイル未指定（既定）でも.claude/skills/配下に5つのSKILL.mdが配置され、profile: standardになる（AC-2, AC-3, AC-4）'"
      - "test/unit/legacy-migration.test.ts: 'detectLegacyAssets: ADR-0023新設の.agent-skill-chain/templates/claude/skills/配下5スキルは旧世代トークンを含まず誤検知しない'"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/init.test.ts: 'init: プロファイル未指定（既定）でも.claude/skills/配下に5つのSKILL.mdが配置され、profile: standardになる（AC-2, AC-3, AC-4）'"
      - "test/integration/init.test.ts: 'init --profile=lightweight: CLAUDE.mdが@AGENTS.md importを含まず、coordination.backend: local・profile: lightweightになり、機械的阻止が無い旨のメッセージが出る（AC-4, AC-5）'"
      - "test/integration/upgrade.test.ts: 'upgrade: 標準プロファイルで導入済みのプロジェクトも.claude/skills/配下が配布元テンプレートへ同期される（AC-3）'"
      - "test/integration/upgrade.test.ts: 'upgrade: profile: lightweightで導入済みのプロジェクトはupgrade後もprofile: lightweightのまま維持される（ケースB相当の正常系、AC-3）'"
      - "test/unit/schema.test.ts: \"validateAgainstSchema('config') (ADR-0023): templates.claude_skills_source/claude_skills_targetを持つconfigはvalidになる\""

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/init.test.ts: 'init --profile=lightweight: CLAUDE.mdが@AGENTS.md importを含まず、coordination.backend: local・profile: lightweightになり、機械的阻止が無い旨のメッセージが出る（AC-4, AC-5）'"
      - src/commands/init.ts（AGENTS.mdは`ROOT_LEVEL_ENTRIES`に含まれprofileに関わらず生成、`--profile`で強制層コマンド自体を呼び出さない現行動作）

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/init.test.ts: 'init --profile=lightweight: CLAUDE.mdが@AGENTS.md importを含まず、coordination.backend: local・profile: lightweightになり、機械的阻止が無い旨のメッセージが出る（AC-4, AC-5）' の「機械的に阻止する手段は現状ありません」アサーション"

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/init.test.ts: 'init: プロファイル未指定（既定）でも.claude/skills/配下に5つのSKILL.mdが配置され、profile: standardになる（AC-2, AC-3, AC-4）' の @AGENTS.md常時import維持アサーション"
      - "npm test 実行結果: 1009 tests / 1009 pass / 0 fail / 0 cancelled（既存init/upgrade自動テスト全件を含む回帰スイート）"

  - ac_id: AC-7
    verification:
      mode: manual
      result: pass
      reason: >-
        SPEC.mdの検証方法見込みどおりmanual。不変条件表I2セルの根拠記述が「非強制性の類推を用いず
        プロファイル軸固有の直接根拠を独立に記載しているか」「I3セルが未変更のままか」は
        文書の論理的整合性の目視確認を要し、自動検査の対象外。
      procedure: >-
        AGENTS.mdの不変条件表I2セルを確認し、降格条件が「ローカルモードかつ`profile: lightweight`でない
        場合は不変条件。GitHubモード、または`profile: lightweight`の場合はガイドライン」という
        モード軸・プロファイル軸の2軸ルールになっていること、GitHubモードの根拠（自動CI強制の不在）と
        `profile: lightweight`の根拠（強制層に加えセグメントゲートの機械的検査・記録機構も導入しない
        設計方針であること自体）が別個に記載され前者が後者へ類推適用されていないこと、`profile`の値の
        判定手段が`.agent-skill-chain/config/agent-skill-chain.yaml`の`profile`フィールドのみに
        限定されていることを確認した。I3セルは本Issue差分で変更されていないこと（`git diff main -- AGENTS.md`で
        I3行に変更が無いこと）を確認した。docs/GLOSSARY.mdに「軽量プロファイル」「既定プロファイル」の
        用語行が追加され20行以内に収まっていること（AC-10と重複確認）を確認した。
      executor: validation_worker（Claude Code）
    evidence:
      - AGENTS.md（不変条件表I2セル、モード軸とプロファイル軸を統合した降格ルール）
      - 'git diff main -- AGENTS.md の出力（I3行に差分なしを確認）'
      - docs/GLOSSARY.md（「軽量プロファイル」「既定プロファイル」の用語行、全18行 <= 20行上限）
      - "test/unit/glossary.test.ts: 'docs/GLOSSARY.md (ADR-0023 AC-10): 「軽量プロファイル」「既定プロファイル」の用語行が追加され、全体20行以内を維持する'"

  - ac_id: AC-8
    verification:
      mode: manual
      result: pass
      reason: >-
        SPEC.mdの検証方法見込みどおりmanual。生データが「後から比率計算に使える形」であることの
        妥当性確認は目視を要する。
      procedure: >-
        `.agent-skill-chain/scripts/skill-description-budget.sh`を実行し、標準出力の表
        （skill・description_chars・when_to_use_chars・total_chars、5スキル分＋合計行）が
        コミット済み`.agent-skill-chain/templates/claude/DESCRIPTION_BUDGET.md`の表と完全一致することを
        確認した（cleanup 263・gate-review 309・issue-start 375・pr-merge 271・segment-work 406、
        合計1624文字）。特定モデルの文脈長数値・比率計算がこの生データに含まれていないこと（要件8が
        求める「生データのみ」の記録であること）を確認した。
      executor: validation_worker（Claude Code）
    evidence:
      - .agent-skill-chain/scripts/skill-description-budget.sh
      - .agent-skill-chain/templates/claude/DESCRIPTION_BUDGET.md
      - 'skill-description-budget.sh 再実行結果とDESCRIPTION_BUDGET.md記載表の一致（差分なし）'

  - ac_id: AC-9
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/init.test.ts: 'init --profile=lightweight: 既存の.claude/skillsと内容衝突する場合はpre-flightで停止し、プロファイルを問わず非破壊方針を維持する（AC-9）'"
      - "test/integration/init.test.ts: 'init: 既存docs資産と衝突する場合、衝突より前に処理される他のファイルも一切書き込まれない（部分適用しない）'（既定プロファイルでのpre-flight非破壊確認）"
      - "src/commands/init.ts（conflictCheckedEntries全件へのcopyTreeFailOnConflict事前検査(dryRun)を実書き込み前に実行する処理順序）"

  - ac_id: AC-10
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/glossary.test.ts: 'docs/GLOSSARY.md (ADR-0023 AC-10): 「軽量プロファイル」「既定プロファイル」の用語行が追加され、全体20行以内を維持する'"
      - docs/GLOSSARY.md

regression:
  executed: true
  evidence:
    - 'npm test（node --import tsx --test）: 1009 tests / 1009 pass / 0 fail / 0 cancelled / 0 skipped'
    - '.agent-skill-chain/ci/verify-doc-length.sh: 終了コード0'
    - '.agent-skill-chain/config/config-doc-sync および agent-skill-chain verify config-doc-sync: 終了コード0'
    - 'agent-skill-chain verify template-sync: 終了コード0'
    - 'agent-skill-chain lint vocab / lint references: いずれも終了コード0'
