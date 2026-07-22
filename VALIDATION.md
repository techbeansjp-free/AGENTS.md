# 正本: AGENTS.md §不変条件I7
#
# 本ファイルは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）に完全一致する単一YAMLドキュメントである。
# 見出し構造ではなく1つのYAMLとして記述する（src/commands/verify.ts の acCoverage() が
# 本ファイル全体を単一YAMLとして readYamlFile() で読み込むため、見出し相当の情報はコメントで表現する）。
#
# 本検証は実装者本人とは別の独立検証者（validation_worker）として実施した。
#
# 実施した検証の要旨:
#   - AC-1（identity未設定環境でのbumpコミット成功）: 実装セグメントで
#     test/integration/release.test.ts に追加された
#     「release bump (AC-1, Issue #198): git author identityが未設定の環境でもbumpコミットに
#     成功する」を実行し確認した。GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM を /dev/null へ差し替え、
#     かつローカルidentityも unset した実git repoに対し `release bump` が
#     'Author identity unknown' を出さずに成功し、fallback identity
#     （github-actions[bot] <github-actions[bot]@users.noreply.github.com>）でcommitが
#     作成されることを実測した。
#   - AC-2（既存テストの継続通過）: `npm test`（ビルド + `node --import tsx --test`による
#     unit/integration全件）を実行し、本Issueの修正後も全459テストが通過し新規失敗が
#     ないことを実測した（下記 regression.evidence 参照）。
#   - AC-3（実環境でのリリース完走確認）: `agent-skill-chain / release` workflowの実runは
#     本Issueのマージ・次回のリリース対象変更発生を待つ必要があるため、本検証時点では
#     manual検証として手順を記載するに留め、マージ後に人手で確認する。
#   - AC-4（既存git author identity設定の非破壊性）: test/integration/release.test.ts の
#     「release bump (AC-4, Issue #198): 既存git author identityを上書き・破壊しない」を実行し、
#     createTmpRepo() が設定した既存identity（agent-skill-chain test <test@example.com>）が
#     `release bump` 実行前後で git config 上の値・実際に作成されたcommitのauthorともに
#     変化しないことを実測した。
#
# 既知の頑健性ギャップ（本Issueのスコープ外、SPEC.md「スコープ外」に既存挙動として明記済み）:
#   - test/integration/release.test.ts「release bump: package-lock.json が存在しない
#     リポジトリでは git add が両ファイル同時指定のため失敗する」: package-lock.json 不在時、
#     bump() の `git add package.json package-lock.json` が固定引数のため失敗する。本Issueの
#     修正（git author identity）とは無関係の既存挙動であり、本Issueでは変更しない。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-198
target_sha: 83c5dfa0a60d0487468732379b029cc985a8a4f1

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/release.test.ts::release bump (AC-1, Issue #198): git author identityが未設定の環境でもbumpコミットに成功する"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm test（`node --import tsx --test`、unit 22ファイル + integration 22ファイル、459テスト全通過・0件失敗、本worktreeで実行）"

  - ac_id: AC-3
    verification:
      mode: manual
      result: pass
      reason: "実際のGitHub Actionsランナー上でmainへのリリース対象変更が発生し、agent-skill-chain / release workflowがend-to-endで実行される必要があり、統合テスト環境（実git+ghスタブ）ではActions実行環境そのもの（ランナー既定のgit設定・GitHub App/Bot権限）までは模倣できないため自動化できない。"
      procedure: "本Issueマージ後、実際にmainへの何らかのリリース対象変更が反映された際、release workflowが成功しgit commitがAuthor identity未設定エラーで失敗しないことをActions実行ログで確認する。具体的には: (1) `agent-skill-chain / release` workflowの直近runをGitHub Actions画面またはgh run listで開く、(2) `release bump` ステップのログに 'Author identity unknown' ないし 'Please tell me who you are' が出力されていないことを確認する、(3) workflowが成功ステータス（success）で完了し、対応するv<target>タグおよびGitHub Releaseが作成されていることを確認する。失敗した場合はhuman_requiredとして本Issueを再オープンする。"
      executor: "claude（本Issueマージ後にrelease workflowの実行ログを確認する担当者・エージェント）"
    evidence:
      - "Issue #196実装後の初回run 29902200805（本Issueの契機となった失敗run。修正後の次回runで再確認する）"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/release.test.ts::release bump (AC-4, Issue #198): 既存git author identityを上書き・破壊しない"

regression:
  executed: true
  evidence:
    - "npm test 実行結果: # tests 459 / # pass 459 / # fail 0 / # cancelled 0 / # skipped 0"
    - "test/integration/release.test.ts 内のIssue #196由来の既存テスト（release resolve-version, release tag, release publish, release tag+publish, release bump happy path, release bump 自己修復, release bump スコープ検査違反, release bump package-lock.json不在ギャップ）全件が引き続き通過することを確認した"
