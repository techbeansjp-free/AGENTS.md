# 由来: AGENTS.md が定める不変条件 I7（仕様⇔検証の追跡）に基づく、ISSUE-751 の独立検証記録である。
# フィールドは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）と完全一致させる。
# 本ファイルは単一の YAML 文書として読み込まれるため、見出し相当の情報はコメント（#）で表現する。
#
# ■ 目的
#   ゲートレビュアへの唯一の入力である判定プロンプトが、gate_id ごとに定められた固定の入力集合を
#   そのとおりに展開し、展開しきれない入力を無言で切り捨てないことを、実装から独立に実行した検証で
#   確認し、受入条件 AC-1〜AC-9 の一つ一つへ検証方法と証跡を対応づける。
#
# ■ 対象範囲
#   判定プロンプトの生成（コマンド gate reviewer-prompt と、その実体である生成関数）と、その入力を
#   導出するモジュール・設定解決。レビュアの権限、証跡スキーマ、判定プロンプトの再生成・照合機構は
#   対象範囲に含めない。本セグメントでは実装・SPEC・DESIGN・PLAN を一切変更していない。
#
# ■ 用語（本ファイル内の定義）
#   判定プロンプト: gate reviewer-prompt が標準出力へ生成する、ゲートレビュアへの唯一の入力文字列。
#   展開: あるファイルの全文（target SHA の blob と同一の内容）を、パスを明示した見出しとともに
#         判定プロンプト本文へ文字列として含めること。部分展開は行わない。
#   必須入力: 判定対象の差分と、固定表の「判定対象成果物」「上流の承認済み成果物」「憲法文書」の3列。
#   根拠ファイル: 固定表の抽出元が名指しし、target SHA に実在し、必須入力として未展開のファイル。
#   M / L / B: 必須区間のレンダー長 / 両一覧の予約長 / 根拠ファイルへ配分した残余予算（いずれもバイト）。
#
# ■ 入力（本検証が読んだもの）
#   SPEC.md（AC-1〜AC-9 と固定表）、DESIGN.md、PLAN.md、
#   docs/adr/ADR-0075-reviewer-prompt-fixed-input-set-and-overflow-failure.md、
#   実装コード（判定プロンプト生成と入力導出モジュール、設定層、実行ラッパー）、
#   自動テスト一式と単体テスト結果。
#
# ■ 出力（本検証が生成したもの）
#   受入テスト・統合テスト・回帰テストの実行結果、実機で生成した判定プロンプトの実測値、
#   および本ファイル（AC-ID と検証方法・結果・証跡の対応、ならびに発見事実の記録）。
#
# ■ 前提（検証環境。個々の AC の evidence では繰り返さない）
#   - ホスト: Linux / bash / Node.js v24.19.0 / npm 11.17.0 / git 2.43.0。
#   - 検証対象 target SHA: 842fd15df607d2140ad1a5247291f148c84946b9。
#     trusted base SHA: f72eadd6bb6403f73f3163a8138f4cdabbbdd26b。
#   - 自動テストは worktree（ブランチ bugfix/751-reviewer-prompt-input-closure）で
#     `set -o pipefail` のうえ `npm test 2>&1 | tee test-execution.log` として実行した
#     （pretest が npm run build を実行する）。保存ログ test-execution.log は .gitignore の対象であり
#     commit されない。同一 target SHA に対し独立に2回実行し、いずれも同じ結果を得た。
#   - 判定プロンプトの実機実測は、対象リポジトリを作業ツリー外の一時ディレクトリへ clone し、
#     target SHA を detach checkout して `npm ci --ignore-scripts` と `npm run build` を実行した
#     隔離環境で行った。隔離 clone は実測開始時点で未 commit 変更を持たない。
#
# ■ 検証対象の実装 SHA と、本ファイルを載せるコミットの関係
#   本節は、target_sha フィールドが宣言する検証対象の実装 SHA
#   （842fd15df607d2140ad1a5247291f148c84946b9）と、本ファイルを載せるコミット（validation ゲートが
#   target とするコミット）との関係を、本ファイルの中だけで確認できる形にするために置く。
#
#   ● 本節が述べる不変
#     本成果物を追加するコミットは、検証対象の実装 SHA 842fd15df607d2140ad1a5247291f148c84946b9 に
#     VALIDATION.md のみを追加した差分であり、実装ファイルを一切変更しない。
#     すなわち実装 SHA 以降に本ブランチへ積まれたコミットが変更するパスは VALIDATION.md ただ1件であり、
#     src/・test/・.agent-skill-chain/・docs/adr/・SPEC.md・DESIGN.md・PLAN.md・package.json・
#     package-lock.json は1件も含まれない。したがって target_sha フィールドの値が validation ゲートの
#     target SHA と一致しないことは、成果物が陳腐化した別系統であることを意味しない。
#
#   ● なぜ両者は一致し得ないか
#     コミットの SHA はその内容が確定して初めて決まり、本ファイルは自身を載せるコミットの内容の一部である。
#     本ファイルへ自身を載せるコミットの SHA を書き込むと、書き込んだ時点で内容が変わり SHA も変わるため、
#     この自己参照は原理的に解けない。よって target_sha フィールドには検証を実施した対象である実装 SHA を
#     記載し、両 SHA の関係は本節の不変と、次の再実行による実出力で示す。
#
#   ● 根拠1（実出力）: 実装 SHA と、直前ラウンドで本ファイルを追加したコミットとの差分
#     $ git diff --stat 842fd15df607d2140ad1a5247291f148c84946b9 a5b0183b8b6a0ce60264056dd01e1788d80c1cb2
#      VALIDATION.md | 325 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
#      1 file changed, 325 insertions(+)
#
#     $ git log --oneline 842fd15df607d2140ad1a5247291f148c84946b9..a5b0183b8b6a0ce60264056dd01e1788d80c1cb2
#     a5b0183 validation(ISSUE-751): AC-1〜AC-9の独立検証結果と回帰実行証跡を記録する
#
#     読み方: 変更されたファイルは VALIDATION.md 1件のみ、変更行は追加のみで削除は0行、区間内のコミットは
#     1件のみである。実装ファイル・SPEC.md・DESIGN.md・PLAN.md・ADR はいずれも現れない。
#
#   ● 根拠2（実出力）: 実装 SHA と、本ラウンドのコミットが記録する内容との差分
#     本ラウンドのコミットは、コミット直前の作業ツリーの内容をそのまま記録する。したがって実装 SHA と
#     作業ツリーとの差分が、実装 SHA と本ファイルを載せるコミットとの差分そのものである。
#     次は、本ラウンドの編集を終えてコミットする直前に実行した実出力である。
#     $ git status --porcelain
#      M VALIDATION.md
#
#     $ git diff --name-only 842fd15df607d2140ad1a5247291f148c84946b9
#     VALIDATION.md
#
#     $ git diff --stat 842fd15df607d2140ad1a5247291f148c84946b9
#      VALIDATION.md | 381 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
#      1 file changed, 381 insertions(+)
#
#     $ git log --oneline 842fd15df607d2140ad1a5247291f148c84946b9..HEAD
#     a5b0183 validation(ISSUE-751): AC-1〜AC-9の独立検証結果と回帰実行証跡を記録する
#
#     読み方: 未コミットの変更は VALIDATION.md 1件のみであり、実装 SHA からの差分に現れるパスも
#     VALIDATION.md ただ1件で、削除行は0行である。log は本ラウンドのコミットを積む直前に実行したため
#     直前ラウンドのコミット1件だけを示す。本ラウンドのコミットはこの作業ツリーを記録するものであり、
#     根拠2 の diff が示すとおり VALIDATION.md 以外のパスを変更しない。
#
#   ● 本ラウンドで変更した箇所
#     本節の追加のみである。AC-1〜AC-9 の検証方法・結果・証跡、regression の記録、独立検証で発見した事実、
#     ならびに実装コード・SPEC.md・DESIGN.md・PLAN.md はいずれも変更していない。
#
# ■ 制約（本セグメントで守った条件）
#   - 実装の追加変更を行わない。検証で発見した欠陥は本ファイルへ origin 付きで記録し、是正の要否は
#     進行役の判断に委ねる。
#   - 要件・AC-ID を新規に追加しない。承認済みの SPEC.md・DESIGN.md・PLAN.md を変更しない。
#
# ■ 検証方法（全 AC 共通の方針）
#   各 AC について、(a) 当該 AC を対象とする自動テストの実行結果と、(b) テストとは独立に、実リポジトリの
#   実 SHA に対して判定プロンプトを生成して観測した実測値の双方を証跡とする。(b) は、テスト用の
#   一時リポジトリではなく本リポジトリの実データで固定表どおりの展開が起きることを確認するために行う。
#
# ■ 常時必須検証の実施結果（PLAN の検証計画に対応。適用要否の判断自体を省略せず記録する）
#   - lint / format: lint-vocab.sh 終了コード0、lint-references.sh 終了コード0、
#     adr-lint.sh check 終了コード0。
#   - 型検査: npm run typecheck（tsc --noEmit -p tsconfig.test.json）終了コード0。
#   - 単体テスト・変更範囲の結合テスト: 上記 npm test（1429件中1428件成功・0件失敗・1件skip）。
#     skip の1件は環境変数 ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 を指定したときだけ実行される
#     外部到達性テストであり、本 Issue の変更とは無関係である。
#   - SAST: 専用の静的アプリケーションセキュリティテストツールは本リポジトリに導入されていない。
#     代替として TypeScript strict 構成の型検査と、リポジトリ全体を走査する lint 群
#     （vocab・references・secrets）を実行し、いずれも違反0で終了した。ツール導入自体は本 Issue の対象外。
#   - 依存関係スキャン: npm audit --package-lock-only --audit-level=low は終了コード1で、
#     fast-uri 3.1.4 の GHSA-7p8r-x3mc-p8w7（high）1件を報告する。package.json と package-lock.json は
#     origin/main・本ブランチ HEAD・作業ツリーの3者で SHA-256 が一致し
#     （package.json は 8dba603a667547460181eec03171df7c32af29c034b37bfbe7259df2ba09f080、
#     package-lock.json は e17bb2ae55a2701f779b884690df9882ed426bb2cf14856686be35865a0fdccf）、
#     本 Issue は依存関係を変更していない。既知かつ本 Issue の射程外のため是正しない。
#   - secret スキャン: lint-secrets.sh --diff origin/main 終了コード0。
#   - 変更内容に応じた追加検証: ユーザー操作・画面フロー、API・サービス境界、認証・認可・秘密情報、
#     性能ホットパス・SLO、DB migration、デプロイ・監視・運用、外部連携のいずれにも該当しないため
#     非該当と判断した（判断自体は省略していない）。
#
# ■ 独立検証で発見した事実（実装は変更していない。是正要否は進行役が判断する）
#   F-1 origin: design ／ 事象: 設定スキーマを拡張する target SHA では判定プロンプトの生成が
#       非0終了する。上限値の解決は target SHA の設定 blob を読み、それを「既存の設定値検査と同じ規則」で
#       設定文書全体としてスキーマ検証する。一方スキーマ本体は実行側のリポジトリ（隔離 clone では
#       protected base を checkout したツリー、consumer では導入済みアセット）から解決される。
#       したがって target SHA が新しい設定キーを自身のスキーマ更新とともに追加している場合、
#       base 側スキーマの追加プロパティ禁止に触れて生成が失敗する。
#       再現（実測）: 隔離 clone を target SHA へ checkout した状態で、設定と設定スキーマの双方へ
#       新しいキーを足した commit を作り、作業ツリーを元の SHA へ戻してから当該 commit を target として
#       判定プロンプトを生成すると、終了コード1・標準出力0バイトで
#       「config/agent-skill-chain.yaml がスキーマ（agent-skill-chain/config/v1）に適合しません」と
#       「/review must NOT have additional properties」を得る。
#       影響: 本 PR 自身の各ゲートは影響を受けない（隔離 clone は base を build するため、base の
#       生成器は target の設定 blob を読まない）。影響が出るのは本 Issue のマージ後に、設定スキーマを
#       拡張する Issue、および導入済みアセットより新しい CLI で本変更を受け取る consumer である。
#       AC 判定への影響: 無い。AC-8 が要求する不在・導出不能の対象は上流成果物と base SHA 未指定であり、
#       設定 blob のスキーマ不一致は AC-8 の Given に含まれない。
#   F-2 origin: design ／ 事象: 非テキストの判定対象成果物は根拠ファイルと異なり省略の対象にならず、
#       欠損を伴う UTF-8 復号結果として全文展開されたうえで、展開済みファイル一覧へ
#       「内容が与えられている」ものとして列挙される。固定表の「判定対象成果物」列は現行挙動の維持と
#       定められており仕様どおりだが、両一覧を内容の有無の唯一の判別手段とする指示との間に差が残る。
#       再現（実測）: 200000 バイトの乱数バイナリを差分へ追加した commit を target として
#       implementation ゲートの判定プロンプトを生成すると、終了コード0で生成され、展開済みファイル一覧へ
#       「200000 B」と digest つきで列挙される一方、本文には置換文字 U+FFFD を含む行が792行、
#       NUL バイトが805個含まれる。
#       AC 判定への影響: 無い。AC-4 の非テキスト省略は根拠ファイルを対象とする。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-751
target_sha: 842fd15df607d2140ad1a5247291f148c84946b9

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751 AC-1/2/6/7: gate_id固定表・1段閉包・一意一覧を4 gateで保つ
        （4つの gate_id それぞれで、固定表の当該行が挙げる入力だけが見出し付きの全文で現れ、
        和集合の外にあるファイルが現れないことを検証。成功）
      - |-
        実機実測（隔離 clone、target 842fd15df607d2140ad1a5247291f148c84946b9 / base f72eadd6bb6403f73f3163a8138f4cdabbbdd26b、
        4 gate をそれぞれ生成。生成物サイズと SHA-256 は spec=189142 B / 5763da73a934d87734e4ee40f31b96298198a2dad4a42178d23d13d23f6907f1、
        design=234993 B / 29c3b5df530f4661777d7bc8cd0aa954e64f47bdb202f22922f5914bfb887f1c、
        implementation=501707 B / 9b23420bfce3fbeecae2e7b6ca54670d3c2d77daac7dbe7259ea10f9c79bb657、
        validation=234489 B / 9b80d54179b3aa9288e5664ea28144801a7e2fd1d77af82d5b0ccff55d3a82c1）:
        spec は判定対象 SPEC.md と憲法文書 AGENTS.md、および抽出元 SPEC.md 由来の根拠ファイル3件の計5件を展開し、
        上流区間は「spec gateに上流の承認済み成果物は無い」と明示した。
        design は判定対象 DESIGN.md・PLAN.md・当該 Issue の ADR、上流 SPEC.md、憲法文書 AGENTS.md、根拠ファイル6件の計11件を展開した。
        implementation は差分に含まれる成果物以外の15ファイル、上流 SPEC.md・DESIGN.md・PLAN.md・当該 Issue の ADR、
        憲法文書 AGENTS.md の計20件を展開した（抽出元が名指しする実在ファイルはすべて必須入力として展開済みであったため、
        追加の根拠ファイルは0件だった）。
        validation は上流4件、憲法文書、根拠ファイル6件の計11件を展開した（判定対象 VALIDATION.md は当該 target SHA に未作成）。
        いずれの gate でも展開済み一覧と省略一覧に重複パスは無い。
  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751 AC-1/2/6/7: gate_id固定表・1段閉包・一意一覧を4 gateで保つ
        （実在パスと非実在パスを混在させ、憲法文書・根拠ファイル・差分だけが名指しするパスを別に置いた
        リポジトリで、展開が抽出元由来かつ実在のものに限られること、同一ファイルが2回展開されないことを検証。成功）
      - |-
        test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751 AC-2: 根拠パスを独立したrepository-relative path境界でだけ名指しと判定する
        （別パスの部分文字列としての出現を名指しと誤認しないことを検証。成功）
      - |-
        実機実測（spec ゲート、target 842fd15df607d2140ad1a5247291f148c84946b9）:
        憲法文書だけが名指しし SPEC.md が名指ししていない実在ファイル（例: 語彙 lint スクリプト）は展開されなかった。
        また抽出元ではなく根拠ファイル側（判定プロンプト生成の実装ファイル）だけが名指しする実在パス11件も
        展開されなかった。展開済み一覧は SPEC.md・AGENTS.md と、SPEC.md が名指しした3件のみの計5件であり、
        1段だけの導出が保たれている。
  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751 AC-3/8: target SHA設定とblobだけを読み、作業ツリー変更およびbase欠落に安全に対処する
        （同一引数の2回生成の間に、抽出元成果物・根拠ファイル・上限設定値へ未 commit の変更を加えても
        生成物がバイト列一致することを検証。成功）
      - |-
        test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751 AC-3回帰: gate reviewer-promptは実行時のgate-reportに依存せず同一バイト列を返す
        （実装ラウンド3で blocking となった、target SHA に束縛されない gate-report の有無で生成物が変わる経路が
        塞がれていることを、コマンド経由の実行で検証。成功）
      - |-
        実機実測（4 gate、target 842fd15df607d2140ad1a5247291f148c84946b9 / base f72eadd6bb6403f73f3163a8138f4cdabbbdd26b）:
        同一引数で2回生成した結果はバイト列一致した。続けて作業ツリーへ、抽出元成果物 SPEC.md への追記、
        根拠ファイル（判定プロンプト生成の実装ファイル）への追記、憲法文書への追記、未追跡ファイルの追加、
        および上限設定値の 1500000 から 1000 への書き換えを同時に加えたうえで3回目を生成しても、
        4 gate すべてが1回目とバイト列一致した（設定値が読まれていれば必須区間超過で失敗するはずの値である）。
        さらに、実行時の gate-report を Light プロファイル適用状態で配置しても生成物は変化せず、
        明示引数で Light 適用を指定したときだけ追加ルーブリック区間が現れた。
      - |-
        実機実測（実行環境非依存性の追加確認、validation ゲート）: 作業ディレクトリをリポジトリ直下から
        サブディレクトリへ変えた場合、TZ=UTC・LANG=C・LC_ALL=C を与えた場合、git の core.autocrlf=true と
        core.eol=crlf を設定した場合のいずれでも、生成物は基準の生成物とバイト列一致した。
  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751 AC-4/5/6: 非テキストと予算超過を全文か省略へ分類し、完成promptを上限内に保つ
        （省略一覧にパス・バイト長・digest・理由が現れ、いずれの根拠ファイルも部分展開されないこと、
        非テキストが予算を消費せず後続の分類へ影響しないことを検証。成功）
      - |-
        test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751 AC-1/4回帰: 多数の分離バッククォート列を持つ根拠ファイルでも展開と省略通知を完了する
        （実装ラウンド3で blocking となった、バッククォート列の件数に比例して可変長引数が増え生成が
        例外終了する経路が塞がれていることを検証。成功）
      - |-
        実機実測（validation ゲート、上限を 120000 バイトへ下げた commit を target とした生成）:
        適用上限120000・M=83312・L=1565・B=35123 が本文へ現れ、根拠ファイル2件が
        「パス | バイト長 | digest | 理由: 予算超過」の形式で省略一覧に列挙された。省略された2件の本文は
        一部も現れず、走査は1件目の巨大ファイルで打ち切られずに継続した。完成した判定プロンプトは
        114347 バイトで上限内に収まった。
  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751 AC-5: 必須区間超過と多数小ファイルによる一覧予約超過を件数・M・L付きで拒否する
        （必須区間だけで上限を超える場合と、必須区間は収まるが一覧の予約長を加えると超える場合の双方で
        生成が非0終了し、メッセージが M・L・候補件数・上限を含み、切り捨てが起きないことを検証。成功）
      - |-
        test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751 AC-4/5/6: 非テキストと予算超過を全文か省略へ分類し、完成promptを上限内に保つ
        （展開対象3列の全入力が全文で展開され、省略一覧に現れないことを検証。成功）
      - |-
        実機実測（validation ゲート、上限120000バイト）: 上流成果物 SPEC.md・DESIGN.md・PLAN.md・
        当該 Issue の ADR と憲法文書 AGENTS.md はいずれも全文で展開され、省略一覧に現れなかった。
        省略されたのは根拠ファイルだけである。
      - |-
        実機実測（validation ゲート、上限を 50000 バイト（必須区間 M を下回る値）へ下げた commit を target とした生成）:
        終了コード1・標準出力0バイトで停止し、標準エラー出力は
        「判定プロンプトの必須区間と一覧予約が上限を超えました（M=83307 B, L=1565 B, 候補件数=11, 上限=50000 B）」と、
        対象 Issue の分割または target SHA の設定値引き上げという対処を提示した。途中まで出力された
        判定プロンプトは存在しない。
  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751 AC-1/2/6/7: gate_id固定表・1段閉包・一意一覧を4 gateで保つ
        （展開対象列の全パスが展開済み一覧へ、根拠ファイルが各々ちょうど1回いずれかの一覧へ現れることを検証。成功）
      - |-
        test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751 AC-6/7: evidence本文のbacktickと偽見出しを衝突不能な動的fence内へ閉じ込める
        （根拠ファイル本文中のバッククォート列や偽の見出しが、区間の境界を破って一覧の外観を偽装できないことを検証。成功）
      - |-
        test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751 AC-6/7回帰: 改行入りADRパスでも上流成果物の見出しから偽の構造見出しを注入できない
        （実装ラウンド3で blocking となった、上流成果物の見出しへ未エスケープのパスを埋めることで
        偽の構造見出しを本文へ注入できる経路が塞がれていることを検証。成功）
      - |-
        実機実測（4 gate、target 842fd15df607d2140ad1a5247291f148c84946b9）: いずれの gate でも
        「適用上限」「必須区間のレンダー長 M」「一覧の予約長 L」「根拠ファイル予算 B」の4値と、
        展開済みファイル一覧・省略ファイル一覧の双方が本文へ現れた。両一覧に現れるパスの重複は0件であり、
        抽出された根拠ファイルはいずれか一方の一覧にちょうど1回だけ現れた。該当が無い一覧は「(なし)」と明示された。
  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751 AC-1/2/6/7: gate_id固定表・1段閉包・一意一覧を4 gateで保つ
        （ハルシネーション防止区間が両一覧を判別手段として参照し、展開済みを検証不能として扱う記述を
        含まないことを検証。成功）
      - |-
        実機実測（spec ゲート、target 842fd15df607d2140ad1a5247291f148c84946b9）: 当該区間は、内容を検証できるのは
        展開済みファイル一覧に列挙され内容が展開されたファイルだけであること、省略ファイル一覧に列挙された
        ファイルの内容は不明であり学習知識や推測で補ってはならないこと、両一覧を内容の有無の唯一の判別手段として
        扱うことを明示していた。展開済みファイルを検証不能として扱うよう促す記述は存在しなかった。
  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751 AC-3/8: target SHA設定とblobだけを読み、作業ツリー変更およびbase欠落に安全に対処する
        （上流成果物が欠ける状態と base SHA を与えない呼び出しの双方で、終了コード0かつ不在・導出不能が
        本文へ明示されることを検証。成功）
      - |-
        実機実測（implementation ゲートと validation ゲート、base SHA を与えない呼び出し、
        target 842fd15df607d2140ad1a5247291f148c84946b9）: いずれも終了コード0で生成され
        （それぞれ 234404 バイト・234518 バイト）、本文へ
        「(当該IssueのADR集合はbase SHA未指定のため導出不能)」が明示された。
      - |-
        実機実測（validation ゲート、target 842fd15df607d2140ad1a5247291f148c84946b9 では VALIDATION.md が
        未作成であった時点の生成）: 判定対象成果物の区間に当該パスの見出しが現れたうえで「(未検出)」と
        明示され、空文字列で沈黙して埋められることはなかった。
  - ac_id: AC-9
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/gate-judgment.test.ts::gate reviewer-prompt: 新規追加成果物の全文再掲を省略した固定出力とバイト数上限を保つ
        （固定入力から生成した判定プロンプトが golden fixture とバイト列一致することを検証。成功）
      - |-
        test/integration/gate-evidence.test.ts の証跡往復テスト群（レビュー証跡の照合が期待値として生成する
        判定プロンプトの digest と、コマンドが出力した判定プロンプトの digest が一致することを検証。成功）
      - |-
        test/integration/gate-judgment.test.ts の判定プロンプト区間テスト群（AC-ID 区間、conformance と
        falsification のルーブリック、出力 JSON 契約、判定対象の差分、判定対象の成果物、過去ラウンドの判定記録、
        Light プロファイル追加ルーブリックの各既存区間が保たれていることを検証。成功）
      - |-
        実機実測（4 gate、target 842fd15df607d2140ad1a5247291f148c84946b9）: 要件が保全対象とする既存区間は
        いずれも生成物の先頭側に同じ並びで残っており、削除も改変も観測されなかった。判定プロンプトの生成関数の
        呼び出し箇所は実装コード全体で2箇所（コマンドの標準出力経路と、レビュー証跡照合が期待値を得る経路）であり、
        いずれも同一の関数を呼ぶため生成経路は1つに保たれている。

regression:
  executed: true
  evidence:
    - |-
      npm test（pretest で npm run build を実行）を worktree で2回実行し、いずれも終了コード0、
      1429件中1428件成功・0件失敗・1件skip。2回目は `set -o pipefail` のうえ
      `npm test 2>&1 | tee test-execution.log` として実行し、所要 339.4 秒。
      skip の1件は環境変数指定時だけ実行される外部到達性テストである。
    - |-
      実装セグメントのラウンド3で blocking となった3件の反例を再現する回帰テストの再実行結果:
      test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751 AC-1/4回帰: 多数の分離バッククォート列を持つ根拠ファイルでも展開と省略通知を完了する（成功）、
      test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751 AC-6/7回帰: 改行入りADRパスでも上流成果物の見出しから偽の構造見出しを注入できない（成功）、
      test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751 AC-3回帰: gate reviewer-promptは実行時のgate-reportに依存せず同一バイト列を返す（成功）。
    - |-
      test/integration/gate-reviewer-prompt-input-closure.test.ts::ISSUE-751回帰: 必須入力Mが1042451 Bのimplementation promptを既定1500000 Bで生成できる
      （現に成功している規模のゲートを既定値のまま失敗側へ変えないことの回帰検査。成功）
    - |-
      既存の判定プロンプト関連テスト（golden fixture 比較、決定性、証跡往復、アダプタ起動）はいずれも成功し、
      判定プロンプトの生成経路・証跡照合に回帰は観測されなかった。
    - |-
      機械検査の再実行: lint-vocab.sh・lint-references.sh・adr-lint.sh check・verify-doc-length.sh・
      verify-template-sync.sh・verify-branch-name.sh・verify-worktree-path.sh・verify-config-doc-sync.sh・
      verify-adr.sh（当該 ADR）・verify-spec-bdd.sh（SPEC.md）・verify design-diagram（DESIGN.md）は
      すべて終了コード0。lint-secrets.sh --diff origin/main も終了コード0。

# ■ 未決事項
#   - 上限の既定値 1500000 バイトが、実際に用いる各レビュアモデルの文脈長へ収まるかは本セグメントでは
#     確認できない（レビュアモデルの文脈長は本 Issue の対象外であり、別 Issue へ分離済みである）。
#     本セグメントで確認したのは、既定値が現に成功している最大規模のゲートの完全レンダー長を上回ること、
#     および超過時に無言の切り捨てではなく非0終了となることまでである。
#   - 上記 F-1・F-2 の是正要否と時期。
#
# ■ 対象外
#   - 判定プロンプトの入力スナップショットからの再生成と照合機構。
#   - レビュアへのツール呼び出し許可、成果物内引用の機械的検証。
#   - 依存関係の脆弱性（fast-uri）の是正。本 Issue は依存関係を変更していない。
#   - 過去に記録済みのレビュー証跡の再検証、consumer リポジトリの導入版更新手順。
