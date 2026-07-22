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
#   - AC-1（自動バージョン更新）・AC-4（3者整合）の中核ロジック: 既存の
#     test/unit/release-version.test.ts（15テスト）が src/lib/release-version.ts の
#     resolveVersion/latestSemverTag（seed規則・非semverタグ除外・patch加算・人手先行bump尊重・
#     後退禁止ガードの各分岐）を全て検証済みであることを再実行して確認した。
#   - AC-1のCLI配線（副作用込み）: 本検証で test/integration/release.test.ts を新規作成し、
#     ビルド後の bin/agents-md.js を子プロセスとして実行する統合テストを追加した。
#     `release resolve-version` が実git repo（実際のgit tag・package.json）に対して
#     設計通りの latest/target/need_commit 行を出力することを実測した。
#   - AC-1/AC-6（bumpブランチ・PR作成／admin merge器）: src/commands/release.ts の bump() は
#     本検証時点まで自動テストが一切存在しなかった（既存テストはCLIサブコマンド層
#     commands/release.ts を経由せず src/lib/release-version.ts の純関数のみを対象にしていた）。
#     本検証で test/helpers/gh-stub.ts を拡張（gh pr view/merge, gh release view/create の
#     状態遷移スタブを追加）し、以下を実git+実gh-stub環境で実測する統合テストを追加した:
#       - happy path: release/bump-v<target> ブランチが実際にpushされ、package.json/
#         package-lock.jsonのversionがtargetへ書き換わり、gh pr createがhead/base/本文を
#         正しく組み立て、gh pr mergeの --subject が 'chore(release): v<target> [skip ci]'
#         という固定文言そのものであること（squash既定メッセージ設定に依存しない設計保証の
#         直接検証）。
#       - スコープ検査違反時: PRの変更ファイルにpackage.json/package-lock.json以外が
#         含まれる場合、自動admin mergeを実行せずhuman_requiredで停止し、mergeCallsが
#         0件のまま（副作用未発生）であることを実測した。
#       - 自己修復（DESIGN.md「PR作成後、admin mergeに失敗」シナリオ）: 1回目のadmin merge
#         失敗後、2回目runが同名ブランチ・既存OPEN PRを検出して再利用し（gh pr createの
#         重複呼び出しが発生しない）、再試行に成功することを実測した。
#   - AC-2（タグ）・AC-3（Release）・AC-7（二重発火防止の存在チェック機構）: release tag /
#     release publish を実git repo + gh-stub上で2回連続実行し、いずれも1回目は新規作成、
#     2回目は既存検出による冪等スキップとなり、タグ・Releaseとも重複作成されないことを
#     実測した（tag+publishの連続2周実行でも成果物が高々1件であることも別途実測）。
#   - 未決事項として発見した頑健性ギャップ: src/commands/release.ts の bump() は
#     `git add package.json package-lock.json` を package-lock.json の存在有無に関わらず
#     固定2引数で呼ぶため、package-lock.json が存在しないリポジトリでは git add 自体が
#     非0終了しbump全体が失敗する（writeBumpedVersionFiles側は fs.existsSync で存在確認して
#     いるにもかかわらず、gitへのステージ指定側にはその条件分岐が反映されていない）。
#     このリポジトリ自身は package-lock.json を保持し続ける限り本番運用に影響しないため
#     result は pass としたが、追跡可能な既知の頑健性ギャップとして本ファイルに明記する
#     （evidence: test/integration/release.test.ts の該当テストで固定・再現可能）。
#   - regression: 本 worktree で `npm test`（pretest経由でnpm run buildを含む）を独立に
#     複数回再実行し、457 tests / 457 pass / 0 fail / 0 skipped を実測した（新規追加した
#     test/integration/release.test.ts の8テストを含む。初回1回のみ457件中1件が
#     タイミング起因とみられる一過性failを示したが、本Issueの変更と無関係のテストであり、
#     直後の再実行2回はいずれも457/457 pass、既存テストへの悪影響は無い）。
#   - AC-6/AC-7のhybrid判断（無限ループ防止・二重発火防止）: 実際にmainへマージし
#     ワークフロー再発火の有無を実地観測することは本検証セッションでは実施していない
#     （マージ自体は進行役の別工程）。かわりに、.github/workflows/agent-skill-chain-release.yml
#     （.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-release.yml と
#     内容一致を確認済み）を読み、design通りの機構（--subjectによるskip-ci固定・
#     concurrency:{group:release,cancel-in-progress:false}による直列化・pathsフィルタ・
#     head_commit.messageの[skip ci]による防御的二重ガード）が実装されていることをソースで
#     確認し、上記の統合テストでその中核（--subjectの固定文言・存在チェックによる冪等性）を
#     実測した。実地確認手順は各ACのprocedureに明記した。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-196
target_sha: 72b76566316bc592e7fcac0bf8b8c78bd0745299

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/release-version.test.ts"
      - "test/integration/release.test.ts (release resolve-version, release bump happy path, release bump 自己修復)"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/release.test.ts (release tag)"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/release.test.ts (release publish)"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/release-version.test.ts"
      - "test/integration/release.test.ts (release resolve-version, release bump happy path — package.json/tag/Releaseがいずれも同一target文字列由来であることを実測)"
      - "src/lib/release-version.ts（version体系は package.json semverを唯一の正本とし、gitタグ=v<semver>・Release tag/nameも同一文字列とする設計をコードで確認）"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/release-version.test.ts（後退禁止ガード横断テスト・不正semver例外テストを含む）"

  - ac_id: AC-6
    verification:
      mode: hybrid
      result: pass
      reason: "「リリース処理自身の生成物（bumpコミットのsquashマージ・タグpush・Release作成）を契機とする新規リリースworkflow実行が一切発生しない」という負の条件は、実際にmainへマージしGitHub Actionsの実行履歴を一定期間観測しない限り機械的に確定できないため、本検証セッション（マージを伴わない独立検証）だけでは automated と判定しない。一方で、再帰トリガを唯一遮断する主機構（gh pr merge --admin --squash --subject によるsquashコミットメッセージの'[skip ci]'固定）は、gh pr merge呼び出し引数そのものを本検証の統合テストで実測しており、GitHub Actionsが[skip ci]を含むpushに対しworkflow run自体を生成しないことは公式仕様であるため、コード・設計レベルでの保証は成立していると判断しpassとした。タグpush・Release作成はpush:branches:[main]トリガの対象外であり再帰トリガ源にならないことも.github/workflows/agent-skill-chain-release.ymlのon.push.branchesをソースで確認済み。防御的skip-ciガード（head_commit.messageの[skip ci]チェック）も同ファイルに実装されていることを確認した。"
      procedure: "マージ後、以下を1サイクル分実地確認する: (1) bump PRのsquashマージによりmainへ着地したコミットのメッセージがchore(release): v<target> [skip ci]であることをgit logで確認する。(2) GitHub Actionsの実行履歴（gh run list --workflow=agent-skill-chain-release.yml）を確認し、当該squashコミットのSHAをtrigger commitとするworkflow runが新規に生成されていないことを確認する。(3) タガー・リリーサが作成したタグpush・GitHub Release作成についても、それらのイベント単独では release.yml がon.push.branches:[main]のみをトリガとするためworkflow runが生成されないことをgh run listで確認する。"
      executor: "進行役（マージ実施後の人間またはマージを実施したエージェント）"
    evidence:
      - "test/integration/release.test.ts (release bump happy path — gh pr mergeの--subjectが'chore(release): v<target> [skip ci]'固定文言であることを実測)"
      - ".github/workflows/agent-skill-chain-release.yml（on.push.paths、if の [skip ci] 防御的ガード、concurrency設定）"
      - ".agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-release.yml（上記と内容一致、verify-template-sync.sh対象）"

  - ac_id: AC-7
    verification:
      mode: hybrid
      result: pass
      reason: "「単一契機に対して生成されるタグ・Releaseが高々1件」という条件のうち、単一契機に対する成果物件数（存在チェックによる冪等no-op）は本検証の統合テストで直接・自動的に実測できたが、真に並行した複数workflow実行が同時到来した場合の直列化（concurrency:{group:release,cancel-in-progress:false}）そのものは、GitHub Actions基盤側の排他制御に依存する振る舞いであり、実際に2つのworkflow runを意図的に競合させて観測しない限り自動テストで確定できないためhybridとした。concurrency設定自体は.github/workflows/agent-skill-chain-release.ymlに実装されていることをソースで確認し、bumpブランチ名へのtarget埋め込みによる同名ブランチ・PR重複防止、タグ・Releaseの存在チェックによる冪等性は統合テストで実測できたため、pass と判断した。"
      procedure: "マージ後、リリース対象と判定される変更を短時間に連続してmainへ2回反映させ（または既存のconcurrency設定を維持したまま同時期に2つのpushを発生させ）、gh run list --workflow=agent-skill-chain-release.ymlで2番目のrunが1番目の完了を待って直列実行されたこと、かつ生成されたタグ・Releaseが1件のみであることを実地確認する。"
      executor: "進行役（マージ実施後の人間またはマージを実施したエージェント）"
    evidence:
      - "test/integration/release.test.ts (release tag, release publish, release tag+publish 連続二重発火, release bump 自己修復 — いずれも既存チェックによる冪等no-opを実測)"
      - ".github/workflows/agent-skill-chain-release.yml（concurrency: {group: release, cancel-in-progress: false}）"

regression:
  executed: true
  evidence:
    - "npm test（457 tests / 457 pass / 0 fail / 0 skipped、本worktreeで独立に複数回再実行して確認）"
    - "test/integration/release.test.ts（本検証で新規追加、8 tests / 8 pass）"
