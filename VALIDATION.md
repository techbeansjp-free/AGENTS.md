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
# 対象範囲
# ============================================================================
# 対象は branch bugfix/741-verify-artifacts-unstarted-segments の HEAD
# 4a5b65331ca1c717606aa2517a71b28e45a440d3 が含む次の変更である。
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
# - 実装セグメントの単体テスト結果（進行役報告: 1350成功／0失敗／1skip）
#
# ============================================================================
# 検証環境（個々のACのevidenceでは繰り返さない）
# ============================================================================
# - ホスト: Linux / bash / node v24.19.0 / npm 11.17.0 / git 2.43.0
# - branch bugfix/741-verify-artifacts-unstarted-segments、
#   検証対象 SHA 4a5b65331ca1c717606aa2517a71b28e45a440d3、作業ツリーは未変更（clean）
# - 自動テスト: npm test（pretest で npm run build を実行）
# - 手動実行は、いずれも本ワークツリーのファイルを変更せずに行った。一時リポジトリを用いる
#   確認は OS の一時領域に作成し、実行後に破棄した。
#
# ============================================================================
# 検証内容と結果（1）テストスイート・型検査・build
# ============================================================================
# npm run build            -> 終了コード 0
# npm run typecheck        -> 終了コード 0（tsc --noEmit -p tsconfig.test.json）
# npm test                 -> 終了コード 0
#     tests 1351 / pass 1350 / fail 0 / cancelled 0 / skipped 1 / todo 0
#     skip 1件の同定: test/integration/cli-resolve.test.ts の
#     「GitHub導入元へ実際に到達してpackage versionを取得できる」。当該テストは
#     ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 が指定された場合だけ実ネットワークへ到達する
#     opt-in であり、未指定時は自らを skip する。ISSUE-741 の変更とは無関係である。
# 独立した lint 相当の検査は「検証内容と結果（4）」に記す。
#
# ============================================================================
# 検証内容と結果（2）ゲートレビュアが inconclusive とした2点の直接検証
# ============================================================================
# 【2-a】CI ラッパーから CLI への引数転送（欠落の有無）
#   確認したもの: .agent-skill-chain/ci/verify-artifacts.sh の委譲行は
#   `exec "${ASC_CLI[@]}" verify artifacts "$@"` であり、位置パラメータを "$@" で展開する。
#   これは各引数を単語分割・パス名展開の対象にせず、空文字列も1個の引数として保持する
#   bash の展開形式である。CI ワークフローの呼び出しは
#   verify-artifacts.sh <issue_id> --started-segments <値> の3引数形式である。
#   実行による確認: 本番ファイルとバイト同一の複製（cmp で一致を確認）を、argv を記録する
#   スタブへ委譲させる構成で起動し、転送後の argv を実測した。
#     3引数形式 -> argc=5、argv=[verify, artifacts, ISSUE-741, --started-segments,
#                  spec,design,implementation]
#     空集合    -> argc=5、5番目が空文字列として保持される（欠落・繰り上がりなし）
#     空白と $() を含む値 -> 各引数が分割も展開もされずそのまま到達する
#     引数ゼロ  -> argc=2（verify artifacts のみ）
#   実 CLI での通し確認: 本ワークツリーで
#   ./.agent-skill-chain/ci/verify-artifacts.sh ISSUE-741 --started-segments spec,design,implementation
#   を実行し、終了コード0で対象集合の要約が出力されることを確認した。
#   判定: 欠落なく転送される。齟齬なし。
#
# 【2-b】base 解決不能・差分算出不能時の非0終了と標準エラー出力（AC-2／要件6）
#   確認したもの: .agent-skill-chain/scripts/detect-changed-segments.sh は、
#   引数欠落・base 解決失敗・git diff 失敗の3経路それぞれで標準エラー出力へ理由を書き、
#   終了コード1で終了する。base 解決は origin/<ref> と <ref> の2段で試み、どちらも
#   解決できない場合にだけ失敗させる。
#   実行による確認（本ワークツリーで直接実行）:
#     引数なし              -> 終了コード1、標準エラー「使い方: detect-changed-segments.sh <base_ref>」
#     解決不能な base ref   -> 終了コード1、標準エラー「base branchを解決できません: <ref>」
#                              標準出力は空（対象集合を導出していない）
#     blob を base に指定    -> 終了コード1、標準エラー「git diff failed for <sha>...HEAD」
#                              （base 解決失敗とは区別できる別文面）
#     正常系（base=main）   -> 終了コード0、標準出力 spec/design/implementation
#   CI ステップとしての伝播確認: ワークフローの当該実行段の本文を取り出し、GitHub Actions の
#   既定シェルと同じ bash -e で単体実行した。当該段は導出コマンドをパイプへ通さず
#   コマンド置換の代入で受けるため、pipefail の有無に依存せず -e が失敗を捕捉する。
#     BASE_REF=解決不能 -> 段の終了コード1、GITHUB_OUTPUT へ values を1件も書かない
#                          （失敗を空の S へ読み替えない）
#     BASE_REF=差分なし -> 段の終了コード0、values= （空）を書く
#   判定: 非0終了と所定の標準エラー出力が行われる。齟齬なし。
#
# ============================================================================
# 検証内容と結果（3）本セグメントで検出した事項（是正は行わない）
# ============================================================================
# 実装の振る舞いに欠陥は検出しなかった。一方で、PLAN.md が「網羅の要であり、いずれも
# 省略しない」と定める必須テストケースのうち2件について、対応する自動テストが
# リポジトリに存在しないことを検出した。いずれも振る舞い自体は独立実行により
# 期待どおりであることを確認しており、実装の欠陥ではなくテスト被覆の欠落である。
#
# 【V1】必須テストケース「免除解除かつ充足」（対応 AC-10）に対応する自動テストが無い
#   検出方法: quick 免除の解除通知を期待する assertion をテスト全体から列挙したところ、
#   該当は3箇所（test/integration/verify.test.ts の2箇所と
#   test/integration/verify-artifact-targets.test.ts の1箇所）で、いずれも終了コード1
#   （失敗）を期待するケースだった。解除かつ全成果物充足で成功することを固定する
#   assertion は存在しない。
#   独立実行による振る舞いの確認: 一時リポジトリで、quick 要求かつ risk normal かつ
#   ガードレール抵触（スキーマ定義の変更）により免除が解除される状態を作り、R の必須成果物
#   （閉包追加分 spec・design と開始済み分 implementation・validation）をすべて満たしたうえで
#   一括検査を実行した。結果は終了コード0で、解除理由2件と対象集合の要約（spec・design が
#   閉包追加、implementation・validation が開始済み）が標準エラー出力へ提示された。
#   すなわち AC-10 の Then を満たす。
#   影響: 現在の実装は正しいが、免除解除時に閉包追加後の充足を成功と判定する挙動が
#   将来の変更で失われても自動テストは検出しない。
#
# 【V2】必須テストケース「閉包追加あり・開始済み分のみ欠落」（対応 AC-9）に対応する
#       独立した自動テストが無い
#   検出方法: 追加された統合テストの各ケースの前提状態を確認したところ、閉包追加が起きる
#   条件下では「閉包追加分のみ欠落」と「双方欠落」は固定されているが、「閉包追加分は充足し
#   開始済み分だけが欠落する」状態を単独で作るケースが無い。開始済み分の欠落検出自体は
#   双方欠落のケースで assertion により固定されている。
#   独立実行による振る舞いの確認: 一時リポジトリで、閉包追加分（SPEC.md・DESIGN.md・
#   PLAN.md・ADR）を満たし開始済みの実装セグメントだけを欠落させた状態で一括検査を実行した。
#   結果は終了コード1で、対象集合の要約に閉包追加分2件と開始済み分1件が列挙され、
#   欠落は開始済みの実装セグメント（code・unit_test_results）だけが報告された。
#   閉包追加分を誤って欠落として報告することはなかった。すなわち AC-9 の Then を満たす。
#   影響: V1 と同様、被覆の欠落であり現在の振る舞いの欠陥ではない。
#
# 【V3】ゲートレビュー attempt の判定不能（GATE_REVIEW_ATTEMPT_INCONCLUSIVE）
#   design セグメント・implementation セグメントの各ゲートに、判定不能な attempt に由来する
#   未解決の blocking finding が記録として残っている。原因は判定プロンプトが成果物の引用元
#   ファイルを展開しないというレビュア側の観測制約であり、本 Issue の成果物の欠陥ではない
#   （Issue #767 として起票済み）。本セグメントは、そのうち implementation セグメントの
#   inconclusive 理由として挙げられた2点を上記「検証内容と結果（2）」で直接検証し、
#   いずれも齟齬が無いことを確認した。
#
# ============================================================================
# 検証内容と結果（4）本ブランチへ適用される検査スクリプトの実行
# ============================================================================
# 本ブランチの CI が実行する検査を手元で実行した結果は次のとおり（すべて終了コード0）。
#   .agent-skill-chain/ci/verify-branch-name.sh        -> 0
#   .agent-skill-chain/ci/verify-worktree-path.sh      -> 0
#   .agent-skill-chain/ci/verify-template-sync.sh      -> 0
#   .agent-skill-chain/ci/verify-spec-bdd.sh SPEC.md   -> 0
#   .agent-skill-chain/ci/verify-design-diagram.sh DESIGN.md -> 0
#   .agent-skill-chain/ci/verify-adr.sh docs/adr/ADR-0067-required-artifact-target-set-upstream-closure.md -> 0
#   .agent-skill-chain/ci/verify-doc-length.sh         -> 0
#   .agent-skill-chain/ci/verify-config-doc-sync.sh    -> 0
#   .agent-skill-chain/ci/verify-root-clean.sh         -> 0
#   .agent-skill-chain/scripts/lint-vocab.sh           -> 0
#   .agent-skill-chain/scripts/lint-references.sh      -> 0
#   .agent-skill-chain/scripts/lint-secrets.sh --diff origin/main -> 0
#   .agent-skill-chain/scripts/adr-lint.sh check       -> 0
#   .agent-skill-chain/ci/verify-artifacts.sh ISSUE-741 --started-segments spec,design,implementation -> 0
# .agent-skill-chain/ci/verify-ac-coverage.sh ISSUE-741 は本ファイル作成後に実行し、
# 全 AC-ID の対応と孤児の不在を確認した（終了コード0）。
# PR #746 のリモート CI は verify・verify-config-doc-sync がいずれも SUCCESS、
# mergeStateStatus は CLEAN である（PR は Draft のまま）。
#
# ============================================================================
# 制約
# ============================================================================
# - 本セグメントでは SPEC.md・DESIGN.md・PLAN.md・ADR・実装コード・CI ワークフロー・
#   テストコードのいずれも変更していない。検出事項の是正は行っていない。
# - AC-10・AC-9 の一部について自動テストが無いため、当該ケースの結果は本セグメントでの
#   手動実行に依拠する。手動実行は一時リポジトリに対して行っており、CI では再現されない。
# - quick シグナルの解決可否は実行環境に依存する。本ワークツリーでの実 CLI 実行は
#   認証済みの状態で行ったため既定では解決可能であり、解決不能側の確認は
#   取得コマンドを失敗させる構成を PATH 上に用意して行った。
#
# ============================================================================
# 完了条件（本セグメント）
# ============================================================================
# - 全 AC-ID に verification.mode と verification.result と evidence が対応している。
# - 回帰実行の結果が記録されている。
# - ゲートレビュアが inconclusive の理由とした2点について、直接の検証結果が記録されている。
# - 検出事項が是正されないまま事実として記録されている。
#
# ============================================================================
# 未決事項
# ============================================================================
# - V1・V2（必須テストケース2件の自動テスト欠落）を本 Issue 内で補うか別 Issue へ分離するかは
#   進行役の判断事項である。本セグメントでは是正しない。
# - V3 の構造的問題（判定プロンプトの展開範囲）は Issue #767 の対象であり本 Issue では扱わない。
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
target_sha: 4a5b65331ca1c717606aa2517a71b28e45a440d3

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/unit/artifact-workflow.test.ts::skip_checks=trueでは必須成果物検査を1回も実行しない
        ガードを固定する（AC-1）（展開結果と配布テンプレートの両ワークフロー定義について、
        必須成果物検査ステップの if 条件が skip_checks != 'true' を含むことを固定。成功）
      - |-
        test/unit/dependabot-ci-skip-exec.test.ts::ci実行(b) Dependabot が開いた直後の PR は
        skip_checks=true ／ ci実行(c) 追加 push しても skip_checks=true ／
        ci実行(f) adminが作成した機械生成root-cleanup PRは skip_checks=true
        （検査対象判定の実行段本文を段の env だけを入力として単体実行し、許可条件に一致する PR で
        skip_checks=true が出力されることを検証。成功）
      - |-
        独立検証セグメントでの通し確認: 検査対象判定が skip_checks=true を出す経路では
        必須成果物検査ステップの if 条件が偽になるため当該ステップは実行されず、
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
        リポジトリを構成して終了コード1と「git diff failed for main...HEAD」を検証。成功）
      - |-
        test/unit/artifact-workflow.test.ts::Detect started segments段は導出コマンドの非0終了を
        空のSへ読み替えない（ワークフロー定義から当該段の本文を取り出し、常に終了コード17で
        終わる導出コマンドを置いて bash --noprofile --norc -e で実行。段の終了コードが17となり
        GITHUB_OUTPUT が空のままであることを検証。成功）
      - |-
        test/unit/artifact-workflow.test.ts::S導出前提と失敗伝播を静的に固定する
        （リポジトリ取得の深度が履歴を切り詰めないこと、base 取得段が S 導出段より前にあること、
        S 導出段が導出コマンドをパイプへ通さないことを両ワークフロー定義について固定。成功）
      - |-
        独立検証セグメントでの直接実行（ゲートレビュアが観測制約により確認できなかった点）:
        .agent-skill-chain/scripts/detect-changed-segments.sh を本ワークツリーで直接起動した。
        引数なし -> 終了コード1・標準エラー「使い方: detect-changed-segments.sh <base_ref>」。
        解決不能な base ref -> 終了コード1・標準エラー「base branchを解決できません: <ref>」・
        標準出力は空。blob を base に指定 -> 終了コード1・標準エラー
        「git diff failed for <sha>...HEAD」。正常系（base=main）-> 終了コード0。
        さらに当該 CI 実行段の本文を GitHub Actions 既定シェルと同じ bash -e で単体実行し、
        base 解決不能時に段が終了コード1で終わり GITHUB_OUTPUT へ values を書かないことを実測した。

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/unit/artifact-targets.test.ts::deriveArtifactTargets: Sが空ならRも空になる
        （閉包追加可否が真でも空集合を返すことを純関数呼び出しで検証。成功）
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: S空は外部シグナルを
        解決せず対象集合空として成功する（一括検査を空の S で起動し、終了コード0・
        「必須成果物検査の対象集合: （空）」・未解決通知を出さないことを検証。成功）
      - |-
        独立検証セグメントでの通し確認: PR 差分がどのセグメントにも対応しない状態を
        本ワークツリーの一時 ref で再現し、CI 実行段が values=（空文字列）を出力すること、
        その値を受けた一括検査が終了コード0で対象集合空と報告することを実測した。

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: quick免除有効時は
        閉包追加を抑止するが開始済み分の欠落は検査する（前半。quick 要求かつ risk normal かつ
        ガードレール非抵触で、上流の欠けた S に対し終了コード0となり、標準エラー出力に
        「上流閉包により追加」も免除対象成果物名も現れないことを検証。成功）
      - |-
        test/integration/verify.test.ts::verify artifacts: ローカルモードの size: quick は
        SPEC/DESIGN/PLAN/VALIDATIONの存在要求を免除する ／
        verify artifacts: GitHubモードは size:quick ラベルで免除し、risk:high・risk未付与では
        ガードレールが発動する（免除対象成果物が要求されないことと免除通知を出さないことを検証。成功）

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: quick免除有効時は
        閉包追加を抑止するが開始済み分の欠落は検査する（後半。免除有効のまま開始済みセグメントの
        非免除成果物を1件削除して commit し、終了コード1と
        「segment 'implementation' の必須成果物が欠落しています: unit_test_results」を検証。成功）

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/unit/artifact-targets.test.ts::deriveArtifactTargets: 文書のみの主経路では
        implementationを閉包追加しない（S=spec,design,validation に対し R が S と一致し
        implementation を含まないことを純関数呼び出しで検証。成功）
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: 文書のみの主経路では
        implementationを閉包追加しない（一括検査が終了コード0で終わり、標準エラー出力に
        implementation が現れないことを検証。成功）
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: quick未要求ではSの
        上流spec/designを閉包追加し、全成果物充足なら成功する（要求・要件から順に成果物を
        揃えた状態で終了コード0となることを検証。成功）

  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: base側にだけ存在して
        当ブランチで削除した成果物は欠落になる（base へ SPEC.md を置いてから当ブランチで削除し
        commit した状態で、閉包追加対象を持たない S=spec に対し終了コード1と
        「segment 'spec' ... SPEC.md」を検証。成功）

  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: quick未要求ではSの
        上流spec/designを閉包追加し、全成果物充足なら成功する（S=implementation に対し
        終了コード0となり、spec・design が「上流閉包により追加・セグメント未開始」として
        対象集合の要約に現れることを検証。成功）
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: 当ブランチで追加後に
        削除した成果物は履歴実績で充足する（ワークツリー上に存在しないが履歴に追加が現れる
        成果物を含む状態で終了コード0となることを検証。成功）
      - |-
        test/unit/artifact-targets.test.ts::deriveArtifactTargets: 最下流の開始済み要素より上流の
        spec/designだけを閉包追加する（純関数呼び出しで閉包追加標識まで含めて検証。成功）

  - ac_id: AC-9
    verification:
      mode: hybrid
      result: pass
      reason: |-
        Then が列挙する3つの欠落形態のうち「閉包追加分にのみ欠落」「双方に欠落」は自動テストが
        固定しているが、「開始済み分にのみ欠落（閉包追加分は充足）」を単独で作るケースが
        自動テストに存在しない。当該形態のみ独立検証セグメントでの直接実行で確認した。
        本セグメントは独立検証であるため、欠落しているテストの追加は行わない（検出事項V2）。
      procedure: |-
        一時リポジトリを作成して Issue 用 worktree を起票し、閉包追加分に相当する
        SPEC.md・DESIGN.md・PLAN.md・docs/adr/配下のADRを配置して充足させ、開始済みの
        実装セグメントの成果物（コード差分・単体テスト差分）は作らないまま
        `verify artifacts ISSUE-741 --started-segments implementation` を実行し、
        終了コードと標準エラー出力を確認する。実行後に一時リポジトリを破棄する。
      executor: claude（validation_worker、ISSUE-741 独立検証セグメント）
    evidence:
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: 閉包追加分・開始済み分・
        双方の欠落をセグメント名と成果物名の対で列挙する（S=spec,implementation で成果物を
        1つも作らない状態から、終了コード1と「segment 'spec' ... SPEC.md」
        「segment 'design'（上流閉包により追加・セグメント未開始）... DESIGN.md」
        「segment 'implementation' ... code」の3種を検証。成功）
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: GitHubの取得失敗・
        解釈不能は未解決、空ラベル集合は解決済みquick未要求になる（末尾。ラベル集合が空の応答を
        解決成功かつ quick 未要求として扱い閉包追加が働くこと、閉包追加分の欠落で終了コード1と
        なることを検証。閉包追加分にのみ欠落する形態を固定。成功）
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: base側にだけ存在して
        当ブランチで削除した成果物は欠落になる（成果物削除に起因する欠落を固定。成功）
      - |-
        独立検証セグメントでの直接実行（開始済み分にのみ欠落する形態）: 上記 procedure のとおり
        実行した結果、終了コード1。標準エラー出力の対象集合の要約は
        「spec（上流閉包により追加・セグメント未開始）」「design（上流閉包により追加・
        セグメント未開始）」「implementation（開始済み）」の3件で、欠落として報告されたのは
        「segment 'implementation' の必須成果物が欠落しています: code」と
        「segment 'implementation' の必須成果物が欠落しています: unit_test_results」の2件のみ。
        充足済みの閉包追加分を誤って欠落と報告することはなかった。AC-9 の Then を満たす。

  - ac_id: AC-10
    verification:
      mode: manual
      result: pass
      reason: |-
        PLAN.md が必須テストケース「免除解除かつ充足」として列挙しているにもかかわらず、
        対応する自動テストがリポジトリに存在しない。quick 免除の解除通知を期待する
        assertion はテスト全体で3箇所あるが、いずれも終了コード1（失敗）を期待するケースであり、
        解除かつ全成果物充足で成功することを固定する assertion は無い。本セグメントは
        独立検証であるため、欠落しているテストの追加は行わない（検出事項V1）。
      procedure: |-
        一時リポジトリを作成して Issue 用 worktree を起票し、Issue 状態へ size: quick と
        risk: normal を記録したうえで、ガードレール対象パス（.agent-skill-chain/schemas/ 配下）
        へ差分を作って免除を解除させる。次に R の必須成果物、すなわち閉包追加分（SPEC.md・
        DESIGN.md・PLAN.md・docs/adr/配下のADR）と開始済み分（コード差分・単体テスト差分・
        VALIDATION.md）をすべて配置して commit し、
        `verify artifacts ISSUE-741 --started-segments implementation,validation` を実行して
        終了コードと標準エラー出力を確認する。実行後に一時リポジトリを破棄する。
      executor: claude（validation_worker、ISSUE-741 独立検証セグメント）
    evidence:
      - |-
        独立検証セグメントでの直接実行: 上記 procedure のとおり実行した結果、終了コード0。
        標準エラー出力は、まず解除通知
        「quick（size:quick）が指定されていますが、次の理由により quick 適用対象外のため
        通常の成果物要求を適用します:」に続けて解除理由2件（変更差分に docs/adr/ 配下が含まれる／
        変更差分に .agent-skill-chain/schemas/ 配下が含まれる）を提示し、次に対象集合の要約として
        「spec（上流閉包により追加・セグメント未開始）」「design（上流閉包により追加・
        セグメント未開始）」「implementation（開始済み）」「validation（開始済み）」の4件を
        列挙した。成果物欠落の報告は1件も無い。免除を適用せず閉包追加を行ったうえで成功と
        判定しており、AC-10 の Then を満たす。
      - |-
        補助証跡: 免除解除の判定そのもの（risk が normal 以外・ガードレール抵触の各条件）は
        test/integration/verify.test.ts::verify artifacts: size: quick でも risk が normal 以外なら
        免除せず通常フローを強制する ／ verify artifacts: size: quick でもADR差分・自己参照的な
        差分を含むと免除せず通常フローを強制する が固定している（いずれも成功）。
        本 AC が固定していない部分は「解除後に充足した場合の成功」だけである。

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
        「... PLAN.md」を検証。成功）
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: 閉包追加分・開始済み分・
        双方の欠落をセグメント名と成果物名の対で列挙する（閉包追加対象が無い場合を含む欠落列挙の
        書式を固定。成功）

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
        適用しません」を提示し「上流閉包により追加」を提示しないことを検証。成功）
      - |-
        test/integration/verify-artifact-targets.test.ts::verify artifacts一括: GitHubの取得失敗・
        解釈不能は未解決、空ラベル集合は解決済みquick未要求になる（ラベル取得コマンドの非0終了、
        JSON として解釈できない応答、ラベル集合を保持しない応答の3経路が未解決になること、
        空のラベル集合は解決成功として扱われることを検証。成功）
      - |-
        独立検証セグメントでの直接実行: 本ワークツリーで、ラベル取得コマンドを常に非0終了させる
        構成を PATH 上に用意して
        `verify-artifacts.sh ISSUE-741 --started-segments implementation,validation` を実行した。
        結果は未解決通知を提示したうえで対象集合が開始済み2件のみ（閉包追加なし）となり、
        R が S と等しくなることを実測した。同じ入力を解決可能な状態で実行すると
        spec・design が閉包追加される。

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
        （standard error に segment 'design' が現れないこと）まで検証。成功）
      - |-
        独立検証セグメントでの直接実行: AC-12 の evidence に記した実行と同一。未解決時に
        閉包追加分が対象集合へ加わらないことを実測しており、閉包追加分の欠落を理由に
        失敗しないことと同じ帰結である。

  - ac_id: AC-14
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/unit/artifact-workflow.test.ts::必須成果物検査へIssue読み取り権限・トークン・
        リポジトリ識別子を与える（展開結果と配布テンプレートの両ワークフロー定義について、
        permissions.issues が read であること、必須成果物検査ステップの env が GH_TOKEN と
        GH_REPO を持つことを検証。成功）
      - |-
        test/unit/artifact-workflow.test.ts::展開結果と配布テンプレートのCIワークフローは完全一致する
        （2ファイルの内容が文字列として同一であることを検証。成功）
      - |-
        独立検証セグメントでの実行: .agent-skill-chain/ci/verify-template-sync.sh を実行し
        終了コード0（配布元テンプレートと展開結果の同期を確認）。

  - ac_id: AC-15
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/unit/artifact-targets.test.ts（全5ケース）: 対象集合 R の導出を純関数
        deriveArtifactTargets として CI ワークフローも Git も介さずに直接呼び出し、
        S 空・閉包追加無効・閉包追加あり・除外集合・連鎖順序不整合の各入力に対する R を検証。
        いずれも成功。
      - |-
        test/unit/artifact-workflow.test.ts::ワークフローはSだけを一括で渡しRの導出規則を持たない
        （両ワークフロー定義について、必須成果物検査ステップが --started-segments を渡すこと、
        閉包追加を示す語や具体的なセグメント列挙を持たないこと、いずれの実行段も導出関数名を
        含まないことを検証。成功）
      - |-
        test/unit/segments.test.ts::deriveSegmentOrder: 定義配列の並びに依存せずnextの一本鎖から
        固定順を導出する ／ 複数先頭・循環・未到達を判定不能として例外にする
        （連鎖順序の導出が実行可能アセット側にあり固定列の再定義でないことを検証。成功）

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
        停止することを検証。成功）
      - |-
        test/unit/dependabot-ci-skip.test.ts::ci: Derive issue_id ステップは厳密なroot-cleanup
        ブランチとadminのPR作成者だけを許可する ／ ci: Derive issue_id の env.ACTOR は PR 作成者
        （pull_request.user.login）由来であり github.actor を参照しない（許可条件の静的な固定。成功）
      - |-
        独立検証セグメントでの通し確認: 検査対象判定が終了コード1で停止する経路では、
        後続の必須成果物検査ステップは実行されない（当該段が同一 job 内の後続段であるため）。

regression:
  executed: true
  evidence:
    - |-
      npm test（pretest で npm run build を実行）: 終了コード0。
      tests 1351 / pass 1350 / fail 0 / cancelled 0 / skipped 1 / todo 0。
      skipped 1件は test/integration/cli-resolve.test.ts の
      「GitHub導入元へ実際に到達してpackage versionを取得できる」で、
      ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 を指定した場合だけ実ネットワークへ到達する
      opt-in テストが自らを skip したものであり、ISSUE-741 の変更とは無関係である。
    - |-
      npm run build（tsc）: 終了コード0。
      npm run typecheck（tsc --noEmit -p tsconfig.test.json）: 終了コード0。
    - |-
      本ブランチへ適用される検査スクリプトの手元実行: verify-branch-name・verify-worktree-path・
      verify-template-sync・verify-spec-bdd・verify-design-diagram・verify-adr・verify-doc-length・
      verify-config-doc-sync・verify-root-clean・verify-artifacts・verify-ac-coverage、および
      lint-vocab・lint-references・lint-secrets（--diff origin/main）・adr-lint check。すべて終了コード0。
    - |-
      PR #746 のリモート CI: verify と verify-config-doc-sync がいずれも SUCCESS、
      mergeStateStatus は CLEAN。PR は Draft のままであり、本セグメントでは遷移させていない。
    - |-
      非退行の確認（本変更で新たに失敗しないこと）: quick 免除有効の経路（AC-4）、
      quick シグナル未解決の経路（AC-12・AC-13）、文書のみの主経路と要求・要件から順に
      揃えた主経路（AC-6）、S が空の経路（AC-3）のいずれも終了コード0で成功することを
      自動テストと独立実行の双方で確認した。
