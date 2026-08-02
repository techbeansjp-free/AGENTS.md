# SPEC: bugfix: gate workflowが未レビュー状態をジョブ失敗として扱い全PRのCIを恒常的に赤くしている

- Issue: `#349`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/349-gate-pending-treated-as-failure`

## 目的・背景

`.github/workflows/agent-skill-chain-gate.yml`の`verify-and-publish`ジョブ（matrix: spec/design/implementation/validationの4セグメント、`fail-fast: false`）は、対象ゲートが「未レビュー（pending）」であるだけの正常な状態でもジョブ全体をFAILUREとして終了させる。`gate verify-evidence`（`src/commands/gate.ts`）自体はpendingのままexit 0でgate-reportを書き出すが、後続の`Verify gate report schema`ステップ（`.agent-skill-chain/ci/verify-gate-report.sh` → `src/commands/verify.ts`の`gateReport()`関数）が`gate.conformance`/`gate.falsification`/`gate.final`いずれかのpendingを違反として非0終了させるため、`set -euo pipefail`下のジョブがそこで停止しFAILUREになる。この経路では`Publish Check Run`ステップ（`gate publish`、`src/commands/gate.ts`）まで到達せず、`Verify local-review evidence`ステップ内にある「evidence失敗」時のaction_required Check Run発行分岐も実行されない。結果として、レビュー未完了というだけの正常な状態のPRで、Check Runが発行されないままjob自体がFAILUREになる。

なお、レビューが実際に失敗した（`gate.final`がrejected）場合は、本Issueの対象となる問題とは別で、従来から一貫してジョブ自体をFAILUREにしていない。`gate publish`（`src/commands/gate.ts`の`publish()`）はfinal=rejectedであってもexit 0を返す実装であり、`agent-skill-chain/<gate>-gate`Check Runのconclusion=failureのみが失敗を表現する。マージ可否の実効的な制御はrequired statusとして設定された当該Check Runが担っており、ジョブ自体のSUCCESS/FAILUREには依存しない。本Issueはこの既存動作を変更しない。

2026-08-02実測で、当時オープンだった全Issue駆動PR（#345, #343, #341, #327, #282）が例外なくこの状態にあり、PR #345（Issue #316修正後のmain上のコード、コード自体に問題なし）でも唯一の失敗理由が「gate.conformance が pending のままです」であることを確認した。これはAGENTS.md自身の「全PRがCI通っていない」という異常事態の支配的原因である（Fableアドバイザーによる横断調査、2026-08-02）。

併せて、同workflowの`detect-segments`ジョブ内Issue ID抽出ロジックには、`.github/workflows/agent-skill-chain-ci.yml`・`.github/workflows/agent-skill-chain-reconcile.yml`に既に存在するdependabot/自動化ブランチのskip分岐が欠落しており、dependabotブランチで`detect-segments`ジョブがexit 1で失敗し続けている。`verify-and-publish`自体はdetect-segments失敗時にSKIPPEDとなるため実害は限定的だが、`detect-segments`の赤がノイズとして残っている。

本Issueは、これら2つの独立した原因を解消する。関連するが別原因（trust root checkoutが古いPR作成時点のbase.shaに凍結される問題）はIssue #348が扱っており、本Issueの対象外とする。

## 要求 → 要件 → 受入条件

### 要求

リポジトリ管理者（ユーザー）は、レビューがまだ完了していないだけの正常な状態のPRで`verify-and-publish`ジョブが恒常的にFAILUREになる状態を解消し、マージ可否の実効的な制御を引き続きrequired statusのCheck Run（`agent-skill-chain/{spec,design,implementation,validation}-gate`）へ委ねられるようにすることを求めている。あわせて、dependabotブランチで`detect-segments`が無意味に失敗し続けるノイズを解消することを求めている。

### 要件

- `gate.conformance`・`gate.falsification`・`gate.final`のいずれかがpending（実運用上は`gate verify-evidence`が返す`gate.final === 'human_required'`が唯一の実際の駆動値であり、リテラル`pending`は`gate review`が生成する白紙スキャフォールドに対する安全側の備えとして判定基準に残す）であり、かつ`approved_artifacts`のdigest不一致・`target_sha`不正等の非pending違反が一切存在しない場合に限り、ジョブは既存の「evidence失敗」分岐と同様に`agent-skill-chain/<gate>-gate`という名前でaction_requiredのCheck Runを対象SHA（`target_sha`）へ発行したうえで、ジョブ自体はexit 0（成功）として終了する。この際、後続の`Publish Check Run`ステップ（`gate publish`）はskipし、二重のCheck Run発行、および`gate publish`がfinal=pendingのgate-reportを拒否して非0終了することによるジョブFAILUREを防ぐ。
- pendingと非pending違反（スキーマ違反、approved_artifactsのdigest不一致、target_sha不正等）が同一gate-report内で併存する場合は、非pending違反を優先してジョブをFAILUREとする（pending救済は非pending違反が皆無の場合にのみ適用するfail-closed設計とし、AGENTS.md I8「既定は常に安全側」を満たす）。
- pending以外の理由（スキーマ違反、approved_artifactsのdigest不一致、target_sha不正等）でgate-reportが不合格の場合は、従来どおりジョブをFAILUREとし、マージ阻害を継続する（regressionなし）。
- レビューが実際に失敗（final=rejected、conformance/falsificationいずれかがfail、blockersが存在）した場合、`gate publish`はfinal=rejectedであってもexit 0を返す既存動作を変更しない。ジョブ自体はSUCCESSのまま、`agent-skill-chain/<gate>-gate`Check Runのみがconclusion=failureとして失敗を表現し続ける（本Issueによる変更対象ではなく、従来から一貫してジョブ自体をFAILUREにしていない。マージ可否の実効的な制御はrequired statusとして設定された当該Check Runが担う）。
- `.github/workflows/agent-skill-chain-gate.yml`のIssue ID抽出ロジックへ、`agent-skill-chain-ci.yml`と同型（`pull_request_target`イベントのpayloadからPRのactor・head branch名を直接判定する方式。API照会を要する`agent-skill-chain-reconcile.yml`方式は`pull_request_target`では不要なため採らない）のdependabot/自動化ブランチskip分岐を追加する。対応するPRのhead branchが`dependabot/`で始まりPR作成者（`user.login`）が`dependabot[bot]`である場合、`detect-segments`のissue_id抽出をskipしてジョブをexit 1にしないだけでなく、`matrix`出力を空配列とし後続`verify-and-publish`ジョブ自体も起動させない（新規Check Runの発行なし。`agent-skill-chain-ci.yml`のskip_checks出力が後続全ステップを抑止するのと同型の、skipとdownstream抑止が対になった設計とする）。
- 配布テンプレート`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-gate.yml`にも同じ修正を同期し、`verify-template-sync`検査をgreenに保つ。

### 受入条件（Acceptance Criteria）

#### AC-1: pendingゲートを持つPRでverify-and-publishがSUCCESSになる

- Given: あるIssueのPRで、いずれかのゲート（spec/design/implementation/validation）がまだレビュー未完了であり、`gate verify-evidence`が生成したgate-reportの`gate.final`が`pending`または`human_required`である（`gate.conformance`・`gate.falsification`のいずれかもpendingを伴う）。かつ、`approved_artifacts`のdigest不一致・`target_sha`不正等の非pending違反は一切存在しない
- When: そのPRへpush（またはPR synchronize等）が発生し、`agent-skill-chain-gate.yml`の`verify-and-publish`ジョブが起動する
- Then: `Verify gate report schema`ステップは専用終了コード2を返し、当該ステップ自身が`agent-skill-chain/<gate>-gate`という名前のCheck Runをconclusion=action_requiredで対象SHAへ発行したうえで、ステップ自体はexit 0として終了する。後続の`Publish Check Run`ステップは、`Verify gate report schema`ステップの出力（pending検出フラグ）を条件にskipされ、`gate publish`は呼び出されない（`gate publish`はfinal=pendingのgate-reportを拒否し非0終了する実装であり、skipしなければジョブがFAILUREへ倒れ、かつ同一Check Runの二重発行を招くため）。結果として`verify-and-publish`ジョブ自体はFAILUREではなくSUCCESSで終了する
- 検証方法見込み: `hybrid`（`Verify gate report schema`ステップが呼び出す`verify gate-report`の終了コード2判定・出力メッセージはCLIレベルの自動テストで検証可能。`Publish Check Run`ステップのskip、実際のジョブ結論・Check Run発行自体は`agent-skill-chain-gate.yml`が`pull_request_target`トリガであり本PR自身の変更が本PR自身のCI実行には適用されないため、本PR内では自動検証できずAC-7の手動確認に委ねる）

#### AC-2: レビュー失敗（rejected）はCheck Runのconclusion=failureとして引き続き表現され、ジョブ自体はSUCCESSのまま変化しない

- Given: あるgateのレビューが完了し、`gate.final`がrejected（またはconformance/falsificationいずれかがfail、blockersが存在）である。gate-reportはスキーマに適合し、approved_artifactsのdigestもtarget_shaも正当である（非pending違反は存在しない）
- When: `verify-and-publish`ジョブが起動する
- Then: `Verify gate report schema`ステップは終了コード0を返す（`final`がpending/human_required以外の場合、`gate.conformance`・`gate.falsification`が個別にpendingのまま提出されていても、`gate.final`という単一の権威あるフィールドのみを判定基準としチェックしない）。後続の`Publish Check Run`ステップはskipされず実行され、`gate publish`（`src/commands/gate.ts`の`publish()`）はfinal=rejectedの場合もexit 0を返すため`verify-and-publish`ジョブ自体はSUCCESSで終了するが、`agent-skill-chain/<gate>-gate`という名前のCheck Runは`checkRunConclusionForFinal()`により導出されたconclusion=failureとして対象SHAへ発行される。この挙動は本Issueによる変更対象ではなく、既存動作のまま変化しない（regressionなし）。マージ可否の実効的な制御はrequired status checkとして設定された当該Check Runが担い、ジョブ自体のSUCCESS/FAILUREには依存しない
- 検証方法見込み: `hybrid`（`gate publish`のfinal=rejected時の終了コード・`checkRunConclusionForFinal()`の導出結果はCLIレベルの自動テストで検証可能。実際のGitHub Check Run発行・ジョブ結論はAC-1と同じ理由によりAC-7の手動確認に委ねる）

#### AC-3: pending以外のgate-report不合格は、pendingが同時に検出されている場合でも優先されジョブを失敗させる

- Given: gate-reportがスキーマに非適合、approved_artifactsのdigestが現在のファイル内容と一致しない、またはtarget_shaが有効なcommitとして解決できない（`verify gate-report`の非pending違反に該当する）。この違反は、`gate.conformance`・`gate.falsification`・`gate.final`のいずれかが同時にpending/human_requiredである場合を含む（併存ケース）
- When: `verify-and-publish`ジョブが起動する
- Then: `verify gate-report`は非pending違反が1件以上存在する場合、pending違反の有無に関わらず終了コード1（違反）を返す。すなわちpending救済（AC-1のexit 0分岐）は非pending違反が0件の場合にのみ適用され、非pending違反が1件でも併存する場合は優先してジョブをFAILUREとする（AGENTS.md I8「既定は常に安全側」に基づくfail-closed）。pending救済分岐の追加によってこれらの検査がバイパスされない
- 検証方法見込み: `automated`（非pending違反とpending違反の優先順位判定はCLIレベルの単体・統合テストで完全に検証可能であり、GitHub Actionsの実行を必要としない）

#### AC-4: dependabotブランチでdetect-segmentsが適切にskipされ、後続のverify-and-publishも実行されない

- Given: `agent-skill-chain-gate.yml`は`pull_request_target`イベントで起動し、PRの`user.login`・`head.ref`はevent payloadから直接取得できる。あるPRのhead branchが`dependabot/`で始まり、かつそのPRの`user.login`が`dependabot[bot]`である（`agent-skill-chain-ci.yml`が採る、event payloadのactorを直接判定する方式に倣う。API照会を要する`agent-skill-chain-reconcile.yml`方式は`pull_request_target`では不要なため採らない）
- When: `agent-skill-chain-gate.yml`の`detect-segments`ジョブが起動する
- Then: issue_id抽出はskip扱いとなり、`Detect started segments`ステップ自体がskipされてジョブがexit 1で失敗しない。`matrix`出力は空配列にフォールバックし、後続`verify-and-publish`ジョブは`needs.detect-segments.outputs.matrix != '[]'`の条件を満たさず起動しない。結果として当該dependabot PRに対し、いずれのgateの`agent-skill-chain/<gate>-gate`Check Runも新規発行されない（`agent-skill-chain-ci.yml`のskip_checks出力が後続全ステップを抑止するのと同型の、skipとdownstream抑止が対になった設計）
- 検証方法見込み: `hybrid`（issue_id抽出・skip判定のbashロジック自体は疑似env varを与えたローカル実行で自動検証可能。`matrix`が実際に空配列へフォールバックし`verify-and-publish`ジョブがGitHub Actions上で起動しないことは、AC-1と同じ`pull_request_target`制約により本PR自身のCIでは検証できず、AC-7の手動確認に委ねる）

#### AC-5: dependabot以外の抽出不能ブランチは引き続き拒否される

- Given: ブランチ名が`.agent-skill-chain/config/agent-skill-chain.yaml`のbranch.patternに適合せず、かつAC-4のdependabot許可条件（`dependabot/`で始まるhead branchかつ`user.login`が`dependabot[bot]`）にも該当しない
- When: `detect-segments`ジョブが起動する
- Then: `Resolve immutable context`ステップは従来どおり非0で終了し、日本語の理由をエラー出力する（誤ってすべての抽出失敗を無条件skipに倒さない）
- 検証方法見込み: `hybrid`（分岐ロジック自体はAC-4と同様ローカル実行で自動検証可能。実際のジョブ失敗の確認はAC-7の手動確認に委ねる）

#### AC-6: 配布テンプレートが本体workflowと同期している

- Given: `.github/workflows/agent-skill-chain-gate.yml`にAC-1〜AC-5の修正が反映されている
- When: `verify-template-sync`（`.agent-skill-chain/scripts/verify-template-sync.sh`）を実行する
- Then: `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-gate.yml`との差分が検出されない
- 検証方法見込み: `automated`（テキスト差分比較であり`pull_request_target`のトリガ種別に依存しないため、本PR自身のCIで検証可能）

#### AC-7: 実際のオープンPRでgreen化を実機確認する

- Given: 本Issueの実装がmainへマージされた状態
- When: 実装時点でオープンだったIssue駆動PR（#345等、pendingゲートを持つもの）の`verify-and-publish`を再実行または新規pushで再評価する。あわせて、dependabotが作成した既存のオープンPR（存在する場合）を確認する
- Then: pending部分を含む当該PRの`verify-and-publish`がSUCCESS（対応するCheck Runはaction_requiredのまま、`Publish Check Run`ステップはskipされ二重発行が起きていないことをジョブログで確認する）になることを目視確認できる。rejected/failしたgateが存在すれば、そのgateのCheck Runがconclusion=failureのまま維持され、ジョブ自体はSUCCESSであることも確認する。dependabot PRについては`detect-segments`が失敗せず、`verify-and-publish`が起動しない（新規Check Runが発行されない）ことを確認する
- 検証方法見込み: `manual`

## スコープ外

- Issue #348が扱う、trust root checkoutが古いPR作成時点のbase.shaに凍結され古いCLIコードを実行してしまう問題への対応。本Issueとは別原因であり別Issueで扱う。
- pendingを理由とするaction_required Check Runの内容（title/summary文言）の大幅な作り込み。既存の「evidence失敗」分岐が持つ形式を踏襲すれば足り、新たな文言規約の制定は対象外とする。
- `gate.conformance`/`gate.falsification`/`gate.final`のpending判定ロジックそのもの（`src/commands/gate.ts`の集約規則）の変更。本Issueはpending状態の検出結果をworkflow側でどう扱うかのみを対象とする。
- required statusとしてのCheck Run設定（branch protection ruleset側の設定）の変更。本Issueの対応後もCheck Run自体は引き続きrequired statusとして機能する前提であり、ruleset設定変更は対象外とする。
- `detect-segments`ジョブ内のissue_id抽出・skip判定ロジックを独立したCLIサブコマンドやスクリプトへ切り出すこと。AC-4/AC-5の検証方法をより完全に自動化する余地はあるが、これは実装方式の選択であり本Issueのスコープでは要求しない。
