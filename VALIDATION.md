# 正本: AGENTS.md §不変条件I7
#
# 本ファイルは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）に完全一致する単一YAMLドキュメントである。
# 見出し構造ではなく1つのYAMLとして記述する（src/commands/verify.ts の acCoverage() が
# 本ファイル全体を単一YAMLとして読み込むため、見出し相当の情報はコメントで表現する）。
#
# 本検証は実装者本人とは別の独立検証者として実施した。実装者の自己申告を鵜呑みにせず、
# 以下すべてを自ら再実測した:
#   - 本 worktree で npm run typecheck（tsc --noEmit）と npm test（pretest で build）を
#     独立に再実行し、410 tests / 410 pass / 0 fail / 0 skipped を実測（typecheck exit 0）。
#   - AC-1: defaultVocabFileRoots(root) が <root>/src を含み <root>/bin を含まないことを
#     独立に実測。test/unit/scan.test.ts の該当アサートが全体テストに含まれ pass することを確認。
#   - AC-3: 新実装で prose.md（"issue: これは会議の議題そのものを指す散文…" と
#     "新しい issue create の手順を説明する。" の2行）が両行とも exit 1・違反検出されることを
#     独立に実測。さらに親 commit faa21d1 の lint.ts/scan.ts をビルドして同一 fixture を実行し
#     exit 0（検出漏れ）を実測し、旧=漏れ／新=検出の対比で finding-1 抜け穴の実在と是正を確証。
#   - AC-4: .md のコード識別子（issue_id/issueId）・外部語彙許可リスト（blank_issues_enabled）・
#     バッククォート囲み参照＝exit 0、.yaml の真の YAML キー／flow-sequence＝exit 0、.sh の
#     実 CLI サブコマンド＝exit 0 を独立実測。逆に同一の YAML/CLI テキストを .md へ置くと
#     exit 1（検出へ転じる）ことも実測し、ファイル種別ディスパッチが意図どおり働くことを確認。
#   - AC-2/AC-6: 作業 worktree の実行時ルート解決の既知挙動（既定対象が主 worktree 側 src/ を
#     指し GLOSSARY 不在で ENOENT になる）を回避するため、実チェックアウト相当（実 .git
#     ディレクトリを持つステージ環境に worktree 内容を配置）で CLI を実行し、引数なし
#     lint vocab / lint references が両者 exit 0 で完走することを実測した。CI ワークフローが
#     lint-vocab.sh / lint-references.sh を引数なしで呼び、ラッパーが "$@" をそのまま渡す
#     （明示 src/bin 引数を足していない）ことをワークフロー・ラッパー定義の内容検査で確認し、
#     実装 commit b2e42fa の変更ファイル一覧に CI yml・ラッパーが含まれないこと（＝無改修で
#     新既定を継承）を確認した。
#
# ---- findings（AC個別のpass/fail判定に加えて記録する検証者所見。いずれも非ブロッキング） ----
#
# finding-1（AC-4関連、DESIGN文言と実装ゲートの厳密不一致・実害なし）:
#   DESIGN.md は「想定外拡張子は散文扱い（YAML/CLI 文脈を適用しない）」と記すが、実装の CLI
#   文脈ゲートは !isProseFile(ext)（= ext !== '.md'）であり、.txt 等の想定外拡張子では論理上
#   CLI 文脈が適用され得る。ただし src/lib/scan.ts の walkTextFiles が全エントリを既知拡張子集合
#   （.md/.yaml/.yml/.sh/.json/.ts）で上流フィルタするため、判定器へ到達する拡張子は既知集合に
#   限られる。独立実測で .txt に bare 禁止語を置いても走査対象外で exit 0（判定器へ未到達）を
#   確認した。実運用で観測可能な誤挙動は生じない。将来の可読性向上として CLI 文脈ゲートの
#   明示 allowlist 化、または DESIGN 文言の整合を推奨（本 Issue のブロッカーにしない）。
#
# finding-2（AC-2関連、テストカバレッジの限界・実測で充足）:
#   既定 lint exit 0 の統合テストは test/helpers/tmp-repo.ts の一時リポジトリ上で走るが、
#   同ヘルパは .agent-skill-chain/・docs/GLOSSARY.md・AGENTS.md のみ複製し src/ を複製しない
#   ため、当該テストの既定対象は existsSync フィルタで src/ を落とし、src/ の内容清浄性は
#   自動テストでは回帰保証されない。SC-1（src/ 含む既定 lint exit 0）はレビュー実施者が実
#   チェックアウト相当で引数なし lint vocab/references を両者 exit 0 で実測して充足を確認済み。
#   継続的な回帰保証は CI（実チェックアウトで src/ を含む）が担う。DESIGN の該当文言整合を推奨。
#
# finding-3（AC-1関連、既存ファイルの pre-existing 状態・非ブロッキング）:
#   test/unit/scan.test.ts は BDD の doc コメント（ユースケース/シナリオ/Given-When-Then）を
#   持たない。これは本 Issue で導入した欠落ではなく既存ファイルの状態であり、本 Issue の変更は
#   同ファイル2テストの期待値配列（src 追加・bin 非含有）に限られる。BDD 形式整備は別 Issue で
#   検討し、本 Issue のブロッカーにはしない。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-187
target_sha: b2e42fafcef288a8f5215a8063fe50a7bf0f5e82

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
      reason: "自動テストに加え、defaultVocabFileRoots の返り値に <root>/src が含まれ <root>/bin が含まれないことを独立に再現実測した"
      procedure: "1) test/unit/scan.test.ts の既定対象根テスト（src 含有・bin 非含有アサート）を含む npm test 全体を実行し pass を確認。2) defaultVocabFileRoots(root) を独立に呼び出し <root>/src を含み <root>/bin を含まないことを確認した"
      executor: claude
    evidence:
      - "test/unit/scan.test.ts（defaultLiveFileRoots/defaultVocabFileRoots の src 含有・bin 非含有）"
      - "src/lib/scan.ts（defaultLiveFileRoots へ path.join(repoRoot,'src') 追加、bin/ は追加せず）"

  - ac_id: AC-2
    verification:
      mode: hybrid
      result: pass
      reason: "作業 worktree の実行時ルート解決の既知挙動を回避するため、実チェックアウト相当の環境で CLI を実測する必要があり、その手動手順に加えて是正後の既定 lint 全体を確認したため"
      procedure: "実 .git ディレクトリを持つステージ環境へ worktree 内容を配置し、引数なしの node bin/agents-md.js lint vocab / lint references を実行して両者 exit 0（違反なし）で完走することを実測した。是正対象（src/ の禁止語 49 件・禁止参照 29 件）が分類是正され残違反ゼロであることを確認した"
      executor: claude
    evidence:
      - "src/commands/*.ts・src/lib/*.ts（コメント散文の正規用語化・自己言及 mention のバッククォート化・禁止参照コメントのインライン化・正当コード識別子のバッククォート付き添字化）"
      - "src/commands/lint.ts（references の節番号記号を Unicode エスケープ定数経由で参照し自己言及誤検出を回避）"
      - "実チェックアウト相当での実測: lint vocab exit 0・lint references exit 0（引数なし・src/ 含む）"
      - "finding-2 参照: tmp-repo は src/ を複製しないため src/ 清浄性の回帰は CI が担う"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
      reason: "自動回帰テストに加え、散文 .md 中の YAML 風・CLI 動詞偶然共起が新実装で検出へ転じ、親 commit ビルド版では検出漏れだった対比を独立実測した"
      procedure: "1) test/integration/lint.test.ts の finding-1 回帰テスト（散文 .md 中の偶然共起を違反検出）を含む npm test 全体を実行し pass を確認。2) prose.md（YAML キー風行・CLI 動詞共起行）を新実装で実行し両行 exit 1 検出、親 commit faa21d1 の lint.ts/scan.ts ビルド版で同 fixture を実行し exit 0（検出漏れ）を実測して回帰の実在を確証した"
      executor: claude
    evidence:
      - "test/integration/lint.test.ts（散文 .md 中で YAML キー風・CLI サブコマンド動詞と偶然共起する禁止語混入は違反として検出される、Issue #187 SC-3・Issue #178 finding-1 回帰）"
      - "src/commands/lint.ts（isIdentifierContext のファイル種別ディスパッチ: YAML 文脈は .yaml/.yml 限定、CLI サブコマンド文脈は非 .md 限定）"
      - "対比実測: 新実装 exit 1（検出）／親 faa21d1 ビルド版 exit 0（検出漏れ）"

  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
      reason: "自動テストに加え、正当な識別子利用（.yaml 真キー・.sh 実コマンド・全 ext 共通のコード識別子/許可リスト/バッククォート）が非検出で、同一 YAML/CLI テキストを .md へ置くと検出に転じることを独立実測した"
      procedure: "1) test/integration/lint.test.ts の ext 限定テスト（YAML キー・flow-sequence は .yaml/.yml 限定非検出、CLI サブコマンド文脈は非 .md 限定非検出、コード識別子・外部語彙許可リストは全 ext 非検出）を含む npm test 全体を実行し pass を確認。2) .yaml の issue: 真キー・.sh の agent-skill-chain issue start・.md の issue_id/issueId/blank_issues_enabled/バッククォート囲みをそれぞれ実行し exit 0 を、同一 YAML/CLI テキストを .md に置くと exit 1 を実測した"
      executor: claude
    evidence:
      - "test/integration/lint.test.ts（コード識別子・外部語彙許可リストは全 ext 非検出／YAML キー・flow-sequence は .yaml/.yml 限定非検出／CLI サブコマンド文脈は非 .md 限定非検出）"
      - "src/commands/lint.ts（isCodeIdentifierContext・isExternalVocabAllowlisted は ext ゲート外で全 ext 共通、上流3除外の評価順序不変）"
      - "finding-1 参照: 想定外拡張子は walkTextFiles の上流フィルタで判定器へ未到達（実害なし）"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
      reason: "npm test を独立にフル実行し、実測件数と typecheck clean を確認した"
      procedure: "本 worktree で npm run typecheck（tsc --noEmit -p tsconfig.test.json）exit 0 と npm test（pretest で npm run build）を実行し、410 tests / 410 pass / 0 fail / 0 skipped を実測した（実装フェーズ報告の 410 件と一致、回帰なし）"
      executor: claude
    evidence:
      - "npm test 実行結果: tests 410, pass 410, fail 0, skipped 0"
      - "npm run typecheck: exit 0（エラー0）"

  - ac_id: AC-6
    verification:
      mode: hybrid
      result: pass
      reason: "CI ワークフロー・ラッパー定義の内容検査と、CI 相当の引数なしローカル実行の両方で src/ 継承を確認したため"
      procedure: "1) .github/workflows/agent-skill-chain-ci.yml が lint-vocab.sh / lint-references.sh を引数なしで呼び、両ラッパーが exec ... lint vocab/references \"$@\" で引数を素通しする（明示 src/bin 引数を足していない）ことを定義の内容検査で確認。2) 実装 commit b2e42fa の変更ファイル一覧に CI yml・ラッパーが含まれない（無改修で新既定を継承）ことを確認。3) 実チェックアウト相当で CI ステップ相当の引数なし lint ラッパーを実行し exit 0（src/ を検査対象に含む）を実測した"
      executor: claude
    evidence:
      - ".github/workflows/agent-skill-chain-ci.yml（lint-vocab.sh/lint-references.sh を引数なしで呼び出す）"
      - ".agent-skill-chain/scripts/lint-vocab.sh・lint-references.sh（exec ... \"$@\" で引数素通し）"
      - "commit b2e42fa の変更ファイル一覧に CI yml・ラッパー不在（無改修で src/ 継承）"
      - "実チェックアウト相当での CI 相当引数なし実行: exit 0"

regression:
  executed: true
  evidence:
    - "npm test 実行結果: 410/410 pass, 0 fail, 0 skipped"
    - "npm run typecheck exit 0"
    - "実チェックアウト相当での引数なし lint vocab / lint references（src/ 含む）両者 exit 0"
