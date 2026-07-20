# VALIDATION: agent-skill-chain Tier 1 — adapters launch_worker（spec/design/implementation/validationワーカー起動）の独立検証
#
# 本ファイルは .agent-skill-chain/schemas/validation-report.schema.yaml
# (agent-skill-chain/validation-report/v1) に完全一致する単一YAMLドキュメントである。
#
# 注記: .agent-skill-chain/templates/issue/VALIDATION.md のテンプレートは
# Markdown見出し + AC毎に分割した複数の```yaml```フェンスという構造だが、
# src/commands/verify.ts の acCoverage() は本ファイル全体を readYamlFile()
# （yamlパッケージの parse() を生のテキストへ直接適用）で1つのYAML文書として
# 読み込む実装であり、Markdown見出しや複数フェンスが混在すると
# 「Implicit keys need to be on a single line」でパースに失敗する
# （先行issue #171で実機確認済み）。よって本ファイルはテンプレートの見出し構造ではなく、
# スキーマが要求するフィールドをすべて満たす1つのYAMLとして記述する（見出し相当の情報は
# 本コメントとキー名・配列構造で表現する）。
#
# 本検証は実装者本人とは別の独立した検証者として実施した。実装者の自己申告
# （357/357テストpass等）を鵜呑みにせず、以下すべてを自ら再実測した:
#   - npm test をこのworktreeで実行し件数を実測（conformance）
#   - /tmp配下の隔離git repo（本リポジトリのAGENTS.md worktreeとは独立）へ
#     .agent-skill-chain/一式を複製し、claude/codex/human 3adapterの launch_worker を
#     実際にCLI経由で呼び出し、lease状態ファイル・worker-report・通知markerを
#     実ファイルとして目視確認した（falsification）
#   - AC-2（lease放置防止）・AC-7（完了を騙るケースの検出）・AC-8（wip.limit）は
#     わざと異常系を仕込んで反例を探索した
#   - 検証後、隔離git repoは完全に削除し、ゾンビ/孤児プロセスが残っていないことを
#     ps で確認した

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-166
target_sha: 8e2c680a923f22a01b95eea0e35bb25f3f705159

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
      reason: "3 adapterが同一シグネチャのlaunch_worker(<issue_id> <segment>)を持つことは静的な構造要件であり、worker-launch.sh経由で3 adapterいずれを選んでも同一引数で駆動できることをtest/integration/worker-adapters.test.tyが全シナリオ（claude/codex/human）で暗黙に検証している"
      procedure: "claude.sh/codex.sh/human.shの3ファイルをコード読解し、launch_worker <issue_id> <segment>という同一の位置引数シグネチャであることを確認。加えて/tmp隔離repoでworker.adapterをclaude→codex→humanと切り替えながら同一の`worker-launch.sh ISSUE-1 <segment>`呼び出しで駆動できることを実機確認した"
      executor: claude
    evidence:
      - ".agent-skill-chain/adapters/claude.sh"
      - ".agent-skill-chain/adapters/codex.sh"
      - ".agent-skill-chain/adapters/human.sh"
      - "test/integration/worker-adapters.test.ts"

  - ac_id: AC-2
    verification:
      mode: hybrid
      result: pass
      reason: "自動テスト（起動失敗・認証未設定・完了を騙るケース・target_sha不一致の4パターン）に加え、/tmp隔離repoで実際にWORKER_CMD='exit 1'を注入し、実際のlease.yaml状態ファイルの消滅とreacquire成功を目視確認する実地検証を実施した"
      procedure: "隔離repoでANTHROPIC_API_KEY=dummy WORKER_CMD='exit 1' bash .agent-skill-chain/scripts/worker-launch.sh ISSUE-1 spec を実行→exit 2・worker-report(status=blocked,human_escalation_requested=true)を確認→直後にlease acquire ISSUE-1 specが成功(exit 0)することでleaseが実際に解放されたことを確認した。target_sha不一致（workerが偽のSHAでcompletedを報告するケース）でも同様にblocked化・lease解放を確認した"
      executor: claude
    evidence:
      - "test/integration/worker-adapters.test.ts"
      - ".agent-skill-chain/adapters/claude.sh#_fail_blocked"
      - "実機確認: /tmp隔離repoでのlease.yaml消滅・reacquire成功（本VALIDATION作成セッションで実施、証跡は隔離repo削除済みのため本ファイルの記述が証跡）"

  - ac_id: AC-3
    verification:
      mode: hybrid
      result: pass
      reason: "自動テストでrole_contract全文がstdin経由でworkerへ渡ることを検証済み。加えて隔離repoでWORKER_CMDにcat >/tmp/contract.txtを仕込み、実際に受信したファイルの先頭行が'role: spec_worker'であることを目視確認した"
      procedure: "WORKER_CMD='cat >/tmp/166verify_contract.txt && ...' を用いてclaude launch_workerを実行し、生成されたファイルの内容が segment start の出力（role・inputs・outputs・rules・completion・forbidden）全文と一致することを確認した"
      executor: claude
    evidence:
      - "test/integration/worker-adapters.test.ts"
      - ".agent-skill-chain/adapters/claude.sh#launch_worker"

  - ac_id: AC-4
    verification:
      mode: hybrid
      result: pass
      reason: "実際のclaude CLI（有償API呼び出し）は本検証環境では実行しない（DESIGN.mdもWORKER_CMDによる完全上書きを前提に実機フラグ確定を実装フェーズ後回しにしており、この検証範囲外の判断を追認する）。WORKER_CMDモック経由でlease取得→起動→完了確認→解放の一連の契約を自動テスト+実地確認で検証した。認証未設定時のfail-safeは自動テストで検証済み"
      procedure: "隔離repoでANTHROPIC_API_KEY=dummyかつWORKER_CMDにcheckpoint+report statusまで行うstubを設定してclaude launch_workerを実行し、exit 0・WORKER_OUTPUT.md生成・report(completed)・lease解放の全経路を実測した"
      executor: claude
    evidence:
      - "test/integration/worker-adapters.test.ts"
      - ".agent-skill-chain/adapters/claude.sh#launch_worker"

  - ac_id: AC-5
    verification:
      mode: hybrid
      result: pass
      reason: "codex.shのlaunch_workerがlease取得を一切試みず即fail-safeで返すことを、自動テストに加え隔離repoでの実行で確認した"
      procedure: "隔離repoでworker.adapter=codexに切り替え、worker-launch.sh ISSUE-1 specを実行→exit 2・stderrに「未構成」旨のメッセージ・worker-reportファイル未生成を確認。直後に同issue・同segmentでlease acquireを行い即座に成功(exit 0)することで、codexがlease取得を一切試みなかった（WIP枠を消費しなかった）ことを確認した"
      executor: claude
    evidence:
      - "test/integration/worker-adapters.test.ts"
      - ".agent-skill-chain/adapters/codex.sh#launch_worker"

  - ac_id: AC-6
    verification:
      mode: hybrid
      result: pass
      reason: "human.shのlaunch_workerがexit 3・lease保持継続・通知本文の必須項目を満たすことを自動テスト（local/github双方）に加え隔離repoでの実行で確認した。SPECワーカーのみDraft PR手順が案内される非対称性(AC-9)も同時に確認した"
      procedure: "隔離repoでworker.adapter=humanに切り替え、spec segmentでworker-launch.sh ISSUE-1 specを実行→exit 3・issues/1/.agent-skill-chain/worker-spec.awaiting-humanマーカー生成・本文にrole_contract全文・lease renew手順・完了手順（checkpoint→pr create→report status→lease release）を含むことを確認。同issueで直後にlease acquireが競合失敗(exit 1)することでleaseが解放されていないことを確認。続けてdesign segmentでも実行し、通知本文に'pr create'が含まれないことを確認した"
      executor: claude
    evidence:
      - "test/integration/worker-adapters.test.ts"
      - ".agent-skill-chain/adapters/human.sh#launch_worker"

  - ac_id: AC-7
    verification:
      mode: hybrid
      result: pass
      reason: "I8安全側ラチェットの最重要観点（起動失敗・完了を騙るケース・target_sha不一致がいずれもsilent passせずblocked扱いになること）を自動テスト4パターンに加え、隔離repoで意図的に異常系を再現し実測した"
      procedure: "(1) WORKER_CMD='exit 1'（起動失敗）、(2) WORKER_CMD='cat >/dev/null; exit 0'（終了コード0だが一切reportしない＝完了を騙る）、(3) WORKER_CMDがcompletedを報告するがtarget_shaがdeadbeef（偽装SHA）、の3パターンをそれぞれ隔離repoで実行し、いずれもexit 2（0でも3でもない）・worker-report(status=blocked, human_escalation_requested=true)・lease解放済みであることを実測した。特に(2)はWORKER_CMD自体がexit 0を返す＝サブプロセスの終了コードだけを信用するとsilent successになりうるケースであり、report latestとの突合により正しくblockedへ倒ることを確認した"
      executor: claude
    evidence:
      - "test/integration/worker-adapters.test.ts"
      - ".agent-skill-chain/adapters/claude.sh#launch_worker（完了確認ステップ）"
      - "src/commands/report.ts#latest"

  - ac_id: AC-8
    verification:
      mode: hybrid
      result: pass
      reason: "wip.limit（既定3）超過時のlease acquire拒否を、既存の自動テスト（local/github backend双方）に加え隔離repoで実際に4件のIssueへ順次lease acquireを試みて確認した"
      procedure: "隔離repo（localモード）でISSUE-101/102/103のspec segmentへ順次lease acquireを行い3件とも成功、続くISSUE-104のacquireがexit 1・stderrに「WIP上限」を含むメッセージで拒否されることを実測した"
      executor: claude
    evidence:
      - "test/integration/worker-adapters.test.ts"
      - "src/commands/lease.ts#acquire"

  - ac_id: AC-9
    verification:
      mode: hybrid
      result: pass
      reason: "launch_worker自体にsegment分岐が無いこと（roles.yamlのrole_contractsを不透明に扱うのみ）をコード読解で、Draft PR手順がspecのみに現れる非対称性を自動テスト+隔離repoでの実行で確認した"
      procedure: ".agent-skill-chain/config/roles.yamlのrole_contractsを確認し、worker.segment_overrides.spec.additional_capabilities: [pr.draft_create]のみがspec専用であり、design_worker/implementation_worker/validation_workerのcompletionにDraft PR相当の項目が無いことを確認。加えてhuman.sh#launch_workerのpr_step変数がsegment==specの場合のみ設定されることをコード読解で確認し、隔離repoでspec/design双方の通知本文を実際に比較して非対称性を実測した"
      executor: claude
    evidence:
      - ".agent-skill-chain/config/roles.yaml"
      - ".agent-skill-chain/adapters/human.sh#launch_worker"
      - "test/integration/worker-adapters.test.ts"

  - ac_id: AC-10
    verification:
      mode: automated
      result: pass
      reason: "npm test はリポジトリの自動テストスイート全体を実行するCI相当のコマンドである"
      procedure: "npm test をこのworktreeで実行し357/357 pass・0 failを実測した（実装者報告の357件と一致）。加えてtest/integration/gate-adapters.test.ts（既存launch_gate_reviewer機能）・test/integration/worker-adapters.test.ts（新規）・test/integration/lease-renew.test.ts・test/unit/github-lease.test.tsを個別に再実行し26/26 pass・0 failを確認し、既存launch_gate_reviewer関連機能が無破壊であることを重ねて確認した。テスト実行後にps -efでsleep/read -t/claude -p/worker-launch/gate-launch関連の孤児・ゾンビプロセスが残っていないことも確認した（実装者報告の「orphaned sleep processバグ修正」が実際に効いていることの実測確認）"
      executor: claude
    evidence:
      - "commit:8e2c680"
      - "npm test 実行結果: 357/357 pass"
      - "node --import tsx --test test/integration/gate-adapters.test.ts test/integration/worker-adapters.test.ts test/integration/lease-renew.test.ts test/unit/github-lease.test.ts 実行結果: 26/26 pass"

regression:
  executed: true
  evidence:
    - "npm test（357/357 pass、本VALIDATION作成セッションで実測、実行日時2026-07-20）"
    - "既存launch_gate_reviewer関連テスト（gate-adapters.test.ts等）を個別再実行し無破壊を確認"
