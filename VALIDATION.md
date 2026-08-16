# 由来: AGENTS.mdが定める不変条件I7（仕様⇔検証の追跡）の規約に基づく雛形である。
#
# このファイルは Issue 毎に複製して使う雛形である（セグメント: validation、ゲート: validation-gate）。
# フィールドは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）と完全一致させること。
#
# 全ACに共通する検証環境（個々のACのevidenceでは繰り返さない）:
#   - ホスト: Linux / bash / Node.js LTS / npm 11.17.0。ブランチ bugfix/677-cli-resolution-fallback-scripts。
#   - 自動テスト: npm test（pretest で npm run build を実行）。1200件中1200件成功・0件失敗。
#   - 手動検証で用いた consumer 展開物: 対象 SHA の .agent-skill-chain/ 一式を作業領域外の
#     一時ディレクトリへ複製し、bin/agents-md.js・node_modules/.bin/agent-skill-chain を持たず
#     PATH 上にも agent-skill-chain が存在しない状態を作ったもの。
#
# 独立検証セグメントで観測した、自動テスト環境に関する注意（本Issueの変更とは無関係）:
#   既定の TMPDIR（/tmp）を用いると test/unit/paths.test.ts の
#   『repoRoot: .git がどこにも見つからない場合は例外を投げる（AC-2）』のみが失敗する。原因は、
#   本Issueと無関係に検証ホストの /tmp 直下へ空ディレクトリ .git が残存しており、一時fixtureから
#   上位へ遡る repoRoot() が /tmp をリポジトリルートと誤認して例外を投げないため。/tmp を祖先に
#   持たない TMPDIR で実行すると同テストは成功し、1200件全件成功となる。上記の回帰実行結果は
#   後者の条件で取得した。本Issueの変更（共有実装・定型前文・CIステップ）はいずれも
#   src/lib/paths.ts の repoRoot() を経由しない。
#
# 独立検証セグメントで観測した、SPECの範囲外だが下流判断の材料となる事実:
#   公開npmレジストリ（registry.npmjs.org）に agent-skill-chain パッケージは存在せず（HTTP 404）、
#   自動導入コマンド npm install -g agent-skill-chain@latest は実環境では現時点で必ず失敗する。
#   したがって実環境の未解決ケースは常に AC-3 の (a) 経路（理由付き日本語エラー＋非ゼロ終了）へ
#   収束し、AC-2 が定める導入成功後の続行は実環境では成立しない。これは本Issueが導入した欠陥では
#   なく、CIワークフロー側に先行実装済みの自動導入コマンドと同一のコマンドをSPECが要件として
#   指定していること（および当該パッケージが未公開であること）に由来する。SPECは自動導入手段の
#   変更・版指定の変更をいずれもスコープ外としているため、本セグメントでは仕様どおりと判定し、
#   公開状態の是正は別Issueの判断事項として記録するに留める。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-677
target_sha: 9f17b97faac088b5b9e508bd34c7591a66a695e5

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/unit/cli-resolve-structure.test.ts::CLI解決の3 literal を近接保持するファイルは共有実装以外に存在しない
        （.agent-skill-chain/ 配下サブディレクトリを含む全 *.sh を走査し、3経路解決の literal
        〔bin/agents-md.js・node_modules/.bin/agent-skill-chain・command -v agent-skill-chain〕が
        連続12行の窓に同居するファイルを列挙したとき、共有実装 .agent-skill-chain/scripts/cli-resolve.sh
        以外が存在しないことを検証。成功）
      - |-
        test/unit/cli-resolve-structure.test.ts::プロジェクトローカルCLIの literal は共有実装1ファイルだけが保持する
        （第2経路の literal を含むファイルの集合が共有実装ちょうど1件と厳密一致し、かつ共有実装が
        3経路の literal をすべて保持することを検証。前項と併せて「列挙結果がちょうど1件」を成立させる。成功）
      - |-
        独立検証セグメントで実施した走査の実測（AC-1 Then の「0件も2件以上も不合格」を直接確認する目的で、
        テストとは独立にAC-1のWhenをそのまま実行した）: 走査対象 *.sh は61本、3経路解決のコード片を
        保持するファイルは1件のみで、その1件は .agent-skill-chain/scripts/cli-resolve.sh であった。
      - |-
        test/unit/cli-resolve-structure.test.ts::54本の前文は終了形を正規化すると文字単位で一致し、契約割当も固定される
        （対象スクリプト集合54本が共有実装を読み込む定型前文のみを持ち、3経路解決を各自再実装していないことを
        前文テキストの同一性として検証。終了形は直接実行52本が exit・source される2本が return。成功）

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/cli-resolve.test.ts::非対話の未解決時は自動導入し、PATH外の導入先を加えて再解決する
        （3経路いずれも解決不能な非対話環境で、人間への確認を求めずに npm install -g agent-skill-chain@latest
        が呼ばれること〔npm呼び出し記録で確認〕、導入成功後に再解決したCLI実体へ引数がそのまま透過して
        委譲され exit code 0 で終了すること、共有実装が標準出力を汚さないことを検証。成功）
      - |-
        test/integration/cli-wrapper-consumer.test.ts::consumerへ展開した54本全数が共有実装から自動導入分岐へ到達する
        （AC-2 の自動導入分岐へ、対象スクリプト集合54本すべてが到達することを consumer 展開物上で検証。成功）
      - |-
        test/unit/npm-build-prereq-exec.test.ts::Ensure CLI: 非Node consumer（package.json・3経路いずれも無い）は
        npm install -g agent-skill-chain@latest を呼び、以後PATHでCLIが解決可能になる
        （CIワークフローの当該ステップ本体を実行し、AC-2 が求める「CIと同等の自動導入」の基準側が
        共有実装経由でも従来どおり成立することを確認。成功）

  - ac_id: AC-3
    verification:
      mode: hybrid
      result: pass
      reason: |-
        (b) 対話環境での利用者拒否は擬似端末を与えることで自動再現できるが、(a) の
        「自動導入コマンド自体が失敗する」条件のうちネットワーク到達性・レジストリ応答・権限に
        起因する失敗は、隔離環境のスタブでは模擬にとどまり実環境条件の準備を要するため、
        実npm・実レジストリに対する実行1件を手動で併用した。
      procedure: |-
        1. 対象SHAの .agent-skill-chain/ 一式を一時ディレクトリへ複製し、bin/agents-md.js・
           node_modules/.bin/agent-skill-chain を持たず PATH 上にも agent-skill-chain が無い
           consumer 状態を作る。
        2. 標準入力を端末に接続しない（非対話）状態で、当該複製の
           .agent-skill-chain/scripts/setup.sh を --help 付きで実行する。npm はスタブせず、
           実npm・公開レジストリをそのまま用いる。
        3. 標準エラー出力・標準出力・exit code と、委譲先CLIサブコマンドが実行されていないことを確認する。
      executor: validation_worker（Claude Opus 5・本Issueの独立検証セグメント）
    evidence:
      - |-
        test/integration/cli-resolve.test.ts::npm失敗・再解決不能・起動不能はいずれも理由付き日本語エラーで非ゼロ終了する
        （自動導入コマンドが非ゼロ終了する場合・導入後もCLI実体を再解決できない場合・導入されたCLIが
        起動可能性検証に失敗する場合の3系統について、日本語エラーの標準エラー出力・非ゼロ終了・
        標準出力を汚さないことを検証。成功）
      - |-
        test/integration/cli-resolve.test.ts::対話確認で拒否するとnpmを呼ばず理由付き日本語エラーで停止する
        （擬似端末を与えた対話環境で確認プロンプトに拒否応答を与えると、npmが一度も呼ばれず
        「利用者が拒否」を含む日本語メッセージで非ゼロ終了することを検証。AC-3 の (b) 経路。成功）
      - |-
        手動実行（AC-3 の (a) 経路・実環境1件）の観測結果: 実npm・公開レジストリに対する
        npm install -g agent-skill-chain@latest は HTTP 404 で失敗し、ラッパーは標準エラー出力へ
        「agent-skill-chain CLI の自動導入に失敗しました（npm install -g agent-skill-chain@latest が
        非ゼロ終了）。」を出力して exit code 1 で停止した。標準出力への出力は無く、委譲先CLIサブコマンドは
        実行されなかった。無言終了・終了コード0での終了のいずれも発生していない。

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/cli-wrapper-compat.test.ts::対象54本の委譲argvと終了コードが変更前と一致する
        （同一fixture上で、変更前の版〔design セグメント完了SHA fa67956a4e3a0ed4697e32c6f0caef1aad961af6 の
        各ラッパー本文〕と変更後の版を1本ずつ同じ引数で実行し、スタブCLIが記録した委譲先サブコマンド名・
        引数列と exit code が完全一致することを54本全数で検証。抜取りではなく列挙件数54を表明したうえで
        全数を実行する。source される2本は driver 経由で _asc_cli を呼ぶ手順で評価。CLIを複数回呼ぶ3本
        〔worker-launch.sh・worker-launch-verify.sh・gate-launch-reviewer.sh〕は _cli が最低1回呼ばれることも
        併せて表明。エージェント起動・gh・git 書込み系へ到達しないことも確認。成功）

  - ac_id: AC-5
    verification:
      mode: manual
      result: pass
      reason: |-
        「重複が解消されているか、解消しない場合は理由がテンプレート内コメントとして明記されているか」
        という判断は、2つの実装が同一の解決ロジックを共有しているかどうかの意味的照合であり、
        機械的な合否判定に落とせないため。
      procedure: |-
        1. CIワークフローテンプレート .agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml の
           「Ensure agent-skill-chain CLI」ステップ本文を読み、3経路解決のインライン記述が残っていないことを確認する。
        2. 同ステップがローカル用ラッパーと同一の共有実装 .agent-skill-chain/scripts/cli-resolve.sh を
           source して asc_resolve_cli を呼ぶ形になっていることを確認する。
        3. 配布元テンプレートと本リポジトリ側 .github/ の展開結果が同一内容であることを確認する。
        4. もう一方のワークフローテンプレート（root-cleanup 用）にCLI解決・自動導入の記述が
           存在しないことを確認する。
      executor: validation_worker（Claude Opus 5・本Issueの独立検証セグメント）
    evidence:
      - |-
        .agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml の
        「Ensure agent-skill-chain CLI」ステップ（3経路のインライン判定と npm install -g の直書きが
        撤去され、共有実装を source して asc_resolve_cli を呼ぶ形に統一されている。重複は解消済みであり、
        「解消しない場合の理由コメント」を要する分岐には該当しない）
      - |-
        .github/workflows/agent-skill-chain-ci.yml（配布元テンプレートの展開結果。同一内容であることを
        .agent-skill-chain/ci/verify-template-sync.sh の成功で確認）
      - |-
        test/unit/npm-build-prereq-exec.test.ts::ci: Ensure agent-skill-chain CLI ステップは
        ローカル用ラッパーと同じ共有実装へ統一される（統一状態を機械的に固定する回帰テスト。成功）
      - |-
        root-cleanup 用ワークフローテンプレートには3経路解決・自動導入の記述が無く、
        統一対象に該当しないことを確認した（当該2 literal の全文検索で該当なし）。

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/cli-wrapper-consumer.test.ts::consumerへ展開した54本全数が共有実装から自動導入分岐へ到達する
        （.agent-skill-chain/ 一式のみを展開した consumer 複製に対し、対象集合の列挙件数が54であることを
        表明したうえで54本すべてを1本ずつ実行し、各本で npm install -g agent-skill-chain@latest が
        呼ばれること〔＝AC-2と同じ自動導入分岐へ到達したこと〕と、「共有実装を解決／読み込めません」に
        類する起動失敗が発生しないことを検証。3ディレクトリ scripts・ci・adapters の全対象を含み抜取りをしない。成功）
      - |-
        test/unit/cli-resolve-structure.test.ts::前文マーカーによる対象集合54本と既知の非対象集合が完全に分離される
        （対象54本の内訳が .agent-skill-chain/scripts/ 直下40本・同 ci/ 配下12本・同 adapters/ 配下2本であり、
        非対象7本が明示列挙と一致することを検証。AC-6 が要求する「3ディレクトリの全対象」の母集合が
        判定者依存でないことを機械的に固定する。成功）
      - |-
        手動実行の補強（実環境1件）: 上記と同じ形の consumer 展開物を一時ディレクトリへ作成し、
        .agent-skill-chain/scripts/ 配下と同 ci/ 配下のラッパーを実際に起動したところ、いずれも
        共有実装を解決して自動導入分岐（実npm呼び出し）へ到達した。階層深さの異なる2ディレクトリで
        共有実装パスの算出が成立することを実機で確認している。

  - ac_id: AC-7
    verification:
      mode: hybrid
      result: pass
      reason: |-
        導入先 bin ディレクトリが実行中プロセスの PATH に含まれない状況は npm スタブと PATH 制御で
        自動再現できるが、実環境のグローバル導入先レイアウト（npm prefix -g が返す位置と
        実際に実行ファイルが置かれる位置の対応）は npm の実装・設定に依存するため、
        実npmによるグローバル導入1件を手動で併用した。
      procedure: |-
        1. npm の設定でグローバル導入先 prefix を一時ディレクトリへ向け、その bin ディレクトリを
           PATH に含めない状態を作る。
        2. 自動導入コマンドの配布元だけを未公開パッケージからローカル生成の tarball へ差し替えた
           npm ラッパーを PATH 先頭に置く（install -g・prefix -g とも実npmが実行する）。
        3. consumer 展開物の .agent-skill-chain/scripts/setup.sh を --help 付きで非対話実行する。
        4. 導入先 bin にCLI実体が生成されること、ラッパーが再解決してCLIへ委譲すること、
           exit code とサブコマンドの出力を確認する。併せて導入されたCLI実体の --help の exit code を確認する。
      executor: validation_worker（Claude Opus 5・本Issueの独立検証セグメント）
    evidence:
      - |-
        test/integration/cli-resolve.test.ts::非対話の未解決時は自動導入し、PATH外の導入先を加えて再解決する
        （導入先が PATH 外である状況を再現し、npm prefix -g の取得と PATH への追加を経て再解決が成立し
        処理が続行することを、npm呼び出し記録〔install -g の次に prefix -g〕と委譲記録で検証。成功）
      - |-
        test/integration/cli-resolve.test.ts::npm失敗・再解決不能・起動不能はいずれも理由付き日本語エラーで非ゼロ終了する
        （導入は成功したがCLI実体を再解決できない系統について、「自動導入は成功しましたが…再解決できません」
        に相当する日本語エラーと非ゼロ終了を検証。AC-7 の後段。成功）
      - |-
        手動実行（実環境1件）の観測結果: 実npmによるグローバル導入が PATH 外の一時 prefix に対して成功し、
        導入先に agent-skill-chain 実行ファイルが生成された。ラッパーは npm prefix -g で得た導入先を
        PATH へ加えて再解決し、実CLIへ委譲して setup サブコマンドの使い方を標準出力へ出力し exit code 0 で
        終了した。無言での成功扱い・メッセージ無しの終了は発生していない。導入された実CLIの --help は
        exit code 0 を返し、第3経路の起動可能性検証が前提とする条件が実CLIで成立することも確認した。

  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/cli-wrapper-consumer.test.ts::共有実装の4種の破損状態で54本全数が探索パス付き日本語エラーへ収束する
        （共有実装ファイルを 欠落・部分展開・読み取り権限なし・構文エラー の4状態にした配布物複製に対し、
        対象54本を1本ずつ実行し、全ケースで「共有実装…探索パス」を含む日本語エラーが標準エラー出力へ出力され
        非ゼロ終了すること、委譲先CLIサブコマンドが一度も実行されないことを検証。4状態×54本の全数実行であり
        抜取りをしない。成功）
      - |-
        test/unit/cli-resolve-structure.test.ts::CLI解決の3 literal を近接保持するファイルは共有実装以外に存在しない
        （AC-8 が禁じる「ラッパー内にインライン再実装された3経路解決へのフォールバック」が
        存在しないことを、共有実装以外に3経路解決のコード片が無いという形で機械的に担保する。成功）

  - ac_id: AC-9
    verification:
      mode: automated
      result: pass
    evidence:
      - |-
        test/integration/cli-resolve.test.ts::3経路は bin → node_modules → PATH の固定順で選ばれる
        （3経路それぞれの位置へ互いに識別可能な別々のスタブCLIを配置した環境、第1経路を取り除いた環境、
        第1・第2経路を取り除いた環境で実際に起動されたスタブを記録し、判定順序が
        bin/agents-md.js → node_modules/.bin/agent-skill-chain → PATH上の agent-skill-chain のままであり
        下位経路が上位経路に優先しないことを検証。成功）

  - ac_id: AC-10
    verification:
      mode: hybrid
      result: pass
      reason: |-
        AC-10 は非対話環境と対話環境の両方で評価することを求めるが、自動テストが実行するのは
        非対話環境側のみである。対話環境側は擬似端末を与える必要があり自動テストへ組み込まれていないため、
        独立検証セグメントで擬似端末を用いた実行1件を手動で併用した。
      procedure: |-
        1. consumer 展開物と、呼び出しを記録するだけの npm を PATH 先頭に置いた隔離環境を用意する。
        2. 擬似端末を与えた対話環境で AGENT_SKILL_CHAIN_AUTO_INSTALL=0 を設定し、
           .agent-skill-chain/scripts/setup.sh を実行する。確認プロンプトの有無・npm呼び出し記録の有無・
           標準エラー出力・exit code を確認する。
        3. 同一環境で当該環境変数を設定せずに実行し、確認プロンプトが出ること、承諾すると
           npm install -g agent-skill-chain@latest が呼ばれること（既定が「試行する」側であること）を確認する。
      executor: validation_worker（Claude Opus 5・本Issueの独立検証セグメント）
    evidence:
      - |-
        test/integration/cli-resolve.test.ts::opt-outは値0だけで有効になり、それ以外は既定の自動導入を維持する
        （非対話環境で AGENT_SKILL_CHAIN_AUTO_INSTALL の値を 0・空文字列・false・no・1 と変えて実行し、
        0 のときだけ npm が一度も呼ばれず「AGENT_SKILL_CHAIN_AUTO_INSTALL=0…自動導入を行いません」を含む
        日本語メッセージで非ゼロ終了すること、それ以外の値では既定どおり
        npm install -g agent-skill-chain@latest が試行されることを検証。design セグメントから
        引き継がれた警告 OPTOUT_VALUE_UNDEFINED〔0以外の値の扱いが未定義〕は、この実装と検証により
        「0 のみがオプトアウト、他は既定どおり試行」として確定している。成功）
      - |-
        手動実行（対話環境側・擬似端末1件）の観測結果: AGENT_SKILL_CHAIN_AUTO_INSTALL=0 を設定した
        対話環境では確認プロンプトが一切表示されず、npm呼び出し記録も生成されず、標準エラー出力へ
        「agent-skill-chain CLI が見つからず、AGENT_SKILL_CHAIN_AUTO_INSTALL=0 のため自動導入を行いません。」が
        出力され exit code 1 で停止した。委譲先CLIサブコマンドは実行されていない。オプトアウト判定が
        確認プロンプトより前に行われることを実機で確認した。
      - |-
        手動実行（対照条件）の観測結果: 同一の対話環境で当該環境変数を設定しない場合は確認プロンプトが
        表示され、承諾すると npm install -g agent-skill-chain@latest と npm prefix -g が呼ばれた。
        既定が「自動導入を試行する」側であることを確認した。実装セグメントから引き継がれた警告
        auto-install-default-in-noninteractive（非対話環境で自動導入が既定で試行される点）は、
        この既定が SPEC の要件どおりであること、および AGENT_SKILL_CHAIN_AUTO_INSTALL=0 による
        事前オプトアウトが対話・非対話の双方で機能することをもって、仕様どおりと判定した。

  - ac_id: AC-11
    verification:
      mode: hybrid
      result: pass
      reason: |-
        並行起動と部分配置状態の観測は遅延付き npm スタブで自動再現できるが、実npmによる
        並行グローバル導入の挙動（同一 prefix への同時書き込みの中間状態）は npm の実装と
        環境に依存するため、実npmによる並行実行1件を手動で併用した。
      procedure: |-
        1. consumer 展開物と、配布元だけをローカル tarball へ差し替えた実npmラッパーを用意し、
           グローバル導入先 prefix を空の一時ディレクトリへ向け、その bin を PATH に含めない状態にする。
        2. 対象スクリプト集合のうち .agent-skill-chain/scripts/ 配下4本と同 ci/ 配下2本の計6本を
           同一環境で同時に起動し、全プロセスの終了を待つ。
        3. 各プロセスの exit code・標準出力・標準エラー出力を確認し、
           「解決して委譲」か「原因を含む日本語エラーで非ゼロ終了」のいずれかへ収束していることと、
           部分配置状態のCLI実体を採用した委譲・無言終了が発生していないことを確認する。
      executor: validation_worker（Claude Opus 5・本Issueの独立検証セグメント）
    evidence:
      - |-
        test/integration/cli-resolve.test.ts::並行自動導入中も部分配置CLIを委譲せず、各プロセスが定義済み挙動へ収束する
        （導入先を段階的に配置する遅延付き npm スタブの下で複数のラッパーを同時起動し、各プロセスが
        「exit code 0 で委譲成立」か「日本語エラーで非ゼロ終了」のいずれかに収束すること、
        部分配置状態のCLI実体への委譲が記録されないことを検証。成功）
      - |-
        test/integration/cli-resolve.test.ts::第3経路は空・実行不可・help失敗の部分配置状態を採用しない
        （サイズ0・実行権限なし・--help が非ゼロという3種の部分配置状態を第3経路に置いた場合、
        いずれもCLI実体として採用されず非ゼロ終了することを検証。AC-11 が禁じる
        「部分配置状態のCLI実体を採用した委譲」を防ぐ判定そのものの検証。成功）
      - |-
        手動実行（実環境1件）の観測結果: 実npmによる同一 prefix への並行グローバル導入下で
        6本を同時起動したところ、6本すべてが exit code 0 で終了し、それぞれ自分の委譲先サブコマンドの
        使い方を標準出力へ出力した。部分配置状態のCLI実体を採用した委譲・無言終了・メッセージ無しの
        終了コード0での終了はいずれも観測されなかった。

regression:
  executed: true
  evidence:
    - |-
      npm run build（tsc。pretest として実行。成功）
    - |-
      npm test（node --test ランナーで test/unit・test/integration 配下の全 *.test.ts を実行。
      tests 1200 / pass 1200 / fail 0 / cancelled 0 / skipped 0 / todo 0。本Issue固有の新規テスト
      16件〔test/unit/cli-resolve-structure.test.ts の4件、test/integration/cli-resolve.test.ts の9件、
      test/integration/cli-wrapper-compat.test.ts の1件、test/integration/cli-wrapper-consumer.test.ts の2件〕を含む。
      本Issueが本文を変更した対象スクリプト集合54本に依存する既存テスト群〔worker-launch・
      worker-launch-verify・gate-launch-reviewer・lease系・pr系・upgrade系・adapters系を含む〕にも
      回帰が無いことを確認した）
    - |-
      test/unit/npm-build-prereq-exec.test.ts の Ensure CLI 系4件（CIワークフローの
      「Ensure agent-skill-chain CLI」ステップ本文を隔離環境で実際に実行し、3経路それぞれで
      npm を呼ばずに成功すること、3経路いずれも無い場合に npm install -g agent-skill-chain@latest を
      呼んだうえで後続ステップと同じ command -v 判定でCLIが解決可能になることを検証。すべて成功。
      design セグメントから引き継がれた警告 CI_ENSURE_STEP_POSTCONDITION_UNVERIFIED
      〔当該ステップの事後条件が検証されていない〕は、この4件により解消済みと判定した）
    - |-
      .agent-skill-chain/ci/verify-template-sync.sh（配布元テンプレートと .github/ 展開結果の同期検査。成功）
    - |-
      .agent-skill-chain/ci/verify-doc-length.sh（AGENTS.md・各テンプレートの文書量上限検査。成功）
    - |-
      .agent-skill-chain/ci/verify-ac-coverage.sh ISSUE-677（SPEC.md の AC-1〜AC-11 と本ファイルの
      対応検査。孤児AC・孤児テスト参照なし。成功）
    - |-
      .agent-skill-chain/ci/verify-spec-bdd.sh SPEC.md（受入条件のBDD形式検査。成功）
    - |-
      .agent-skill-chain/ci/verify-design-diagram.sh DESIGN.md（設計図の存在検査。成功）
    - |-
      .agent-skill-chain/ci/verify-adr.sh docs/adr/ADR-0064-cli-resolution-shared-implementation-and-auto-install-fallback.md
      および .agent-skill-chain/scripts/adr-lint.sh check（ADR形式・整合検査。成功）
    - |-
      .agent-skill-chain/scripts/lint-vocab.sh（禁止語検査。成功）
    - |-
      .agent-skill-chain/scripts/lint-references.sh（陳腐化しうる参照〔セクション番号参照・
      ファイルパス＋行番号参照〕の検査。成功）
    - |-
      .agent-skill-chain/ci/verify-branch-name.sh・.agent-skill-chain/ci/verify-worktree-path.sh
      （ブランチ名・worktreeパス規約の検査。成功）
    - |-
      .agent-skill-chain/ci/verify-artifacts.sh ISSUE-677 を4セグメント（spec・design・
      implementation・validation）それぞれに対して実行（各セグメントの成果物存在検査。すべて成功）
    - |-
      実装セグメントから引き継がれた info の扱い: adapter-preamble-return-vs-exit（定型前文における
      return と exit の使い分け）は、test/unit/cli-resolve-structure.test.ts の
      『54本の前文は終了形を正規化すると文字単位で一致し、契約割当も固定される』が、直接実行される52本を
      exit・source される2本（adapters/claude.sh・同 human.sh）を return と固定しており、
      機械的に担保されていることを確認した。auto-install-side-effect-observed-in-visible-diff
      （自動導入の副作用が差分上で観測可能である点）は、AC-10 のオプトアウト検証および
      test/integration/cli-resolve.test.ts『adapterはsourceだけではCLI解決も自動導入も行わない』が
      副作用の発火点を限定していることを確認し、追加の是正は不要と判定した。
