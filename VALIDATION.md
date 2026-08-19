# 由来: AGENTS.md が定める不変条件I7（仕様⇔検証の追跡）。SPEC.md の AC-1〜AC-8 に一意対応する。
# 本ファイルは .agent-skill-chain/schemas/validation-report.schema.yaml に適合する純粋なYAMLである。
#
# ── target_sha の自己記述 ─────────────────────────────────────────────
# 下記 target_sha は、本検証を実行した実装 commit の SHA である。VALIDATION.md は自身を載せる
# commit の SHA を内容に持てないため、この宣言値と validation-gate が判定対象とする SHA
# （本成果物を含む commit）は必ず食い違う。その差が判定へ影響しないことを次の不変で担保する。
#
#   不変: 本成果物を追加する commit は、検証対象の実装 SHA
#   f377e5988539b89ae950996a2e803aaaed891a36 に VALIDATION.md のみを追加した差分であり、
#   実装ファイル・SPEC.md・DESIGN.md・PLAN.md・ADR-0078 を一切変更しない。
#
# 根拠1: 検証実行時点の worktree HEAD が当該実装 SHA であること。validation worker が再実行した実出力:
#   $ git log --oneline -3
#   f377e59 fix: 分類後の判定を有効sub-verdictで再計算し制御レコードの投稿者を束縛する
#   89ffd95 chore(adr): ADR-0078 を accepted へ更新
#   0188f52 docs: 最終ラウンドの判定値をhuman_requiredへ収束させ裏付け規則を確定する
#
# 根拠2: 本成果物を追加する commit の差分が VALIDATION.md 1件だけであること。
#   `git add -N VALIDATION.md` 後に validation worker が再実行した実出力:
#   $ git diff --stat HEAD
#   VALIDATION.md | 87 +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
#   1 file changed, 87 insertions(+)
#
# 検出した欠陥: なし。本検証で origin を付して記載すべき欠陥は検出していない。
# 実装・承認済み成果物（SPEC.md / DESIGN.md / PLAN.md / ADR-0078）への変更は行っていない。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-786
target_sha: f377e5988539b89ae950996a2e803aaaed891a36

acceptance_criteria:
  - ac_id: AC-1
    verification: {mode: automated, result: pass}
    evidence:
      - 'test/unit/gate-round-policy-assets.test.ts「gate-review skill (AC-1〜AC-8): 既定予算・宣言・4類型・追跡・fallbackを配布する」pass。配布 SKILL.md が「初回をround 0」「最終round 4、最大5回」を全4 gate共通の既定として明示する'
      - '.agent-skill-chain/config/agent-skill-chain.yaml と .agent-skill-chain/templates/lightweight/agent-skill-chain.yaml がともに review.round_limit.cutoff_threshold=4 を持ち、standard・lightweight の両配布で同一予算になる'
      - 'test/integration/init.test.ts 20件 pass / test/integration/upgrade.test.ts 33件 pass。skill と config が両 profile へ展開され配布元と不一致を残さない'
  - ac_id: AC-2
    verification: {mode: automated, result: pass}
    evidence:
      - 'test/unit/round-budget-policy.test.ts「round budget宣言: digest改変・直前attempt不一致・複数宣言・上書き・review開始後追加を拒否する」pass。レビュー開始後および結果確定後に作成された宣言は採用されず、事後宣言では通過できない'
      - 'src/commands/gate.ts の review() が最終roundで宣言を解決できない場合に「最終roundの事前宣言を検証できません」で reviewer 起動前に停止する。同経路は test/unit/round-budget-policy.test.ts の宣言検査群で固定されている'
  - ac_id: AC-3
    verification: {mode: automated, result: pass}
    evidence:
      - 'test/unit/round-budget-policy.test.ts「finding再分類: 同一current recordのraw evidence完全一致と4類型外根拠を要求する」pass。4類型のいずれかに該当すると申告した finding は warning へ分類できない'
      - 'test/unit/review-evidence.test.ts「D3: 4条件が揃う最終roundは、raw failを保持したまま有効sub-verdictでapprovedになる」pass。4類型外 finding だけが残る最終round では blocking が0件となり進行を妨げない'
  - ac_id: AC-4
    verification: {mode: automated, result: pass}
    evidence:
      - '.agent-skill-chain/schemas/gate-report.schema.yaml の finding.reclassification.outside_blocking_categories.data_loss_or_security が const: false。データ喪失・セキュリティ低下を認めた finding の降格記録は schema 上作成できない'
      - 'test/unit/round-budget-policy.test.ts「finding再分類」pass。data_loss_or_security: true を含む分類recordを「4類型すべて」に該当しない旨の要件違反として拒否する'
      - 'test/unit/gate-round-policy-assets.test.ts「gate-review skill (AC-1〜AC-8)」pass。配布 SKILL.md が「データ喪失またはセキュリティ低下」を round・risk・profile によらない常時blockingとして配布する'
  - ac_id: AC-5
    verification: {mode: automated, result: pass}
    evidence:
      - 'test/integration/gate-judgment.test.ts「gate record-verdict (AC-5): current findingのraw evidence改変を拒否し完全記録を保持する」pass。現行記録単独で元severity・降格理由・根拠・raw evidence・follow-up Issue番号を検証できる'
      - 'test/unit/review-evidence.test.ts「D3: 4条件が揃う最終round…」pass。分類後も finding は削除されず severity のみ warning となり、evidence 原文・original_severity=blocking・follow_up_issue_id を保持する'
  - ac_id: AC-6
    verification: {mode: automated, result: pass}
    evidence:
      - 'test/unit/review-evidence.test.ts「D3: 4条件を単独で崩した入力はいずれもapprovedにならず、最終roundではrejectedでなくhuman_requiredへ収束する」pass。4類型blocking残存・判定不能表明・未分類blocking・裏付けの無いfailのいずれも承認されない'
      - 'test/unit/gate-round-policy-assets.test.ts「AC-6: ラウンド値を解決できない経路が有限性保証の対象外であることを配布契約が明示する」および「AC-6: gateコマンドは集約済み判定をapprove側へ直接代入しない」pass'
      - 'test/integration/gate-judgment.test.ts「gate publish (D3): 有効sub-verdictのapprovedはsuccess、4類型blocking残存の最終roundはaction_requiredになる」pass'
  - ac_id: AC-7
    verification: {mode: automated, result: pass}
    evidence:
      - 'test/unit/roles.test.ts「loadRoles (AC-7): 全4 workerだけに非追記型是正の同一契約を配布する」pass。spec・design・implementation・validation の4契約へ同一規範が入り、gate_reviewer には編集規範を配らない'
      - 'test/integration/report.test.ts「report status (AC-7): blocking remediationは報告必須で、理由なしrequired_additionを拒否する」pass'
  - ac_id: AC-8
    verification: {mode: automated, result: pass}
    evidence:
      - 'test/unit/review-light.test.ts「resolveReviewProfile: I8のrisk/autonomy判定を一意に解決する」pass。risk != normal または autonomy == full の Strict 固定は緩和されない'
      - 'test/integration/gate-judgment.test.ts 35件 pass。Strict の独立2 verdict 要求・件数不足時の書込み拒否・2観点の分離判定はいずれも不変'
      - 'test/integration/verify-artifact-targets.test.ts 13件 pass。quick の成果物免除範囲は変更されていない'

regression:
  executed: true
  evidence:
    - 'npm test（target f377e5988539b89ae950996a2e803aaaed891a36）: tests 1439 / pass 1438 / fail 0 / skipped 1。skip 1件は ASC_TEST_LIVE_CLI_INSTALL_SOURCE=1 指定時のみ実行する live 到達性テストであり本変更と無関係'
    - 'npm run build（tsc）exit 0'
    - '両方向の回帰再実行（承認強制側）: test/unit/review-evidence.test.ts「D3: 4条件を単独で崩した入力はいずれもapprovedにならず、最終roundではrejectedでなくhuman_requiredへ収束する」pass。blocking 0件を根拠に final/inconclusive を承認側へ代入する経路が無いことを固定する'
    - '両方向の回帰再実行（永久rejected側）: test/unit/review-evidence.test.ts「D3: 4条件が揃う最終roundは、raw failを保持したまま有効sub-verdictでapprovedになる」pass。severity 差し替えが sub-verdict へ届かず最終roundが rejected に固定される経路が無いことを固定する'
    - 'test/unit/round-budget-policy.test.ts 7件 pass。gate横断の宣言衝突（別gateの宣言を重複と数えない）と制御レコードの投稿者束縛（非trusted投稿は採用せず単独でゲートも停止させない）の回帰を含む'
    - 'test/unit/review-evidence.test.ts 15件 pass / test/unit/roles.test.ts 7件 pass / test/unit/schema.test.ts 50件 pass / test/integration/report.test.ts 9件 pass / test/integration/worker-adapters.test.ts 88件 pass'
    - '.agent-skill-chain/ci/verify-template-sync.sh exit 0 / .agent-skill-chain/ci/verify-doc-length.sh exit 0 / .agent-skill-chain/ci/verify-adr.sh docs/adr/ADR-0078-finding-reclassification-effective-subverdict-and-control-record-trust.md exit 0 / .agent-skill-chain/scripts/adr-lint.sh check exit 0 / .agent-skill-chain/scripts/lint-references.sh exit 0 / .agent-skill-chain/scripts/lint-vocab.sh exit 0'
