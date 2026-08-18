# 由来: AGENTS.md が定める不変条件I7（仕様⇔検証の追跡）の規約に基づく雛形である。
#
# このファイルは Issue 毎に複製して使う（セグメント: validation、ゲート: validation-gate）。
# フィールドは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）と完全一致させる。全体が単一のYAML文書として
# 読み込まれるため、見出し相当の情報はすべてコメント（#）で表現する。
#
# ============================================================================
# 目的
# ============================================================================
# ISSUE-741 の変更（必須成果物検査の対象集合 R を、開始済みセグメント集合 S の上流へ
# 閉包追加して導出する変更）について、実装セグメントとは独立に受入・統合・回帰の各検査を
# 実行し、SPEC.md が定める全 AC-ID の成否と回帰の有無を確定する。
#
# ============================================================================
# 証跡の単一基準リビジョン（本ファイルの最重要規約）
# ============================================================================
# 本ファイルが AC-1〜AC-16 の充足および回帰不在の証跡として採用するのは、
# target_sha = 877d18edf914e9021f7c56c74c4a22c849ba53bb に対する実行結果だけである。
# これより前のリビジョンでの実行結果は、後述の「経緯」節にのみ記載し、AC 充足の証跡としては
# 一切用いない。両者は節が分かれており、AC-ID の evidence 配列に現れるのは target_sha に
# 対する実行結果のみである。
#
# ============================================================================
# 対象範囲
# ============================================================================
# 対象は branch bugfix/741-verify-artifacts-unstarted-segments の
# 877d18edf914e9021f7c56c74c4a22c849ba53bb が含む次の変更である。
#   - 対象集合 R を導出する純関数の新設（src/lib/artifact-targets.ts）
#   - 必須成果物検査コマンドへの一括呼び出し形式の追加（src/commands/verify.ts）
#   - quick 判定への「シグナル解決可否」の追加（src/lib/quick-mode.ts）
#   - セグメント連鎖順序の導出（src/lib/segments.ts）
#   - CI ワークフローの権限・トークン付与と一括呼び出しへの切替（展開結果と配布テンプレート）
#   - 上記に対応する自動テストの追加・変更
# 対象外は「本セグメントの対象外」節に記す。
#
# ============================================================================
# 前提
# ============================================================================
# - spec-gate・design-gate はいずれも承認済みであり、SPEC.md・DESIGN.md・PLAN.md・
#   docs/adr/ADR-0067-required-artifact-target-set-upstream-closure.md は本セグメントでは変更しない。
# - implementation-gate は strict の両 slot とも blocking ゼロで進行役が承認済みである。
#   両 slot の inconclusive は、判定プロンプトが成果物の引用元ファイルを展開しないという
#   レビュア側の観測制約に起因し、成果物の欠陥ではないと進行役が判定している
#   （構造的問題は Issue #767 として別途起票済み）。本セグメントは、その観測制約により
#   レビュアが確認できなかった2点をリポジトリのファイルへ直接到達して検証する責務を負う。
# - 本セグメントは独立検証であり、欠陥を検出しても是正は行わず事実として記録する。
#
# ============================================================================
# 用語（本ファイル内での定義）
# ============================================================================
# S: 開始済みセグメント集合。PR 差分に現れたファイル種別から導出される。
# R: 必須成果物検査の対象集合。S に上流セグメントを閉包追加して導出される。
# 閉包追加: S の最も下流の要素より上流にある要求・要件セグメント／設計・実装計画セグメントを、
#           開始済みでなくても R へ加えること。実装セグメント・独立検証セグメントは加えない。
# quick シグナル: GitHub モードでは Issue ラベル、ローカルモードでは Issue 状態ファイルの
#                 size／risk フィールド。成果物ファイルには一切依存しない。
#
# ============================================================================
# 入力
# ============================================================================
# - SPEC.md（受入条件 AC-1〜AC-16、要件1〜11）
# - DESIGN.md・PLAN.md（必須テストケース一覧を含む）
# - 実装コードと自動テスト（上記「対象範囲」に列挙）
#
# ============================================================================
# 検証環境（個々のACのevidenceでは繰り返さない）
# ============================================================================
# - ホスト: Linux / bash / node v24.19.0 / npm 11.17.0 / git 2.43.0
# - branch bugfix/741-verify-artifacts-unstarted-segments、
#   検証対象 SHA 877d18edf914e9021f7c56c74c4a22c849ba53bb
#   （下記のすべての実行の直前に git rev-parse HEAD で確認し、
#   git status --porcelain が空＝作業ツリー未変更であることも確認した）
# - 自動テスト: npm test（pretest で npm run build を実行）
# - 手動実行は、いずれも本ワークツリーのファイルを変更せずに行った。一時領域を用いる
#   確認は OS の一時領域に作成し、実行後に破棄した。
# - 本ファイル自身の更新 commit は上記のすべての実行が完了した後に行うため、
#   commit により進む PR head は target_sha の証跡に影響しない。
#
# ============================================================================
# 検証内容と結果（A）target_sha でのテストスイート・型検査・build
# ============================================================================
# npm run build            -> 終了コード 0（tsc）
# npm run typecheck        -> 終了コード 0（tsc --noEmit -p tsconfig.test.json）
# npm test                 -> 終了コード 0
#     tests 1366 / suites 0 / pass 1365 / fail 0 / cancelled 0 / skipped 1 / todo 0
#     duration_ms 323548.537367
#     skip 1件の同定: test/integration/cli-resolve.test.ts の
#     「GitHub導入元へ実際に到達してpackage versionを取得できる」。当該テストは
#     ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 が指定された場合だけ実ネットワークへ到達する
#     opt-in であり、未指定時は自らを skip する。ISSUE-741 の変更とは無関係である。
# この1回の実行が、以下の全 AC の automated evidence の実行実体である。AC ごとに
# 別のリビジョンで実行した結果を混在させていない。
#
# ============================================================================
# 検証内容と結果（B）target_sha で、ゲートレビュアが inconclusive とした2点を直接検証
# ============================================================================
# 【B-1】CI ラッパーから CLI への引数転送（欠落の有無）
#   確認したもの: .agent-skill-chain/ci/verify-artifacts.sh の委譲行は
#   `exec "${ASC_CLI[@]}" verify artifacts "$@"` であり、位置パラメータを "$@" で展開する。
#   これは各引数を単語分割・パス名展開の対象にせず、空文字列も1個の引数として保持する
#   bash の展開形式である。CI ワークフローの呼び出しは
#   verify-artifacts.sh <issue_id> --started-segments <値> の3引数形式である。
#   実行による確認: target_sha の本番ファイル2件（verify-artifacts.sh と cli-resolve.sh）と
#   バイト同一の複製（cmp で一致を確認）を、argv を記録するスタブへ委譲させる構成で起動し、
#   転送後の argv を実測した。
#     3引数形式 -> argc=5、argv=[verify, artifacts, ISSUE-741, --started-segments,
#                  spec,design,implementation,validation]
#     空集合    -> argc=5、5番目が空文字列として保持される（欠落・繰り上がりなし）
#     空白と $() と * を含む値 -> argv[4]=<a b $(id) *> がそのまま到達（分割も展開もされない）
#     引数ゼロ  -> argc=2（verify artifacts のみ）
#   実 CLI での通し確認: target_sha の本ワークツリーで
#   ./.agent-skill-chain/ci/verify-artifacts.sh ISSUE-741 --started-segments spec,design,implementation,validation
#   を実行し、終了コード0で対象集合の要約（4件すべて「開始済み」）が出力されることを確認した。
#   判定: 欠落なく転送される。齟齬なし。
#
# 【B-2】base 解決不能・差分算出不能時の非0終了と標準エラー出力（AC-2／要件6）
#   確認したもの: .agent-skill-chain/scripts/detect-changed-segments.sh は、
#   引数欠落・base 解決失敗・git diff 失敗の3経路それぞれで標準エラー出力へ理由を書き、
#   終了コード1で終了する。base 解決は origin/<ref> と <ref> の2段で試み、どちらも
#   解決できない場合にだけ失敗させる。
#   実行による確認（target_sha の本ワークツリーで直接実行）:
#     引数なし              -> 終了コード1、標準エラー「使い方: detect-changed-segments.sh <base_ref>」
#     解決不能な base ref   -> 終了コード1、標準エラー「base branchを解決できません: no-such-base-ref-xyz」
#                              標準出力は 0 バイト（対象集合を導出していない）
#     blob を base に指定    -> 終了コード1、標準エラー
#                              「git diff failed for <blob-sha>...HEAD」
#                              （base 解決失敗とは区別できる別文面）
#     正常系（base=main）   -> 終了コード0、標準出力 spec/design/implementation/validation
#   CI ステップとしての伝播確認: ワークフローの当該実行段の本文を取り出し、GitHub Actions の
#   既定シェルと同じ bash --noprofile --norc -e で単体実行した。当該段は導出コマンドをパイプへ
#   通さずコマンド置換の代入で受けるため、pipefail の有無に依存せず -e が失敗を捕捉する。
#     BASE_REF=解決不能 -> 段の終了コード1、GITHUB_OUTPUT は 0 行
#                          （失敗を空の S へ読み替えない）
#     BASE_REF=差分なし（target_sha 自身を base に指定）
#                       -> 段の終了コード0、GITHUB_OUTPUT へ values=（空文字列）を書く
#     BASE_REF=main     -> 段の終了コード0、values=spec,design,implementation,validation
#   判定: 非0終了と所定の標準エラー出力が行われる。齟齬なし。
#
# ============================================================================
# 検証内容と結果（C）target_sha で本ブランチへ適用される検査スクリプトの実行
# ============================================================================
# 本ブランチの CI が実行する検査を target_sha の手元で実行した結果（すべて終了コード0）。
#   .agent-skill-chain/ci/verify-branch-name.sh        -> 0
#   .agent-skill-chain/ci/verify-worktree-path.sh      -> 0
#   .agent-skill-chain/ci/verify-template-sync.sh      -> 0
#   .agent-skill-chain/ci/verify-spec-bdd.sh SPEC.md   -> 0
#   .agent-skill-chain/ci/verify-design-diagram.sh DESIGN.md -> 0
#   .agent-skill-chain/ci/verify-adr.sh docs/adr/ADR-0067-required-artifact-target-set-upstream-closure.md -> 0
#   .agent-skill-chain/ci/verify-doc-length.sh         -> 0
#   .agent-skill-chain/ci/verify-config-doc-sync.sh    -> 0
#   .agent-skill-chain/ci/verify-root-clean.sh         -> 0
#   .agent-skill-chain/ci/verify-ac-coverage.sh ISSUE-741 -> 0
#   .agent-skill-chain/scripts/lint-vocab.sh           -> 0
#   .agent-skill-chain/scripts/lint-references.sh      -> 0
#   .agent-skill-chain/scripts/lint-secrets.sh --diff origin/main -> 0
#   .agent-skill-chain/scripts/adr-lint.sh check       -> 0
# 対象集合の導出と一括検査（CI と同じ2段構成を target_sha の手元で再現）:
#   detect-changed-segments.sh main -> 終了コード0、
#     出力を paste -sd, で連結した値は spec,design,implementation,validation
#   verify-artifacts.sh ISSUE-741 --started-segments spec,design,implementation,validation
#     -> 終了コード0、対象集合は4件すべて「開始済み」（閉包追加は不要な状態）
#   verify-artifacts.sh ISSUE-741 --started-segments ""（空の S）
#     -> 終了コード0、「必須成果物検査の対象集合: （空）」、未解決通知なし
#
# ============================================================================
# 検証内容と結果（D）target_sha に対するリモート CI 実行結果
# ============================================================================
# PR #746 の head は target_sha 877d18edf914e9021f7c56c74c4a22c849ba53bb であり、
# 当該 SHA に対する GitHub Actions の実行結果は次のとおり。
#   Check Run: verify -> completed / success、verify-config-doc-sync -> completed / success
#   workflow run: 「agent-skill-chain / ci」 -> success、
#                 「agent-skill-chain / config documentation sync」 -> success
#   verify job の全ステップ: verify-root-clean (merge-ready) のみ skipped
#   （PR が Draft のため実行条件を満たさない）。Derive issue_id・verify-branch-name・
#   verify-worktree-path・verify-template-sync・Detect started segments・
#   verify-artifacts (対象集合を一括検査)・verify-spec-bdd・verify-design-diagram・
#   verify-ac-coverage・verify-adr・lint-vocab・lint-references・lint-secrets・adr-lint を
#   含む他の全ステップが success。
#   verify-artifacts ステップのログには
#   `./.agent-skill-chain/ci/verify-artifacts.sh "ISSUE-741" --started-segments "spec,design,implementation,validation"`
#   の実行と、対象集合4件の要約が記録されている。すなわち本変更が導入した3引数形式の
#   呼び出しは、target_sha において実 CI 環境でも通しで成立している。
# PR は Draft のままであり、本セグメントでは遷移させていない。マージ準備の判断は進行役の責務である。
#
# ============================================================================
# 経緯（AC 充足の証跡ではない。検出と是正の履歴として保持する）
# ============================================================================
# 本節は target_sha より前のリビジョンでの観測を記録する。AC-1〜AC-16 の evidence には
# 一切用いない。上記（A）〜（D）とは独立に読むこと。
#
# 【経緯1】独立検証の初回実施（HEAD が 4a5b65331ca1c717606aa2517a71b28e45a440d3 の時点）
#   実装の振る舞いに欠陥は検出しなかった。一方で、PLAN.md が「網羅の要であり、いずれも
#   省略しない」と定める必須テストケースのうち2件について、対応する自動テストが
#   リポジトリに存在しないことを検出した。いずれも振る舞い自体は独立実行により
#   期待どおりであることを確認しており、実装の欠陥ではなくテスト被覆の欠落であった。
#
#   【V1】必須テストケース「免除解除かつ充足」（対応 AC-10）の自動テストが無かった
#     検出方法: quick 免除の解除通知を期待する assertion をテスト全体から列挙したところ、
#     該当は3箇所で、いずれも終了コード1（失敗）を期待するケースだった。解除かつ全成果物
#     充足で成功することを固定する assertion は存在しなかった。
#     影響: 当時の実装は正しいが、免除解除時に閉包追加後の充足を成功と判定する挙動が
#     将来の変更で失われても自動テストは検出しない状態だった。
#
#   【V2】必須テストケース「閉包追加あり・開始済み分のみ欠落」（対応 AC-9）の独立した
#         自動テストが無かった
#     検出方法: 統合テストの各ケースの前提状態を確認したところ、閉包追加が起きる条件下では
#     「閉包追加分のみ欠落」と「双方欠落」は固定されているが、「閉包追加分は充足し
#     開始済み分だけが欠落する」状態を単独で作るケースが無かった。
#     影響: V1 と同様、被覆の欠落であり当時の振る舞いの欠陥ではない。
#
# 【経緯2】進行役の指示による implementation セグメントでの是正
#   進行役の指示により、implementation セグメントで
#   test/integration/verify-artifact-targets.test.ts へ次の2件の自動テストを追加した。
#   実装コード・CI ワークフローは変更していない。
#     - quick免除解除後も対象集合が全充足なら解除理由を示して成功する（V1 に対応）
#     - 閉包追加分が充足して開始済み分だけ欠落する場合は開始済み分を報告する（V2 に対応）
#   この是正により HEAD は target_sha 877d18edf914e9021f7c56c74c4a22c849ba53bb へ進んだ。
#   追加後の状態＝target_sha に対する検証結果は上記（A）〜（D）に記載しており、
#   本節の観測は AC 充足の根拠として用いない。
#
# 【経緯3】ゲートレビュー attempt の判定不能（GATE_REVIEW_ATTEMPT_INCONCLUSIVE）
#   design セグメント・implementation セグメントの各ゲートに、判定不能な attempt に由来する
#   未解決の blocking finding が記録として残っている。原因は判定プロンプトが成果物の引用元
#   ファイルを展開しないというレビュア側の観測制約であり、本 Issue の成果物の欠陥ではない
#   （Issue #767 として起票済み）。本セグメントは、そのうち implementation セグメントの
#   inconclusive 理由として挙げられた2点を上記（B）で target_sha に対して直接検証し、
#   いずれも齟齬が無いことを確認した。
#
# ============================================================================
# 本ラウンドで新たに検出した欠陥
# ============================================================================
# target_sha に対する再検証（上記 A〜D）では、実装・テスト・CI・成果物のいずれについても
# 新たな欠陥を検出しなかった。自動テストは1件も失敗せず、手元検査スクリプトとリモート CI は
# すべて成功し、（B）の直接実行はいずれも期待どおりの終了コードと標準エラー出力を示した。
#
# ============================================================================
# 制約
# ============================================================================
# - 本セグメントは独立検証であり、SPEC.md・DESIGN.md・PLAN.md・ADR・実装コード・
#   CI ワークフロー・テストコードのいずれも変更していない。本ラウンドの変更は本ファイルのみである。
# - target_sha は本ファイルの更新 commit の親であり、上記のすべての実行は
#   その commit の前に完了している。本ファイルの更新により PR head は target_sha の子へ
#   進むが、それは本ファイルの内容変更のみであり、証跡が指すコード状態は target_sha で確定する。
# - quick シグナルの解決可否は実行環境に依存する。本ワークツリーでの実 CLI 実行は
#   認証済みの状態で行ったため既定では解決可能であり、解決不能側の確認は
#   ラベル取得コマンドを常に非0終了させる構成を PATH 上に用意して行った。
# - リモート CI の verify-root-clean は PR が Draft のため skipped である。同検査は
#   target_sha の手元実行で終了コード0を確認している。
#
# ============================================================================
# 完了条件（本セグメント）
# ============================================================================
# - 全 AC-ID に verification.mode と verification.result と evidence が対応している。
# - すべての evidence が単一の target_sha に対する実行結果である。
# - 回帰実行の結果が記録されている。
# - ゲートレビュアが inconclusive の理由とした2点について、target_sha に対する
#   直接の検証結果が記録されている。
# - 検出と是正の経緯が、AC 充足の証跡とは別の節に分離して記録されている。
#
# ============================================================================
# 未決事項
# ============================================================================
# - V1・V2 は進行役の指示により本 Issue の implementation セグメントで是正済みであり、
#   未決事項は無い。
# - 経緯3の構造的問題（判定プロンプトの展開範囲）は Issue #767 の対象であり本 Issue では扱わない。
#
# ============================================================================
# 本セグメントの対象外
# ============================================================================
# - 成果物存在述語そのものの妥当性（SPEC.md がスコープ外と定めている）。
# - quick 免除の対象成果物集合・ガードレール対象パス・シグナル置き場所の規則。
# - 配布先 consumer project の実環境における CI 実行結果（本リポジトリの CI 実行結果と
#   静的なワークフロー定義の一致検査までを対象とする）。
# - PR の Draft から Ready への遷移可否とマージ判断（進行役の責務）。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-741
target_sha: 877d18edf914e9021f7c56c74c4a22c849ba53bb

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/unit/artifact-workflow.test.ts::skip_checks=trueでは必須成果物検査を1回も実行しない
        ガードを固定する（AC-1）（展開結果と配布テンプレートの両ワークフロー定義について、
        必須成果物検査ステップの if 条件が skip_checks != 'true' を含むことを固定。
        target_sha の npm test で成功）
      - |-
        test/unit/dependabot-ci-skip-exec.test.ts::ci実行(b) Dependabot が開いた直後の PR は
        skip_checks=true ／ ci実行(c) 追加 push しても skip_checks=true ／
        ci実行(f) adminが作成した機械生成root-cleanup PRは skip_checks=true
        （検査対象判定の実行段本文を段の env だけを入力として単体実行し、許可条件に一致する PR で
        skip_checks=true が出力されることを検証。target_sha の npm test で成功）
      - |-
        target_sha での静的直接確認: 展開結果と配布テンプレートの両ワークフロー定義について、
        `- name: verify-artifacts (対象集合を一括検査)` の直後の行が
        `if: steps.ctx.outputs.skip_checks != 'true'` であることを確認した。
        skip_checks=true の経路では当該ステップの if 条件が偽になるため実行されず、
        成果物欠落を理由とする非0終了は発生しない。

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/unit/artifact-workflow.test.ts::開始済みセグメント導出はbase解決失敗と差分算出失敗を
        区別して非0終了する（実スクリプトを解決不能な base ref で起動して終了コード1と
        「base branchを解決できません」を検証し、別途 orphan branch で merge base を持たない
        リポジトリを構成して終了コード1と「git diff failed for main...HEAD」を検証。
        target_sha の npm test で成功）
      - |-
        test/unit/artifact-workflow.test.ts::Detect started segments段は導出コマンドの非0終了を
        空のSへ読み替えない（ワークフロー定義から当該段の本文を取り出し、常に終了コード17で
        終わる導出コマンドを置いて bash --noprofile --norc -e で実行。段の終了コードが17となり
        GITHUB_OUTPUT が空のままであることを検証。target_sha の npm test で成功）
      - |-
        test/unit/artifact-workflow.test.ts::S導出前提と失敗伝播を静的に固定する
        （リポジトリ取得の深度が履歴を切り詰めないこと、base 取得段が S 導出段より前にあること、
        S 導出段が導出コマンドをパイプへ通さないことを両ワークフロー定義について固定。
        target_sha の npm test で成功）
      - |-
        target_sha での直接実行（ゲートレビュアが観測制約により確認できなかった点）:
        .agent-skill-chain/scripts/detect-changed-segments.sh を本ワークツリーで直接起動した。
        引数なし -> 終了コード1・標準エラー「使い方: detect-changed-segments.sh <base_ref>」。
        解決不能な base ref -> 終了コード1・標準エラー
        「base branchを解決できません: no-such-base-ref-xyz」・標準出力は0バイト。
        blob を base に指定 -> 終了コード1・標準エラー「git diff failed for <blob-sha>...HEAD」。
        正常系（base=main）-> 終了コード0。
        さらに当該 CI 実行段の本文を GitHub Actions 既定シェルと同じ
        bash --noprofile --norc -e で単体実行し、base 解決不能時に段が終了コード1で終わり
        GITHUB_OUTPUT へ values を1行も書かないことを実測した。

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/unit/artifact-targets.test.ts::deriveArtifactTargets: Sが空ならRも空になる
        （閉包追加可否が真でも空集合を返すことを純関数呼び出しで検証。
        target_sha の npm test で成功）
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: S空は外部シグナルを
        解決せず対象集合空として成功する（一括検査を空の S で起動し、終了コード0・
        「必須成果物検査の対象集合: （空）」・未解決通知を出さないことを検証。
        target_sha の npm test で成功）
      - |-
        target_sha での直接実行: 差分の無い base（target_sha 自身）を与えた CI 実行段を
        bash --noprofile --norc -e で単体実行し、段が終了コード0で GITHUB_OUTPUT へ
        values=（空文字列）を書くことを実測した。続けて本ワークツリーで
        `verify-artifacts.sh ISSUE-741 --started-segments ""` を実行し、
        終了コード0・「必須成果物検査の対象集合: （空）」・未解決通知なしを実測した。

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: quick免除有効時は
        閉包追加を抑止するが開始済み分の欠落は検査する（前半。quick 要求かつ risk normal かつ
        ガードレール非抵触で、上流の欠けた S に対し終了コード0となり、標準エラー出力に
        「上流閉包により追加」も免除対象成果物名も現れないことを検証。
        target_sha の npm test で成功）
      - |-
        test/integration/verify.test.ts::verify artifacts: ローカルモードの size: quick は
        SPEC/DESIGN/PLAN/VALIDATIONの存在要求を免除する ／
        verify artifacts: GitHubモードは size:quick ラベルで免除し、risk:high・risk未付与では
        ガードレールが発動する（免除対象成果物が要求されないことと免除通知を出さないことを検証。
        target_sha の npm test で成功）

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: quick免除有効時は
        閉包追加を抑止するが開始済み分の欠落は検査する（後半。免除有効のまま開始済みセグメントの
        非免除成果物を1件削除して commit し、終了コード1と
        「segment 'implementation' の必須成果物が欠落しています: unit_test_results」を検証。
        target_sha の npm test で成功）

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/unit/artifact-targets.test.ts::deriveArtifactTargets: 文書のみの主経路では
        implementationを閉包追加しない（S=spec,design,validation に対し R が S と一致し
        implementation を含まないことを純関数呼び出しで検証。target_sha の npm test で成功）
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: 文書のみの主経路では
        implementationを閉包追加しない（一括検査が終了コード0で終わり、標準エラー出力に
        implementation が現れないことを検証。target_sha の npm test で成功）
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: quick未要求ではSの
        上流spec/designを閉包追加し、全成果物充足なら成功する（要求・要件から順に成果物を
        揃えた状態で終了コード0となることを検証。target_sha の npm test で成功）

  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: base側にだけ存在して
        当ブランチで削除した成果物は欠落になる（base へ SPEC.md を置いてから当ブランチで削除し
        commit した状態で、閉包追加対象を持たない S=spec に対し終了コード1と
        「segment 'spec' ... SPEC.md」を検証。target_sha の npm test で成功）

  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: quick未要求ではSの
        上流spec/designを閉包追加し、全成果物充足なら成功する（S=implementation に対し
        終了コード0となり、spec・design が「上流閉包により追加・セグメント未開始」として
        対象集合の要約に現れることを検証。target_sha の npm test で成功）
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: 当ブランチで追加後に
        削除した成果物は履歴実績で充足する（ワークツリー上に存在しないが履歴に追加が現れる
        成果物を含む状態で終了コード0となることを検証。target_sha の npm test で成功）
      - |-
        test/unit/artifact-targets.test.ts::deriveArtifactTargets: 最下流の開始済み要素より上流の
        spec/designだけを閉包追加する（純関数呼び出しで閉包追加標識まで含めて検証。
        target_sha の npm test で成功）
      - |-
        target_sha での直接実行: 本ワークツリーで
        `verify-artifacts.sh ISSUE-741 --started-segments implementation,validation` を
        quick シグナル解決可能な状態で実行した結果、対象集合は
        「spec（上流閉包により追加・セグメント未開始）」「design（上流閉包により追加・
        セグメント未開始）」「implementation（開始済み）」「validation（開始済み）」の4件で、
        終了コード0。開始済み集合の上流のみが閉包追加されることを実測した。

  - ac_id: AC-9
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: 閉包追加分が充足して
        開始済み分だけ欠落する場合は開始済み分を報告する（閉包追加された spec・design と
        開始済み implementation が対象集合に現れ、欠落としては implementation の code・
        unit_test_results だけを報告し、spec・design を欠落として報告しないことを検証。
        target_sha の npm test で成功）
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: 閉包追加分・開始済み分・
        双方の欠落をセグメント名と成果物名の対で列挙する（S=spec,implementation で成果物を
        1つも作らない状態から、終了コード1と「segment 'spec' ... SPEC.md」
        「segment 'design'（上流閉包により追加・セグメント未開始）... DESIGN.md」
        「segment 'implementation' ... code」の3種を検証。target_sha の npm test で成功）
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: GitHubの取得失敗・
        解釈不能は未解決、空ラベル集合は解決済みquick未要求になる（末尾。ラベル集合が空の応答を
        解決成功かつ quick 未要求として扱い閉包追加が働くこと、閉包追加分の欠落で終了コード1と
        なることを検証。閉包追加分にのみ欠落する形態を固定。target_sha の npm test で成功）
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: base側にだけ存在して
        当ブランチで削除した成果物は欠落になる（成果物削除に起因する欠落を固定。
        target_sha の npm test で成功）

  - ac_id: AC-10
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: quick免除解除後も
        対象集合が全充足なら解除理由を示して成功する（quick 要求・risk normal・ガードレール抵触
        （docs/adr/ 配下と .agent-skill-chain/schemas/ 配下の差分）という状態で、R の全成果物を
        充足させて実行し、終了コード0・解除理由2件・「spec（上流閉包により追加・セグメント未開始）」
        「design（上流閉包により追加・セグメント未開始）」「implementation（開始済み）」
        「validation（開始済み）」の4件・「必須成果物が欠落」を1件も出さないことを検証。
        target_sha の npm test で成功）
      - |-
        補助証跡: 免除解除の判定そのもの（risk が normal 以外・ガードレール抵触の各条件）は
        test/integration/verify.test.ts::verify artifacts: size: quick でも risk が normal 以外なら
        免除せず通常フローを強制する ／ verify artifacts: size: quick でもADR差分・自己参照的な
        差分を含むと免除せず通常フローを強制する が固定している
        （いずれも target_sha の npm test で成功）。

  - ac_id: AC-11
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: ISSUE-692再現条件では
        quick解除理由と未開始design成果物の欠落を同時に示す（size: quick と risk: normal を記録した
        うえでスキーマ定義への差分により免除を解除し、実装セグメント・独立検証セグメントが
        開始済みで設計・実装計画セグメントが未開始の状態を作り、終了コード1と「quick 適用対象外」
        「schemas/ 配下」「segment 'design'（上流閉包により追加・セグメント未開始）... DESIGN.md」
        「... PLAN.md」を検証。target_sha の npm test で成功）
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: 閉包追加分・開始済み分・
        双方の欠落をセグメント名と成果物名の対で列挙する（閉包追加対象が無い場合を含む欠落列挙の
        書式を固定。target_sha の npm test で成功）

  - ac_id: AC-12
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: quick未解決の
        ローカル3経路ではR=Sへ劣化し、成果物検査を続行する（状態ファイル不在・内容が解釈不能・
        構造が不正・読み取り操作が失敗の各経路で終了コード0となり、
        「quick シグナルを解決できなかったため、quick 免除も上流セグメントの閉包追加も
        適用しません」を提示し「上流閉包により追加」を提示しないことを検証。
        target_sha の npm test で成功）
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: GitHubの取得失敗・
        解釈不能は未解決、空ラベル集合は解決済みquick未要求になる（ラベル取得コマンドの非0終了、
        JSON として解釈できない応答、ラベル集合を保持しない応答の3経路が未解決になること、
        空のラベル集合は解決成功として扱われることを検証。target_sha の npm test で成功）
      - |-
        target_sha での直接実行: 本ワークツリーで、ラベル取得コマンドを常に非0終了させる
        構成を PATH 上に用意して
        `verify-artifacts.sh ISSUE-741 --started-segments implementation,validation` を実行した。
        結果は終了コード0で、「quick シグナルを解決できなかったため、quick 免除も上流セグメントの
        閉包追加も適用しません」を提示したうえで対象集合が
        「implementation（開始済み）」「validation（開始済み）」の2件のみ（閉包追加なし）となり、
        R が S と等しくなることを実測した。同じ入力を解決可能な状態で実行すると
        spec・design が閉包追加され対象集合は4件になる。

  - ac_id: AC-13
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: quick未解決の
        ローカル3経路ではR=Sへ劣化し、成果物検査を続行する（末尾。未解決のまま開始済み分の
        成果物を欠落させ、終了コード1と未解決通知と
        「segment 'implementation' ... unit_test_results」の同時提示を検証し、
        閉包追加対象である design の欠落を理由には失敗しないこと
        （標準エラー出力に segment 'design' が現れないこと）まで検証。
        target_sha の npm test で成功）
      - |-
        target_sha での直接実行: AC-12 の evidence に記した実行と同一の実行である。
        未解決時に閉包追加分が対象集合へ加わらないことを実測しており、
        閉包追加分の欠落を理由に失敗しないことと同じ帰結である。

  - ac_id: AC-14
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/unit/artifact-workflow.test.ts::必須成果物検査へIssue読み取り権限・トークン・
        リポジトリ識別子を与える（展開結果と配布テンプレートの両ワークフロー定義について、
        permissions.issues が read であること、必須成果物検査ステップの env が GH_TOKEN と
        GH_REPO を持つことを検証。target_sha の npm test で成功）
      - |-
        test/unit/artifact-workflow.test.ts::展開結果と配布テンプレートのCIワークフローは完全一致する
        （2ファイルの内容が文字列として同一であることを検証。target_sha の npm test で成功）
      - |-
        target_sha での直接実行: .agent-skill-chain/ci/verify-template-sync.sh -> 終了コード0。
        あわせて cmp により、展開結果 .github/workflows/agent-skill-chain-ci.yml と配布元
        .agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml が
        バイト単位で同一であることを確認した。
      - |-
        target_sha に対するリモート CI: verify job の
        「verify-artifacts (対象集合を一括検査)」ステップが GH_TOKEN・GH_REPO を env に持ち、
        success で完了している（GH_REPO: techbeansjp-free/AGENTS.md）。

  - ac_id: AC-15
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/unit/artifact-targets.test.ts（全5ケース）: 対象集合 R の導出を純関数
        deriveArtifactTargets として CI ワークフローも Git も介さずに直接呼び出し、
        S 空・閉包追加無効・閉包追加あり・除外集合・連鎖順序不整合の各入力に対する R を検証。
        target_sha の npm test でいずれも成功。
      - |-
        test/unit/artifact-workflow.test.ts::ワークフローはSだけを一括で渡しRの導出規則を持たない
        （両ワークフロー定義について、必須成果物検査ステップが --started-segments を渡すこと、
        閉包追加を示す語や具体的なセグメント列挙を持たないこと、いずれの実行段も導出関数名を
        含まないことを検証。target_sha の npm test で成功）
      - |-
        test/unit/segments.test.ts::deriveSegmentOrder: 定義配列の並びに依存せずnextの一本鎖から
        固定順を導出する ／ 複数先頭・循環・未到達を判定不能として例外にする
        （連鎖順序の導出が実行可能アセット側にあり固定列の再定義でないことを検証。
        target_sha の npm test で成功）

  - ac_id: AC-16
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/unit/dependabot-ci-skip-exec.test.ts::ci実行(d) 人間が dependabot/ ブランチ名を偽装した
        PR は exit 1 で拒否される ／ ci実行(g) adminでない人間がroot-cleanupブランチ名を偽装した
        PRは exit 1 で拒否される ／ ci実行(h) root-cleanupの類似ブランチはadmin作成でも exit 1 で
        拒否される ／ ci実行(i) root-cleanup PR作成者の権限API確認が失敗した場合は exit 1 で
        安全側に停止する（検査対象判定の実行段本文を単体実行し、いずれも終了コード1で
        停止することを検証。target_sha の npm test で成功）
      - |-
        test/unit/dependabot-ci-skip.test.ts::ci: Derive issue_id ステップは厳密なroot-cleanup
        ブランチとadminのPR作成者だけを許可する ／ ci: Derive issue_id の env.ACTOR は PR 作成者
        （pull_request.user.login）由来であり github.actor を参照しない
        （許可条件の静的な固定。target_sha の npm test で成功）
      - |-
        target_sha での静的直接確認: 検査対象判定（Derive issue_id）と必須成果物検査は同一 job 内の
        連続する実行段であり、前者が終了コード1で停止した場合に後者は実行されない。
        target_sha のリモート CI では Derive issue_id が success であったため後続段が実行され、
        全ステップが success で完了している。

regression:
  executed: true
  evidence:
    - |-
      target_sha 877d18edf914e9021f7c56c74c4a22c849ba53bb での npm test（pretest で
      npm run build を実行）: 終了コード0。
      tests 1366 / suites 0 / pass 1365 / fail 0 / cancelled 0 / skipped 1 / todo 0。
      skipped 1件は test/integration/cli-resolve.test.ts の
      「GitHub導入元へ実際に到達してpackage versionを取得できる」で、
      ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 を指定した場合だけ実ネットワークへ到達する
      opt-in テストが自らを skip したものであり、ISSUE-741 の変更とは無関係である。
      失敗は1件も無く、既存テストの退行は無い。
    - |-
      target_sha での npm run build（tsc）: 終了コード0。
      target_sha での npm run typecheck（tsc --noEmit -p tsconfig.test.json）: 終了コード0。
    - |-
      target_sha での検査スクリプト手元実行: verify-branch-name・verify-worktree-path・
      verify-template-sync・verify-spec-bdd・verify-design-diagram・verify-adr・verify-doc-length・
      verify-config-doc-sync・verify-root-clean・verify-ac-coverage、および
      lint-vocab・lint-references・lint-secrets（--diff origin/main）・adr-lint check。
      すべて終了コード0。
    - |-
      target_sha での対象集合導出と一括検査（CI と同じ2段構成の手元再現）:
      detect-changed-segments.sh main が終了コード0で spec,design,implementation,validation を
      出力し、その値を渡した verify-artifacts.sh が終了コード0で4件すべてを「開始済み」として
      要約した。空の S を渡した場合も終了コード0で対象集合空となる。
    - |-
      PR #746 の target_sha 877d18edf914e9021f7c56c74c4a22c849ba53bb に対するリモート CI:
      Check Run verify・verify-config-doc-sync がいずれも completed / success。
      verify job の各ステップは verify-root-clean (merge-ready) のみ skipped
      （PR が Draft のため実行条件を満たさない）で、Derive issue_id・Detect started segments・
      verify-artifacts (対象集合を一括検査)・verify-ac-coverage を含む他の全ステップが success。
      本変更が導入した3引数形式の呼び出しが実 CI 環境でも通しで成立することを示す。
      PR は Draft のままであり、本セグメントでは遷移させていない。
    - |-
      非退行の確認（本変更で新たに失敗しないこと）: quick 免除有効の経路（AC-4）、
      quick シグナル未解決の経路（AC-12・AC-13）、文書のみの主経路と要求・要件から順に
      揃えた主経路（AC-6）、S が空の経路（AC-3）のいずれも終了コード0で成功することを、
      target_sha の自動テストと target_sha での直接実行の双方で確認した。
