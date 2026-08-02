# SPEC: bugfix: gate workflowが未レビュー状態をジョブ失敗として扱い全PRのCIを恒常的に赤くしている

- Issue: `#349`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/349-gate-pending-treated-as-failure`

## 目的・背景

`.github/workflows/agent-skill-chain-gate.yml`の`verify-and-publish`ジョブ（matrix: spec/design/implementation/validationの4セグメント、`fail-fast: false`）は、対象ゲートが「未レビュー（pending）」であるだけの正常な状態でもジョブ全体をFAILUREとして終了させる。`gate verify-evidence`（`src/commands/gate.ts`）自体はpendingのままexit 0でgate-reportを書き出すが、後続の`Verify gate report schema`ステップ（`.agent-skill-chain/ci/verify-gate-report.sh` → `src/commands/verify.ts`の`gateReport()`関数）が`gate.conformance`/`gate.falsification`/`gate.final`いずれかのpendingを違反として非0終了させるため、`set -euo pipefail`下のジョブがそこで停止しFAILUREになる。この経路では`Publish Check Run`ステップ（`gate publish`、`src/commands/gate.ts`）まで到達せず、`Verify local-review evidence`ステップ内にある「evidence失敗」時のaction_required Check Run発行分岐も実行されない。結果として、レビュー未完了というだけの正常な状態のPRで、Check Runが発行されないままjob自体がFAILUREになる。

2026-08-02実測で、当時オープンだった全Issue駆動PR（#345, #343, #341, #327, #282）が例外なくこの状態にあり、PR #345（Issue #316修正後のmain上のコード、コード自体に問題なし）でも唯一の失敗理由が「gate.conformance が pending のままです」であることを確認した。これはAGENTS.md自身の「全PRがCI通っていない」という異常事態の支配的原因である（Fableアドバイザーによる横断調査、2026-08-02）。

併せて、同workflowの`detect-segments`ジョブ内Issue ID抽出ロジックには、`.github/workflows/agent-skill-chain-ci.yml`・`.github/workflows/agent-skill-chain-reconcile.yml`に既に存在するdependabot/自動化ブランチのskip分岐が欠落しており、dependabotブランチで`detect-segments`ジョブがexit 1で失敗し続けている。`verify-and-publish`自体はdetect-segments失敗時にSKIPPEDとなるため実害は限定的だが、`detect-segments`の赤がノイズとして残っている。

本Issueは、これら2つの独立した原因を解消する。関連するが別原因（trust root checkoutが古いPR作成時点のbase.shaに凍結される問題）はIssue #348が扱っており、本Issueの対象外とする。

## 要求 → 要件 → 受入条件

### 要求

リポジトリ管理者（ユーザー）は、レビューがまだ完了していないだけの正常な状態のPRで`verify-and-publish`ジョブが恒常的にFAILUREになる状態を解消し、マージ可否の実効的な制御を引き続きrequired statusのCheck Run（`agent-skill-chain/{spec,design,implementation,validation}-gate`）へ委ねられるようにすることを求めている。あわせて、dependabotブランチで`detect-segments`が無意味に失敗し続けるノイズを解消することを求めている。

### 要件

- `gate.conformance`・`gate.falsification`・`gate.final`のいずれかがpendingであることが理由で`verify-and-publish`ジョブが停止する場合、ジョブは既存の「evidence失敗」分岐と同様に`agent-skill-chain/<gate>-gate`という名前でaction_requiredのCheck Runを対象SHA（`target_sha`）へ発行したうえで、ジョブ自体はexit 0（成功）として終了する。
- pending以外の理由（スキーマ違反、blockers存在によるrejected、approved_artifactsのdigest不一致、target_sha不正等）でgate-reportが不合格の場合は、従来どおりジョブをFAILUREとし、マージ阻害を継続する（regressionなし）。
- レビューが実際に失敗（rejected、final=rejected）した場合も、従来どおりジョブ・Check Runとも失敗を適切に表現し続ける。
- `.github/workflows/agent-skill-chain-gate.yml`のIssue ID抽出ロジックへ、`agent-skill-chain-ci.yml`・`agent-skill-chain-reconcile.yml`と同型のdependabot/自動化ブランチskip分岐を追加し、対応するPRが存在しdependabot[bot]が作成者である場合に`detect-segments`をexit 1にせず適切にskipする。
- 配布テンプレート`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-gate.yml`にも同じ修正を同期し、`verify-template-sync`検査をgreenに保つ。

### 受入条件（Acceptance Criteria）

#### AC-1: pendingゲートを持つPRでverify-and-publishがSUCCESSになる

- Given: あるIssueのPRで、いずれかのゲート（spec/design/implementation/validation）がまだレビュー未完了（`gate.conformance`・`gate.falsification`・`gate.final`のいずれかがpending）である
- When: そのPRへpush（またはPR synchronize等）が発生し、`agent-skill-chain-gate.yml`の`verify-and-publish`ジョブが起動する
- Then: 当該gateの`verify-and-publish`ジョブはFAILUREではなくSUCCESSで終了し、`agent-skill-chain/<gate>-gate`という名前のCheck Runがconclusion=action_requiredで対象SHAへ発行される
- 検証方法見込み: `automated`

#### AC-2: レビュー失敗（rejected）は引き続きジョブ・Check Runとも失敗を表現する

- Given: あるgateのレビューが完了し、`gate.final`がrejected（またはconformance/falsificationいずれかがfail、blockersが存在）である
- When: `verify-and-publish`ジョブが起動する
- Then: ジョブはFAILUREで終了し、`agent-skill-chain/<gate>-gate`のCheck Runはconclusion=failureで発行される（pending救済分岐によってこの失敗表現が損なわれない）
- 検証方法見込み: `automated`

#### AC-3: pending以外のgate-report不合格（スキーマ違反・digest不一致・target_sha不正）は引き続きジョブを失敗させる

- Given: gate-reportがスキーマに非適合、approved_artifactsのdigestが現在のファイル内容と一致しない、またはtarget_shaが有効なcommitとして解決できない
- When: `verify-and-publish`ジョブが起動する
- Then: ジョブはFAILUREで終了する（pending救済分岐の追加によってこれらの検査がバイパスされない）
- 検証方法見込み: `automated`

#### AC-4: dependabotブランチでdetect-segmentsが適切にskipされる

- Given: `dependabot/`形式のブランチに対応する開いているPRが存在し、その作成者が`dependabot[bot]`である
- When: `agent-skill-chain-gate.yml`の`detect-segments`ジョブが起動する
- Then: `agent-skill-chain-ci.yml`・`agent-skill-chain-reconcile.yml`と同様にissue_id抽出がskip扱いとなり、ジョブがexit 1で失敗しない
- 検証方法見込み: `automated`

#### AC-5: dependabot以外の抽出不能ブランチは引き続き拒否される

- Given: ブランチ名が`.agent-skill-chain/config/agent-skill-chain.yaml`のbranch.patternに適合せず、かつdependabot許可リストにも該当しない
- When: `detect-segments`ジョブが起動する
- Then: 従来どおり非0で終了し、日本語の理由をエラー出力する（誤ってすべての抽出失敗を無条件skipに倒さない）
- 検証方法見込み: `automated`

#### AC-6: 配布テンプレートが本体workflowと同期している

- Given: `.github/workflows/agent-skill-chain-gate.yml`にAC-1〜AC-5の修正が反映されている
- When: `verify-template-sync`（`.agent-skill-chain/scripts/verify-template-sync.sh`）を実行する
- Then: `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-gate.yml`との差分が検出されない
- 検証方法見込み: `automated`

#### AC-7: 実際のオープンPRでgreen化を実機確認する

- Given: 本Issueの実装がmainへマージされた状態
- When: 実装時点でオープンだったIssue駆動PR（#345等、pendingゲートを持つもの）の`verify-and-publish`を再実行または新規pushで再評価する
- Then: pending部分を含む当該PRの`verify-and-publish`がSUCCESS（対応するCheck Runはaction_requiredのまま）になることを目視確認できる
- 検証方法見込み: `manual`

## スコープ外

- Issue #348が扱う、trust root checkoutが古いPR作成時点のbase.shaに凍結され古いCLIコードを実行してしまう問題への対応。本Issueとは別原因であり別Issueで扱う。
- pendingを理由とするaction_required Check Runの内容（title/summary文言）の大幅な作り込み。既存の「evidence失敗」分岐が持つ形式を踏襲すれば足り、新たな文言規約の制定は対象外とする。
- `gate.conformance`/`gate.falsification`/`gate.final`のpending判定ロジックそのもの（`src/commands/gate.ts`の集約規則）の変更。本Issueはpending状態の検出結果をworkflow側でどう扱うかのみを対象とする。
- required statusとしてのCheck Run設定（branch protection ruleset側の設定）の変更。本Issueの対応後もCheck Run自体は引き続きrequired statusとして機能する前提であり、ruleset設定変更は対象外とする。
