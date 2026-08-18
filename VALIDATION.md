# VALIDATION: env トークン非設定の資格情報ストア限定環境でゲートレビュアが認証できない
#
# Issue: ISSUE-758 / 対象ブランチ: bugfix/758-keychain-auth-config-dir
# 作成者: validation_worker
#
# 本ファイルは純粋な YAML である（見出し相当の情報はコメントで表現する）。
# フィールドは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）に一致させている。
#
# ---------------------------------------------------------------------------
# 目的・対象範囲
# ---------------------------------------------------------------------------
# 本書は、認証情報の所在が外部資格情報ストア限定（分類C。macOS Keychain 等で、設定
# ディレクトリ配下に通常ファイルとして存在しない）である構成でも claude アダプタの
# ゲートレビュアが認証を成立させて verdict を返すこと、およびその実現が隔離と
# read-only 性・資格情報の非露出を弱めないことを、受入条件 AC-1〜AC-13 単位で検証した
# 結果を記録する。対象は変更後の .agent-skill-chain/adapters/claude.sh、
# .agent-skill-chain/standards/TEST_POLICY.md、および claude アダプタのゲートレビュア
# 起動経路を駆動する結合テストである。
#
# 対象外: 設計判断そのものの再検討、実装の変更、codex アダプタの認証経路、セグメント
# 作業ワーカー起動経路、macOS Keychain 以外の外部資格情報ストア。
#
# ---------------------------------------------------------------------------
# 検証環境と実測手順（本セグメントで実施した実測）
# ---------------------------------------------------------------------------
# 実行者:     validation_worker（AI ワーカー）
# 実行日時:   2026-08-18T22:01+09:00（Asia/Tokyo）
# 実行環境:   Ubuntu 24.04.4 LTS / Linux x86_64 / Node.js v24.19.0
# 実行内容:   検証対象コミットのチェックアウト状態で `npm run build` を実行して型検査と
#             ビルドが成功することを確認したのち、`npm test`（pretest により再ビルド後、
#             test/unit と test/integration の全テストを node --test で実行）を実行した。
# 実測結果:   npm run build  → 終了コード 0、診断出力なし
#             npm test       → 終了コード 0
#                              tests 1398 / pass 1397 / fail 0 / cancelled 0 /
#                              skipped 1 / todo 0 / duration_ms 590241.443008
# skipped 1 件の内訳: 「GitHub導入元へ実際に到達してpackage versionを取得できる」。
#             環境変数 ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 の指定時のみ実行される既存の
#             opt-in ライブネットワークテストであり、本 Issue の変更対象経路とは無関係。
#             本 Issue の追加・変更により新たに skip されたテストは存在しない。
# 本 Issue の追加テスト14件（テスト名に「Issue #758」を含むもの）はいずれも pass した。
# 失敗・エラー・回帰は観測されなかった。
#
# ---------------------------------------------------------------------------
# target_sha についての注記
# ---------------------------------------------------------------------------
# 下記 target_sha は「検証した実装状態のコミット SHA」である。本ファイル自身のコミットは
# その後に作られるため、validation-gate が判定対象とする PR head SHA とは構造上一致しない。
# これは検証記録と判定対象の SHA が同一コミットになり得ないという既知の機構上の欠陥であり
# （Issue #739 が扱う）、本 Issue では解決しない。SHA の書き換えや再検証は行っていない。
#
# ---------------------------------------------------------------------------
# AC-10 の状態: 未実施（human_required）
# ---------------------------------------------------------------------------
# AC-10 は「macOS で対話ログイン済み・環境変数トークン未設定・設定ディレクトリ配下に認証
# ファイル無し・レビュア実行系および認証確認系の上書きを一切設定していない実機で、macOS
# 実機を保有する人間の実行者がゲートレビュア起動スクリプトを spec ゲートに対して実行し、
# ゲートレビュアが verdict を返して final が human_required 以外の確定値になること」を
# 要求し、実行者名・実行日時・結果を本ファイルへ記録することを求めている。
#
# 本セグメントの実行環境は上記のとおり Linux（Ubuntu 24.04.4 LTS）であり、macOS 実機が
# 存在しない。したがって AC-10 は実施できていない。実施していない確認を実施したとは記録
# せず、実行者名・実行日時・結果も記録しない（存在しないため）。
#
# AC-10 の未実施により、.agent-skill-chain/standards/TEST_POLICY.md が定める外部資格情報
# ストア経路の模倣前提 STORE-A1〜STORE-A6 は、いずれも実機による確定が未了である。自動
# テストはこれらの前提を代替実行系による模倣で置き換えているため、前提が実機と乖離した
# 場合、自動テストが成功したまま実機で失敗し得る。この限界は AC-10 の実施でのみ埋まる。
#
# 必要な措置: macOS 実機を保有する人間のメンテナが上記の実行環境と手順で実機確認を行い、
# 実行者名・実行日時・STORE-A1〜STORE-A6 それぞれの結果を本ファイルへ追記すること。
# 本 Issue の validation セグメントの判定は、この点について human_required である。
#
# ---------------------------------------------------------------------------
# AC-13 構成(b)（watchdog 起動失敗）の代替検証に対する評価
# ---------------------------------------------------------------------------
# 結論: 代替（ソースレベルの表明）は AC-13 を充足すると判断する。ただし後述の限界を伴う。
#
# 根拠1（到達不能性の確認）: watchdog は隔離領域を作成しレビュア起動前に自プロセスから
# 分岐して起動される。その起動失敗が成立するのは、プロセス分岐の失敗、アダプタ自身が
# 直前に 0700 で作成した一時領域への準備完了ファイル作成の失敗、または待機コマンドの
# 実行失敗に限られる。いずれも呼び出し元が環境変数・引数で到達できる分岐ではないことを、
# 当該関数の全分岐を読んで確認した。実行時入力で構成(b) を再現する手段は存在しない。
#
# 根拠2（Then の前半＝隔離領域の削除）: 当該経路は2箇所ある。代替検証はその2箇所を
# 特定したうえで、各復帰の直前に隔離領域を再帰削除する処理が置かれていることを表明して
# いる。削除対象が資格情報の配置先を包含することは、AC-8 の実測が取得ステップの標準出力
# 接続先を隔離領域配下の認証ファイルであると観測していることから独立に確かめられる。
#
# 根拠3（Then の後半＝final が human_required）: 当該2経路はいずれも同一の非零終了値で
# 復帰し、呼び出し元はレビュア実行系不在を示す終了値以外の非零復帰を一律に安全側復帰へ
# 集約して human_required を記録する。この集約経路自体は構成(a)（レビュアが時間上限内に
# 応答しない）の実測で human_required になることを確認済みである。したがって構成(b) に
# 固有で未検証のまま残る振る舞いは無い。
#
# 限界（記録）: 本代替は実行時の観測ではなく実装記述の表明であるため、(i) 削除処理を等価
# な別表現へ書き換えるリファクタでは検証が偽陽性（不当な失敗）になり得る、(ii) 削除処理
# 自体が実行時に失敗する場合（一時領域の権限異常等）は検出しない。いずれも構成(b) が
# 実行時入力から到達不能である以上、実行時観測へ置き換える手段が現状は無い。
#
# ---------------------------------------------------------------------------
# 受入条件ごとの検証結果
# ---------------------------------------------------------------------------
# evidence の automated 項目は、テストファイルとテスト名で証跡を指す。
# regression 実行結果（上記「検証環境と実測手順」の実測）は末尾の regression に記録する。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-758
target_sha: 7992f1432faa9f33a0dcfd2a9f010ad12701dabb

acceptance_criteria:
  # AC-1: 3分類いずれでも設定ディレクトリが隔離領域内を指し、呼び出し元設定ディレクトリ
  # とも呼び出し元ホーム配下とも一致しないことを、レビュア子プロセス側の環境記録で確認。
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 3分類いずれでも設定ディレクトリが隔離領域内を指す（Issue #758 AC-1）"
      - "local-run:npm test 2026-08-18T22:01+09:00 Ubuntu 24.04.4 / Node v24.19.0 → tests 1398 / pass 1397 / fail 0 / skipped 1"

  # AC-2: 分類C構成で隔離設定ディレクトリへ資格情報が配置され、隔離環境の認証確認が取得
  # 値との一致を確かめて成功し、verdict が返り final が確定値になることを確認。
  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 資格情報ストア限定構成（分類C）で隔離設定ディレクトリへ資格情報を配置し verdict を返す（Issue #758 AC-2）"
      - "local-run:npm test 2026-08-18T22:01+09:00 → 当該テスト pass"

  # AC-3: 3分類のいずれからも用意できない構成・取得が時間上限内に完了しない構成・認証
  # 確認成立後に取得が失敗する構成の3経路で、分類ごとの検出結果と設定ディレクトリの扱いを
  # 含む診断が呼び出し元の標準エラーへ到達し final が human_required になることを確認。
  # 診断に呼び出し元ホームのパスも資格情報の実値も現れないことを併せて確認している。
  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 認証情報を用意できない場合に分類ごとの検出結果と設定ディレクトリの扱いを診断する（Issue #758 AC-3）"
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 認証確認の成立後に取得が失敗した経路でも原因を診断へ出す（Issue #758 AC-3）"
      - "local-run:npm test 2026-08-18T22:01+09:00 → 当該2件 pass"

  # AC-4: 分類C構成のレビュア子プロセス内で列挙した環境変数について、必須集合11個の存在、
  # 追加許容集合（シェルが自ら設定する3個）以外の変数名の不在、HOME が隔離領域配下であり
  # 呼び出し元 HOME と異なること、全変数値に資格情報の実値が現れないことを確認。
  # 上書き用の変数名が子プロセスへ渡らないことも同テストが表明している。
  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 分類C構成でも子プロセスの環境変数集合が基底集合と許容集合だけになる（Issue #758 AC-4）"
      - "local-run:npm test 2026-08-18T22:01+09:00 → 当該テスト pass"

  # AC-5: 呼び出し元設定ディレクトリに設定ファイル・権限設定・MCP サーバ定義・hooks が
  # 存在する分類C構成で、隔離設定ディレクトリの内容一覧が認証ファイル1件のみであることを
  # レビュア子プロセス側の記録で確認。
  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 分類C構成で隔離設定ディレクトリが認証要素のみになり呼び出し元へ副作用を残さない（Issue #758 AC-5 / AC-7）"
      - "local-run:npm test 2026-08-18T22:01+09:00 → 当該テスト pass"

  # AC-6: 分類C構成で、隔離領域と隔離設定ディレクトリの権限、配置した認証ファイルが 0600
  # であること、正常終了後に隔離領域が削除され複製が残らないことを確認。
  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 分類Cの資格情報が0600で作られ正常終了後に隔離領域ごと消える（Issue #758 AC-6）"
      - "local-run:npm test 2026-08-18T22:01+09:00 → 当該テスト pass"

  # AC-7: 呼び出し元ホーム配下（設定ディレクトリを含む）の内容一覧と各エントリの更新時刻を
  # 起動前後で突き合わせ、新規作成・更新・削除が無いことを確認。
  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 分類C構成で隔離設定ディレクトリが認証要素のみになり呼び出し元へ副作用を残さない（Issue #758 AC-5 / AC-7）"
      - "local-run:npm test 2026-08-18T22:01+09:00 → 当該テスト pass"

  # AC-8: 取得成功・取得失敗・取得の時間上限・認証確認不成立の4構成で、呼び出し元の標準
  # 出力と標準エラー、取得ステップの起動列と環境変数、レビュア子プロセスの環境変数を収集し、
  # 資格情報の実値と取得ステップの標準エラーがいずれにも現れないことを実測で確認。あわせて
  # 取得ステップの標準出力の接続先が隔離設定ディレクトリの認証ファイルのみであること、標準
  # エラーが破棄されること、取得ステップの引数が0個であることを実測している。実装側では
  # 取得結果をコマンド置換・パイプ分岐・環境変数へ渡さないことを表明で固定している。
  # 取得失敗経路の代替は実値を意図的に自身の標準エラーへ書き出しており、それが呼び出し元へ
  # 到達しないことを検証が積極的に表明している点で、失敗経路の非露出が実測で担保されている。
  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 成功・取得失敗・時間上限・認証不成立のいずれでも資格情報の実値が禁止経路へ出ない（Issue #758 AC-8）"
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 取得と配置が実値を変数・引数・分岐へ渡さない実装であること（Issue #758 AC-8）"
      - "local-run:npm test 2026-08-18T22:01+09:00 → 当該2件 pass"

  # AC-9: 認証情報の所在3分類それぞれについて、claude アダプタのゲートレビュア起動経路を
  # 対象とする自動テストが最低1件存在し、実測ですべて成功することを確認。
  # 分類A・分類B＝下記2件、分類C＝AC-2 の回帰テスト。3分類を横断する AC-1 の検証も併せて
  # 3分類すべてを起動している。
  - ac_id: AC-9
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 分類A（環境変数トークン）は資格情報ストアへ問い合わせず verdict を返す（Issue #758 AC-9 / AC-11）"
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 分類B（設定ディレクトリの通常ファイル）は資格情報ストアへ問い合わせず verdict を返す（Issue #758 AC-9 / AC-11）"
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 資格情報ストア限定構成（分類C）で隔離設定ディレクトリへ資格情報を配置し verdict を返す（Issue #758 AC-2）"
      - "local-run:npm test 2026-08-18T22:01+09:00 → 当該3件 pass"

  # AC-10: 未実施。result は本スキーマが pass と fail のみを許すため、実施していない確認を
  # pass と記録しないという理由で fail を選んでいる。これは実機確認が不合格であったことを
  # 意味しない（実機確認自体を行っていない）。詳細は本ファイル冒頭の AC-10 の節を参照。
  - ac_id: AC-10
    verification:
      mode: manual
      result: fail
      reason: "自動化できない理由: macOS 実機の対話ログイン状態と実サービスで有効な資格情報を必要とし、継続的インテグレーション環境では再現できないため。今回 fail としている理由: 本 validation セグメントの実行環境が Linux（Ubuntu 24.04.4 LTS）であり macOS 実機が存在しないため、実機確認を実施できていない。実施していない確認を pass と記録しないという判断による記録上の値であり、実機確認が不合格であったことを意味しない。本項目は human_required である。"
      procedure: "macOS で claude の対話ログインを済ませ、環境変数トークン（ANTHROPIC_API_KEY・CLAUDE_CODE_OAUTH_TOKEN）を未設定、設定ディレクトリ配下に認証ファイル無し、レビュア実行系・認証確認系・取得コマンドの上書きを一切設定していない状態で、ゲートレビュア起動スクリプトを spec ゲートに対して実行する。ゲートレビュアが verdict を返し gate report の final が human_required 以外の確定値になることを確認し、実行者名・実行日時・結果、および TEST_POLICY.md が定める模倣前提 STORE-A1〜STORE-A6 それぞれの成否を本ファイルへ追記する。"
      executor: "未実施のため実行者は存在しない。実施主体は macOS 実機を保有する人間のメンテナであり、AI ワーカーは代替しない。"
    evidence:
      - "未実施。本 validation セグメントの実行環境は Ubuntu 24.04.4 LTS / Linux x86_64 であり macOS 実機が無いため、実機確認を実行していない。実行者名・実行日時・結果は存在しないため記録していない。"
      - ".agent-skill-chain/standards/TEST_POLICY.md の「実機確認の規約」および模倣前提 STORE-A1〜STORE-A6 の表（実施時期・実行者・手順・記録先の規約）。同表の前提はいずれも実機による確定が未了である。"

  # AC-11: 分類A構成・分類B構成それぞれで、資格情報ストアへの問い合わせ記録が1件も無いこと
  # （取得を試みないこと）と、verdict が返り final が確定値になることを確認。取得コマンドの
  # 代替は起動事実を記録して失敗する実装であるため、問い合わせが起きれば記録に現れる。
  - ac_id: AC-11
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 分類A（環境変数トークン）は資格情報ストアへ問い合わせず verdict を返す（Issue #758 AC-9 / AC-11）"
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 分類B（設定ディレクトリの通常ファイル）は資格情報ストアへ問い合わせず verdict を返す（Issue #758 AC-9 / AC-11）"
      - "local-run:npm test 2026-08-18T22:01+09:00 → 当該2件 pass"

  # AC-12: 取得は成功するが隔離環境の認証確認が成立しない構成で、隔離領域が削除され複製が
  # 残らないこと、final が human_required になること、認証不成立の診断が標準エラーへ出ることを確認。
  - ac_id: AC-12
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 取得できても認証確認が不成立なら複製を残さず診断して human_required へ倒す（Issue #758 AC-12）"
      - "local-run:npm test 2026-08-18T22:01+09:00 → 当該テスト pass"

  # AC-13: 構成(a)（レビュアが時間上限内に応答しない）と構成(c)（取得が時間上限内に完了
  # しない）は実行時の観測で隔離領域の削除と final=human_required を確認。構成(b)（watchdog
  # 起動失敗）は呼び出し元から到達可能な入力が存在しないため、両復帰分岐が復帰直前に隔離領域を
  # 削除することのソースレベルの表明で代替している。この代替が AC-13 を充足するかの評価と根拠・
  # 限界は本ファイル冒頭の該当節に記録した（結論: 充足する）。
  - ac_id: AC-13
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 取得の時間上限・レビュアの時間上限のいずれでも複製を残さず human_required へ倒す（Issue #758 AC-13）"
      - "test/integration/gate-credential-store.test.ts :: claude gate reviewer: 監視プロセス起動失敗の復帰経路でも隔離領域を削除する（Issue #758 AC-13 構成(b)）"
      - "local-run:npm test 2026-08-18T22:01+09:00 → 当該2件 pass"

regression:
  executed: true
  evidence:
    - "local-run:npm run build 2026-08-18T22:01+09:00 Ubuntu 24.04.4 LTS / Node v24.19.0 → 終了コード 0（tsc 診断なし）"
    - "local-run:npm test 2026-08-18T22:01+09:00 Ubuntu 24.04.4 LTS / Node v24.19.0 → 終了コード 0 / tests 1398 / pass 1397 / fail 0 / cancelled 0 / skipped 1 / todo 0 / duration_ms 590241.443008"
    - "skipped 1 件は既存の opt-in ライブネットワークテスト（ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 指定時のみ実行）であり、本 Issue の変更対象経路とは無関係。本 Issue により新たに skip されたテストは無い。"
    - "本 Issue が追加した結合テスト14件（テスト名に Issue #758 を含むもの）はすべて pass。既存テストの失敗・ビルド失敗・回帰は観測されなかった。"

# ---------------------------------------------------------------------------
# 未決事項
# ---------------------------------------------------------------------------
# - AC-10（macOS 実機での上書きなし確認）が未実施であり human_required である。これに伴い
#   模倣前提 STORE-A1〜STORE-A6 は実機による確定が未了である。自動テストが成功したまま実機
#   で失敗し得る余地はこの範囲に残る。
# - AC-13 構成(b) は実行時入力から到達不能であり、実装記述の表明でのみ検証されている。実行時
#   観測へ置き換える手段は現状存在しない。
# - 検証記録の target_sha と validation-gate の判定対象 SHA が構造上一致しない点は本 Issue の
#   対象外であり、Issue #739 が扱う。
