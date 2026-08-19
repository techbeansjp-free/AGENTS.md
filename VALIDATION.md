# 由来: AGENTS.md が定める不変条件I7（仕様⇔検証の追跡）。SPEC.md の AC-1〜AC-8 に一意対応する。
# 本ファイルは .agent-skill-chain/schemas/validation-report.schema.yaml に適合する純粋なYAMLである。
#
# ══ target_sha の自己記述 ══════════════════════════════════════════════════
# 下記 target_sha は本検証を実行した実装 commit の SHA である。VALIDATION.md は自身を載せる
# commit の SHA を内容に持てないため、この宣言値と validation-gate が判定対象とする SHA
# （本成果物を含む commit）は必ず食い違う。その差が判定へ影響しないことを次の不変で担保する。
#
#   不変: 本成果物を追加する commit は、検証対象の実装 SHA
#   2ff1798d3f97b26317f9654422eafb1bd61c3b12 に VALIDATION.md のみを追加した差分であり、
#   実装ファイル・SPEC.md・DESIGN.md・PLAN.md・docs/adr/ADR-0078-*.md を一切変更しない。
#
# 根拠1: VALIDATION.md を除外した差分が0行である。これは本ファイル自身の行数に依存しない不変であり、
#   実装ファイルが1行も変わっていないことを直接示す。commit 直前の作業ツリー実出力（出力なし＝0行）:
#   $ git diff --stat 2ff1798d3f97b26317f9654422eafb1bd61c3b12 -- ':!VALIDATION.md'
#   （出力なし。0行）
#
# 根拠2: 差分に現れるパスの実出力。VALIDATION.md 1件だけである（--stat の行数は本ファイル自身の
#   長さに依存して自己参照になるため、パス集合を示す --name-only を原文引用する）:
#   $ git diff --name-only 2ff1798d3f97b26317f9654422eafb1bd61c3b12
#   VALIDATION.md
#
# 根拠3: commit 直前の HEAD の実出力。HEAD は検証対象 SHA そのものであり、本検証は当該ツリーで
#   実行した。
#   $ git log --oneline -3
#   2ff1798 test: 最終round宣言の2つの反例経路を独立したテストへ分離する
#   efd272a fix: 最終round宣言機構がゲートを恒久的に判定不能へ固定しないようにする
#   b8797e4 Merge remote-tracking branch 'origin/main' into process/786-gate-round-budget-remediation-policy
#
# 根拠4: commit 直前の作業ツリー状態の実出力。未追跡ファイルも他の変更も存在しない。
#   $ git status --porcelain
#    M VALIDATION.md
#
# 根拠5: staging 内容の実出力。commit 対象は VALIDATION.md だけである。
#   $ git diff --cached --name-only
#   VALIDATION.md
#
# 根拠6: 判定対象 SHA（本成果物を含む commit）でレビュアが独立に再現できる検査。0行になる。
#   $ git diff --stat 2ff1798d3f97b26317f9654422eafb1bd61c3b12..HEAD -- ':!VALIDATION.md'
#
# ══ 検証で検出した事実（origin 付き） ══════════════════════════════════════
# 本ラウンドで blocking finding は検出していない。
#
# 前ラウンドの VALIDATION.md が origin: implementation / severity: blocking として記録した
# MERGE_REF_BUILD_TYPE_ERROR（main 74ae980 とのマージ ref で
# `src/commands/gate.ts(2598,74): error TS2304: Cannot find name 'config'`）は解消済みである。
# 1c7848b が buildReviewerPrompt() の config.coordination.backend 参照を Issue #751 の
# targetConfig へ揃えた。本ラウンドの実測: PR #791 の head は
# 2ff1798d3f97b26317f9654422eafb1bd61c3b12、mergeable=MERGEABLE、mergeStateStatus=CLEAN、
# base=main。head SHA の check-runs は verify=completed/success、
# verify-config-doc-sync=completed/success の2件であり、fail は0件である。
#
# code: DECLARATION_ORDERING_CHECK_NOT_EXERCISED_END_TO_END / origin: validation / severity: info
#   進行役の指示により、read-only で検証可能な範囲を確認した結果を記録する。
#   宣言の作成順序検査は src/lib/round-budget-policy.ts の resolveDurableRoundBudgetDeclaration()
#   が2つ持つ。(a) previousEvidenceCompletedAt: 宣言が直前 attempt の結果確定前に作成されていれば
#   「直前attemptの結果確定前に作成されています」で invalid。(b) reviewStartedAt: 宣言が最終 round の
#   review 開始後に作成されていれば「review開始後または結果後に追加されています」で invalid。
#   CLI からの結線は src/commands/gate.ts の resolveGithubFinalRoundDeclaration() にあり、
#   (a) は `gate review` と `gate verify-evidence` の双方へ渡り、(b) は `gate verify-evidence`
#   だけへ渡る（`gate review` は review 開始前の呼び出しであり (b) を渡さない）。
#   カバレッジの実測: (a) の受理側は test/integration/gate-round-budget-convergence.test.ts が
#   CLI 経由で end-to-end に通す（直前 attempt の submit-evidence 完了後に
#   `gate declare-final-round` を実行し、後続の `gate review` が宣言を解決して gate-report の
#   round_budget_declaration へ結線することを検査する）。一方 (a)(b) の拒否側は
#   test/unit/round-budget-policy.test.ts の関数単体検査だけであり、`gate verify-evidence` を
#   CLI から駆動して拒否させる統合検査は無い。`gate classify-finding` には end-to-end 検査が
#   1件も無い。AC-2・AC-6 の Then は、CLI が実際に呼ぶ関数そのものへの単体検査と受理側の
#   end-to-end 検査で充足しているため両 AC は pass と判定する。本項は将来の回帰検知力に関する
#   持ち越しであり、進行役の指示（実装変更禁止）に従い本ラウンドでは是正しない。
#
# ══ 是正禁止として持ち越した既知の warning / info ═════════════════════════
# 進行役が名指しした7件は本ラウンドで是正していない。実装ファイルへの変更は0行である（根拠1）。
#   REVIEWER_PROMPT_READS_RUNTIME_GATE_REPORT_AGAIN /
#   REVIEWER_PROMPT_RUNTIME_READ_CONTRADICTS_DISTRIBUTED_CLAIM（Issue #802 へ分離済み）、
#   CONTROL_RECORD_WRITER_LACKS_PROTECTED_BASE_EXECUTION_GUARD（origin: design）、
#   LOCAL_ROUND_BUDGET_DECLARATION_SPEC_DESIGN_DIVERGENCE（origin: design）、
#   DUPLICATED_ROUND_CONTEXT_DERIVATION_AND_GATE_REPORT_READ、
#   NEW_CLI_WRAPPERS_OUTSIDE_PREAMBLE_INVARIANT、UNUSED_TYPE_IMPORT_IN_REVIEW_EVIDENCE。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-786
target_sha: 2ff1798d3f97b26317f9654422eafb1bd61c3b12

acceptance_criteria:
  - ac_id: AC-1
    verification: {mode: automated, result: pass}
    evidence:
      - 'test/unit/gate-round-policy-assets.test.ts「gate-review skill (AC-1〜AC-8): 既定予算・宣言・4類型・追跡・fallbackを配布する」pass（1.519615ms）。配布元 .agent-skill-chain/templates/claude/skills/gate-review/SKILL.md が「初回をround 0」「最終round 4、最大5回」を含むことを断片一致で固定する'
      - '配布元 SKILL.md の当該記述実物: 「**round**: 初回をround 0とする同一Issue・同一gateのreview反復。ラウンド値を解決できる経路では、既定は全4 gateで最終round 4、最大5回。解決できない経路は本予算の対象外であり、差し戻し回数の有限性を保証しない。」ゲート別の別値・別定数を持たないため、spec・design・implementation・validation の4ゲートで同一予算になる'
      - '.agent-skill-chain/config/agent-skill-chain.yaml・.agent-skill-chain/templates/standard/agent-skill-chain.yaml・.agent-skill-chain/templates/lightweight/agent-skill-chain.yaml のいずれも review.round_limit が {narrowing_threshold: 2, cutoff_threshold: 4} であり、standard・lightweight の両配布で最終round 4が既定になる'
      - 'test/integration/init.test.ts・test/integration/upgrade.test.ts pass（全件実行 fail 0 に含まれる）。skill と config が両 profile へ展開され、配布元と展開物の不一致を残さない'
  - ac_id: AC-2
    verification: {mode: automated, result: pass}
    evidence:
      - 'test/unit/round-budget-policy.test.ts「round budget宣言: digest改変・直前attempt不一致・複数宣言・上書き・review開始後追加を拒否する」pass（1.432655ms）。resolveDurableRoundBudgetDeclaration() が reviewStartedAt 以降に作成された宣言を「review開始後または結果後に追加されています」、previousEvidenceCompletedAt 以前に作成された宣言を「直前attemptの結果確定前に作成されています」として invalid にするため、事後宣言では通過できない'
      - 'test/integration/gate-round-budget-convergence.test.ts「D1: round budget宣言をevidenceへ載せた最終round attemptもラウンド計数から外れない」pass（8511.440128ms）。直前 attempt の submit-evidence 完了後に CLI で gate declare-final-round を実行し、後続の gate review が宣言を解決して gate-report scaffold の round_budget_declaration へ結線することを end-to-end で固定する。宣言 payload はゲート・直前 attempt_id・解決済み final_round・4類型・類型外findingのwarning降格とfollow-upを含む不変値であり、レビュー開始前の調整状態へ耐久化される'
      - 'test/integration/gate-round-budget-convergence.test.ts「AC-6: 最終roundの事前宣言を解決できない経路はコマンド失敗ではなくhuman_requiredとして記録される」pass（4295.737108ms）。宣言が成立しない最終roundでは reviewer 起動へ進ませず、gate-report へ final: human_required・conformance: pending・falsification: pending を記録する'
      - 'test/unit/round-budget-policy.test.ts「宣言の重複検査: 別gateの宣言を重複と数えず、同一gateの再宣言だけを検出する」pass（0.517611ms）。作成側の重複検査と解決側の件数検査が同一の絞り込み集合を使うため、1 Issue 内で複数ゲートが最終roundへ到達しても宣言を作成できる'
      - '同ラウンドの持ち越し: 作成順序検査の拒否側を CLI から駆動する統合検査は存在しない（本ファイル冒頭 DECLARATION_ORDERING_CHECK_NOT_EXERCISED_END_TO_END）。CLI が実際に呼ぶ関数そのものへの単体検査と受理側 end-to-end により AC-2 の Then は充足する'
  - ac_id: AC-3
    verification: {mode: automated, result: pass}
    evidence:
      - 'test/unit/round-budget-policy.test.ts「finding再分類: 同一current recordのraw evidence完全一致と4類型外根拠を要求する」pass（0.247655ms）。分類recordは既出未是正・目的直接阻害・test/build失敗または回帰・データ喪失またはセキュリティ低下の4類型すべてに該当しない旨の申告を必須とし、いずれかに該当すると申告した finding は warning へ分類できない'
      - 'test/unit/review-evidence.test.ts「D3: 4条件が揃う最終roundは、raw failを保持したまま有効sub-verdictでapprovedになる」pass（3.292777ms）。4類型外 finding だけが残る最終roundでは分類後 blocking が0件となり、ゲート後の進行を妨げない'
      - 'test/unit/review-evidence.test.ts「D3: 4条件を単独で崩した入力はいずれもapprovedにならず、最終roundではrejectedでなくhuman_requiredへ収束する」pass（6.537997ms）。未分類の blocking が1件でも残れば有効 sub-verdict の導出条件が崩れ、raw fail が維持されて approved にならない。すなわち4類型に該当する finding だけが blocking として残る'
      - 'test/unit/review-evidence.test.ts「D3: 最終round以外と宣言なし経路は導入前と同じrejectedを維持する」pass（1.089351ms）。分類による severity 差し替えは最終roundの進行判断だけを制御し、最終round前の既存 blocking 判定を変えない'
  - ac_id: AC-4
    verification: {mode: automated, result: pass}
    evidence:
      - '.agent-skill-chain/schemas/gate-report.schema.yaml の finding.reclassification.outside_blocking_categories.data_loss_or_security が const: false。データ喪失またはセキュリティ低下を認めた finding の降格記録は schema 上そもそも作成できない。round・risk・review profile を条件に含む分岐は存在しない'
      - 'test/unit/round-budget-policy.test.ts「finding再分類: 同一current recordのraw evidence完全一致と4類型外根拠を要求する」pass（0.247655ms）。data_loss_or_security: true を含む分類recordを要件違反として拒否する'
      - 'test/unit/review-evidence.test.ts「D4: 作成後に上書きされたfinding分類recordを採用せず、4類型のblockingをwarningへ差し替えない」pass（1.846594ms）。trusted recorder が4類型外 finding だけを分類した正しい入力でも、データ喪失 finding は blocking のまま残り最終判定は human_required になる。偽造recordを注入した反例経路でも両 finding が blocking のまま残り、レビュアの raw fail も pass へ差し替わらない'
      - 'test/unit/gate-round-policy-assets.test.ts「gate-review skill (AC-1〜AC-8)」pass（1.519615ms）。配布 SKILL.md が「データ喪失またはセキュリティ低下」を4類型の1つとして配り、「Strict固定・quick境界はroundを理由に減らさない」も併せて配布する'
  - ac_id: AC-5
    verification: {mode: automated, result: pass}
    evidence:
      - 'test/integration/gate-judgment.test.ts「gate record-verdict (AC-5): current findingのraw evidence改変を拒否し完全記録を保持する」pass（1000.458999ms）。現行記録単独で元severity・降格理由・4類型外根拠・raw evidence・follow-up Issue番号を検証でき、Git履歴からの元severity復元を前提にしない'
      - 'test/unit/review-evidence.test.ts「D3: 4条件が揃う最終roundは、raw failを保持したまま有効sub-verdictでapprovedになる」pass（3.292777ms）。分類後も finding は検査結果から削除されず severity だけが warning となり、evidence 原文・original_severity: blocking・follow_up_issue_id を保持する。raw の conformance/falsification も gate.subverdict_reclassification へ併記されて失われない'
      - 'src/lib/review-evidence.ts の applyFindingClassifications() は、分類recordの finding.evidence と reclassification.raw_evidence が source review の元 evidence と canonicalJson 一致しない場合、および元 severity・origin が一致しない場合に invalid を返す。evidence 原文の要約・整形・置換が成立する経路は無い'
  - ac_id: AC-6
    verification: {mode: automated, result: pass}
    evidence:
      - 'test/unit/review-evidence.test.ts「D3: 4条件を単独で崩した入力はいずれもapprovedにならず、最終roundではrejectedでなくhuman_requiredへ収束する」pass（6.537997ms）。4類型blocking残存・レビュアのinconclusive表明・未分類blocking・裏付けの無いfailのいずれでも承認されず、最終roundでは rejected ではなく human_required になるため、進行役の裁量による追加ラウンドが発生しない'
      - 'test/unit/review-evidence.test.ts「D4: 作成後に上書きされたfinding分類recordを採用せず、4類型のblockingをwarningへ差し替えない」pass（1.846594ms）。分類recordを有効な記録として採用できない場合は final: human_required・inconclusive: true となり、便宜的な承認も、記録失敗を隠す便宜的な blocking 復帰も起きない'
      - 'test/unit/gate-round-policy-assets.test.ts「AC-6: ラウンド値を解決できない経路が有限性保証の対象外であることを配布契約が明示する」pass（1.376856ms）。SKILL.md が「解決できない経路は本予算の対象外であり、差し戻し回数の有限性を保証しない」と「この経路は差し戻し回数の有限性保証の対象外として扱う」を持ち、.agent-skill-chain/config/roles.yaml が同旨を5箇所（4 worker + gate_reviewer）持ち、src/commands/gate.ts が「通常差し戻しfallbackを維持し、この経路は差し戻し回数の有限性保証の対象外です」を持つことを固定する。取得不能を理由に human_required へ倒す記述は無い'
      - 'test/unit/roles.test.ts「loadRoles (AC-6): 全4 workerとgate_reviewerへ有限性保証の対象外である旨を配布する」pass（7.033036ms）'
      - 'test/unit/gate-round-policy-assets.test.ts「AC-6: gateコマンドは集約済み判定をapprove側へ直接代入しない」pass（1.353893ms）。src/commands/gate.ts に .final = approved・.inconclusive = false・.conformance = pass・.falsification = pass の代入が1件も存在しないことを固定し、推測による承認の記録経路を無くす'
      - 'test/integration/gate-judgment.test.ts「gate publish (D3): 有効sub-verdictのapprovedはsuccess、4類型blocking残存の最終roundはaction_requiredになる」pass（1778.106898ms）'
      - 'test/integration/gate-round-budget-convergence.test.ts「AC-6: 最終roundの事前宣言を解決できない経路はコマンド失敗ではなくhuman_requiredとして記録される」pass（4295.737108ms）。宣言を作成できない最終roundでも、approved・rejected・human_required のいずれにも到達しない停止状態を残さない'
      - 'test/unit/review-evidence.test.ts「D3: 最新attemptへ結線できない分類recordは不正にせず非適用として扱い、後続attemptを固定しない」pass（2.759704ms）。人間が明示指示した追加の修正ラウンドが、過去attempt由来の分類recordによって恒久的に human_required へ固定されない'
  - ac_id: AC-7
    verification: {mode: automated, result: pass}
    evidence:
      - 'test/unit/roles.test.ts「loadRoles (AC-7): 全4 workerだけに非追記型是正の同一契約を配布する」pass（4.628743ms）。spec_worker・design_worker・implementation_worker・validation_worker の rules へ「blockingを局所的な条項・例外・分岐・フラグの追記で塞がず、原因となる既存記述・実装を書き換えるか削除する」を含む同一規範が入り、gate_reviewer には編集規範を配らない'
      - '.agent-skill-chain/config/roles.yaml の当該規範は4 worker契約すべてに存在する（不要な要求・挙動の削減を先に評価、原因が上流なら上流最小改訂と必要な再ゲート、Issue目的に必要な追加は検証可能な報告を条件とする例外、真因が範囲外なら成果物を拡張せず実測報告）'
      - 'test/integration/report.test.ts「report status (AC-7): blocking remediationは報告必須で、理由なしrequired_additionを拒否する」pass（1351.533568ms）。worker-report schema の remediations が rewrite|delete|reduce_unneeded|upstream_minimal_revision|required_addition|out_of_scope を要求し、required_addition だけは非追加手段で達成できない具体的理由を必須とする'
  - ac_id: AC-8
    verification: {mode: automated, result: pass}
    evidence:
      - 'test/unit/review-light.test.ts「resolveReviewProfile: I8のrisk/autonomy判定を一意に解決する」pass（1.160685ms）。risk != normal または autonomy == full による Strict 固定は本変更で緩和されていない'
      - 'test/integration/gate-judgment.test.ts「gate record-verdict: Strictの独立2 verdictがともにpassの場合だけapprovedになる」pass（682.174067ms）／「Strictの独立verdictに1件でもfailがあればrejectedになる」pass（613.24753ms）／「Strictの独立verdictが規定件数に満たない場合は書込みを拒否する」pass（659.160854ms）。必要レビュア数と2観点の分離判定は不変'
      - 'test/integration/verify-artifact-targets.test.ts pass（全件実行 fail 0 に含まれる）。quick の成果物免除範囲は変更されていない'
      - 'src/lib/review-evidence.ts の有効 sub-verdict はレビュアの raw conformance・falsification・inconclusive を書き換えず、raw 値を gate.subverdict_reclassification へ併記したうえで進行判断だけを導く派生値である。ゲート・観点・検査項目・review profile が要求するレビュア数はいずれも減っていない'

regression:
  executed: true
  evidence:
    - '全件テスト npm test（対象 2ff1798d3f97b26317f9654422eafb1bd61c3b12）の実出力: 「ℹ tests 1504 / ℹ suites 0 / ℹ pass 1503 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 1 / ℹ todo 0 / ℹ duration_ms 343693.612583」。fail 0 件'
    - 'skip 1件の実出力: 「﹣ GitHub導入元へ実際に到達してpackage versionを取得できる # ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 が指定された場合だけlive到達性を確認する」。環境変数未指定時のみ skip される live 到達性テストであり本変更と無関係'
    - 'npm run build（tsc）exit 0、出力なし'
    - '本 Issue が追加した回帰テスト20件はいずれも上記全件実行で pass した。最終round宣言の反例経路2件（「AC-6: 最終roundの事前宣言を解決できない経路はコマンド失敗ではなくhuman_requiredとして記録される」4295.737108ms、「D1: round budget宣言をevidenceへ載せた最終round attemptもラウンド計数から外れない」8511.440128ms）'
    - '分類recordの非適用扱い（「D3: 最新attemptへ結線できない分類recordは不正にせず非適用として扱い、後続attemptを固定しない」2.759704ms）。expectedRoundBudgetDeclaration の自己参照方式は src/commands/gate.ts の historicalGateAttemptVerifier() が first.round_budget_declaration を渡すことで成立し、上記「D1: ...」が round 2 → 追加ラウンド round 3 の連続を CLI で確認して固定する'
    - '制御レコードの上書き検知（「D4: 作成後に上書きされたfinding分類recordを採用せず、4類型のblockingをwarningへ差し替えない」1.846594ms、「finding分類recordの選択: marker・issue_id・gate・投稿者の同一規則で採否を決める」1.684806ms）。src/lib/round-budget-policy.ts の selectFindingClassificationComments() が宣言側 resolveDurableRoundBudgetDeclaration() と同じ createdAt/updatedAt 比較を持つ'
    - '投稿者束縛（「D4: 非trustedな投稿者のfinding分類recordを採用せず、単独でゲートも停止させない」1.860564ms、「制御レコードの信頼境界: 非trustedな投稿者の宣言を採用せず、単独でゲートも停止させない」0.469176ms）'
    - '両方向の回帰（承認強制側）: 「D3: 4条件を単独で崩した入力はいずれもapprovedにならず、最終roundではrejectedでなくhuman_requiredへ収束する」6.537997ms。blocking 0件を根拠に final/inconclusive を承認側へ代入する経路が無いことを固定する'
    - '両方向の回帰（永久rejected側）: 「D3: 4条件が揃う最終roundは、raw failを保持したまま有効sub-verdictでapprovedになる」3.292777ms。severity 差し替えが sub-verdict へ届かず最終roundが rejected に固定される経路が無いことを固定する'
    - '既存判定の不変: 「D3: 最終round以外と宣言なし経路は導入前と同じrejectedを維持する」1.089351ms、「strict: trustedな独立slot 1/2だけがapprovedになる」「ラウンド打ち切り: 閾値到達時のblockingをrejectedより先にhuman_requiredへ移し、未到達・導出不能・blocker無しは既存判定を保つ」いずれも pass'
    - 'test/integration/worker-adapters.test.ts は全件実行で fail 0。前ラウンドで進行役が観測した8件の失敗は起動系 env（WORKER_CMD）の漏洩による偽陽性であり、本ラウンドでは再現しなかった'
    - 'PR #791 の CI 実測（head 2ff1798d3f97b26317f9654422eafb1bd61c3b12）: check-runs は verify=completed/success、verify-config-doc-sync=completed/success の2件。mergeable=MERGEABLE、mergeStateStatus=CLEAN、base=main。前ラウンドの MERGE_REF_BUILD_TYPE_ERROR は解消済みである'
