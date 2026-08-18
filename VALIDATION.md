# VALIDATION: 反証ルーブリックに合格到達条件・blocking 基準・過去ラウンド・ラウンド上限を与え、
# ゲートを収束させる（ISSUE-729、セグメント: validation、ゲート: validation-gate）
#
# 本ファイルは .agent-skill-chain/schemas/validation-report.schema.yaml
# （agent-skill-chain/validation-report/v1）へ適合する純粋な YAML である。当該スキーマが
# additionalProperties: false を課すため、目的・前提・制約などの散文はすべてコメント（#）で
# 表現する。これは雛形 .agent-skill-chain/templates/issue/VALIDATION.md が定める記法に従う。
#
# ============================================================================
# 目的
# ============================================================================
# ISSUE-729 の独立検証セグメントとして、次の3点を実際の実行結果によって確認し証跡を残す。
#   1. SPEC.md が定める受入条件 AC-1 から AC-9 のすべてが充足されていること。
#   2. 本 Issue の目的（反証ゲートの非停止性をラウンド予算で打ち切ること）が達成されて
#      いること。すなわち、ラウンド予算到達時の打ち切り、打ち切り時の判定不能の機械的設定と
#      人間判断への到達、真正な証跡のみからのラウンド履歴復元、レビュアへ実際に渡した
#      プロンプトの digest の証跡記録、設定変更によるラウンド数の過少計上の不在、
#      プロンプト生成変更後も過去ラウンドが計数から落ちないことが、いずれも成立すること。
#   3. 既存のゲート関連挙動が回帰していないこと。
#
# ============================================================================
# 対象範囲
# ============================================================================
# 対象は branch bugfix/729-falsification-rubric-nonterminating の HEAD
# 8787dbcabcf3100f6b6a9c58fd624a91c98a35ad が含む変更一式である。具体的には反証ルーブリックと
# 過去ラウンド節を生成する判定プロンプト生成、ラウンド番号と過去ラウンド判定記録の導出、
# 耐久記録（PR レビュー証跡）の取得と閾値検査、証跡検証への打ち切りの組み込み、
# 限定閾値・打ち切り閾値の設定項目、およびそれらの自動テストである。
#
# 本セグメントは独立検証であり、実装の是正は行わない。検証の結果として齟齬を見つけた場合は
# 修正せずコメントへ記載する（後述「検証で判明した事実」）。
#
# ============================================================================
# 前提
# ============================================================================
# - レビュアの自然言語判断そのものの当否は検証対象にできない。検証できるのは、生成される
#   判定プロンプトの内容、ラウンド番号の導出結果、verdict から最終判定を導出する処理の挙動の
#   3点である。これは SPEC.md が前提として確定させた範囲であり、本検証もこれに従う。
# - 観測単位は PLAN.md が定めるとおり、ゲートレビューの実運用ではなく当該処理の直接実行と
#   する。すなわち（a）ラウンド導出の純関数を単体テストから直接呼ぶ、（b）判定プロンプト生成を
#   一時リポジトリまたは本リポジトリに対して直接実行し出力文字列を検査する、（c）証跡検証へ
#   組み立てたレビュー一覧と PR 情報を与えて直接実行し最終判定と理由を検査する、の3種類である。
# - 実行環境は Linux、Node.js は package.json の engines が要求する 20 以上、gh は 2.45.0。
#
# ============================================================================
# 入力
# ============================================================================
# - SPEC.md（AC-1 から AC-9 の定義。spec-gate 承認済み）
# - DESIGN.md・PLAN.md・docs/adr/ADR-0068-gate-round-derivation-and-falsification-blocking-criteria.md
#   （design-gate 承認済み）
# - 実装コードと単体テスト（implementation-gate 承認済み、target_sha 8787dbca）
#
# ============================================================================
# 検証内容と結果（実行したコマンドと出力の要旨）
# ============================================================================
# すべて worktree
# .worktrees/20260817_150818-bugfix-729-falsification-rubric-nonterminating で実行した。
# 実行前の作業ツリーは clean、HEAD は 8787dbcabcf3100f6b6a9c58fd624a91c98a35ad であり、
# origin/bugfix/729-falsification-rubric-nonterminating と一致していた。
#
# (1) ビルド・型検査・テスト
#   - npm run build                → exit 0（tsc、出力なし）
#   - npm run typecheck            → exit 0（tsc --noEmit -p tsconfig.test.json）
#   - npm test                     → exit 0。tests 1352 / pass 1351 / fail 0 / skipped 1 /
#                                    duration_ms 309263。skipped 1 件は環境変数
#                                    ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 を指定したときだけ
#                                    実行される外部到達性の確認であり、本 Issue とは無関係。
#   - 変更のあったテストファイルの個別実行（すべて fail 0）
#       test/unit/gate-round.test.ts             tests 10 / pass 10
#       test/unit/review-evidence.test.ts        tests 11 / pass 11
#       test/unit/config.test.ts                 tests  6 / pass  6
#       test/integration/gate-judgment.test.ts   tests 33 / pass 33
#       test/integration/gate-evidence.test.ts   tests  3 / pass  3
#       test/integration/gate-adapters.test.ts   tests 37 / pass 37
#       test/integration/github-backend.test.ts  tests 43 / pass 43
#
# (2) 機械検査スクリプト（すべて exit 0）
#   - .agent-skill-chain/ci/verify-branch-name.sh
#   - .agent-skill-chain/ci/verify-worktree-path.sh
#   - .agent-skill-chain/ci/verify-template-sync.sh
#   - .agent-skill-chain/ci/verify-doc-length.sh
#   - .agent-skill-chain/ci/verify-config-doc-sync.sh
#   - .agent-skill-chain/ci/verify-artifacts.sh ISSUE-729 spec / design / implementation
#     （検査対象セグメントは detect-changed-segments.sh main の出力に従う）
#   - .agent-skill-chain/ci/verify-spec-bdd.sh SPEC.md
#   - .agent-skill-chain/ci/verify-design-diagram.sh DESIGN.md
#   - .agent-skill-chain/ci/verify-adr.sh docs/adr/ADR-0068-gate-round-derivation-and-falsification-blocking-criteria.md
#   - .agent-skill-chain/scripts/lint-vocab.sh
#   - .agent-skill-chain/scripts/lint-references.sh
#   - .agent-skill-chain/scripts/adr-lint.sh check
#   - .agent-skill-chain/scripts/lint-secrets.sh --diff origin/main
#   - .agent-skill-chain/ci/verify-ac-coverage.sh ISSUE-729（本ファイル作成後に実行）
#   - .agent-skill-chain/ci/verify-artifacts.sh ISSUE-729 validation（本ファイル作成後に実行）
#
# (3) PR #756 の CI（GitHub 側の実行結果、head 8787dbca）
#   - agent-skill-chain / ci の verify              SUCCESS
#   - agent-skill-chain / config documentation sync SUCCESS
#   - agent-skill-chain / risk の risk-ratchet      SUCCESS
#   - CodeRabbit                                    SUCCESS
#
# (4) 本リポジトリ実物に対する判定プロンプト生成の直接実行
#   agent-skill-chain gate reviewer-prompt ISSUE-729 implementation 8787dbca... ae580bac...
#   を PR 番号なしで実行し（exit 0）、反証ルーブリック節に次が現れることを確認した。
#     - 「blocking 基準を満たす反例が 1 件も無い場合は falsification=pass とする。これは正常かつ
#        第一級の帰結であり」（合格到達条件）
#     - 目的阻害性・到達可能性・責務内是正可能性の3条件と「3 条件は全ラウンドで必要条件であり、
#       取り除かない」
#     - 「ラウンド番号やレビュープロファイルを理由に、データ喪失・セキュリティ低下・既存機能の
#        回帰・当該 Issue の目的未達という区分そのものを blocking 対象から除外しない」
#     - 変更前の「能動的に 1 件以上探索する」という記述がルーブリック本文に存在しないこと
#       （同文字列は判定対象の差分区間に引用として現れるのみで、ルーブリック節には無い）
#     - 過去ラウンド節が「取得できなかった」「過去ラウンドが存在しないことを意味しない」を出力し、
#       初回の文言を出さないこと。高ラウンドの追加要件も出さないこと。
#
# ============================================================================
# 検証で判明した事実（是正せず記録する）
# ============================================================================
# F-1. 本実行環境の gh はラウンド番号の導出に必要な取得コマンドを解釈できない。
#   耐久記録の取得は gh api の --paginate と --slurp を併用する。本環境の gh は 2.45.0 であり、
#   同フラグに対して「unknown flag: --slurp」を返す。このため PR #756 を対象に
#   gate reviewer-prompt へ PR 番号と反復識別子を与えて直接実行しても、ラウンド情報は
#   status=unavailable（理由「PR review evidence の取得に失敗しました」）へ落ちる。
#   帰結として本環境では限定も打ち切りも発火せず、差し戻しの反復のみが維持される。
#   これは次の理由により本 Issue の欠陥ではないと判断する。
#     (a) --slurp の使用は本 Issue の変更前から main の複数の取得経路に存在する既存の作法であり、
#         本 Issue が新たに持ち込んだ依存ではない。
#     (b) SPEC.md は「ラウンド番号を耐久記録から導出できない環境における有限性の保証」を
#         対象外と明記し、導出不能時は限定を適用せず打ち切りによる承認も記録せず、未解消の
#         blocking が残る場合は通常どおり差し戻すことを要件としている。上記の観測結果は
#         この安全側の劣化そのものであり、AC-9 が求める挙動と一致する。
#   ただし運用上の含意として、gh がこのフラグを解釈できる環境へ更新されるまで、本 Issue が
#   導入したラウンド予算による打ち切りは実運用では発火しない。この解消は本 Issue の射程外で
#   あるため別 Issue として扱う必要がある。
#
# F-2. verify-root-clean.sh のローカル実行結果は CI の結果を代表しない。
#   同スクリプトが基点とする repoRoot は linked worktree から呼ぶとメイン作業ツリールートへ
#   解決される。メイン側の root 直下には対象4ファイルが存在しないため、本 worktree から
#   実行すると exit 0 になる。CI は単一チェックアウトのため PR head の root 直下を検査し、
#   Draft ではない PR に対しては対象4ファイルが残存する限り失敗する（設計どおり、ADR-0046）。
#   PR #756 は現在 Draft であり当該ステップは実行されない。
#
# ============================================================================
# 制約
# ============================================================================
# - レビュアの自然言語判断の当否、および根拠要約が自然文として意味的に十分かは機械的に
#   判定できない。本検証はプロンプト文字列・導出結果・最終判定導出の挙動のみを観測する。
# - 本ファイルに記載する target_sha は検証を実施した時点の HEAD であり、本ファイルを commit
#   した後の PR head とは一致しない。VALIDATION.md は自身の commit SHA を記載できない一方、
#   ゲートの target_sha は PR head との一致を要求するため、両者は原理的に一致しない。これは
#   Issue #773 として起票済みの構造的制約であり、成果物の欠陥ではない。target_sha
#   8787dbcabcf3100f6b6a9c58fd624a91c98a35ad から PR head までの差分は本ファイルの追加のみである。
#
# ============================================================================
# 完了条件
# ============================================================================
# - AC-1 から AC-9 のすべてに verification.result が記録されていること。
# - 回帰テストの実行結果が記録されていること。
# - 本ファイルが commit・push 済みであること。
#
# ============================================================================
# 未決事項
# ============================================================================
# - F-1 の解消（耐久記録の取得を、本環境の gh が解釈できる形にするか、実行環境の gh を
#   更新するか）は本 Issue の射程外であり、別 Issue の起票を要する。
#
# ============================================================================
# 対象外
# ============================================================================
# - 各 finding の根拠要約が対象記述と欠陥を判別できる水準にあるかの機械的判定。当該要求は
#   構造的制約をどれだけ積んでも形式を満たしつつ意味的に空虚な入力を構成できるため、機械検査で
#   充足を判定できないと判断され、Issue #768 へ分離済みである。本 Issue では空配列の拒否、
#   最小長、対象成果物パスまたは AC-ID の同伴という構造的制約までを暫定として受け入れる。
#   本セグメントでは当該要求の是正を行わない。AC-3 に対する下記の pass は、過去ラウンド判定
#   記録の展開項目・初回と取得不能の区別・分量上限という構造的性質に対する判定であり、
#   根拠要約の意味的十分性に対する判定ではない。
# - ラウンド番号を耐久記録から導出できない環境における有限性の保証（SPEC.md が対象外と明記）。
# - finding 台帳の永続化（Issue #745）、判定プロンプトへの実装ファイル展開（Issue #751）、
#   網羅要求型の受入条件の充足判定方法（Issue #755）。
# - SPEC.md・DESIGN.md・PLAN.md・ADR-0068 の変更、および実装コード・テストコードの変更。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-729
target_sha: 8787dbcabcf3100f6b6a9c58fd624a91c98a35ad

acceptance_criteria:
  # AC-1: 反証ルーブリックが合格到達条件を明示する
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: 反証の合格条件・3条件・不緩和条項を全ラウンドへ置き、高ラウンドだけ実証性を追加要件にする'（限定閾値未満・以上の2本の生成物に対し、blocking 基準を満たす反例が1件も無い場合に falsification=pass とする旨の存在と、能動的に1件以上探索するという記述の不在を検査）"
      - "test/fixtures/gate-reviewer-prompt-golden.txt（判定プロンプトの固定出力比較）"
      - "実物実行: agent-skill-chain gate reviewer-prompt ISSUE-729 implementation 8787dbca... ae580bac...（exit 0）。反証ルーブリック節に合格到達条件が現れ、能動的な1件以上の探索要求は現れない"
      - "npm test 全体（tests 1352 / pass 1351 / fail 0 / skipped 1）"

  # AC-2: blocking 基準の 3 条件が全ラウンドの必要条件として明記される
  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: 反証の合格条件・3条件・不緩和条項を全ラウンドへ置き、高ラウンドだけ実証性を追加要件にする'（限定閾値未満・以上の双方に目的阻害性・到達可能性・責務内是正可能性と3条件が全ラウンドで必要条件である旨が現れることを検査）"
      - "実物実行の出力（3条件が番号付きで列挙され、3 条件は全ラウンドで必要条件であり取り除かない旨が併記される）"
      - "npm test 全体（tests 1352 / pass 1351 / fail 0 / skipped 1）"

  # AC-3: 過去ラウンドの判定記録が判定プロンプトへ展開される
  #   本 pass は展開項目・初回と取得不能の区別・分量上限という構造的性質に対する判定である。
  #   根拠要約の意味的十分性は Issue #768 の射程であり本 Issue の対象外（上記「対象外」参照）。
  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: 過去記録あり・初回・取得不能を区別し、根拠要約と蒸し返し境界を展開する'（(a) finding code・severity・立証と反証の判定・根拠要約の展開、(b) 初回の文言、(c) 取得不能の文言が (b) と異なることを検査）"
      - "test/unit/gate-round.test.ts の 'ラウンド導出: ローカル・PR無し・trusted actor無し・attempt無しを初回と区別して導出不能にする'（取得不能の4経路）"
      - "test/unit/gate-round.test.ts の 'ラウンド導出: 当該attemptと未登録actorを除外し、根拠要約を600文字で明示的に切り詰める'"
      - "test/unit/gate-round.test.ts の 'ラウンド履歴: 節全体が24000文字以内になり、古いラウンドの省略番号を明示する'"
      - "test/unit/gate-round.test.ts の '根拠要約: 防御的に空配列からも空文字を生成しない'"
      - "実物実行の出力（取得不能時に『過去ラウンドが存在しないことを意味しない』を出力し、初回の文言を出さない）"

  # AC-4: 是正済み論点の無根拠な蒸し返しのみを禁じる指示が含まれる
  - ac_id: AC-4
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: 過去記録あり・初回・取得不能を区別し、根拠要約と蒸し返し境界を展開する'（是正済み論点を新たな根拠なしに再び blocking として提出しない旨と、未修正のまま残る blocking の同一 code 再提出が禁止の対象外である旨の双方を検査）"
      - "npm test 全体（tests 1352 / pass 1351 / fail 0 / skipped 1）"

  # AC-5: 限定閾値以上のラウンドで blocking の適用範囲が真に狭くなる
  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: 反証の合格条件・3条件・不緩和条項を全ラウンドへ置き、高ラウンドだけ実証性を追加要件にする'（ラウンド番号のみを変えた2本を比較し、限定閾値以上の側にのみ『3 条件をすべて満たし、かつ実証性を満たす反例だけを blocking』『3 条件はいずれも取り除かない』『実証性を満たさない反例は warning 以下』が現れることを検査）"
      - "test/unit/config.test.ts の 'loadConfig: 実物の .agent-skill-chain/config/agent-skill-chain.yaml を読み込み主要フィールドを検証する'（限定閾値2・打ち切り閾値4が設定ファイルから与えられること）"
      - "test/unit/gate-round.test.ts の '閾値: 既定値は2<4で、省略時も解決され、大なり・等号・下限違反を拒否する'"
      - "test/integration/gate-evidence.test.ts の 'GitHub evidence: Review API由来のStrict 2件を検証してsuccess Check Runへ結線する'（ラウンド1では高ラウンドの追加要件が現れないこと）"

  # AC-6: 打ち切り閾値に達しても blocking が残る場合は人間判断へ移る
  - ac_id: AC-6
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/review-evidence.test.ts の 'ラウンド打ち切り: 閾値到達時のblockingをrejectedより先にhuman_requiredへ移し、未到達・導出不能・blocker無しは既存判定を保つ'（レビュア自身の申告する判定不能が偽でも、round=4・cutoff=4・未解消 blocking ありで inconclusive が true に設定され final が human_required になること、理由に round・cutoff_threshold・unresolved_blocking が含まれること、round=3 では rejected のまま、ラウンド情報なしでは rejected、blocking 無しでは approved であること）"
      - "test/integration/gate-judgment.test.ts の 'gate record-verdict: inconclusive の verdict は silent pass せず final=human_required になる'（判定不能から人間判断を導く既存の最終判定導出の実在）"
      - "test/integration/gate-judgment.test.ts の 'gate record-verdict: lightの再レビュー上限でblockingが残ればhuman_requiredへ打ち切る' および 'light未適用または初回ラウンドには専用打ち切りを適用しない'（既存の軽量プロファイル打ち切りの非回帰）"
      - "test/integration/gate-evidence.test.ts の 'GitHub evidence: Review API由来のStrict 2件を検証してsuccess Check Runへ結線する'（打ち切り不成立時に final=approved を保つ非回帰と prompt digest の往復）"

  # AC-7: 重大性の区分を軸とした緩和が行われない
  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/gate-judgment.test.ts の 'gate reviewer-prompt: 反証の合格条件・3条件・不緩和条項を全ラウンドへ置き、高ラウンドだけ実証性を追加要件にする'（限定閾値未満・以上の双方に、データ喪失・セキュリティ低下・既存機能の回帰・当該 Issue の目的未達を除外しない旨が現れることを検査）"
      - "実物実行の出力（不緩和条項が全ラウンド向けの節に存在し、実証性の定義に『この定義だけで実証性を blocking の必要条件にはしない』が併記される）"

  # AC-8: 限定閾値が打ち切り閾値より真に小さいことが強制される
  - ac_id: AC-8
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/config.test.ts の 'loadConfig: round_limitの大なり・等号は日本語の設定エラー、各下限と非整数はスキーマエラーになる'（等号を含めて設定読み込みが例外となり、当該設定でゲートレビューが実行されないこと）"
      - "test/unit/gate-round.test.ts の '閾値: 既定値は2<4で、省略時も解決され、大なり・等号・下限違反を拒否する'"
      - ".agent-skill-chain/schemas/config.schema.yaml（narrowing_threshold は1以上、cutoff_threshold は2以上の整数）と .agent-skill-chain/config/agent-skill-chain.yaml の既定値"
      - "docs/CONFIGURATION.md への設定項目の記載と .agent-skill-chain/ci/verify-config-doc-sync.sh（exit 0）"

  # AC-9: ラウンド番号がゲート反復を単位として耐久記録から復元される
  - ac_id: AC-9
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/gate-round.test.ts の 'ラウンド導出: Strictの2 slotをattempt_idで畳み、target_sha変更後もStandardと同じ反復数になる'（証跡件数 2N ではなく反復識別子の相異なる個数 N になること、target_sha の変化で 0 へ戻らないこと）"
      - "test/unit/gate-round.test.ts の 'ラウンド導出: API metadataまたはattempt attestationが不正なreviewを計数しない' および 'trusted verifierが真正性を確認できない完備attemptを計数しない'（形式だけ整えた証跡を計数へ算入しない）"
      - "test/unit/gate-round.test.ts の 'ラウンド導出: 現行検査より前に有効だったv3 findingも履歴として計数する'（プロンプト生成を変更しても過去ラウンドが計数から落ちない）"
      - "test/integration/gate-evidence.test.ts の 'GitHub evidence: Review API由来のStrict 2件を検証してsuccess Check Runへ結線する'（(i) 投稿された証跡の prompt_digest が実際に生成したプロンプトの digest と一致、(ii) 変更前の生成ロジックが記録した再現不能な prompt_digest を持つ証跡もラウンド計数へ残る、(iii) launcher digest を改竄した同形レビューが除外され除外した旨が展開される、(iv) 候補 target 側の設定が既定と異なる状態でラウンド番号が 2 を保つ、(v) recorder 側の設定を変更してもラウンド番号が 2 を保つ）"
      - "test/integration/gate-adapters.test.ts の 'gate adapter: reviewer-promptへ証跡投稿と同じPR番号・attempt_idを渡す' および 'gate adapter: sha256sum不在時も既存のshasum fallbackでprompt digestを算出する'（レビュアへ実際に渡したプロンプトの digest を submit-evidence へ引き渡す経路）"
      - "test/unit/review-evidence.test.ts の 'ラウンド打ち切り: 閾値到達時のblockingをrejectedより先にhuman_requiredへ移し、未到達・導出不能・blocker無しは既存判定を保つ'（導出不能時は打ち切りによる承認も人間判断も記録せず rejected を維持）"
      - "実物実行: PR #756 に対する gate reviewer-prompt は本環境の gh が取得コマンドを解釈できないため status=unavailable へ落ち、限定も打ち切りも適用しない安全側の劣化を実地で確認した（上記 F-1）"

regression:
  executed: true
  evidence:
    - "npm test（変更後のリポジトリ全体）: exit 0、tests 1352 / pass 1351 / fail 0 / skipped 1 / duration_ms 309263。skipped 1 件は ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 指定時のみ実行される外部到達性確認"
    - "npm run build（tsc）: exit 0"
    - "npm run typecheck（tsc --noEmit -p tsconfig.test.json）: exit 0"
    - "test/integration/gate-judgment.test.ts: tests 33 / pass 33 / fail 0（判定プロトコル・Check Run 発行・軽量プロファイル打ち切りの既存挙動を含む）"
    - "test/integration/gate-evidence.test.ts: tests 3 / pass 3 / fail 0（prompt digest 往復・証跡の schema 版 v3 の維持を含む）"
    - "test/integration/gate-adapters.test.ts: tests 37 / pass 37 / fail 0（アダプタ起動・認証境界・core reviewer の既存挙動）"
    - "test/integration/github-backend.test.ts: tests 43 / pass 43 / fail 0"
    - "test/unit/gate-round.test.ts: tests 10 / pass 10 / fail 0"
    - "test/unit/review-evidence.test.ts: tests 11 / pass 11 / fail 0"
    - "test/unit/config.test.ts: tests 6 / pass 6 / fail 0"
    - "機械検査: verify-branch-name / verify-worktree-path / verify-template-sync / verify-doc-length / verify-config-doc-sync / verify-artifacts(spec,design,implementation,validation) / verify-spec-bdd / verify-design-diagram / verify-adr / verify-ac-coverage / lint-vocab / lint-references / adr-lint check / lint-secrets --diff origin/main はいずれも exit 0"
    - "PR #756 の CI（head 8787dbca）: verify・verify-config-doc-sync・risk-ratchet・CodeRabbit がいずれも SUCCESS"
