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

- `gate.final`という単一の権威あるフィールドの値がリテラル`pending`である場合にのみ、救済分岐（`Verify gate report schema`ステップ自身による汎用action_required Check Run発行＋後続`Publish Check Run`ステップのskip）を発動する。`pending`は`gate review`が生成する白紙スキャフォールドにのみ存在する値であり、実運用でgate-reportを生成する唯一の経路である`gate verify-evidence`は`approved`/`rejected`/`human_required`の3値しか返さないため、この救済分岐は実運用では到達しない理論上の安全側フォールバックである（`gate publish`はリテラル`final=pending`を拒否し非0終了するため、skipしなければジョブがFAILUREへ倒れる。skipはこれを防ぐ）。`gate.conformance`・`gate.falsification`が個別にpendingのまま提出されていても、`gate.final`が確定値（approved/rejected/human_required）であれば救済分岐は発動しない。救済分岐の発動は、加えて`approved_artifacts`のdigest不一致・`target_sha`不正等の非pending違反が一切存在しない場合に限り、ジョブは既存の「evidence失敗」分岐と同様に`agent-skill-chain/<gate>-gate`という名前でaction_requiredのCheck Runを対象SHA（`target_sha`）へ発行したうえで、ジョブ自体はexit 0（成功）として終了する。この「`final`が確定値であれば`conformance`/`falsification`の個別pendingをチェックしない」という免除は、`final`の値と`conformance`/`falsification`の実際の値が整合している場合に限る前提のもとで成立する。`final=approved`は`conformance`/`falsification`が両方`pass`である場合にのみ成立するという定義（`src/commands/gate.ts`の`deriveFinal()`）に反し、`final=approved`でありながら`conformance`または`falsification`が`pass`でない（`pending`または`fail`のまま）gate-reportは、`final`が確定値であることによる上記免除の対象外とし、`verify gate-report`（`gateReport()`）自身が非pending違反（otherErrors、終了コード1）として検出する。これは`gate publish`（`publish()`）側に既に存在する同種の矛盾拒否ガード（final=approvedだがconformance/falsificationが両passでない場合を拒否）が、`gateReport()`側での事前検出が無いために`Publish Check Run`ステップで初めて発火し、そのステップにはaction_required Check Run発行による救済分岐が無いため、Check Runが一つも発行されないままジョブがFAILUREになる——という、本Issueが解消しようとした失敗モードと同型の状態がこの入力パターンで再現してしまうことに対応するためである（AC-9）。
- `gate.final`が`human_required`（レビューは完了したが判定不能（inconclusive・origin衝突等）で人間判断が必要な状態。実運用で到達する唯一の「未確定」値）である場合は、救済分岐の対象とせず、非pending違反が無ければ`verify gate-report`をexit 0で通過させ、後続の`Publish Check Run`ステップ（`gate publish`）を通常どおり実行する。`gate publish`は`human_required`を拒否せずexit 0で正常終了し、`agent-skill-chain/<gate>-gate`のCheck Runをconclusion=action_required・title `<gate> gate: human_required`・summary（blockersの実値）・output.text（gate-report全体のcanonical JSON）付きで発行する。これにより進行役はCheck Runのみから「レビュー未了でまだ待つべき状態」（救済分岐の汎用Check Run）と「レビュー完了・人間判断が必要な状態」（`gate publish`の詳細Check Run）を区別できる（AGENTS.md I6正準モデル・I8人間判断への昇格）。救済分岐がCheck Runを発行するのはリテラル`final=pending`（`Publish Check Run`はskip）の場合のみであるため、二重発行は起きない。
- pendingと非pending違反（スキーマ違反、approved_artifactsのdigest不一致、target_sha不正等）が同一gate-report内で併存する場合は、非pending違反を優先してジョブをFAILUREとする（pending救済は非pending違反が皆無の場合にのみ適用するfail-closed設計とし、AGENTS.md I8「既定は常に安全側」を満たす）。
- pending以外の理由（スキーマ違反、approved_artifactsのdigest不一致、target_sha不正等）でgate-reportが不合格の場合は、従来どおりジョブをFAILUREとし、マージ阻害を継続する（regressionなし）。
- レビューが実際に失敗（final=rejected、conformance/falsificationいずれかがfail、blockersが存在）した場合、`gate publish`はfinal=rejectedであってもexit 0を返す既存動作を変更しない。ジョブ自体はSUCCESSのまま、`agent-skill-chain/<gate>-gate`Check Runのみがconclusion=failureとして失敗を表現し続ける（本Issueによる変更対象ではなく、従来から一貫してジョブ自体をFAILUREにしていない。マージ可否の実効的な制御はrequired statusとして設定された当該Check Runが担う）。
- `gate reconcile`（`src/commands/gate.ts`の`reconcile()`）が「承認済み成果物のdigestが新SHAでも不変（unchanged）」と判定してCheck Runを再発行する際、そのconclusionは承認済み成果物のdigest不変性のみを根拠に無条件で`success`としてはならない。承認済み成果物のdigestが変化していないことは、そのgateが以前approvedだったことを意味しない（例えば直前に永続化されたgate-reportの`gate.final`が`human_required`や`rejected`である状態のまま、当該gateの成果物には触れないpushが来た場合を含む）。unchangedと判定したgateのconclusionは、直前に永続化された`reviews/<gate>.yaml`の`gate.final`の実際の値から導出しなければならない（`final=approved`のときのみ`success`、`final=rejected`のときは`failure`、`final=human_required`（実運用に加え、リテラル`pending`の場合も含む）のときは`action_required`）。これにより、未確定・却下のままのgateが、成果物が変化していないというだけの理由でmerge可能な`success`へ誤って昇格する経路（fail-openなCheck Run上書き）を塞ぐ。
- AGENTS.md「ゲートの継承・無効化」節は、本システムの正本（憲法）でありながら「`.agent-skill-chain/scripts/gate-reconcile.sh` が push ごとに承認済み成果物 digest を照合し、変化なしなら最新 SHA へ成功を再発行」という、上記のconclusion導出是正（無条件`success`再発行の禁止）以前の挙動をそのまま記述しており、是正後の実装と矛盾する状態のまま放置されている。正本が実装と矛盾したまま残ることは許容しないため、当該記述を「変化なしなら、直前に永続化された`gate.final`の値（`approved`のみ`success`、`rejected`は`failure`、`human_required`・`pending`は`action_required`）から導出したconclusionを再発行する」という趣旨へ修正する。AGENTS.mdの他の節・不変条件I1〜I8・4セグメント構造・文書量上限（150行、`.agent-skill-chain/ci/verify-doc-length.sh`で検査）は変更しない。
- `.github/workflows/agent-skill-chain-gate.yml`のIssue ID抽出ロジックへ、`agent-skill-chain-ci.yml`と同型（`pull_request_target`イベントのpayloadからPRのactor・head branch名を直接判定する方式。API照会を要する`agent-skill-chain-reconcile.yml`方式は`pull_request_target`では不要なため採らない）のdependabot/自動化ブランチskip分岐を追加する。対応するPRのhead branchが`dependabot/`で始まりPR作成者（`user.login`）が`dependabot[bot]`である場合、`detect-segments`のissue_id抽出をskipしてジョブをexit 1にしないだけでなく、`matrix`出力を空配列とし後続`verify-and-publish`ジョブ自体も起動させない（新規Check Runの発行なし。`agent-skill-chain-ci.yml`のskip_checks出力が後続全ステップを抑止するのと同型の、skipとdownstream抑止が対になった設計とする）。
- 配布テンプレート`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-gate.yml`にも同じ修正を同期し、`verify-template-sync`検査をgreenに保つ。

### 受入条件（Acceptance Criteria）

#### AC-1: 未確定ゲートを持つPRでverify-and-publishがSUCCESSになり、確定・未確定の区別がCheck Runへ正しく表現される

- Given: あるIssueのPRで、いずれかのゲート（spec/design/implementation/validation）のレビューが未確定であり、`gate verify-evidence`が生成したgate-reportの`gate.final`が`human_required`（実運用で到達する唯一の未確定値。`gate.conformance`・`gate.falsification`はpendingを伴う）である。かつ、`approved_artifacts`のdigest不一致・`target_sha`不正等の非pending違反は一切存在しない
- When: そのPRへpush（またはPR synchronize等）が発生し、`agent-skill-chain-gate.yml`の`verify-and-publish`ジョブが起動する
- Then: `Verify gate report schema`ステップは終了コード0を返して素通りし（`final=human_required`は確定値としてpending救済分岐に計上しない）、後続の`Publish Check Run`ステップはskipされず実行される。`gate publish`は`human_required`を拒否せずexit 0で正常終了し、`agent-skill-chain/<gate>-gate`のCheck Runをconclusion=action_required・title `<gate> gate: human_required`・summary（blockersの実値）・output.text（gate-report全体のcanonical JSON）付きで対象SHAへ発行する。Check Runの発行は`gate publish`による1回のみ（救済分岐は発動せず二重発行なし）で、`verify-and-publish`ジョブ自体はFAILUREではなくSUCCESSで終了する。加えて（理論上の安全側フォールバック）: `gate.final`がリテラル`pending`（`gate review`の白紙スキャフォールド。実運用では到達しない）の場合のみ、`verify gate-report`は専用終了コード2を返し、`Verify gate report schema`ステップ自身が汎用のaction_required Check Runを発行して`pending=true`を出力し、`Publish Check Run`ステップはskipされ（`gate publish`のリテラル`final=pending`拒否ガードによる非0終了でジョブがFAILUREへ倒れることを防ぐ）、ジョブはSUCCESSで終了する
- 検証方法見込み: `hybrid`（`verify gate-report`の`final=human_required`時の終了コード0判定・リテラル`final=pending`時の終了コード2判定、および`gate publish`の`human_required`受理・action_required発行はCLIレベルの自動テストで検証可能。`Publish Check Run`ステップの実行/skip、実際のジョブ結論・Check Run発行自体は`agent-skill-chain-gate.yml`が`pull_request_target`トリガであり本PR自身の変更が本PR自身のCI実行には適用されないため、本PR内では自動検証できずAC-7の手動確認に委ねる）

#### AC-2: レビュー失敗（rejected）はCheck Runのconclusion=failureとして引き続き表現され、ジョブ自体はSUCCESSのまま変化しない

- Given: あるgateのレビューが完了し、`gate.final`がrejected（またはconformance/falsificationいずれかがfail、blockersが存在）である。gate-reportはスキーマに適合し、approved_artifactsのdigestもtarget_shaも正当である（非pending違反は存在しない）
- When: `verify-and-publish`ジョブが起動する
- Then: `Verify gate report schema`ステップは終了コード0を返す（`final`が確定値（approved/rejected/human_required）の場合、`gate.conformance`・`gate.falsification`が個別にpendingのまま提出されていても、`gate.final`という単一の権威あるフィールドのみを判定基準としチェックしない）。後続の`Publish Check Run`ステップはskipされず実行され、`gate publish`（`src/commands/gate.ts`の`publish()`）はfinal=rejectedの場合もexit 0を返すため`verify-and-publish`ジョブ自体はSUCCESSで終了するが、`agent-skill-chain/<gate>-gate`という名前のCheck Runは`checkRunConclusionForFinal()`により導出されたconclusion=failureとして対象SHAへ発行される。この`gate publish`経由の挙動（`verify-and-publish`ジョブがgate-reportを直接publishする経路のconclusion導出）自体は本Issueによる変更対象ではなく、既存動作のまま変化しない（regressionなし）。マージ可否の実効的な制御はrequired status checkとして設定された当該Check Runが担い、ジョブ自体のSUCCESS/FAILUREには依存しない（`gate reconcile`が同じgateを後から再発行する経路のconclusion導出はAC-8が扱う別の要求であり、本ACの「変化しない」はその経路には及ばない）
- 検証方法見込み: `hybrid`（`gate publish`のfinal=rejected時の終了コード・`checkRunConclusionForFinal()`の導出結果はCLIレベルの自動テストで検証可能。実際のGitHub Check Run発行・ジョブ結論はAC-1と同じ理由によりAC-7の手動確認に委ねる）

#### AC-3: pending以外のgate-report不合格は、pendingが同時に検出されている場合でも優先されジョブを失敗させる

- Given: gate-reportがスキーマに非適合、approved_artifactsのdigestが現在のファイル内容と一致しない、またはtarget_shaが有効なcommitとして解決できない（`verify gate-report`の非pending違反に該当する）。この違反は、`gate.final`が同時にリテラル`pending`である場合（pending違反と併存するケース）、および`gate.final`が`human_required`である場合を含む
- When: `verify-and-publish`ジョブが起動する
- Then: `verify gate-report`は非pending違反が1件以上存在する場合、pending違反の有無・`final`の値に関わらず終了コード1（違反）を返す。すなわちリテラル`final=pending`の救済（AC-1の終了コード2分岐）は非pending違反が0件の場合にのみ適用され、`final=human_required`の通過（AC-1の終了コード0）も非pending違反が0件の場合に限られる。非pending違反が1件でも併存する場合は優先してジョブをFAILUREとする（AGENTS.md I8「既定は常に安全側」に基づくfail-closed）。pending救済分岐・human_required通過の追加によってこれらの検査がバイパスされない
- 検証方法見込み: `automated`（非pending違反とpending違反の優先順位判定はCLIレベルの単体・統合テストで完全に検証可能であり、GitHub Actionsの実行を必要としない）

#### AC-4: dependabotブランチでdetect-segmentsが適切にskipされ、後続のverify-and-publishも実行されない

- Given: `agent-skill-chain-gate.yml`は`pull_request_target`イベントで起動し、PRの`user.login`・`head.ref`はevent payloadから直接取得できる。あるPRのhead branchが`dependabot/`で始まり、かつそのPRの`user.login`が`dependabot[bot]`である（`agent-skill-chain-ci.yml`が採る、event payloadのactorを直接判定する方式に倣う。API照会を要する`agent-skill-chain-reconcile.yml`方式は`pull_request_target`では不要なため採らない）
- When: `agent-skill-chain-gate.yml`の`detect-segments`ジョブが起動する
- Then: issue_id抽出はskip扱いとなり、`Detect started segments`ステップ自体がskipされてジョブがexit 1で失敗しない。`matrix`出力は空配列にフォールバックし、後続`verify-and-publish`ジョブは`needs.detect-segments.outputs.matrix != '[]'`の条件を満たさず起動しない。結果として当該dependabot PRに対し、いずれのgateの`agent-skill-chain/<gate>-gate`Check Runも新規発行されない（`agent-skill-chain-ci.yml`のskip_checks出力が後続全ステップを抑止するのと同型の、skipとdownstream抑止が対になった設計）
- 検証方法見込み: `hybrid`（issue_id抽出・skip判定のbashロジック自体は疑似env varを与えたローカル実行で自動検証可能。`matrix`が実際に空配列へフォールバックし`verify-and-publish`ジョブがGitHub Actions上で起動しないことは、AC-1と同じ`pull_request_target`制約により本PR自身のCIでは検証できず、AC-7の手動確認に委ねる）

#### AC-5: dependabot以外の抽出不能ブランチは引き続き拒否される

- Given: `Resolve immutable context`ステップが`BRANCH`（`github.event.pull_request.head.ref`）から`ISSUE_ID="ISSUE-$(echo "$BRANCH" | sed -E 's#^[^/]+/([0-9]+)-.*#\1#')"`により抽出した`ISSUE_ID`が、正規表現`^ISSUE-[0-9]+$`に適合しない（sedの後方参照が`/`区切りの先頭セグメント直後の数字を捕捉できず、`ISSUE-`に元の`BRANCH`文字列全体がそのまま連結される等）。かつAC-4のdependabot許可条件（`dependabot/`で始まるhead branchかつ`user.login`が`dependabot[bot]`）にも該当しない。この判定基準は`.agent-skill-chain/config/agent-skill-chain.yaml`の`branch.pattern`（`{type}/{issue_id}-{slug}`。`type`は`issue.allowed_types`列挙、`slug`は`[a-z0-9-]`長さ上限付きという、`src/lib/worktree.ts`の`branchNameRegex()`が使うより厳密な正規表現）とは別物であり、sedによる抽出可否のみで判定される。例えば`wip/123-foo`のような`branch.pattern`非適合のブランチ名でも、sed抽出自体は`ISSUE-123`に成功し本ACのGivenを満たさない（＝本ACの拒否対象にはならない）
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
- When: 実装時点でオープンだったIssue駆動PR（#345等、レビュー未確定（`final=human_required`）のゲートを持つもの）の`verify-and-publish`を再実行または新規pushで再評価する。あわせて、dependabotが作成した既存のオープンPR（存在する場合）を確認する
- Then: 未確定ゲートを含む当該PRの`verify-and-publish`がSUCCESS（対応するCheck Runは`gate publish`が発行したaction_required——title `<gate> gate: human_required`・blockers・gate-report本文付き——であり、`Publish Check Run`ステップが実行され、Check Runの発行が1回のみで二重発行が起きていないことをジョブログで確認する）になることを目視確認できる。rejected/failしたgateが存在すれば、そのgateのCheck Runがconclusion=failureのまま維持され、ジョブ自体はSUCCESSであることも確認する。dependabot PRについては`detect-segments`が失敗せず、`verify-and-publish`が起動しない（新規Check Runが発行されない）ことを確認する
- 検証方法見込み: `manual`

#### AC-8: `gate reconcile`のunchanged分岐は、承認済み成果物のdigest不変性のみを根拠に無条件でsuccessを再発行しない

- Given: あるgateについて`reviews/<gate>.yaml`に永続化された直前のgate-reportの`gate.final`が`human_required`または`rejected`である（レビュー未確定、またはレビュー完了済みで却下）。新しいpushによる`gate reconcile`実行時、当該gateの`approved_artifacts`に記録された各pathのdigestが、新しいtarget_shaにおける実際のファイル内容のdigestと完全に一致する（＝当該gateの成果物は承認判定時点から変化していない）
- When: `gate reconcile <issue_id> <target_sha>`（`src/commands/gate.ts`の`reconcile()`）を実行する
- Then: `reconcile()`は当該gateを「unchanged」分岐として扱い、`reviews/<gate>.yaml`の`target_sha`のみを新SHAへ更新して再永続化する。GitHubモードでは`agent-skill-chain/<gate>-gate`Check Runを新target_shaへ再発行するが、そのconclusionは無条件`success`ではなく、直前に永続化された`gate.final`の実際の値から`checkRunConclusionForFinal()`により導出する（`final=approved`のときのみ`success`、`final=rejected`のときは`failure`、`final=human_required`（実運用に加えリテラル`pending`の場合も含む）のときは`action_required`）。承認済み成果物のdigestが不変であることは、そのgateが以前approvedだったことを意味せず、unchanged判定はconclusionをsuccessへ昇格させる根拠にならない
- 検証方法見込み: `automated`（`reconcile()`のunchanged分岐におけるconclusion導出は`test/integration/reconcile.test.ts`のCLIレベル統合テストで検証可能であり、GitHub Actionsの実行を必要としない）

#### AC-9: `final=approved`だが`conformance`/`falsification`が両`pass`でない矛盾したgate-reportは、非pending違反としてジョブをFAILUREにする

- Given: あるgate-reportの`gate.final`が`approved`であるが、`gate.conformance`または`gate.falsification`が`pass`でない（`pending`または`fail`のまま）。gate-report自体はスキーマに適合し、`approved_artifacts`のdigestも`target_sha`も正当である（他の非pending違反は存在しない）。これは`gate publish`（`publish()`）が既に持つ矛盾拒否ガード（final=approvedだがconformance/falsificationが両passでない場合を拒否）が本来防ぐべき、実際には生じ得ない（`deriveFinal()`はconformance/falsification両passかつblocking findingが無い場合にのみapprovedを返す）はずの、真に壊れているgate-reportである
- When: `verify-and-publish`ジョブが起動し`Verify gate report schema`ステップ（`verify gate-report`、`gateReport()`）が実行される
- Then: `gateReport()`はこの矛盾を「`final`が確定値であればconformance/falsificationの個別pendingをチェックしない」という免除の対象外とし、非pending違反（otherErrors）として計上し終了コード1を返す。これにより`Publish Check Run`ステップ（`gate publish`）の矛盾拒否ガードへ到達する前に検出され、Check Runが一つも発行されないままジョブがFAILUREになる経路（本Issueが解消しようとした失敗モードと同型の状態がこの入力パターンで再現する経路）を避ける。ジョブ自体がFAILUREになる点は他の一般的な非pending違反（スキーマ違反・digest不一致等、AC-3）と同型の扱いであり、本Issueが変更対象とする「`final=pending`の白紙スキャフォールド」「`final=human_required`の未確定状態」という*正常な*未確定状態とは異なる、*本当に壊れている*gate-reportのケースである（Check Runが発行できないままジョブが落ちる点は救済せず、他の一般的な違反ケースと同様に扱う。本Issueが新たに解決する範囲ではない）。`final=rejected`側の同種チェック（rejectedはconformance/falsificationのいずれかがfailのはず、というチェック）は意図的に対象外とする。standard profile（レビュア1体がconformance→falsificationを順に実行）でfalsification='fail'（blocking finding付き）を提出しつつconformanceの網羅チェックを完了させずpendingのまま提出することは現実的に起こり得る組み合わせであり（`gate-report.schema.yaml`上も正当、`publish()`側にもrejectedの矛盾を拒否するガードは存在しない）、これを矛盾として拒否すると正当な状態を誤って壊すため対象としない
- 検証方法見込み: `automated`（`gateReport()`の矛盾検出・終了コード判定は`test/integration/verify.test.ts`のCLIレベル統合テストで検証可能であり、GitHub Actionsの実行を必要としない）

#### AC-10: AGENTS.md「ゲートの継承・無効化」節の記述が、AC-8のconclusion導出是正と整合する

- Given: AGENTS.md「ゲートの継承・無効化」節が、`gate reconcile`のunchanged分岐について記述している
- When: 当該節の本文を確認する
- Then: 「変化なしなら最新SHAへ成功を再発行」という無条件`success`再発行を意味する記述は存在せず、変化なしの場合のconclusionは直前に永続化された`gate.final`の値（`approved`のみ`success`、`rejected`は`failure`、`human_required`・`pending`は`action_required`）から導出される旨が明記されている。AGENTS.mdの他の不変条件I1〜I8・4セグメント構造・行数上限（150行）は変更されていない
- 検証方法見込み: `manual`（AGENTS.md本文の記述内容確認。`.agent-skill-chain/ci/verify-doc-length.sh`は行数のみを機械検査するため文言の正確性はレビュアの目視確認に委ねる）

## スコープ外

- Issue #348が扱う、trust root checkoutが古いPR作成時点のbase.shaに凍結され古いCLIコードを実行してしまう問題への対応。本Issueとは別原因であり別Issueで扱う。
- `final=rejected`かつ`conformance`/`falsification`のいずれかが`pending`である組み合わせを矛盾として検出すること。standard profileでfalsification='fail'を確定させつつconformanceの網羅チェックを未完了のまま`pending`で提出することはschema上正当かつ現実的に起こり得るため、AC-9の対象から明示的に除外する。
- pendingを理由とするaction_required Check Runの内容（title/summary文言）の大幅な作り込み。既存の「evidence失敗」分岐が持つ形式を踏襲すれば足り、新たな文言規約の制定は対象外とする。
- `gate.conformance`/`gate.falsification`/`gate.final`のpending判定ロジックそのもの（`src/commands/gate.ts`の集約規則）の変更。本Issueはpending状態の検出結果をworkflow側でどう扱うかのみを対象とする。
- required statusとしてのCheck Run設定（branch protection ruleset側の設定）の変更。本Issueの対応後もCheck Run自体は引き続きrequired statusとして機能する前提であり、ruleset設定変更は対象外とする。
- `detect-segments`ジョブ内のissue_id抽出・skip判定ロジックを独立したCLIサブコマンドやスクリプトへ切り出すこと。AC-4/AC-5の検証方法をより完全に自動化する余地はあるが、これは実装方式の選択であり本Issueのスコープでは要求しない。
