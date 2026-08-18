# VALIDATION: gh の --slurp 依存を除去し、古い gh の環境でゲートの取得経路が黙って劣化しないようにする
#
# Issue: ISSUE-774 / 対象ブランチ: bugfix/774-gh-slurp-silent-degradation / 作成者: validation_worker
# 本ファイルは純粋な YAML である（見出し相当の情報はコメントで表現する）。フィールドは
# .agent-skill-chain/schemas/validation-report.schema.yaml（agent-skill-chain/validation-report/v1）に一致させている。
#
# 目的・対象範囲: SPEC.md の AC-1〜AC-9 について、変更後の実装が受入条件を満たすことを独立に実測し証跡を
#   記録する。対象は src/lib/gh-json.ts・src/commands/gate.ts・src/lib/gate-round.ts・src/lib/review-light.ts
#   の変更と、それらを駆動する単体・結合テストである。対象外は設計判断の再検討、実装・テスト・
#   SPEC/DESIGN/PLAN/ADR の変更、gh 2.45.0 より古い gh に対する動作保証。
#
# 実行環境・実測手順: 実行者 validation_worker（AIワーカー）。2026-08-19T00:47〜01:35+09:00（Asia/Tokyo）。
#   Linux x86_64 / Node.js v24.19.0 / npm 11.17.0 / gh 2.97.0（/home/tatsuru/.local/bin/gh）。
#   検証対象コミットのチェックアウト状態で、ビルド・全件テスト・各 lint と、AC 立証テストの単独実行、
#   および gh 実体の不変性スナップショット比較を行った。
#
# 実測結果（すべて本セグメントで実行した実物の出力）:
#   npm run build                                   → 終了コード 0、診断出力なし
#   npm test                                        → 終了コード 0、tests 1415 / pass 1414 / fail 0 /
#                                                     cancelled 0 / skipped 1 / todo 0 / duration_ms 856298.879676
#   .agent-skill-chain/scripts/lint-references.sh   → 終了コード 0、出力なし
#   .agent-skill-chain/scripts/lint-vocab.sh        → 終了コード 0、出力なし
#   .agent-skill-chain/scripts/adr-lint.sh check    → 終了コード 0、出力なし
#   .agent-skill-chain/ci/verify-doc-length.sh      → 終了コード 0、出力なし
#   単独実行 test/integration/gate-gh-slurp-compat.test.ts → 終了コード 0、tests 4 / pass 4 / fail 0
#   単独実行 test/unit/gh-json.test.ts                     → 終了コード 0、tests 9 / pass 9 / fail 0
#   単独実行 test/unit/gate-round.test.ts                  → 終了コード 0、tests 12 / pass 12 / fail 0
#   単独実行 test/integration/reconcile.test.ts            → 終了コード 0、tests 17 / pass 17 / fail 0
#   単独実行 test/integration/gate-judgment.test.ts        → 終了コード 0、tests 33 / pass 33 / fail 0
#   grep -rc -- '--slurp' src/ の合計 0。grep -c -- '--paginate' は src/commands/gate.ts 10 /
#   src/lib/gate-round.ts 1 / src/lib/review-light.ts 1。
#
# skipped 1 件の内訳:「GitHub導入元へ実際に到達してpackage versionを取得できる」。環境変数
#   ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 指定時のみ実行される既存の opt-in ライブ到達性テストであり、本 Issue の
#   変更対象経路とは無関係である。本 Issue の追加・変更により新たに skip されたテストは無い。
#   失敗・エラー・回帰は観測されなかった。
#
# 上流セグメントから独立検証へ送られた確認事項の結果: spec-gate の ac7-given-existence-unverified および
#   design-gate の golden-fixture-existence-deferred は、AC-7 の Given が要求する golden fixture と、それを
#   突き合わせる既存テストの実在を独立検証で同定するよう求めていた。実測の結果、fixture は
#   test/fixtures/gate-reviewer-prompt-golden.txt として実在し、これを読み込んで生成結果と等値比較する既存
#   テストは test/integration/gate-judgment.test.ts の「gate reviewer-prompt: 新規追加成果物の全文再掲を
#   省略した固定出力とバイト数上限を保つ」である。したがって AC-7 は検証可能であり、検証不能な受入条件ではない。
#
# target_sha についての注記（既知の機構上の欠陥。本 Issue では解決しない）: 下記 target_sha は「検証した実装
#   状態のコミット SHA」である。本ファイル自身のコミットはその後に作られるため、validation-gate が判定対象と
#   する PR head SHA とは構造上必ず不一致になる。これは Issue #739 が扱う既知の欠陥であり本 Issue の射程外で
#   あるため、SHA の書き換えやコミット後の再検証といった是正は行っていない。
#
# 未実施の確認（偽の証跡を残さないための明示）: gh 2.45.0 の実体を用いた実機での end-to-end 実行は未実施で
#   ある。SPEC 要件6 が実行環境の gh を変更しないことを求めており、実機 gh の差し替えは行えない。当該経路は
#   未知フラグ拒否を模倣する gh スタブによる自動検証で代替している（AC-5・AC-8）。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-774
target_sha: 7fb8e240914f7a64bcb86118d0573370418ca6fb

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-gh-slurp-compat.test.ts :: AC-1: src配下のgh起動引数からページ一括オプションが全廃され、--paginateは保たれている（単独実行 4件中 pass）"
      - "local-run:grep -rc -- '--slurp' src/ の合計 0、--paginate は gate.ts 10 / gate-round.ts 1 / review-light.ts 1 で維持（2026-08-19）"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/gh-json.test.ts :: gh-json: 配列応答は出力形 (i)(ii)(iii) のいずれからも同一の要素集合を返す"
      - "test/unit/gh-json.test.ts :: gh-json: 文字列リテラル内の括弧・エスケープを含む連結文書を正しく分割する"
      - "test/unit/gh-json.test.ts :: gh-json: 配列と非配列が混在する応答は判別不能として解釈失敗にする"
      - "local-run:npm test 2026-08-19 Node v24.19.0 → tests 1415 / pass 1414 / fail 0 / skipped 1"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/gh-json.test.ts :: gh-json: オブジェクト応答は出力形 (i)(ii)(iii) のいずれからも同一の要素集合を返す"
      - "test/integration/reconcile.test.ts :: gate reconcile (github backend): ページ一括オプションを拒否するghでも連結文書・ページ配列のオブジェクト応答からbaselineを解決する"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/gh-json.test.ts :: gh-json: 空・空白のみ・閉じていない断片・JSON でない文字列を空の一覧として扱わない"
      - "test/unit/gh-json.test.ts :: gh-json: ページに当該属性が無い・配列でない場合は解釈失敗にする"
      - "test/integration/reconcile.test.ts :: gate reconcile (github backend): 終了コード0のまま解釈できないCheck Run応答をbaseline不在扱いにせず停止する"
      - "test/unit/gate-round.test.ts :: ラウンド履歴: 出力形の違いを吸収し、空応答を過去ラウンド0件として扱わない"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-gh-slurp-compat.test.ts :: AC-5/AC-8: ページ一括オプションを拒否するghでもラウンド履歴が構築され、受け付けるghと判定プロンプトが一致する"

  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-gh-slurp-compat.test.ts :: AC-6: ラウンド履歴の取得失敗と解釈失敗だけを標準エラー出力へ提示し、終了コードと本文を変えない"
      - "test/integration/gate-gh-slurp-compat.test.ts :: AC-6: 失敗ではない運用形態（ローカルモード・PR番号未指定）では診断を出さない"
      - "test/unit/gate-round.test.ts :: ラウンド診断: 取得・解釈の失敗だけを診断対象とし、正常な運用形態では診断を出さない"

  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/fixtures/gate-reviewer-prompt-golden.txt が実在し、ブランチ差分に含まれない（git diff --name-only <merge-base d26bb543> HEAD -- 当該fixture の出力が空、2026-08-19 実測）"
      - "test/integration/gate-judgment.test.ts :: gate reviewer-prompt: 新規追加成果物の全文再掲を省略した固定出力とバイト数上限を保つ（単独実行 33件中 pass）"

  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-gh-slurp-compat.test.ts :: AC-5/AC-8: ページ一括オプションを拒否するghでもラウンド履歴が構築され、受け付けるghと判定プロンプトが一致する"
      - "test/unit/gh-json.test.ts :: gh-json: 配列応答は出力形 (i)(ii)(iii) のいずれからも同一の要素集合を返す"
      - "test/unit/gh-json.test.ts :: gh-json: オブジェクト応答は出力形 (i)(ii)(iii) のいずれからも同一の要素集合を返す"

  - ac_id: AC-9
    verification:
      mode: hybrid
      result: pass
      reason: "テストが実行環境の gh を変更しないことは、テストコードの静的確認だけでは十分でなく、実行前後の実体の不変性を人手で定めた手順により観測する必要がある。"
      procedure: "(1) test/helpers/gh-stub.ts が一時ディレクトリへスタブを書き出し、PATH を子プロセスの環境変数としてのみ前置することを読んで確認する。(2) gh の解決先パス・バージョン・実体のサイズと更新時刻・ホームの gh 設定ファイル一覧（サイズと更新時刻）・PATH を実行前に記録する。(3) test/integration/gate-gh-slurp-compat.test.ts を単独実行する。(4) 同じ項目を再記録し差分を取る。"
      executor: "validation_worker（AIワーカー）"
    evidence:
      - "local-run:2026-08-19 スナップショット比較 → 差分なし（gh 2.97.0 / /home/tatsuru/.local/bin/gh のサイズ・更新時刻、$HOME/.config/gh の config.yml・hosts.yml、PATH のいずれも実行前後で同一。テスト単独実行は終了コード 0）"
      - "test/helpers/gh-stub.ts の createGhStub は一時ディレクトリへ実行可能ファイルを書き出し、その位置を子プロセスへ渡す環境変数の PATH へ前置するのみで、恒久的な PATH 設定・gh 実体・gh 設定ファイルを書き換えない"

regression:
  executed: true
  evidence:
    - "local-run:npm run build 2026-08-19T00:47+09:00 → 終了コード 0"
    - "local-run:npm test 2026-08-19 Linux x86_64 / Node v24.19.0 → 終了コード 0、tests 1415 / pass 1414 / fail 0 / cancelled 0 / skipped 1 / todo 0 / duration_ms 856298.879676"
    - "local-run:lint-references.sh・lint-vocab.sh・adr-lint.sh check・verify-doc-length.sh いずれも終了コード 0"
