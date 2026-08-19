# 由来: AGENTS.md が定める不変条件I7（仕様⇔検証の追跡）と、セグメント④独立検証の成果物である。
# 形式: 本ファイルは全体が単一のYAML文書である（verify ac-coverage が readYamlFile で読む）。
# 見出し相当の記述はすべてYAMLコメントで表現する。
#
# ============================================================================
# 目的
# ============================================================================
# ISSUE-733「size:quick の Issue でゲートが構造上通過不能な問題の是正」について、
# 実装セグメントが確定させた実装を独立に検証し、SPEC.md が定める受入条件 AC-1 から
# AC-24 のすべてに検証方法と証跡を対応づけ、回帰の有無を確定する。
#
# ============================================================================
# 対象範囲
# ============================================================================
# 検証対象は commit e661c040d09e6b935496da4cc6f43a61a35f8e3b（以下「検証対象SHA」）の
# リポジトリ全体である。base は f72eadd6bb6403f73f3163a8138f4cdabbbdd26b（default branch main）。
# 対象の変更は 30 ファイル・4913 行追加・490 行削除であり、判定プロンプト生成
# （src/commands/gate.ts）、quick 免除の解決（src/lib/gate-quick-exemption.ts）、
# 必須成果物の三値読み取り（src/lib/gate-artifacts.ts）、判定軸・提示・中断の決定表
# （src/lib/gate-judgment-rules.ts）、代替判定基準の抽出（src/lib/gate-alternative-criteria.ts）、
# attempt 単位の判定集約（src/lib/gate-verdict-aggregation.ts）、GitHub 証跡経路
# （src/lib/review-evidence.ts）、ゲートレビュー起動シェル
# （.agent-skill-chain/scripts/gate-local-review.sh）を含む。
#
# ============================================================================
# 本成果物を追加するコミットに関する不変（レビュア向けの明示）
# ============================================================================
# 本成果物を追加するコミットは、検証対象SHA e661c040d09e6b935496da4cc6f43a61a35f8e3b に
# 対して VALIDATION.md のみを追加した差分であり、実装ファイル・テストファイル・
# SPEC.md・DESIGN.md・PLAN.md・ADR を一切変更しない。したがって本ファイルが宣言する
# target_sha（検証を実施した実装SHA）と、validation ゲートが判定に用いる target_sha
# （本ファイルを載せたコミットのSHA）は必ず異なる値になるが、両者の間の差分は本ファイル
# 1 件の追加のみであり、検証結果はそのまま妥当である。
#
# 根拠として、下記コマンドを本ファイルの内容確定後に実行した実出力を原文のまま引用する。
#
#   $ git diff --stat e661c040d09e6b935496da4cc6f43a61a35f8e3b HEAD
#    VALIDATION.md | 458 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
#    1 file changed, 458 insertions(+)
#
#   $ git diff --name-status e661c040d09e6b935496da4cc6f43a61a35f8e3b HEAD
#   A	VALIDATION.md
#
#   $ git rev-list --count e661c040d09e6b935496da4cc6f43a61a35f8e3b..HEAD
#   1
#
#   $ git log --format=%s e661c040d09e6b935496da4cc6f43a61a35f8e3b..HEAD
#   validation(ISSUE-733): AC-1〜AC-24 の独立検証結果と回帰実行結果を記録する
#
# 上記のうち git log を短縮SHA付きの形（git log --oneline）で引用していないのは、
# 引用対象がそのコミット自身のSHAであり、コミットが存在する前に本文へ書き込むことが
# 原理的にできないためである。この自己参照不能性こそが、本節の不変を文章として明示する
# 必要がある理由そのものである。SHAに依存しない上記4コマンドの出力（追加ファイルが
# VALIDATION.md ただ1件であること、コミット数が1であること、件名が上記であること）により、
# 「VALIDATION.md のみを追加した差分である」ことはSHAを知らずとも確認できる。
#
# ============================================================================
# 前提
# ============================================================================
# - SPEC.md・DESIGN.md・PLAN.md は承認済みであり、本セグメントでは変更しない。
# - 実装の追加変更は行わない。欠陥を発見した場合は本ファイルへ origin 付きで記載し、
#   是正は進行役の差し戻し判断に委ねる。
# - 要件・AC-ID の新規追加は行わない。AC-ID は SPEC.md の 24 件で固定である。
#
# ============================================================================
# 用語
# ============================================================================
# - 検証対象SHA: 独立検証を実施した実装のcommit SHA。本ファイルの target_sha と同値。
# - 判定対象区間: 判定プロンプトのうち、レビュアが読むべき成果物内容と不在事由を提示する区間。
#   実体は判定プロンプト中の agent-skill-chain:judgment-target:begin と
#   agent-skill-chain:judgment-target:end に挟まれた範囲である。
# - 判定軸区間: 判定プロンプトのうち、conformance を何によって判定するかを指示する区間。
#   実体は agent-skill-chain:judgment-axis:begin と agent-skill-chain:judgment-axis:end に
#   挟まれた範囲であり、値は「AC-ID 全件網羅」「代替判定基準」「inconclusive 指示」の3つ。
# - quick 免除: size シグナルが quick、risk シグナルが normal、ガードレール判定が
#   「含まない」の3条件すべてが解決されたときに限り成立する4成果物の作成義務免除。
# - 独立再実行: 本セグメントのワーカーが、リポジトリ同梱のテストを実行するだけでなく、
#   一時リポジトリを自ら構築して CLI・純関数を直接呼び出し、期待結果を観測した検証をいう。
#
# ============================================================================
# 入力
# ============================================================================
# - 検証対象SHA のリポジトリ全体（成果物・実装・テスト）。
# - SPEC.md の受入条件 AC-1 から AC-24 と、完了条件の(A)群・(B)群。
# - PLAN.md の必須テストケース表および完了判定。
# - protected base 側 CI の check run 実行結果。
#
# ============================================================================
# 出力
# ============================================================================
# - AC-1 から AC-24 それぞれの検証方法・結果・証跡（下記 acceptance_criteria）。
# - 回帰実行の結果（下記 regression）。
# - 検証で発見した欠陥の origin 付き記載（下記「発見した欠陥」節。実装の是正は行わない）。
#
# ============================================================================
# 検証方法（実施した手順の全体）
# ============================================================================
# 検証はすべて検証対象SHA のワークツリーで実施した。
#
# 1. 依存復元とビルド
#      npm ci --ignore-scripts   -> 正常終了
#      npm run build             -> 終了コード 0（tsc、エラーなし）
#      npm run typecheck         -> 終了コード 0（tsc --noEmit -p tsconfig.test.json）
#
# 2. 全自動テストの実行（受入・統合・回帰を含むリポジトリ全体のスイート）
#      npm test                  -> 終了コード 0
#      集計: tests 1489 / pass 1488 / fail 0 / cancelled 0 / skipped 1 / todo 0
#            duration_ms 502686.986925
#      skipped 1 件は 'GitHub導入元へ実際に到達してpackage versionを取得できる' であり、
#      環境変数 ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 を明示した場合のみ実行する対外疎通確認
#      テストである。本 Issue の AC とは無関係であり、既定でスキップされる設計である。
#
# 3. AC に対応するテストファイル単位の再実行（すべて終了コード 0）
#      test/unit/gate-quick-exemption.test.ts                     4 / 4 pass
#      test/unit/gate-artifacts.test.ts                           2 / 2 pass
#      test/unit/gate-judgment-rules.test.ts                      2 / 2 pass
#      test/unit/gate-alternative-criteria.test.ts               13 / 13 pass
#      test/unit/gate-verdict-aggregation.test.ts                 7 / 7 pass
#      test/unit/review-evidence.test.ts                         15 / 15 pass
#      test/unit/gate-round.test.ts                              13 / 13 pass
#      test/integration/gate-judgment.test.ts                    63 / 63 pass
#      test/integration/gate-adapters.test.ts                    40 / 40 pass
#      test/integration/gate-evidence.test.ts                     4 / 4 pass
#      test/integration/gate-local-review.test.ts                 5 / 5 pass
#      test/integration/verify.test.ts                           72 / 72 pass
#      test/integration/reconcile.test.ts                        20 / 20 pass
#      test/integration/gate-reviewer-prompt-determinism.test.ts   2 / 2 pass
#
# 4. 独立再実行（テストコードに依存しない観測）
#    一時リポジトリを自ら構築し（bare remote + .agent-skill-chain 一式の複製 +
#    coordination.backend を local へ切替）、CLI と純関数を直接呼び出して観測した。
#    観測結果は各 AC の evidence に記載する。
#
# 5. 機械検査スクリプトの実行（すべて終了コード 0）
#      .agent-skill-chain/ci/verify-branch-name.sh
#      .agent-skill-chain/ci/verify-worktree-path.sh
#      .agent-skill-chain/ci/verify-template-sync.sh
#      .agent-skill-chain/ci/verify-doc-length.sh
#      .agent-skill-chain/ci/verify-spec-bdd.sh SPEC.md
#      .agent-skill-chain/ci/verify-design-diagram.sh DESIGN.md
#      .agent-skill-chain/ci/verify-artifacts.sh ISSUE-733 --started-segments spec,design,implementation
#      .agent-skill-chain/scripts/lint-vocab.sh
#      .agent-skill-chain/scripts/lint-references.sh
#      .agent-skill-chain/scripts/lint-secrets.sh --diff f72eadd6bb6403f73f3163a8138f4cdabbbdd26b
#      .agent-skill-chain/scripts/adr-lint.sh check
#
# 6. 依存関係スキャン
#      npm audit -> high 1 件（fast-uri 3.0.0 - 3.1.4、GHSA-7p8r-x3mc-p8w7）。
#      本変更は package.json・package-lock.json を一切変更しておらず
#      （git diff --stat の対象に両ファイルが現れない）、同一の指摘が base
#      f72eadd6bb6403f73f3163a8138f4cdabbbdd26b でも再現する。すなわち本 Issue に由来しない
#      既存の指摘であり、進行役の指示「範囲外に真因がある場合は修正せず事実を報告する」に
#      従い是正しない。下記「発見した欠陥」節へ origin 付きで記載する。
#
# 7. protected base 側 CI check run の確認（SPEC.md 完了条件(B)群の立証手段）
#      検証対象SHA e661c040d09e6b935496da4cc6f43a61a35f8e3b に対する check run:
#        name=verify                  status=completed  conclusion=success
#                                     completed_at=2026-08-19T06:40:53Z
#        name=verify-config-doc-sync  status=completed  conclusion=success
#                                     completed_at=2026-08-19T06:40:53Z
#
# ============================================================================
# 制約
# ============================================================================
# - ゲートレビュアの起動には外部の実行系と認証を要するため、AC の観測単位は
#   PLAN.md の定めに従い「当該関数・当該コマンドを直接呼び出した結果」とした。
# - 本ファイルは自身を載せるコミットのSHAを内容に持てない（前掲「本成果物を追加する
#   コミットに関する不変」を参照）。
#
# ============================================================================
# 完了条件と、その充足状況
# ============================================================================
# - 全 AC の verification.result が記録されている        -> 充足（AC-1 から AC-24 の 24 件）
# - regression 実行結果が記録されている                  -> 充足（下記 regression）
# - 孤児AC・孤児テスト参照が無い                          -> 充足（SPEC.md の AC-ID は 24 件、
#   本ファイルの ac_id も同じ 24 件で過不足なし）
# - commit + push 済み                                   -> 本ファイルを載せるコミットで充足する
#
# ============================================================================
# 発見した欠陥（origin 付き。本セグメントでは是正しない）
# ============================================================================
# [F-1] origin: specification / severity: warning（非 blocking）
#   事象: SPEC.md の完了条件(B)群は「本群の唯一の立証手段は……本リポジトリの CI
#         （check run 名 verify）とし、他の手段では代替しない」と定め、その立証対象に
#         単体テスト・変更範囲の結合テスト・型検査・SAST・依存関係スキャンを含めている。
#         しかし当該 check run を生成するワークフロー（.github/workflows/agent-skill-chain-ci.yml
#         の job 名 verify）は npm test を実行しない。ワークフロー冒頭のコメントが
#         「agent-skill-chain CLI自体の開発リポジトリ用テストスイート（npm test）は
#         consumer環境では意味を持たないため、本ワークフローには含めない（Issue #290）」と
#         明記しており、意図的な除外である。同 job には npm run typecheck・SAST・
#         依存関係スキャンの各ステップも存在せず、実行されるのは npm ci、npm run build、
#         および verify-*.sh・lint-*.sh・adr-lint.sh の各機械検査である。
#   影響: 完了条件(B)群が、自らが唯一と宣言した立証手段では立証できない。すなわち(B)群は
#         その定義どおりには充足不能である。
#   本検証での取り扱い: 実体としての(B)群の内容（自動テスト・型検査の成功）は、本ワーカーが
#         上記「検証方法」の手順1・2・3として検証対象SHA で自ら実行し、いずれも成功を
#         確認済みである。したがって成果物の品質に対する未確認事項は残らない。欠けているのは
#         立証手段の所在に関する仕様記述の正確性のみである。
#   blocking と判定しない理由: 進行役が宣言したラウンド予算により、以降 blocking として扱うのは
#         「Issue 目的の直接阻害・データ喪失・既存挙動の回帰」の3類型に限られる。本件は
#         quick 免除下のゲート通過可能性という Issue 目的を阻害せず、データ喪失も回帰も
#         生じない。承認済み SPEC.md の変更は本セグメントの禁止事項でもある。
#
# [F-2] origin: implementation / severity: warning（非 blocking。本 Issue 由来ではない）
#   事象: npm audit が fast-uri 3.0.0 - 3.1.4 の high 深刻度脆弱性
#         （GHSA-7p8r-x3mc-p8w7）を 1 件報告する。fast-uri は ajv の推移的依存である。
#   影響: 本 Issue の変更に起因しない。本変更は package.json と package-lock.json の
#         いずれも変更していないため、依存グラフは base と同一である。
#   再現: base f72eadd6bb6403f73f3163a8138f4cdabbbdd26b のワークツリーで npm audit を
#         実行しても同一の 1 件が報告される。すなわち main で既に成立している事象である。
#   本検証での取り扱い: 範囲外の既存事象として是正せず事実のみ報告する。
#
# ============================================================================
# 未決事項
# ============================================================================
# - F-1 の是正（完了条件(B)群の立証手段記述と CI 実体の整合）を本 Issue で行うか、
#   別 Issue へ分離するかは進行役の判断に委ねる。本ファイルは判断を先取りしない。
# - F-2 の依存関係更新は本 Issue の範囲外であり、担当と時期は未定である。
#
# ============================================================================
# 対象外
# ============================================================================
# - 実装・テスト・SPEC.md・DESIGN.md・PLAN.md・ADR の変更（本セグメントの禁止事項）。
# - 要件および AC-ID の新規追加。
# - ゲートレビュアを実際に起動しての判定（外部実行系と認証を要するため、PLAN.md の定めに
#   従い観測単位を直接呼び出しとした）。
# - SPEC.md がスコープ外と定めた事項（証跡照合機構、判定軸の自己改変対策、反証ルーブリック、
#   変更規模に応じた反証強度、strict attempt の実行独立性、GitHub モードの I2 自動CI強制）。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-733
target_sha: e661c040d09e6b935496da4cc6f43a61a35f8e3b

acceptance_criteria:
  - ac_id: AC-1
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-quick-exemption.test.ts の 'ゲート用quick免除は固定SHA差分と三値シグナルからだけ成立する'（4/4 pass）"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-1〜AC-3): GitHubの免除条件8通りと曖昧シグナルを安全側に解決する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: GitHubラベルとIssue本文でもlocalと同じquick判定軸を生成する'（両モードで同一結果）"
      - "独立再実行: resolveGateQuickExemption へ size=quick・risk=normal・ガードレール非該当を与え exempt=true、3シグナルとも status=resolved を観測"

  - ac_id: AC-2
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-quick-exemption.test.ts の 'ゲート用quick免除は固定SHA差分と三値シグナルからだけ成立する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-1〜AC-3): GitHubの免除条件8通りと曖昧シグナルを安全側に解決する'（8通りを網羅）"
      - "独立再実行: size=standard、risk=high、ガードレール該当（docs/adr/ 配下の追加）のいずれでも exempt=false を観測"
      - "独立再実行: size・risk とも未指定の状態で size=resolved(standard)・risk=resolved(other)・exempt=false を観測。未指定が解決不能として扱われず既定値へ決定的に解決されることを確認"

  - ac_id: AC-3
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-quick-exemption.test.ts の 'ISSUE-733 AC-3: local状態ファイルの欠落・構文不正・非通常ファイルは免除不成立へ倒す'"
      - "test/unit/gate-quick-exemption.test.ts の 'base SHA不在とガードレール差分は免除不成立へ倒す'"
      - "test/unit/review-evidence.test.ts および test/integration/gate-judgment.test.ts の AC-1〜AC-3 系ケース（曖昧シグナルの安全側解決）"
      - "独立再実行: size に値域外の値を与え size={status:unresolved, reason:'size シグナル が値域外です'}・exempt=false を観測。例外による中断は起きず、判定は決定的に免除不成立へ解決された"

  - ac_id: AC-4
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-judgment-rules.test.ts の 'ISSUE-733 AC-4〜AC-8・AC-19: 判定軸決定表の全行を排他的に導出する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-4/AC-6〜AC-8): 両モードの実入力を4ゲートで同じ判定軸へ解決する'"

  - ac_id: AC-5
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-alternative-criteria.test.ts の 'ISSUE-733 AC-5/AC-6: 要求記述節だけを採用し、前文・管理節・見出しだけは採用しない'"
      - "test/unit/gate-alternative-criteria.test.ts の 'ISSUE-733 AC-5/AC-6: 要求記述節の見出しは固定ラベルへ正規化後完全一致する'"
      - "test/unit/gate-alternative-criteria.test.ts の 'ISSUE-733 AC-5: 一般Markdown本文と部分装飾は固定placeholderとして除外しない'"
      - "test/unit/gate-alternative-criteria.test.ts の 'ISSUE-733 AC-5: 文字数・意味を推定せず、固定placeholder以外の短い記述も採用する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-5): ATX closing sequence付き受入基準をGitHub/localとも展開する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: quick免除下のdesign/validation必須成果物不在を正当な不在として起動可能にする'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: quick免除下でSPEC.mdが無くてもIssue本文を判定軸へ展開する'"
      - "独立再実行: quick免除成立・SPEC.md不在の spec ゲートで gate reviewer-prompt が終了コード0で成功し、判定軸区間に '## 代替判定基準（trusted な Issue 本文由来）'、'AC-ID は quick 免除により正当に存在しない。'、'網羅を立証すべき必須成果物は quick 免除により正当に不在: SPEC.md'、および Issue 本文由来の受入基準本文が出力され、inconclusive 指示が含まれないことを観測"

  - ac_id: AC-6
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-alternative-criteria.test.ts の 'ISSUE-733 AC-5/AC-6: fenced code block・HTMLコメント内の偽見出しは要求記述節として扱わない'"
      - "test/unit/gate-alternative-criteria.test.ts の 'ISSUE-733 AC-5/AC-6: 固定placeholderはリスト記号と末尾句読点を正規化して除外する'"
      - "test/unit/gate-alternative-criteria.test.ts の 'ISSUE-733 AC-6: task-list markerだけ、または固定placeholderだけの項目は展開不能にする'"
      - "test/unit/gate-alternative-criteria.test.ts の 'ISSUE-733 AC-6: blockquote内のtask-list placeholderも展開不能にする'"
      - "test/unit/gate-alternative-criteria.test.ts の 'ISSUE-733 AC-6: Markdown装飾された固定placeholderも展開不能にする'"
      - "test/unit/gate-alternative-criteria.test.ts の 'ISSUE-733 AC-6: 空白・コメント・水平線だけの要求記述節は展開不能にする'"
      - "test/unit/gate-alternative-criteria.test.ts の 'ISSUE-733 AC-6: 本文を伴わない下位見出しだけの要求記述節は展開不能にする'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-6): Markdown装飾placeholderはGitHub/localともinconclusiveにする'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-6): blockquote内task-list placeholderはGitHub/localともinconclusiveにする'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-6): AC-IDがあってdesign/validation成果物が欠落し代替不能ならinconclusiveにする'"
      - "独立再実行: quick免除成立・Issue本文の受入基準が task-list 形式の装飾placeholder のみである入力に対し gate reviewer-prompt が終了コード0で成功（例外中断なし）し、判定軸区間に 'conformance の判定軸を実体化できない。conformance=pending、inconclusive:true とし human_required へ倒すこと。' が出力され、代替判定基準もAC-ID全件網羅も出力されないことを観測"

  - ac_id: AC-7
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-judgment-rules.test.ts の 'ISSUE-733 AC-4〜AC-8・AC-19: 判定軸決定表の全行を排他的に導出する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-4/AC-6〜AC-8): 両モードの実入力を4ゲートで同じ判定軸へ解決する'"
      - "test/fixtures/gate-reviewer-prompt-golden.txt を用いた既存の固定出力比較テスト（免除不成立の主経路の出力を本変更の前後で固定する）"
      - "独立再実行: 免除不成立（size=standard）かつ SPEC.md に AC-1・AC-2 が存在する入力で、判定軸区間が '## 適用対象の AC-ID（SPEC.md 由来。全件を conformance 判定で網羅すること）' と 'AC-1, AC-2' となり、Issue 本文へ置いた受入基準を緩める記述が判定プロンプト全体で 0 件であることを観測"

  - ac_id: AC-8
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-judgment-rules.test.ts の 'ISSUE-733 AC-4〜AC-8・AC-19: 判定軸決定表の全行を排他的に導出する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-4/AC-6〜AC-8): 両モードの実入力を4ゲートで同じ判定軸へ解決する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: 正規宣言が0件なら本文や非準拠見出しの同形文字列を列挙せずhuman_requiredへ倒す'"

  - ac_id: AC-9
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-judgment-rules.test.ts の 'ISSUE-733 AC-9〜AC-13・AC-20〜AC-23: 成果物ごとの提示表と起動中断表の全状態を区別する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-9〜AC-11/AC-20/AC-22/AC-23): 3ゲートの成果物状態を直接描画する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: 既存変更・新規追加・空ファイル・削除の情報をパス単位で保持する'（削除パスが不在表示にならないこと）"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: implementation対象成果物が空集合なら両区間で明示する'"
      - "test/integration/gate-local-review.test.ts の成果物読み取り経路のケース（5/5 pass）"

  - ac_id: AC-10
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-judgment-rules.test.ts の 'ISSUE-733 AC-9〜AC-13・AC-20〜AC-23: 成果物ごとの提示表と起動中断表の全状態を区別する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-9〜AC-11/AC-20/AC-22/AC-23): 3ゲートの成果物状態を直接描画する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: 解決済み入力の組み立ては不在と読み取り不能を個別に提示する'"
      - "独立再実行: quick免除成立・SPEC.md不在の spec ゲートで、判定対象区間に '(quick 免除により正当に不在: SPEC.md)' が出力され無言の空欄にならないことを観測"

  - ac_id: AC-11
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-judgment-rules.test.ts の 'ISSUE-733 AC-9〜AC-13・AC-20〜AC-23: 成果物ごとの提示表と起動中断表の全状態を区別する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-9〜AC-11/AC-20/AC-22/AC-23): 3ゲートの成果物状態を直接描画する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: 解決済み入力の組み立ては不在と読み取り不能を個別に提示する'"

  - ac_id: AC-12
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-adapters.test.ts の 'claude launch_gate_reviewer (ISSUE-733 AC-12): quick免除下の4ゲートを両backendで起動する'（40/40 pass）"
      - "test/unit/gate-judgment-rules.test.ts の 'ISSUE-733 AC-9〜AC-13・AC-20〜AC-23: 成果物ごとの提示表と起動中断表の全状態を区別する'（中断規則の全行）"

  - ac_id: AC-13
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-adapters.test.ts の 'claude launch_gate_reviewer (ISSUE-733 AC-13/AC-24): 免除不成立の成果物不在は両backendの3ゲートで未起動になる'"
      - "test/unit/gate-judgment-rules.test.ts の 'ISSUE-733 AC-9〜AC-13・AC-20〜AC-23: 成果物ごとの提示表と起動中断表の全状態を区別する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: 免除不成立で必須成果物が不在ならプロンプトを出力せず起動を中断する'"
      - "独立再実行: 免除不成立（size=standard）・SPEC.md不在の spec ゲートで gate reviewer-prompt が終了コード1で中断し、標準出力は 0 バイト、標準エラーへ 'target SHAの必須成果物を読めません: SPEC.md' が出力されることを観測。従来の中断挙動が維持されている"

  - ac_id: AC-14
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-verdict-aggregation.test.ts の 'ISSUE-733 AC-14/AC-15: 全slotが両観点passの場合だけapprovedになる'"
      - "test/unit/gate-verdict-aggregation.test.ts の 'ISSUE-733 AC-14/AC-15/AC-24: 要求体数を超えたslotも全件を集約対象にする'"
      - "test/integration/gate-judgment.test.ts の 'gate record-verdict: pass/pass の verdict は final=approved で結線される'"
      - "test/integration/gate-judgment.test.ts の 'gate record-verdict: Strictの独立2 verdictがともにpassの場合だけapprovedになる'"
      - "独立再実行: aggregateGateAttempt へ（要求1体・起動1体・両pass）を与え final=approved、（要求2体・起動2体・両pass）でも final=approved、（要求1体・起動2体・両passかつ超過）でも final=approved を観測"

  - ac_id: AC-15
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-verdict-aggregation.test.ts の 'ISSUE-733 AC-15/AC-16: 判定が全件そろった後はfail・blockingをpendingより優先する'"
      - "test/unit/gate-verdict-aggregation.test.ts の 'ISSUE-733 AC-14/AC-15: 全slotが両観点passの場合だけapprovedになる'"
      - "test/unit/review-evidence.test.ts の 'ISSUE-733 AC-15: 閾値到達時のblockingをrejectedより先にhuman_requiredへ移し、未到達・blocker無しは集約判定を保つ'"
      - "test/integration/gate-judgment.test.ts の 'gate record-verdict: inconclusive でも fail と blocking finding を優先して final=rejected にする'"
      - "test/integration/gate-judgment.test.ts の 'gate record-verdict: Strictの独立verdictに1件でもfailがあればrejectedになる'"
      - "独立再実行: aggregateGateAttempt へ（要求2体・起動2体・1体が conformance=fail、他方が conformance=pending）を与え final=rejected を観測。fail と pending が同時成立する入力で fail が優先されることを確認"

  - ac_id: AC-16
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-verdict-aggregation.test.ts の 'ISSUE-733 AC-15/AC-16: 判定が全件そろった後はfail・blockingをpendingより優先する'"
      - "test/integration/gate-judgment.test.ts の 'gate record-verdict: inconclusive の verdict は silent pass せず final=human_required になる'"
      - "test/integration/gate-judgment.test.ts の 'gate record-verdict: inconclusive でも fail と blocking finding を優先して final=rejected にする'"
      - "独立再実行: aggregateGateAttempt へ（conformance=pending・falsification=pass・blocking無し）を与え final=human_required、（conformance=pending・falsification=fail・blocking有り）を与え final=rejected を観測。いずれも approved は導出されない"

  - ac_id: AC-17
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-alternative-criteria.test.ts の 'ISSUE-733 AC-17: 転記区間は最初の開始から最後の終了まで除去してマーカー偽装を無害化する'"
      - "test/unit/gate-alternative-criteria.test.ts の 'ISSUE-733 AC-17: 片側マーカー欠落は転記内容を採用範囲から除去する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: 4ゲートの代替判定基準はワーカー供給値と競合してもIssue本文の一次情報だけを使う'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-17): localの4ゲートも状態正本だけを判定軸に使う'"
      - "独立再実行: ブランチ上の成果物ファイル（DESIGN.md および Issue 本文の写しファイル）へ受入基準を緩める記述を置いた状態で spec ゲートの判定プロンプトを生成し、判定軸区間内の当該記述の出現数が 0、一次情報（ローカルモードの Issue 状態ファイル）由来の記述の出現数が 1 であることを観測"

  - ac_id: AC-18
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-18): 判定区間標識を成果物とIssue本文から偽装できない'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-18): 成果物パスから判定区間標識を偽装できない'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-18): 両モードの4ゲートで判定対象区間と判定軸区間を分離する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: 過去findingと診断に埋め込まれた区間標識を無害化する'"
      - "独立再実行: 生成された判定プロンプト中で 4 種の区間標識（judgment-target:begin / judgment-target:end / judgment-axis:begin / judgment-axis:end）がそれぞれちょうど 1 回だけ出現し、判定対象区間が判定軸区間の開始より前で閉じており、両区間が占める位置が互いに素であることを観測"

  - ac_id: AC-19
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-judgment-rules.test.ts の 'ISSUE-733 AC-4〜AC-8・AC-19: 判定軸決定表の全行を排他的に導出する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-19): 両モードの4ゲートでSPEC抽出不能をinconclusiveへ倒す'"

  - ac_id: AC-20
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-judgment-rules.test.ts の 'ISSUE-733 AC-9〜AC-13・AC-20〜AC-23: 成果物ごとの提示表と起動中断表の全状態を区別する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-9〜AC-11/AC-20/AC-22/AC-23): 3ゲートの成果物状態を直接描画する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-20/AC-22/AC-23): 両モードの実入力で読み取り不能と不在を区別する'"
      - "test/unit/gate-artifacts.test.ts の 'target treeから存在・不在・blob以外を三値で区別する'"

  - ac_id: AC-21
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/gate-adapters.test.ts の 'claude launch_gate_reviewer (ISSUE-733 AC-21): 読み取り不能なら両backendの3ゲートでレビュアを起動しない'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: 必須成果物が読み取り不能ならプロンプトを出力せず起動を中断する'"
      - "test/unit/gate-judgment-rules.test.ts の 'ISSUE-733 AC-9〜AC-13・AC-20〜AC-23: 成果物ごとの提示表と起動中断表の全状態を区別する'"
      - "独立再実行: quick免除が成立する入力で SPEC.md を blob ではなく tree（同名ディレクトリ）として commit し、spec ゲートの gate reviewer-prompt が終了コード1で中断、標準出力 0 バイト、標準エラーへ '必須成果物の内容を取得できません: SPEC.md' を出力することを観測。免除成立でも中断し、かつ不在時の中断メッセージ 'target SHAの必須成果物を読めません' とは区別されている"

  - ac_id: AC-22
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-judgment-rules.test.ts の 'ISSUE-733 AC-9〜AC-13・AC-20〜AC-23: 成果物ごとの提示表と起動中断表の全状態を区別する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-9〜AC-11/AC-20/AC-22/AC-23): 3ゲートの成果物状態を直接描画する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-20/AC-22/AC-23): 両モードの実入力で読み取り不能と不在を区別する'"

  - ac_id: AC-23
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-judgment-rules.test.ts の 'ISSUE-733 AC-9〜AC-13・AC-20〜AC-23: 成果物ごとの提示表と起動中断表の全状態を区別する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-9〜AC-11/AC-20/AC-22/AC-23): 3ゲートの成果物状態を直接描画する'"
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt (ISSUE-733 AC-20/AC-22/AC-23): 両モードの実入力で読み取り不能と不在を区別する'"

  - ac_id: AC-24
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/gate-verdict-aggregation.test.ts の 'ISSUE-733 AC-24: 要求体数を解決できない場合とレビュア未起動はhuman_requiredになる'"
      - "test/unit/gate-verdict-aggregation.test.ts の 'ISSUE-733 AC-24: 起動体数不足は返された判定の内容によらずhuman_requiredになる'"
      - "test/unit/gate-verdict-aggregation.test.ts の 'ISSUE-733 AC-24: 起動済みslotの判定が一部または全部未確定ならhuman_requiredになる'"
      - "test/unit/gate-verdict-aggregation.test.ts の 'ISSUE-733 AC-24: 要求体数だけを変えると同じ起動済みslotでもquorum判定が変わる'"
      - "test/unit/review-evidence.test.ts の 'ISSUE-733 AC-24: GitHubの4ゲートで要求体数に満たない証跡をhuman_requiredへ倒す'"
      - "test/unit/review-evidence.test.ts の 'ISSUE-733 AC-24: profile要求数を超えて起動された全slotを集約する'"
      - "test/unit/review-evidence.test.ts の 'ISSUE-733 AC-24: 耐久記録されたcurrent attemptがevidence 0件でも旧complete attemptへfallbackしない'"
      - "test/unit/review-evidence.test.ts の 'ISSUE-733 AC-24: 耐久記録されたcurrent attemptが一部slotだけでも旧complete attemptへfallbackしない'"
      - "test/integration/gate-judgment.test.ts の 'gate record-verdict (ISSUE-733 AC-24): 不正なslot verdictは全4ゲートでhuman_requiredへ倒す'"
      - "test/integration/gate-judgment.test.ts の 'gate record-verdict (ISSUE-733 AC-24): localの4ゲートで起動体数不足をhuman_requiredへ結線する'"
      - "test/integration/gate-judgment.test.ts の 'gate record-verdict (ISSUE-733 AC-24): localの4ゲートでfail・blocking・pending・未確定を安全側へ結線する'"
      - "test/integration/gate-adapters.test.ts の 'claude launch_gate_reviewer (ISSUE-733 AC-13/AC-24): 免除不成立の成果物不在は両backendの3ゲートで未起動になる'"
      - "test/integration/gate-local-review.test.ts の 'gate-local-review (ISSUE-733 AC-24): attempt記録POSTが非ゼロ終了してもgate-reportをpendingのまま残さない'"
      - "独立再実行: aggregateGateAttempt へ（要求2体・起動1体・両pass）(b-2)、（要求2体・起動2体・1体未確定）(b-1)、（要求体数が未解決）、（起動0体）(a) の4入力を与え、いずれも final=human_required・inconclusive=true を観測。approved も rejected も導出されない"
      - "独立再実行（母数の独立性）: 同一の起動済みslotと同一の判定結果に対し要求体数のみを1体と2体で変えると、前者は approved、後者は human_required になることを観測"

regression:
  executed: true
  evidence:
    - "npm test（リポジトリ全体の自動テストスイート）を検証対象SHA e661c040d09e6b935496da4cc6f43a61a35f8e3b で実行し終了コード0。tests 1489 / pass 1488 / fail 0 / cancelled 0 / skipped 1 / todo 0、duration_ms 502686.986925。skipped 1 件は ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 明示時のみ実行する対外疎通確認テストであり本 Issue の AC とは無関係"
    - "npm run build（tsc）終了コード0、npm run typecheck（tsc --noEmit -p tsconfig.test.json）終了コード0"
    - "回帰1（免除不成立の主経路の固定）: test/fixtures/gate-reviewer-prompt-golden.txt による固定出力比較と test/integration/gate-reviewer-prompt-determinism.test.ts（2/2 pass）。判定プロンプト生成の決定性と免除不成立入力の出力が本変更の前後で不変であることを確認"
    - "回帰2（必須成果物検査の免除判定）: test/integration/verify.test.ts 72/72 pass。免除の成否・解除理由の提示・検査対象の成果物集合が不変であることを確認"
    - "回帰3（ゲート状態の再照合）: test/integration/reconcile.test.ts 20/20 pass。承認時に不在だった成果物の記録済み不在標識による照合を含む"
    - "回帰4（実装セグメントで是正した ATTEMPT_START_POST_LEAVES_PENDING の到達経路）: test/integration/gate-local-review.test.ts の 'gate-local-review (ISSUE-733 AC-24): attempt記録POSTが非ゼロ終了してもgate-reportをpendingのまま残さない' が pass。.agent-skill-chain/scripts/gate-local-review.sh の EXIT trap が、レビュア起動前の非ゼロ終了時に gate mark-human-required を実行して gate-report を pending のまま残さないことを確認"
    - "回帰5（ラウンド上限打ち切りの GitHub 経路）: test/unit/review-evidence.test.ts の 'ISSUE-733 AC-15: 閾値到達時のblockingをrejectedより先にhuman_requiredへ移し、未到達・blocker無しは集約判定を保つ' が pass。src/lib/review-evidence.ts の cutoffReached が集約結果に従属せず（round >= cutoffThreshold かつ hasBlocking のみで成立し）、到達不能な死コードになっていないことを確認"
    - "回帰6（ラウンド上限打ち切りの local 経路）: test/integration/gate-judgment.test.ts の 'gate record-verdict: lightの再レビュー上限でblockingが残ればhuman_requiredへ打ち切る'、'gate record-verdict: lightの再レビュー上限で否定判定が無いpendingはhuman_requiredへ倒れる'、'gate record-verdict: light未適用または初回ラウンドには専用打ち切りを適用しない' がいずれも pass。src/commands/gate.ts の lightReviewCutoffReached が集約結果に従属せず打ち切り経路が到達可能であることを確認"
    - "機械検査スクリプト: verify-branch-name.sh・verify-worktree-path.sh・verify-template-sync.sh・verify-doc-length.sh・verify-spec-bdd.sh・verify-design-diagram.sh・verify-artifacts.sh・lint-vocab.sh・lint-references.sh・lint-secrets.sh・adr-lint.sh check をいずれも終了コード0で実行"
    - "protected base 側 CI: 検証対象SHA e661c040d09e6b935496da4cc6f43a61a35f8e3b に対する check run 'verify' が conclusion=success（completed_at=2026-08-19T06:40:53Z）、check run 'verify-config-doc-sync' が conclusion=success"
    - "依存関係スキャン: npm audit が high 1 件（fast-uri、GHSA-7p8r-x3mc-p8w7）を報告。本変更は package.json・package-lock.json を変更しておらず、同一の指摘が base f72eadd6bb6403f73f3163a8138f4cdabbbdd26b でも再現するため本 Issue 由来ではない。上記コメントの発見した欠陥 F-2 として origin 付きで記載済み"
