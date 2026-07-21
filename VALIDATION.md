# VALIDATION: agent-skill-chain — repoRoot() の worktree 分裂バグ解消・launch_worker 認証チェックの誤検知解消
#
# 本ファイルは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）に完全一致する単一YAMLドキュメントである。
#
# 注記: .agent-skill-chain/templates/issue/VALIDATION.md のテンプレートは Markdown見出し +
# AC毎の複数```yaml```フェンス構造だが、src/commands/verify.ts の acCoverage() は本ファイル全体を
# readYamlFile()（yamlパッケージ parse() を生テキストへ直接適用）で1つのYAML文書として読み込むため、
# Markdown見出しや複数フェンスを混在させるとパースに失敗する（先行 issue #171・#176 で実機確認済み）。
# よって本ファイルはテンプレートの見出し構造ではなく、スキーマが要求するフィールドをすべて満たす
# 1つのYAMLとして記述し、散文（目的・対象範囲・前提・検証方法・Given/When/Then・所見）は本コメント
# ブロックで表現する。
#
# ─────────────────────────────────────────────────────────────────────────────
# 目的・対象範囲・前提（自己完結）
# ─────────────────────────────────────────────────────────────────────────────
# 目的: SPEC.md が確定した2つの独立バグ——(1) src/lib/paths.ts の repoRoot() が git worktree 内から
#   呼ばれると worktree 自身のパスを返し coordination 状態が worktree 内へ分裂する、(2)
#   .agent-skill-chain/adapters/claude.sh の認証チェックが環境変数の非空のみで判定しキーチェーン等の
#   セッション認証を「認証欠如」と誤判定する——の恒久解消と、Issue #180・#183 で持ち越された
#   「launch_worker 自身の1セグメント完走検知」の実機成立を、AC-1〜AC-8 の観点で独立に検証する。
# 対象範囲: 本 worktree（feature/185-reporoot-worktree-split、base chore/162-agent-skill-chain-bootstrap、
#   Draft PR #186）の commit 109c023 時点のコード・テスト・成果物。
# 前提: 本リポジトリは agent-skill-chain の正本（配布元）であると同時にドッグフーディング消費者でもある。
#   本 worktree 自体が linked worktree（ルート直下の .git がファイル）であり、AC-1 が対象とする条件を
#   検証環境自身が満たす。git 2.31+（--path-format=absolute 前提）・node/tsx・実 claude CLI が利用可能。
#
# 検証者の立場: 本検証は実装エージェント（タスク#1〜#6）および実機ライブ検証を実施した進行役（タスク#7）
#   とは別の独立検証ワーカーとして実施した。前段の報告を鵜呑みにせず、コードを実際に読み・ビルドと
#   テストを自ら再実行し・報告内容とコード実装の論理整合を独立に確認した。ライブの claude CLI 起動
#   （AC-6/AC-7）は使い捨て fixture が後始末済みのため再起動しないが、その成立を可能にする修正
#   （repoRoot の一貫化・認証2段化）がコード上で正しく実装され、報告された挙動と論理的に整合することを
#   独立に確認した（後述 AC-6/AC-7 の procedure 参照）。
#
# ─────────────────────────────────────────────────────────────────────────────
# 独立に再実測した内容（前段報告の追認ではなく自ら実行）
# ─────────────────────────────────────────────────────────────────────────────
# - src/lib/paths.ts を通読: repoRoot() が fs.lstatSync で .git の種別を判定し、ディレクトリなら従来
#   どおり即返す（git バイナリを呼ばない高速パス・regressionゼロ）、ファイル（linked worktree）なら
#   resolveMainWorktreeRoot() で `git rev-parse --path-format=absolute --git-common-dir` の dirname を
#   一次手段、失敗時は .git ファイルの gitdir: + commondir の純fsパースをフォールバック、いずれも失敗時は
#   明示エラーで停止することを確認。worktreeRoot()（`git rev-parse --show-toplevel`）新設を確認。報告と一致。
# - src/commands/checkpoint.ts: `const root = worktreeRoot()` へ切替済みを確認（git add/commit/push が
#   自 worktree・自 branch を対象とし続け、メイン作業ツリー誤 commit を防ぐ）。報告と一致。
# - src/commands/verify.ts: DESIGN.md 設計要素Bの列挙は checkpoint.ts のみだったが、branchName()（判定対象は
#   現在の作業ツリーのチェックアウトブランチ）と gateReport()（approved_artifacts はレビュー実行 worktree 上の
#   ファイル）も worktreeRoot() 基点へ変更されていた。これは ADR-0004 の原則（作業コピー基点は worktreeRoot、
#   coordination/同一性は repoRoot）に照らして正しく必要な追加修正であり、前段報告の「DESIGN列挙外の追加対応」
#   の申告とも一致する（commit 10af8bc）。config（branch.pattern）・スキーマ検証は repoRoot() のまま維持され整合。
# - test/unit/scan.test.ts: 本 worktree 自身のアセット存在確認という意図に合わせ repoRoot()→worktreeRoot() へ
#   変更済み（linked worktree 環境では repoRoot がメイン側を返すため）。妥当な追随修正であることを確認。
# - .agent-skill-chain/adapters/claude.sh: 共通ヘルパ _claude_auth_ok を通読。(a) ANTHROPIC_API_KEY /
#   CLAUDE_CODE_OAUTH_TOKEN いずれか非空なら return 0（高速パス・実値非ログ）、(b) 両 env 無なら
#   CLAUDE_AUTH_PROBE_CMD（未指定時 `claude auth status`、claude 不在なら return 1）を
#   CLAUDE_AUTH_PROBE_TIMEOUT_SEC（既定20）で timeout 実行し終了コード0のみ authed、出力は >/dev/null 2>&1 で
#   非ログ、を確認。launch_worker は `if ! _claude_auth_ok; then _fail_blocked ...`、launch_gate_reviewer は
#   `_fail_safe ...` へ配線済みを確認。報告と一致。
# - docs/adr/ADR-0004-worktree-path-resolution.md: status: proposed で存在。「基準ディレクトリ解決を
#   共通作業ツリー(repoRoot)と現在の worktree(worktreeRoot) の2責務へ分離する」判断を記録。DESIGN の
#   related_adrs: ADR-0004(adopts) と整合。
# - ビルド: `npm run build`（tsc）を自ら実行 → exit 0。
# - テスト: `npm test` を自ら実行 → tests 407 / pass 407 / fail 0 / skipped 0（duration 147s）。前段報告の
#   「407/407 pass」と完全一致。regression なし。
#
# ─────────────────────────────────────────────────────────────────────────────
# AC-1〜AC-8 Given/When/Then と PASS/FAIL 判定（実測）
# ─────────────────────────────────────────────────────────────────────────────
# AC-1 [PASS] repoRoot() が worktree 内から呼ばれてもメイン作業ツリーと同一の基準ディレクトリを返す
#   Given: test/unit/paths.test.ts が実 `git init` + `git worktree add` でメイン(mainRoot)と linked worktree
#     (worktreePath, .git はファイル)を構築。
#   When: repoRoot(worktreePath)・repoRoot(worktreePath/a/b)・repoRoot(mainRoot) を呼ぶ。
#   Then: いずれも mainRoot を返し、repoRoot(worktreePath) === repoRoot(mainRoot) が成立。当該テスト群 pass。
#     実装 resolveMainWorktreeRoot() の一次手段（--git-common-dir の dirname）が効いている。→ PASS。
#
# AC-2 [PASS] 通常リポジトリでの repoRoot() 返り値が従来どおりで regression がない
#   Given: .git がディレクトリの通常リポジトリ（深い階層・起点自身が .git 保持・.git 皆無の3系列）。
#   When: repoRoot() を各起点で呼ぶ。
#   Then: 通常リポジトリではルートを返し、.git 皆無では `/\.git が見つかりません/` で throw。paths.test.ts の
#     AC-2 テスト3件 pass。lstatSync().isDirectory() 分岐が従来経路を1バイトも変えず git を呼ばないことを
#     コードで確認。→ PASS。
#
# AC-3 [PASS] 同一 issue の coordination 状態が worktree とメイン作業ツリーで同一実体を指す
#   Given: test/integration/report.test.ts（local backend）で issue start により生成した worktree。
#   When: worktree 内（cwd=worktreePath）から `report status ISSUE-1 spec_worker spec completed <sha>` を実行し、
#     メイン側（cwd=repo.dir）から `report latest ISSUE-1 spec` を読む。
#   Then: 書込み先が repo.dir/issues/1/.agent-skill-chain/reports/spec.yaml（メイン基点）であり、worktree 側には
#     分裂ファイルが作られず（existsSync=false をアサート）、メイン側から status=completed・target_sha 一致が
#     読める。当該テスト pass。進行役ライブ検証でも state/lease/integration/reports がメイン側 issues/1/ 配下に
#     一元化されていたと報告され、自動テストと整合。→ PASS。
#
# AC-4 [PASS] 認証チェックが env 認証情報なしでも実疎通で認証済み環境を認証欠如と誤判定しない
#   Given: env（ANTHROPIC_API_KEY/CLAUDE_CODE_OAUTH_TOKEN）を除去し、CLAUDE_AUTH_PROBE_CMD='true'（認証済みを
#     模す exit0 スタブ）を注入した launch_worker（test/integration/worker-adapters.test.ts）。
#   When: launch_worker の認証チェックを通過させる。
#   Then: 認証欠如の fail-safe（blocked）が発火せず通常の完了経路へ進む。当該自動テスト pass。加えて進行役の
#     ライブ検証で env 未設定（キーチェーン認証）のまま launch_worker が本物 claude CLI を起動し完走したと
#     報告されており（hybrid の live 側）、モック側自動テストと論理整合。→ PASS。
#
# AC-5 [PASS] 真の認証欠如時は引き続きフェイルセーフが発火する（regression なし）
#   Given: env 未設定 + CLAUDE_AUTH_PROBE_CMD='false'（プローブ常時失敗）の対照条件（worker-adapters /
#     gate-adapters 両テスト）。
#   When: 同条件で認証チェックを起動する。
#   Then: launch_worker は _fail_blocked（report_status blocked / 非0非3）、launch_gate_reviewer は _fail_safe
#     （final=human_required / 非0非3）へ倒れる。当該自動テスト pass。既存の認証欠如テストも
#     CLAUDE_AUTH_PROBE_CMD='false' 注入で hermetic 化され real auth 非依存で pass。進行役ライブ対照検証でも
#     CLAUDE_AUTH_PROBE_CMD=false + env 未設定で status=blocked・exit 2 を報告。AC-4 との対照により「実際に
#     認証済みなら通し、真に欠如なら倒す」が裏付けられた。→ PASS。
#
# AC-6 [PASS] launch_worker が本物の claude CLI で1セグメントを人間介在なく完走し、自身もそれを検知する
#   Given: worker.adapter: claude・本物 claude CLI（キーチェーン認証、`claude auth status` が loggedIn:true を
#     返す環境）・local backend の使い捨て issue（進行役がタスク#7で /tmp fixture を用い実施）。
#   When: worktree 内から env 認証変数を一切設定せず launch_worker ISSUE-1 spec を起動。
#   Then: 本物の claude が SPEC.md 作成・git commit(b44766c)・git push・report status completed まで人間介在なく
#     完走し、launch_worker 自身が exit 0 で完了を検知。メイン側から report latest が status=completed・
#     target_sha=b44766c（worktree 実 HEAD と一致）を読めた。Issue #180・#183 で未達だった真の AC-6 が達成。
#   独立検証者の裏付け: ライブ fixture は後始末済みのため再起動していないが、(i) repoRoot() 修正により worker が
#     worktree 内から書いた report がメイン側 launch_worker から同一実体で読める経路が AC-3 自動テストで成立、
#     (ii) 認証2段化により env 無キーチェーン環境が誤 blocked されない経路が AC-4 自動テストで成立しており、
#     この2点が修正前に AC-6 を阻んでいた false negative の直接原因（repoRoot 分裂・認証誤検知）を解消する
#     ことをコードレベルで確認した。報告された b44766c 完走・exit 0 検知はこの実装と論理的に整合する。→ PASS。
#
# AC-7 [PASS] launch_worker 完走・自己検知の証跡（ログ・report-status 記録）が残る
#   Given: AC-6 の実機起動。
#   When: 進行役が launch_worker 実行ログと report-status 記録を採取。
#   Then: 「人間介在なしに spec セグメントが completed（target_sha=b44766c 一致）となり launch_worker が exit 0 で
#     検知、blocked/human_escalation_requested の誤発火なし」が report 履歴として記録され、対照条件（AC-5）では
#     blocked が正しく記録された。証跡は本 VALIDATION.md（Given/When/Then と report latest 実測値）および進行役の
#     タスク#7 報告として本 issue に残る。認証実値・auth status 出力は非ログ（claude.sh の非ログ実装で担保）。
#   独立検証者の所見: 証跡は進行役採取のライブ記録に依拠する（独立検証者はライブを再起動していない）。この点は
#     hybrid/manual の一回性検証の性質上妥当であり、AC-3/AC-4 自動テストが同経路を hermetic に再現可能にして
#     いることで補強される。→ PASS。
#
# AC-8 [PASS] 既存テストスイートが全て pass しビルドが通る（regression なし）
#   Given: 本 issue 全変更（repoRoot worktree 対応・認証2段化・追加テスト）反映済みの commit 109c023。
#   When: 独立検証者が `npm run build` と `npm test` を自ら実行。
#   Then: build exit 0、tests 407 / pass 407 / fail 0 / skipped 0。既存テスト + 新規（AC-1/AC-2/AC-3/AC-4/AC-5
#     自動化部分）が全 pass。前段報告「407/407」と一致。→ PASS。
#
# ─────────────────────────────────────────────────────────────────────────────
# 前段報告との突合結果・findings・残る軽微な制約
# ─────────────────────────────────────────────────────────────────────────────
# 突合: 実装エージェント（#1〜#6）および進行役ライブ検証（#7）の報告と、独立に再確認したコード・ビルド・
#   テスト結果との間に食い違いは検出されなかった。テスト件数（407/407）・commit（10af8bc, 109c023）・
#   paths.ts / checkpoint.ts / verify.ts / claude.sh / ADR-0004 の実装内容がすべて報告と一致した。
# finding-1 [情報/軽微]: DESIGN.md 設計要素Bは worktreeRoot() 退避対象として checkpoint.ts のみを列挙していたが、
#   実装では verify.ts の branchName()・gateReport() および test/unit/scan.test.ts も同一原則で worktreeRoot()
#   へ切替が必要だった。これは前段報告で正直に申告済みであり、ADR-0004 の原則に照らして正しい必須の追加対応。
#   設計文書の列挙漏れは軽微（実装は正しく網羅）。今後 DESIGN の影響範囲列挙に verify.ts を含めると精度が上がる。
# finding-2 [情報/軽微]: AC-6/AC-7 のライブ証跡は進行役がタスク#7で採取したものであり、独立検証者はライブを
#   再起動していない（fixture 後始末済み・一回性検証の性質上妥当）。独立検証者の裏付けは AC-3/AC-4 自動テストに
#   よる同経路の hermetic 再現と、修正コードの論理整合確認による。ライブ結果の完全な第三者再現までは行っていない
#   点を正直に記載する（合否判定には影響しない）。
# 残る軽微な制約: 認証プローブ `claude auth status` の終了コード契約は claude CLI バージョン依存。緩和は
#   CLAUDE_AUTH_PROBE_CMD 上書きとプローブ失敗＝安全側 blocked（DESIGN 記載済み・設計上の許容トレードオフ）。
#
# ─────────────────────────────────────────────────────────────────────────────
# 全体所見
# ─────────────────────────────────────────────────────────────────────────────
# AC-1〜AC-8 の全8件が PASS。2つの根本バグ（repoRoot の worktree 分裂・認証チェックの env 非空のみ判定）は
# コード上で恒久解消され、通常経路の regression ゼロ（AC-2）・407/407 テスト pass（AC-8）を独立に再実測で確認した。
# Issue #180・#183 で未達だった「launch_worker 自身の人間介在なし完走・自己検知」が、今回のライブ検証で真に達成
# されたと進行役が報告し、独立検証者はその成立を可能にする修正がコード・自動テストレベルで論理整合することを
# 確認した。SPEC.md / DESIGN.md / PLAN.md との整合も確認済み（全 AC が対応タスクを持ち、孤児 AC・孤児テスト参照
# なし）。前段報告との食い違いは無し。DESIGN 列挙外の追加修正（verify.ts）も正直に申告・記載されており、完璧の
# 偽装は認められない。総合判定: 全 AC PASS。Draft PR #186 は Ready 化してよい状態と判断する（最終判断は進行役）。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-185
target_sha: 109c023cb2078bdaf6ac1394a5d9f75f74923a22

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/paths.test.ts（repoRoot: linked worktree内から呼ぶとメイン作業ツリールートを返す 他）"
      - "src/lib/paths.ts（resolveMainWorktreeRoot / repoRoot の .git 種別判定）"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/paths.test.ts（通常リポジトリ・regressionなし / .git 皆無で例外の3系列）"
      - "src/lib/paths.ts（lstatSync().isDirectory() のディレクトリ即返し高速パス）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/report.test.ts（AC-3: worktree内から実行したreportがメイン作業ツリー側から同一実体として読める）"

  - ac_id: AC-4
    verification:
      mode: hybrid
      result: pass
      reason: "実疎通確認はCLAUDE_AUTH_PROBE_CMDでモックし自動テスト化できる一方、真のキーチェーン認証環境での不誤判定は本物のclaude CLIを用いたライブ実機でしか裏付けられないため。"
      procedure: "自動: env除去+CLAUDE_AUTH_PROBE_CMD='true'（exit0スタブ）でlaunch_workerのfail-safeが不発火し起動処理へ進むことをworker-adapters.test.tsで検証（独立検証者がnpm testで再実行しpass確認）。ライブ: 進行役がタスク#7でenv認証変数未設定（キーチェーン認証）のままlaunch_worker ISSUE-1 specを起動し誤blockedなく完走したことを報告、独立検証者は_claude_auth_okの2段実装と自動テスト経路の論理整合をコードで確認。"
      executor: "独立検証ワーカー（claude/opus、自動テスト再実行・コード整合確認）＋進行役（ライブ実機、タスク#7）"
    evidence:
      - "test/integration/worker-adapters.test.ts（env認証情報が無くてもCLAUDE_AUTH_PROBE_CMD成功なら起動処理へ進む）"
      - ".agent-skill-chain/adapters/claude.sh（_claude_auth_ok 2段判定・実値非ログ）"

  - ac_id: AC-5
    verification:
      mode: hybrid
      result: pass
      reason: "実疎通失敗はプローブモック（exit≠0）／env操作で自動テスト化できるが、AC-4の正常環境との対照（実際に認証済みなら通す）はライブ実機を伴うため。"
      procedure: "自動: env除去+CLAUDE_AUTH_PROBE_CMD='false'でlaunch_workerが_fail_blocked（blocked/非0非3）、launch_gate_reviewerが_fail_safe（human_required/非0非3）へ倒れることをworker-adapters/gate-adapters両テストで検証、既存認証欠如テストも同注入でhermetic化。独立検証者がnpm testで407/407 pass再実測。ライブ対照: 進行役がCLAUDE_AUTH_PROBE_CMD=false+env未設定でstatus=blocked・exit2を報告。"
      executor: "独立検証ワーカー（claude/opus、自動テスト再実行）＋進行役（ライブ対照、タスク#7）"
    evidence:
      - "test/integration/worker-adapters.test.ts（真の認証欠如でblocked+lease解放+非0非3）"
      - "test/integration/gate-adapters.test.ts（認証欠如でhuman_requiredへfail-safe / hermetic化）"

  - ac_id: AC-6
    verification:
      mode: manual
      result: pass
      reason: "本物のclaude CLI・実認証を用いたライブ起動の一回性検証であり、モデル起動を伴うため自動テストスイートに常設できないため。"
      procedure: "進行役がタスク#7で/tmp使い捨てfixture（local backend・独立bare remote）にissue startで起票後、worktree内からenv認証変数未設定でlaunch_worker ISSUE-1 specを起動。本物claudeがSPEC.md作成・git commit(b44766c)・git push・report status completedまで人間介在なく完走し、launch_worker自身がexit 0で完了検知。メイン側から report latest ISSUE-1 spec が status=completed・target_sha=b44766c（worktree実HEAD一致）を返すことを確認。独立検証者は本ライブを再起動せず、AC-3（coordination同一実体化）・AC-4（認証2段化）の自動テスト成立と修正コードの論理整合により、修正前にAC-6を阻んでいたrepoRoot分裂・認証誤検知の解消を確認。"
      executor: "進行役（ライブ実機、タスク#7）＋独立検証ワーカー（claude/opus、コード・自動テストによる論理整合の独立確認）"
    evidence:
      - "src/lib/paths.ts / src/commands/checkpoint.ts（repoRoot=メイン基点・checkpoint=worktreeRoot切替）"
      - "test/integration/report.test.ts（AC-3同経路のhermetic再現）"
      - "進行役タスク#7ライブ報告（report latest: status=completed, target_sha=b44766c, lease解放, exit 0）"

  - ac_id: AC-7
    verification:
      mode: manual
      result: pass
      reason: "ライブ実機起動の実行ログ・report-status記録の採取・記載であり、一回性のため自動テスト化できないため。"
      procedure: "進行役がAC-6のライブ起動の実行ログとreport-status記録を採取。人間介在なしにspecセグメントがcompleted（target_sha=b44766c一致）となりlaunch_workerがexit 0で検知、blocked/human_escalation_requestedの誤発火が無いことをreport履歴で確認。対照条件（AC-5、CLAUDE_AUTH_PROBE_CMD=false）ではblockedが正しく記録されたことも確認。認証実値・auth status出力は非ログ（claude.sh実装で担保）。証跡は本VALIDATION.mdのGiven/When/Then実測値と進行役タスク#7報告として本issueに残る。"
      executor: "進行役（ライブ証跡採取、タスク#7）＋独立検証ワーカー（claude/opus、証跡整合の確認・記載）"
    evidence:
      - "本VALIDATION.md（AC-6/AC-7 Given/When/Then と report latest 実測値の記載）"
      - "進行役タスク#7ライブ報告（誤blocked不発火・対照条件でのblocked正常記録）"

  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
    evidence:
      - "npm run build（tsc）exit 0（独立検証者が再実行）"
      - "npm test: tests 407 / pass 407 / fail 0 / skipped 0（独立検証者が再実行、前段報告と一致）"

regression:
  executed: true
  evidence:
    - "npm test: 407/407 pass（独立検証ワーカーがcommit 109c023で再実測、regressionなし）"
    - "npm run build（tsc）exit 0（独立検証ワーカーが再実測）"
