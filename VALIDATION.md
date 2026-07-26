# 独立検証記録: セグメント別 worker アダプタ・モデルティア選択の恒久設定
#
# 本ファイルは純粋な YAML である（.agent-skill-chain/schemas/validation-report.schema.yaml、
# agent-skill-chain/validation-report/v1）。見出し相当の情報はコメントで表現する。
#
# 目的
#   Issue ISSUE-307 の SPEC.md が定める受入条件 AC-1〜AC-9 のそれぞれについて、
#   実装が要求どおりに振る舞うことを実装セグメントとは独立に実行・観測して判定し、
#   判定に用いた証跡（実行したコマンドと観測された出力）を記録する。あわせて、
#   本変更が既存の振る舞いを壊していないこと（回帰の不在）を記録する。
#
# 対象範囲
#   検証対象は、ワーカー起動時のアダプタ・モデル選択の解決経路である。すなわち
#   設定スキーマ（.agent-skill-chain/schemas/config.schema.yaml）、設定ファイル
#   （.agent-skill-chain/config/agent-skill-chain.yaml）、設定読み込みと選択解決
#   （src/lib/config.ts、src/lib/worker-selection.ts）、CLI サブコマンド
#   `worker context`（src/commands/worker.ts）、起動ラッパー
#   （.agent-skill-chain/scripts/worker-launch.sh）、codex アダプタ
#   （.agent-skill-chain/adapters/codex.sh）の6点である。
#
# 前提
#   - 検証は対象ブランチ feature/307-segment-worker-adapter-config の commit
#     d6375fbcb4e7ef6c97ab362ee438b87caf4322be に対して行った。
#   - 検証環境は Node.js v20.19.5 / GNU bash 5.2.21 / git 2.43.0 である。
#   - codex CLI・claude CLI の実 API へは一切アクセスしていない。実行系呼び出しは
#     すべて PATH 上に置いた stub（受け取った引数をファイルへ記録するだけの実行体）で
#     置き換えて観測した。
#   - 本リポジトリは自身を適用対象とするため、CLI の設定解決の基点はメイン作業ツリーの
#     設定ファイルになる（linked worktree から実行しても共通 .git を介してメイン側へ
#     解決される既存仕様）。したがって本ブランチの設定ファイルを対象とする検証では、
#     その設定ファイルを含むツリーを明示的に基点として与える方式を用いた。
#
# 用語
#   - セグメント別上書き: 設定キー worker.segment_overrides.<segment> が与える、
#     当該セグメントにのみ適用される adapter・model_tier・reasoning_effort の集合。
#   - ティア対応表: 設定キー worker.model_tiers。ティア名と実行系アダプタ名の組から
#     具体的なモデル文字列を与える構造化データ。
#   - ティア解決: ティア対応表を引いて具体的なモデル文字列を得ること。
#   - worker 起動コンテキスト: `worker context` が返す KEY=VALUE 形式の解決結果。
#   - 完全上書き環境変数: 起動コマンド全体を差し替える CODEX_WORKER_CMD・WORKER_CMD。
#   - 個別上書き環境変数: モデル名・reasoning effort を個別に差し替える CODEX_ 系変数。
#
# 入力
#   SPEC.md（受入条件の正本）、DESIGN.md、PLAN.md、本ブランチの変更コード一式、
#   実装セグメントが追加した単体テスト・結合テスト。
#
# 出力
#   受入テスト結果と回帰テスト結果。すなわち下記 acceptance_criteria（AC ごとの
#   検証方法・判定・証跡）と regression（回帰実行の有無と証跡）である。
#
# 制約
#   本記録の作成にあたり SPEC.md・DESIGN.md・PLAN.md は変更していない。
#
# 検証方法の区分
#   automated: 判定が機械実行の成否・出力の一致のみで決まるもの。
#   hybrid: 記述の存在は機械検査できるが、内容が要求を満たすかの判断に読解を要するもの。
#
# 完了条件
#   AC-1〜AC-9 のすべてに verification.result が記録され、回帰実行結果が記録され、
#   SPEC.md に存在しない AC への言及（孤児テスト参照）と、検証記録の無い AC
#   （孤児 AC）のいずれも存在しないこと。
#
# 検証時に観測した特記事項（いずれも本 Issue の欠陥ではないと判断した）
#   1. 本 linked worktree 内で追加指定なしに `worker context ISSUE-307 implementation`
#      を実行すると adapter=claude が返る。設定解決の基点がメイン作業ツリーへ解決される
#      既存仕様によるものであり、メイン作業ツリー側の設定ファイルが本ブランチの内容へ
#      更新された時点で解消する。本ブランチの設定ファイルを含むツリーを基点として
#      与えた場合は AC-6 が要求する値が返ることを確認済み（AC-6 の証跡を参照）。
#   2. 上記の帰結として、本変更がメイン側へ取り込まれた後は、本リポジトリの実装
#      セグメントの起動に codex CLI の認証が必要になる。認証が成立しない場合は
#      blocked 報告・writer lease 解放・0 でも 3 でもない終了コードという既存の
#      フェイルセーフへ倒れる（誤った成果物は作られない）。これは DESIGN.md と
#      ADR-0015 が意図された挙動として明記しているものである。
#   3. 設定がスキーマに適合しない場合のエラーは、日本語の理由文（どのファイルが
#      どのスキーマに適合しないか）と、機械可読な英語の項目別詳細の組で出力される。
#      本 Issue 以前から存在する worker.adapter へ不正値を与えた場合も同一の形式で
#      出力されることを確認したため、本 Issue が導入した振る舞いではない。
#
# 未決事項
#   なし。
#
# 対象外
#   ゲートレビュア側のセグメント別選択、コア独立レビュー用のモデル宣言と検証機構、
#   codex 以外の新規アダプタ、claude アダプタ・human アダプタのモデル選択方式、
#   highest_capability 以外のティア名、4セグメント構成、配布既定値と本リポジトリ
#   自身の運用設定の分離。いずれも SPEC.md がスコープ外と定めており検証していない。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-307
target_sha: d6375fbcb4e7ef6c97ab362ee438b87caf4322be

acceptance_criteria:
  # AC-1: セグメント別のアダプタ解決
  # Given: worker.adapter=claude、implementation のセグメント別上書きに adapter=codex。
  # When: 各セグメントを指定して worker 起動コンテキストを解決する。
  # Then: implementation は codex、spec・design・validation は claude に解決される。
  # 判定: pass。本ブランチの設定ファイルを含むツリーを基点として CLI を実際に実行し、
  #   4セグメントすべての出力を観測して一致を確認した。
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - '独立実行（受入）: 本ブランチの .agent-skill-chain/ を複製した検証用ツリーを基点に
         `node bin/agents-md.js worker context ISSUE-307 <segment>` を4セグメント分実行。
         implementation は adapter=codex、spec・design・validation はいずれも adapter=claude
         を出力し、後者3つには model_tier・model・reasoning_effort の行が出力されなかった。'
      - '単体テスト: test/unit/worker-selection.test.ts の
         「resolveWorkerSelection (AC-1): セグメント別上書きのadapterが最優先で解決される」が
         adapter=codex・model_tier=highest_capability・reasoning_effort=high の解決結果を、
         「resolveWorkerSelection (AC-1): 上書きの無いセグメントはworker.adapter（スカラー）へ
         フォールバックする」が spec・design・validation の adapter=claude を、
         「resolveWorkerSelection: 上書きのadapterがscalarと異なっても上書きが優先される
         （AC-1双方向）」が scalar=human・上書き=claude の逆向きの組でも上書きが勝つことを
         それぞれ表明する。'
      - '結合テスト: test/integration/worker-context.test.ts の
         「worker context <issue_id> implementation (AC-1, AC-2, AC-6)」と
         「worker context <issue_id> spec/design/validation (AC-1)」が CLI 出力の全行を
         deepEqual で固定している。'
      - '結合テスト: test/integration/worker-adapters.test.ts の
         「codex launch_worker (validation, 任意セグメントへのsegment_overrides追加)」が、
         implementation 以外のセグメントへ上書きを与えた場合にも同じ仕組みが働き、かつ
         上書きの無い spec が影響を受けないことを、起動ラッパー経由の実行で確認する。'
      - '回帰スイート: `npm test` 全652件成功（失敗0件）。'

  # AC-2: モデルティア・reasoning effort の解決と codex 実行への反映
  # Given: implementation の上書きが adapter=codex / model_tier=highest_capability /
  #   reasoning_effort=high、ティア対応表に当該ティアの codex 用モデルがある。
  # When: 起動ラッパー経由で implementation のワーカーを起動する。
  # Then: 解決済みの具体的なモデル文字列と reasoning effort が codex アダプタへ渡り、
  #   codex CLI 起動コマンドのモデル指定・推論強度指定へそのまま反映される。ただし
  #   完全上書き環境変数・個別上書き環境変数が与えられた場合はそちらが優先される。
  # 判定: pass。起動ラッパーから実際に stub 化した codex を起動させ、codex が受け取った
  #   引数列そのものと、codex プロセスへ届いた環境変数を直接観測して確認した。
  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - '独立実行（受入・実地）: 一時リポジトリで issue start により worktree を作成し、
         PATH 上へ引数記録用の codex stub を置いたうえで
         `bash .agent-skill-chain/scripts/worker-launch.sh ISSUE-1 implementation` を実行。
         終了コード0。codex プロセスへ届いた環境変数は
         ASC_WORKER_MODEL=gpt-5.6-sol / ASC_WORKER_MODEL_TIER=highest_capability /
         ASC_WORKER_REASONING_EFFORT=high の3つ。codex が受け取った引数列は
         exec / --sandbox / workspace-write / --color / never / -m / gpt-5.6-sol / -c /
         model_reasoning_effort="high" / - であった。ワーカー報告は status: completed。'
      - '独立実行（優先順位・アダプタ層の直接観測）: main 版と本ブランチ版の
         .agent-skill-chain/adapters/codex.sh をそれぞれ source し、_codex_worker_model と
         _codex_worker_effort の戻り値を4セグメント分比較した。設定由来の値
         （ASC_WORKER_MODEL / ASC_WORKER_REASONING_EFFORT）のみを与えた場合、本ブランチ版だけが
         その値を採用し、個別上書き環境変数を併せて与えた場合は個別上書きが勝つことを確認した。'
      - '結合テスト: test/integration/worker-adapters.test.ts の
         「codex launch_worker (implementation, 本リポジトリ既定config)」がモデル指定と
         推論強度指定の反映を、「codex launch_worker: 個別上書き環境変数
         （CODEX_IMPLEMENTATION_MODEL/CODEX_IMPLEMENTATION_REASONING_EFFORT）は設定由来の
         解決済み値より優先される（AC-2）」が個別上書きの優先を、
         「codex launch_worker: CODEX_WORKER_CMD完全上書きは設定由来のモデル解決そのものを
         行わせない（AC-2, 既存優先順位の回帰確認）」が完全上書きの最優先をそれぞれ表明する。'
      - '結合テスト: test/integration/worker-context.test.ts の
         「worker context (AC-2, AC-9): model_tierが指定されているのにworker.model_tiersが
         無い場合は推測せずエラーで終了する」および worker-adapters.test.ts の
         「worker-launch.sh (AC-2, AC-9): ティア指定はあるがworker.model_tiersを引けない場合、
         lease取得前のエラーとして扱われ何も起動しない」が、解決失敗時に値を推測せず
         既存のフェイルセーフへ倒れることを表明する。'
      - '単体テスト: test/unit/worker-selection.test.ts の
         「resolveModelForTier (AC-2, AC-9): worker.model_tiers.<tier>.<adapter>から
         具体的なモデル文字列を解決する」ほか計4件が、解決成功と3種の解決失敗
         （対応表不在・ティアエントリ不在・当該アダプタ用モデル不在）を表明する。'

  # AC-3: 既存設定に対する解決ロジックの後方互換
  # Given: セグメント別上書きもティア対応表も持たない既存の設定ファイル。
  # When: 4セグメントそれぞれで解決しワーカーを起動する。
  # Then: すべて worker.adapter の値に解決され、未設定なら human。ティア指定が無い場合は
  #   codex アダプタの従来のモデル・reasoning effort 選択がそのまま用いられる。
  # 判定: pass。本 Issue 適用前の設定ファイル（main の内容そのもの）を復元して実行し、
  #   さらに codex アダプタの解決関数の戻り値が main 版と完全一致することを確認した。
  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - '独立実行（受入）: main の .agent-skill-chain/config/agent-skill-chain.yaml を
         そのまま取り出して検証用ツリーへ配置し、`worker context ISSUE-1 <segment>` を
         4セグメント分実行。worker.adapter=claude のとき4セグメントすべて adapter=claude、
         worker.adapter=codex へ変更すると4セグメントすべて adapter=codex、worker.adapter を
         削除して worker: {} とすると adapter=human に解決された。セグメント引数を省略した
         従来形の呼び出しも従来どおり3行のみを返した。'
      - '独立実行（実地・起動まで）: 一時リポジトリの設定から worker.segment_overrides と
         worker.model_tiers のブロックを削除し worker.adapter=codex とした状態で、
         `worker-launch.sh ISSUE-1 implementation` を実行。終了コード0。codex が受け取った
         引数は -m / gpt-5.6-terra / -c / model_reasoning_effort="medium" であり、
         本 Issue 適用前の実装セグメント既定値と一致した。ASC_WORKER_ 系の環境変数は
         1つも export されていなかった（未解決の値を空文字で渡していないこと）。'
      - '独立実行（アダプタ層の同値性）: main 版と本ブランチ版の codex.sh について、
         (a) 上書き環境変数を一切与えない場合、(b) 個別上書き環境変数のみを与えた場合の
         2条件で _codex_worker_model・_codex_worker_effort の4セグメント分の戻り値を
         diff したところ、いずれも完全一致（差分なし）であった。'
      - '結合テスト: test/integration/worker-context.test.ts の
         「worker context (AC-3): セグメント別上書き・ティア対応表を持たない既存設定は
         worker.adapterがそのまま全セグメントへ解決される」「worker context (AC-3):
         worker.adapterも未設定の場合はhumanへフォールバックする」
         「worker context <issue_id> (segmentを省略): 従来互換の3行のみを返す（AC-3後方互換）」。'
      - '結合テスト: test/integration/worker-adapters.test.ts の
         「codex launch_worker (implementation, セグメント別上書き・ティア対応表を持たない
         既存設定): 従来のフォールバック（gpt-5.6-terra/medium）が維持される（AC-3, 後方互換）」
         および「codex launch_worker (spec, ティア未指定)」（非実装セグメントの従来値
         gpt-5.6/high の維持）。'
      - '単体テスト: test/unit/worker-selection.test.ts の
         「resolveWorkerSelection (AC-3): セグメント別上書きを持たないスカラーのみの設定は
         全セグメントでスカラー値に解決される」「resolveWorkerSelection (AC-3):
         worker.adapterも未設定の場合は最終フォールバックのhumanになる」。'
      - 'codex 認証未成立時のフェイルセーフの維持: 本 Issue 以前から存在する
         test/integration/worker-adapters.test.ts の「codex launch_worker: 認証不成立は
         blocked報告・lease解放・exit」系のテストが変更なしで成功している
         （`npm test` 全652件成功）。'

  # AC-4: 設定スキーマによる新旧両形式の検証
  # Given: .agent-skill-chain/schemas/config.schema.yaml。
  # When: 新形式・旧形式・不正値・モデル値変更の各設定を検証する。
  # Then: 新旧両形式は妥当、未知のアダプタ名・ティア名・セグメント名・キーは拒否され
  #   日本語の理由付きで設定読み込みが失敗する。モデル値の変更はスキーマ変更なしで妥当。
  # 判定: pass。スキーマ単体の検証に加え、実際の設定ファイルを改変して CLI から
  #   読み込ませ、拒否されること・受理されることを終了コードと出力で確認した。
  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - '独立実行（受入・設定読み込み経由）: 本ブランチの設定ファイルを8通りに改変し、
         検証用ツリーを基点に `worker context ISSUE-1 implementation` を実行した。
         (1) 未知のアダプタ名 gpt5、(2) 未知のティア名 super_ultra、(3) 未知のセグメント名
         review、(4) segment_overrides 内の未知キー、(5) model_tier があるのに adapter が
         claude、(6) model_tiers への claude キー追加、(8) 未知の reasoning_effort ultra の
         7通りはいずれも終了コード1で失敗し、「config/agent-skill-chain.yaml がスキーマ
         （agent-skill-chain/config/v1）に適合しません」という日本語の理由文と、違反箇所を
         指す項目別詳細が出力された。(7) ティア対応表のモデル値を別の文字列へ変更した設定
         のみ終了コード0で正常に解決された（スキーマ変更を要さないこと）。'
      - '同上の補足: エラー出力の形式が本 Issue 由来でないことを確認するため、本 Issue 以前
         から存在する worker.adapter へ不正値を与えた場合も実行したところ、同一形式
         （日本語の理由文＋項目別詳細）で失敗した。'
      - '単体テスト: test/unit/schema.test.ts に AC-4 を明示する13件のテストがある。
         新形式（examples の新規追加分）の受理、スカラーのみの旧形式の受理、モデル値を
         別文字列へ変更した設定の受理、未知アダプタ名・未知ティア名・未知
         reasoning_effort・未知セグメント名・segment_overrides 内の未知キー・
         model_tier と非 codex アダプタの組・reasoning_effort と adapter 未指定の組・
         model_tiers の未知ティア名・model_tiers の未知アダプタキー・model_tiers の
         codex キー欠落の各拒否、および adapter: codex と組んだ正当な組合せの受理を
         それぞれ表明する。'
      - '単体テスト: test/unit/config.test.ts の
         「loadConfig: 実物の .agent-skill-chain/config/agent-skill-chain.yaml を読み込み
         主要フィールドを検証する」および「loadConfig: スキーマ不適合の config は例外を
         投げる」が変更なしで成功しており、実設定の受理と不適合時の失敗が維持されている。'

  # AC-5: 解決ロジックの単体テスト
  # Given: 本 Issue で追加・変更された設定解決ロジックの5項目。
  # When: リポジトリの単体テストを実行する。
  # Then: 5項目それぞれについて期待される解決結果を検証するテストが存在し成功する。
  # 判定: pass。5項目すべてに対応する単体テストの存在をテストコードの読解で確認し、
  #   スイートの実行で成功を確認した。
  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - '独立実行: `npm run build`（終了コード0）、`npm run typecheck`（終了コード0）、
         `npm test`（tests 652 / pass 652 / fail 0 / skipped 0 / todo 0）。'
      - '項目1（セグメント別のアダプタ解決）: test/unit/worker-selection.test.ts の
         「resolveWorkerSelection (AC-1): セグメント別上書きのadapterが最優先で解決される」。'
      - '項目2（ティア対応表を用いたモデル解決と reasoning effort の解決）:
         test/unit/worker-selection.test.ts の「resolveModelForTier (AC-2, AC-9):
         worker.model_tiers.<tier>.<adapter>から具体的なモデル文字列を解決する」および
         「resolveWorkerSelection (AC-1): セグメント別上書きのadapterが最優先で解決される」
         が reasoning_effort=high の解決結果を含めて表明する。'
      - '項目3（上書き未設定時のフォールバック）: test/unit/worker-selection.test.ts の
         「resolveWorkerSelection (AC-1): 上書きの無いセグメントはworker.adapter（スカラー）
         へフォールバックする」「resolveWorkerSelection (AC-3): worker.adapterも未設定の
         場合は最終フォールバックのhumanになる」「resolveWorkerSelection: model_tier/
         reasoning_effortは上書きが無い場合キー自体を含めない（未解決を空文字にしない）」。'
      - '項目4（ティア解決失敗時の扱い）: test/unit/worker-selection.test.ts の
         「resolveModelForTier: 対応表そのものが無い場合は解決失敗として返す（推測しない）」
         「resolveModelForTier: 当該ティアのエントリが無い場合は解決失敗として返す」
         「resolveModelForTier: 当該アダプタ用のモデルが無い場合は解決失敗として返す
         （未知のアダプタへ推測しない）」「resolveModelForTier: adapterがcodex以外の場合は
         常に解決失敗になる（本Issueでclaude/human用モデルを追加しない）」の4件。'
      - '項目5（スキーマによる新旧両形式の受理と不正値の拒否）: test/unit/schema.test.ts の
         AC-4 を明示する13件。'
      - '単体テストの独立性: src/lib/worker-selection.ts は import を1つも持たない純粋関数
         モジュールであり、ファイル入出力・環境変数・プロセス起動を経由せず検証されている
         ことをソースの読解で確認した。'

  # AC-6: 本リポジトリの実装セグメントの恒久切替
  # Given: 本リポジトリの .agent-skill-chain/config/agent-skill-chain.yaml。
  # When: 追加の指示・環境変数なしで implementation を指定して解決する。
  # Then: adapter=codex / model_tier=highest_capability / reasoning_effort=high と、
  #   ティア対応表から解決された具体的なモデル文字列が得られる。他3セグメントは claude。
  #   セグメント別上書きに具体的なモデル文字列は現れず、設定ファイル内で具体的な
  #   モデル文字列が現れるのはティア対応表のみである。
  # 判定: pass。ただし本 linked worktree 内での素の実行では、設定解決の基点が
  #   メイン作業ツリーへ解決される既存仕様のため main 側の設定が読まれる点に留意
  #   （冒頭の特記事項1を参照）。本ブランチの設定ファイルを基点として与えた場合は
  #   要求どおりの値が得られることを実行して確認した。
  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - '独立実行（受入）: 本ブランチの .agent-skill-chain/ をそのまま複製した検証用ツリーを
         基点に、環境変数を一切追加せず `node bin/agents-md.js worker context ISSUE-307
         implementation` を実行。出力は adapter=codex / backend=github / issue_number=307 /
         model_tier=highest_capability / model=gpt-5.6-sol / reasoning_effort=high の6行、
         終了コード0。同じ設定で spec・design・validation を実行するといずれも
         adapter=claude / backend=github / issue_number=307 の3行のみであった。'
      - '独立実行（設定ファイルの内容確認）: 本ブランチの
         .agent-skill-chain/config/agent-skill-chain.yaml において
         worker.segment_overrides.implementation の値は
         {adapter: codex, model_tier: highest_capability, reasoning_effort: high} であり
         具体的なモデル文字列を含まない。具体的なモデル文字列 gpt-5.6-sol は同ファイル内で
         worker.model_tiers.highest_capability.codex の1箇所にのみ出現する
         （ファイル全体を対象とした出現数の数え上げで1件）。'
      - '独立実行（実地・起動まで）: 一時リポジトリで起動ラッパーから implementation の
         ワーカーを起動し、stub 化した codex が -m gpt-5.6-sol / -c
         model_reasoning_effort="high" を受け取ることを確認した（AC-2 の証跡と同一の実行）。'
      - '単体テスト: test/unit/config.test.ts の「loadConfig (AC-6):
         worker.segment_overrides.implementation が codex/highest_capability/high に恒久設定
         され、worker.model_tiersのみに具体的なモデル文字列を持つ」が、解決値の一致と、
         設定ファイル内の具体的なモデル文字列の出現数が1であることを表明する。'
      - '結合テスト: test/integration/worker-context.test.ts の
         「worker context <issue_id> implementation (AC-1, AC-2, AC-6): 本リポジトリ既定config
         でadapter=codex/model_tier/model/reasoning_effortが解決される」が CLI 出力の全6行を
         deepEqual で固定する。'

  # AC-7: 設定更新手順の文書化
  # Given: 進行役が対話中に「実装は◯◯で」という指示を受けた状況。
  # When: 規範文書（リポジトリの規約文書または CLI のヘルプ出力）を参照する。
  # Then: 更新操作・実行主体・タイミングが一意に読み取れ、その手順が進行役の純粋性を
  #   侵さないことが確認できる。
  # 判定: pass。記述の存在は CLI を実行して確認し、内容が要求を満たすかは読解で判断した。
  - ac_id: AC-7
    verification:
      mode: hybrid
      result: pass
      reason: '手順の記述が存在することは機械検査できるが、その手順が進行役の純粋性
        （進行役は調整状態のみを読み書きし、成果物の著述・内容の取り込みを行わない）を
        侵さないかどうかの妥当性判断は、記述内容と不変条件を突き合わせる読解を要するため
        自動化できない。'
      procedure: '(1) `node bin/agents-md.js worker context -h` を実行し、ヘルプ出力に
        更新操作・実行主体・タイミング・現在値の確認手段が記載されているかを確認する。
        (2) .agent-skill-chain/config/agent-skill-chain.yaml の worker セクション直上の
        コメントに同じ4点が自己完結して記載されているかを確認する。
        (3) 記載された実行主体と経路が、進行役の純粋性および「調整状態は Coordination
        Backend のプリミティブにのみ存在する」という不変条件に反しないかを読解で判断する。
        (4) 実際に設定を書き換える CLI サブコマンドが存在しないことを、CLI のコマンド一覧を
        出力して確認する。'
      executor: 'validation worker（claude、本 Issue の独立検証セグメント担当）'
    evidence:
      - '独立実行: `node bin/agents-md.js worker context -h` の出力に、更新操作
         （.agent-skill-chain/config/agent-skill-chain.yaml の直接編集で更新する／専用の
         書き換えコマンドは存在しない）、書いてよい場所の限定（具体的なモデル文字列を
         書いてよいのは worker.model_tiers だけ）、実行主体（writer lease を保持する
         セグメント作業ワーカー）、タイミング（当該変更を扱う Issue の実装セグメントで編集
         する）、進行役の関与の限界（進行役は調整状態のみを読み書きし、設定ファイルという
         成果物側の資産は編集しない。対話で受けた指示は Issue への記録とワーカー起動に限って
         反映する）、現在値の確認手段（このコマンド自体）がすべて記載されていることを確認した。'
      - '独立実行: `node bin/agents-md.js` のコマンド一覧に、設定を書き換えるサブコマンドが
         存在しないことを確認した（worker context は読み取り専用の解決結果出力である）。'
      - '設定ファイルのコメント（正本）: .agent-skill-chain/config/agent-skill-chain.yaml の
         worker セクション直上に、ヘルプ出力と同一の4点（更新操作・書いてよい場所の限定・
         実行主体・タイミング）と、進行役が編集しないこと、対話で受けた指示は Issue への
         記録とワーカー起動に限って関与することが自己完結して記載されている。'
      - '読解による妥当性判断: 記載された手順は、設定ファイルの編集をワーカーによる成果物
         ブランチへの commit に限定し、進行役の関与を Issue への記録とワーカー起動だけに
         留める。進行役が成果物を著述せず、成果物ブランチへ commit もしないため、進行役の
         純粋性を侵さない。また設定を書き換える CLI サブコマンドを新設していないため、
         CLI を実行できる進行役が境界を越える経路も存在しない。以上より要求を満たすと判断した。'
      - '結合テスト: test/integration/worker-context.test.ts の「worker context -h (AC-7):
         恒久設定の変更操作・実行主体・タイミング・現在値の確認手段が記載される」が、
         上記6点の記述の存在を機械的に固定している。'

  # AC-8: 設定項目追加手続きの帰結の明記
  # Given: 本 Issue の設計成果物と更新後の設定スキーマ。
  # When: これらを参照する。
  # Then: 新設フィールドについて、ハードコード不可の理由・プロジェクト単位で変わる
  #   必要性・スキーマ版数の扱い・既定値・migration 方針の5点が明記されている。
  # 判定: pass。5点すべての記述の所在を特定し、内容が要求を満たすかを読解で判断した。
  - ac_id: AC-8
    verification:
      mode: hybrid
      result: pass
      reason: '5点の記述が存在することは機械検査できるが、各記述が当該項目に対する説明として
        十分かどうか（例えばスキーマ版数を据え置く判断に理由が伴っているか）の判断は読解を
        要するため自動化できない。'
      procedure: 'DESIGN.md の「設定項目追加手続きの帰結」節と ADR-0015 を通読し、
        (1) ハードコードで対応できない理由、(2) プロジェクト単位で変わる必要性、
        (3) スキーマ版数の扱いとその理由、(4) 既定値、(5) migration 方針の5点それぞれに
        ついて、記述の有無と、その記述が判断の根拠を伴っているかを確認する。あわせて
        更新後の設定スキーマが実際にその記述どおりの構造（任意項目・版数据え置き）に
        なっているかを設定スキーマの内容と照合する。'
      executor: 'validation worker（claude、本 Issue の独立検証セグメント担当）'
    evidence:
      - 'DESIGN.md の「設定項目追加手続きの帰結」節に、番号付きで6項目が記載されている。
         1 ハードコード不可の理由（どのセグメントをどの実行系で走らせるかは認証状況・費用・
         品質要求で決まる運用上の選択であり、コードで固定すると利用者が変更する手段を失う。
         ティアに対応する具体的なモデル文字列もモデル世代の更新のたびに変わる値である）、
         2 プロジェクト単位で変わる必要性（codex CLI を導入していないプロジェクトと、
         実装だけ別実行系へ寄せたいプロジェクトを同一の既定値では満たせない）、
         3 スキーマ版数の扱い（agent-skill-chain/config/v1 のまま据え置く。追加はすべて
         任意項目であり後方互換。版を上げると既存のすべての設定ファイルが即座に不正となる
         ため、破壊的変更に限る）、4 既定値（segment_overrides 未設定・model_tiers 未設定。
         その場合の解決結果は worker.adapter、未設定時は human で、モデルと reasoning effort
         は未解決）、5 migration（不要・no-op。移行スクリプトも変換処理も追加しない）、
         6 ADR（作成する）。'
      - 'ADR-0015（docs/adr/ADR-0015-segment-worker-adapter-and-model-tier-config.md、
         status: proposed）の Context・Decision・Consequences に、上記5点と同じ判断が
         判断理由とともに記録されている。とくにスキーマ版数については「スキーマ定義の更新」と
         「スキーマ版数の引き上げ」が同義でないことを明示したうえで据え置きを決めている。'
      - '設定スキーマとの照合: .agent-skill-chain/schemas/config.schema.yaml において
         segment_overrides・model_tiers はいずれも worker の required に入らない任意項目で
         あり、schema_version の const は agent-skill-chain/config/v1 のまま据え置かれている。
         ティア対応表のモデル値は const ではなく minLength: 1 の文字列として定義されており、
         DESIGN.md と ADR-0015 の記述と一致する。'
      - '既定値・migration 不要の実地確認: 本 Issue 適用前の設定ファイル（main の内容）が
         無変更のまま妥当と判定され、4セグメントすべてで従来と同一の解決結果を返すことを
         実行して確認した（AC-3 の証跡と同一の実行）。'

  # AC-9: ティア対応表の存在と更新容易性
  # Given: .agent-skill-chain/config/agent-skill-chain.yaml の worker.model_tiers。
  # When: highest_capability を指定したセグメントについて解決する。
  # Then: 当該ティアと codex アダプタの組に対応する具体的なモデル文字列が、ティア対応表の
  #   単一エントリから解決される。モデル世代の更新はそのエントリの値の変更だけで足り、
  #   設定スキーマ・CLI・起動ラッパー・アダプタのコード変更を要さない。アダプタのソースに
  #   具体的なモデル文字列を新たに追加しない。
  # 判定: pass。対応表の値だけを別の文字列へ書き換えて解決が追従することを実行で確認し、
  #   アダプタ・スキーマ・起動ラッパーへ具体的なモデル文字列が新たに加わっていないことを
  #   変更差分の全走査で確認した。
  - ac_id: AC-9
    verification:
      mode: automated
      result: pass
    evidence:
      - '独立実行（単一エントリからの解決）: 本ブランチの設定を基点に
         `worker context ISSUE-307 implementation` を実行すると model=gpt-5.6-sol が
         出力される。この値の出所は worker.model_tiers.highest_capability.codex の
         単一エントリのみである（設定ファイル全体での当該文字列の出現数は1）。'
      - '独立実行（更新容易性）: worker.model_tiers.highest_capability.codex の値だけを
         gpt-9.9-future-model へ書き換えた設定で `worker context ISSUE-1 implementation` を
         実行したところ、設定スキーマ・CLI・起動ラッパー・アダプタのいずれにも変更を
         加えずに終了コード0で妥当と判定され、解決結果が新しい値へ追従した。'
      - '独立実行（アダプタ・スキーマ・起動ラッパーへの新規追加の不在）: main との差分の
         追加行すべてを対象に、モデル名らしい文字列を走査した。実行対象コード側で
         具体的なモデル文字列が追加行に現れるのは
         (a) .agent-skill-chain/config/agent-skill-chain.yaml の
         worker.model_tiers.highest_capability.codex、
         (b) .agent-skill-chain/adapters/codex.sh の既存フォールバック値 gpt-5.6-terra と
         gpt-5.6 の2つのみ。(b) は関数の書き換えに伴い差分上は追加行として現れるが、値そのものは
         main と同一であり、main 版と本ブランチ版の解決関数の戻り値を上書き環境変数なし・
         個別上書きのみの2条件で比較して完全一致することを確認済みである（SPEC.md が
         「既に存在する値は無変更のまま残る」と定めるとおり）。
         .agent-skill-chain/schemas/config.schema.yaml と
         .agent-skill-chain/scripts/worker-launch.sh には具体的なモデル文字列が存在しない
         （スキーマの examples はプレースホルダ文字列 some-model-id を用いている）。'
      - '独立実行（コア独立レビュー用機構への不干渉）: 変更ファイル一覧に
         .agent-skill-chain/project/ 配下・project-policy スキーマ・
         src/lib/model-selection.ts・src/lib/bootstrap-ledger.ts・ADR-0009 のいずれも
         含まれないことを確認した。また src/lib/worker-selection.ts は import を1つも持たず、
         src/commands/worker.ts の import も paths・config・issue・cli-io・worker-selection の
         5つのみで、当該機構への依存を持たない。'
      - '結合テスト: test/integration/worker-adapters.test.ts の「codex.sh: アダプタのソースに
         具体的なモデル文字列（worker.model_tiersのgpt-5.6-sol）が新たに追加されていない
         （AC-9, DESIGN.md）」および「config.schema.yaml: examplesを含め具体的なモデル文字列
         （worker.model_tiersのgpt-5.6-sol）が新たに置かれていない（SPEC.md制約, ADR-0015）」。'
      - '単体テスト: test/unit/schema.test.ts の「validateAgainstSchema(config) (AC-4):
         ティア対応表のモデル値を別の文字列へ変更してもスキーマ変更無しでvalidになる」および
         test/unit/worker-selection.test.ts の resolveModelForTier に関する5件。'

# 回帰
#   本変更が既存の振る舞いを壊していないことの確認。単体・結合を含む全テストスイートの
#   実行に加え、常時必須の検査（型検査・語彙検査・参照検査・ADR 検査・文書量検査・
#   成果物存在検査・テンプレート同期検査・secret スキャン）を実行した。
#   SPEC.md の完了条件が定める変更種別の判断も記録する。
regression:
  executed: true
  evidence:
    - '全テストスイート: `npm test`（pretest で `npm run build` を実行）を無競合の環境で実行し、
       tests 652 / suites 0 / pass 652 / fail 0 / cancelled 0 / skipped 0 / todo 0、
       所要 487 秒。'
    - '回帰の基準線: 本ブランチはテストを45件追加し、削除したテストは0件、削除したテスト
       ファイルも0件である（main のトップレベル test 定義582件に対し本ブランチ626件）。
       したがって上記の全件成功には、本 Issue 以前から存在するテストの全件成功が含まれる。'
    - 'ビルド: `npm run build`（tsc）終了コード0。'
    - '型検査: `npm run typecheck`（tsc --noEmit -p tsconfig.test.json）終了コード0。'
    - 'lint / format および静的解析: 本リポジトリの常時必須検査は
       `.agent-skill-chain/standards/TEST_POLICY.md` に従い CLI サブコマンドとして提供される。
       `bash .agent-skill-chain/scripts/lint-vocab.sh` 終了コード0（禁止語の混入なし）、
       `bash .agent-skill-chain/scripts/lint-references.sh` 終了コード0（セクション番号参照・
       ファイルパス＋行番号参照の混入なし）。'
    - '依存関係・secret スキャン: `bash .agent-skill-chain/scripts/lint-secrets.sh` に
       本ブランチの変更ファイル16件すべてを渡して実行、終了コード0（検出0件）。'
    - 'ADR 検査: `bash .agent-skill-chain/scripts/adr-lint.sh check` 終了コード0。
       `bash .agent-skill-chain/ci/verify-adr.sh
       docs/adr/ADR-0015-segment-worker-adapter-and-model-tier-config.md` 終了コード0。'
    - '文書量検査: `bash .agent-skill-chain/ci/verify-doc-length.sh` 終了コード0
       （AGENTS.md 144行、各テンプレート100行以内）。'
    - '成果物存在検査: `node bin/agents-md.js verify artifacts ISSUE-307 implementation`
       終了コード0。validation セグメントは本ファイル作成前は
       acceptance_test_results・regression_test_results の欠落で終了コード1であり、
       本ファイルの追加により充足する。'
    - 'テンプレート同期検査: `node bin/agents-md.js verify template-sync` 終了コード0。'
    - 'ブランチ名・worktree パス・root 直下の検査:
       `bash .agent-skill-chain/ci/verify-branch-name.sh`、
       `bash .agent-skill-chain/ci/verify-worktree-path.sh`、
       `bash .agent-skill-chain/ci/verify-root-clean.sh` いずれも終了コード0。'
    - '変更種別の判断（SPEC.md の完了条件が記録を求めるもの）: 本変更は設定と実行系選択の
       変更であり、画面フロー・API 境界・認証認可・性能ホットパス・DB migration・
       デプロイ運用・外部連携のいずれの変更種別にも該当しない。よってそれらに紐づく追加検証は
       不要と判断した。根拠は次のとおり。画面を持たない CLI であること、公開 CLI の
       サブコマンド構成は変わらず worker context に任意引数と追加の出力行が加わるだけで
       既存の呼び出し形が無変更で動作すること（AC-3 の証跡）、権限判定・credential の扱いを
       変更していないこと、解決処理は設定の読み取りと純粋関数の評価のみで起動ごとに1回しか
       走らないこと、永続状態と migration を持たないこと（AC-8 の証跡）、配布・更新の方式
       そのものを変更していないこと、外部サービスとの通信を追加していないことである。'
    - '外部アクセスの不在: 本検証で実行系（codex CLI・claude CLI）の実 API へは一切
       アクセスしていない。実行系呼び出しはすべて PATH 上に置いた stub で置き換え、
       stub が受け取った引数と環境変数を観測する方式で確認した。'
