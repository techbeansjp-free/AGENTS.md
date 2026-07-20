# 正本: AGENTS.md §不変条件I7
#
# このファイルは Issue 毎に複製して使う雛形である（セグメント: validation、ゲート: validation-gate）。
# フィールドは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）と完全一致させること。
#
# 注意: src/commands/verify.ts の acCoverage() は本ファイル全体を単一の
# YAML文書として readYamlFile() で読み込む。Markdown見出しや複数の
# ```yaml``` フェンスを混在させると parse() が失敗するため、本ファイルは
# 常に純粋なYAMLとして記述し、見出し相当の情報はコメント（#）で表現する。
#
# <...> のプレースホルダを実際の内容に置き換えて記入すること。
# 以下の acceptance_criteria の要素は AC-ID の数だけ複製する。
# SPEC.md に記載された全 AC-ID がここに対応すること（孤児ACは不可、I7）。

schema_version: agent-skill-chain/validation-report/v1
issue_id: <ISSUE-123>
target_sha: <検証対象のcommit SHA>

acceptance_criteria:
  # mode が manual または hybrid の場合、reason / procedure / executor は必須。
  # mode が automated の場合は reason / procedure / executor を省略してよい。
  - ac_id: <AC-1>
    verification:
      mode: <automated | manual | hybrid>
      result: <pass | fail>
      reason: "<自動化できない理由（mode=manual|hybridの場合必須）>"
      procedure: "<検証手順（mode=manual|hybridの場合必須）>"
      executor: "<実行者または実行エージェント（mode=manual|hybridの場合必須）>"
    evidence:
      - "<証跡へのパス・リンク（テストファイル・スクリーンショット・ci-run等）>"

  - ac_id: <AC-2>
    verification:
      mode: <automated | manual | hybrid>
      result: <pass | fail>
    evidence:
      - "<証跡へのパス・リンク>"

regression:
  executed: <true | false>
  evidence:
    - "<証跡へのパス・リンク（例: ci-run:12345）>"
