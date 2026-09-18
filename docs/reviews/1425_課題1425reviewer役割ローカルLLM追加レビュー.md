# 1425 reviewer役割へのローカルLLM provider追加 レビュー

## 対象

- Issue: https://github.com/techbeansjp-free/AGENTS.md/issues/1425
- PR: https://github.com/techbeansjp-free/AGENTS.md/pull/1426
- 基点SHA: `b08fa7f974274b1610553f77503582bf7f3f94d3`（`main`のHEAD、既定branch追随なし）
- H_impl（最終実装commit）: `7af39f7bb5f3cdcd7391494795b505aeef8e46bd`
- H_final（本artifactのcommit）: 本commit（H_implの直後、本artifactだけが差分）

## 経緯（初回作成分からの要約）

初回のStep 10レビュー（4 round、H_impl=`019f1a2f`）で承認しPR作成後、CIが2件（trusted品質契約の保護対象file自己変更、review artifact命名規則違反）失敗し、CodeRabbitが9件指摘した。全件を実コードで裏取りした結果、誤検知は0件で、加えて独立に1件（小文字枝番SCN IDの再発）を発見した。これらをDISC-002として`workflow assess-discovery`で評価し（`disposition: rebaseline-affected-contracts`）、5commit（`eed84b40`〜`2155957b`）で是正した。

是正後、H_impl=`2155957b`に対して独立review（別context agent、subagent ID `a542791a2808ac75a`）を実施したところ、新たにCritical 1件（REV3-01: ローカルLLM応答が`findings[].riskAcceptance`を自己申告し、Critical/High指摘を`acceptedRisks`側へ動かして自己承認できる。CodeRabbitの2巡目指摘と一致）とMedium 1件（REV3-02: `01_ワークフロー要件.md`がAC-109を参照するが追跡先がどこにも存在しない）を検出した。他の全観点（INV-05分離、`evaluateReview`リファクタの既存呼出し元への非破壊性、SCN文法、`AI_ISSUERS`の影響範囲、post-dispatch再検証の判別力等）は誤りなしと確認された。

commit `7af39f7b`でREV3-01・REV3-02を是正した後、この修正だけに絞った2回目の独立review（別subagent、ID `aa60c1735be621dac`）を実施し、`approved`（プロトタイプ汚染・重複JSONキー・大文字小文字トリック・別名フィールド経由等、複数の迂回経路を実際に試行し突破口なしと確認）を得た。

## 最終判定: **approved**

未解決のCritical/High指摘は無い。

## 指摘一覧（H_impl=`2155957b`時点で検出・全てH_impl=`7af39f7b`で解消）

| ID | 重大度 | 状態 | 対応 |
|---|---|---|---|
| REV3-01 | Critical | resolved | `src/domain/review-verdict.ts`へ`stripRiskAcceptance`を追加し、LLM応答の`findings[].riskAcceptance`を機械的に剥奪してから`evaluateReviewJudgment`へ渡す。人間の受容が必要な指摘は常に`blocking`として安全側に倒す。`SCN-INTEGRATION-REVIEW-1425-018`で反例testを追加し、実装を一時的に無効化して失敗することを2つの独立subagentがそれぞれ確認した |
| REV3-02 | Medium | resolved | `docs/specs/02_要件/01_ワークフロー要件.md`の「AC-101〜109」を「AC-101〜108」へ訂正し、AC-109（cucumberスイート対象外、実プロジェクトでの実地検証）が本追跡表の対象外である旨を明記した |

## 検証したが指摘なしと確認した観点

- INV-05: `git diff --stat`で`src/adapters/codex-launch.ts`・`src/domain/routing.ts`の差分が空であることを確認（implementer向け経路は無変更）
- `evaluateReview`（`src/domain/review.ts`）から`evaluateReviewJudgment`を切り出すリファクタが、既存の全呼出し元（`src/cli.ts`、`test/steps/issue-development-considerations.steps.ts`、`test/steps/unit.steps.ts`、`test/steps/risk-policy.steps.ts`、`test/steps/review-reproduction.steps.ts`）の観測可能な挙動（`approved`/`blocking`/`acceptedRisks`）を変えないこと
- `resolveReviewRouting`のcoordinator/reviewer同一identity拒否の配置順序（provider/model/mode/endpoint検証より前）に情報漏洩や`launchReview`との不整合が無いこと
- `SCN-INTEGRATION-REVIEW-1425-013`（dispatch後policy再検証）が、`refs/remotes/origin/main`の更新漏れという既知の落とし穴を踏まえたうえで実際に判別力を持つこと（実装を一時的に無効化して2つの独立subagentがそれぞれ失敗を確認）
- SCN ID文法違反（小文字枝番等）が新規・既存を含め残っていないこと
- `AI_ISSUERS`への`ollama`追加の影響範囲が`validateProviderSelection`の自己発行override拒否チェック1箇所に限定されること
- `stripRiskAcceptance`の迂回経路（プロトタイプ汚染、`__proto__`/`constructor.prototype`、重複JSONキー、大文字小文字トリック、別名フィールド経由）を実際に試行し、いずれも成立しないこと。また`findings`の正当なfield（`id`/`severity`/`status`/`evidence`/`reproductionSteps`/`reproductionResult`）が剥奪処理の影響を受けず素通りすること
- `evaluateLocalLlmReview`の`acceptedRisks`が、`launchReview`・`routing review-launch`のどちらの経路でも権威的な判定として消費されず、常に空配列になること（自己承認の逃げ道が別の消費側にも存在しないこと）

## 検証したローカルゲート（H_impl=`7af39f7b`）

`npm run typecheck` / `lint` / `format:check` / `cli:check` / `architecture:check`（`valid: true`） / `trace:check`（`orphanRequirements`/`orphanScenarios`/`orphanImplementations`すべて空） / `docs:format` / `test:format` / `source:check`（`valid: true`） / `package:check` — 全合格。

`@routing-1425`タグのBDDスイート: 34 scenarios / 205 steps、全合格（`node --import tsx ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.mjs --tags @routing-1425`）。

`test:unit`: 1272 scenario中134件失敗。失敗134件はこのsandbox環境固有のtmpdir/symlink問題（macOSの`os.tmpdir()`がsymlink経由の`/var`配下を指すことに起因）であり、基準commit（`b08fa7f9`）のclean cloneと完全一致することを確認済み（review-launch関連の失敗は0件）。

`conformance:check`: 87 scenario中3件失敗。同様にclean baselineと完全一致（環境要因、回帰ではない）。

## 未実施（本PRのスコープ外として明記）

- AC-109（利用project d-pops-inventory側Issue #259での実地検証）は本PRのcucumberスイート対象外。本branchのmerge後、または本branch参照下でのIssue #259 Step 5以降の実施を待つ
- implementer向け`resolveRouting`/`launchCodex`のprovider固定（`codex`/`claude`）を同様にレジストリ抽象化する件は、別Issue https://github.com/techbeansjp-free/AGENTS.md/issues/1427 として起票済み。本PRでは実装しない
