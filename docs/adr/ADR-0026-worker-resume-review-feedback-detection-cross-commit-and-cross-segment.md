# ADR

```yaml
id: ADR-0026
status: accepted
title: resumeしたセグメント作業ワーカーへの既存レビューフィードバック検出は、commit跨ぎのコメント除外を行わずローカルモードは全segmentのgate reportをorigin基準で走査する
tags: [worker-resume, review-status, github-backend, local-backend, i5-progression-role-purity]
supersedes: [ADR-0025]
superseded-by: null
deprecated-reason: null
```

## Context

ADR-0025（Issue #446、本ADRと同一Issue）は、resumeされたセグメント作業ワーカーへ同梱する「未対応の既存レビューフィードバック」の判定基準を、(a) 単純コメントは「対象ブランチの最新commit時刻（`git log -1 --format=%cI HEAD`）より`createdAt`が後のもの」、(b) ローカルモードは「対象segmentと同名のgate report（`reviews/<segment>.yaml`）の`gate.blockers`が非空であること」と確定した。ADR-0025のConsequences節は(a)について「workerが（レビューへの対応ではなく）無関係な理由で新しいcommitを積んだ直後に古いコメントへの対応がまだ済んでいない場合、そのコメントは次回resumeで『未対応』として再表示されなくなる（取りこぼし）」という限界を明示し、「必要になった時点で別Issueとする」としていた。

2026-08-05、Issue #446自身のPR #447に対するimplementation-gate（strict、独立2レビュア）で、両レビュアが一致して次の2件の実装上のblocking findingを検出した。

1. `SINCE_CUTOFF_DROPS_UNADDRESSED_FEEDBACK`: 上記(a)の限界がまさに顕在化する反例（レビュアがT1にコメント→workerが未対応のままT2(>T1)に無関係なcommitを実行→再開時のsince基準ではT1のコメントが消える）が、本Issue自身が防ごうとしている「commit済みであることのみを根拠に完了と判定する」失敗モードを検出機構自身が再導入していると指摘された。
2. `LOCAL_MODE_READS_ONLY_SAME_SEGMENT_GATE_REPORT`: 上記(b)の「同名gate reportのみ」という基準では、AGENTS.mdが定める`finding.origin`基準の差し戻し（例: implementationゲートが`origin: specification`のblocking findingを検出し、進行役がspecセグメントへ差し戻すケース）で、差し戻し先のワーカーが自分のセグメント名と異なるgate report（この例では`reviews/implementation.yaml`）に記録されたblocking findingを一切参照できないという欠落が指摘された。

いずれの指摘も、ADR-0025のDecision本文が明記した判定基準そのものに起因する。ADR-0025は設計ゲート承認済み（`status: accepted`）でありDecision本文は不変であるため、本文修正ではなく本ADR（新規、`supersedes: [ADR-0025]`）によって決定を置き換える。

2026-08-05、本ADR初版（コメント時刻カットオフ廃止・ローカル全segment走査の2点のみを決定）に対する design-gate（strict、独立2レビュア）が、いずれも `falsification: fail` で次のblocking findingを検出した。(i) DESIGN.mdが「時刻カットオフを廃止した」と決定しながら、依存関係・mermaid・コンポーネント責務の記述にcommit時刻取得（`git log -1`）を入力源として残しており、決定と設計要素が同一成果物内で矛盾していた。(ii) GitHubモードで対象branchにOPENなPRがまだ無い場合（例: spec segmentのDraft PR作成前）、Issueコメントの取得自体が行われず、本Issueが解消対象とする「resumeしたworkerがフィードバックを一切参照しない」失敗モードがこのケースで再現し得た。(iii) ローカルモードのgate report読み込みに使う関数名・失敗意味論がDESIGN.md内で2箇所で食い違っていた。(iv) `resolveCurrentBranch()` の失敗（detached HEAD等）の扱いが未定義だった。本ADRはこれらを是正し、Decisionへ反映する。

2026-08-05、上記是正を反映したDESIGN.md（Issue側／PR側の分離を導入した版）に対する design-gate（strict、独立2レビュア）が再度実行され、両レビュアが独立に次の実質的に同一の欠陥を指摘した（一方は`blocking`、他方は`warning`）: `PARTIAL_FAILURE_DISCARDS_DETECTED_FEEDBACK`／`PARTIAL_SUCCESS_DISCARDED_ON_ONE_SIDE_FAILURE`。「Issue側／PR側の分離」の合成規則が「いずれかが失敗すれば`detection: 'failed'`」とのみ規定しており、他方の経路で実際に検出済みの`unresolved_reviews`/`unresolved_comments`を保持するか破棄するかを規定していなかった。反例: PR側でレビュアが`CHANGES_REQUESTED`を出した状態で、Issue側`gh issue view`が一時的なレートリミットで失敗した場合、実際に検出できていた未対応レビューがプロンプトから消え、workerは`detection: 'failed'`の一文だけを受け取る。これは本Issue自身が解消対象とする「resumeしたworkerがレビューフィードバックを一切参照しない」失敗モードを、この合成ロジック自身が部分障害時に再導入していることを意味する。本ADRはこの合成規則を是正し、Decisionへ反映する（ADR本文はまだ`status: proposed`であり、design-gate承認前のためDecision本文の修正は本ADRの改版として許容される。承認後の変更が必要になった場合は別ADRで`supersedes`する）。

2026-08-05、GitHub側の部分障害合成規則を是正した版（`a139576e`）に対する design-gate（strict、独立2レビュア）が再度実行され、両レビュアが一致して次の2件のblocking findingを検出した。いずれも「一方の経路が失敗した際に既に検出済みの情報を保持する」という直前の是正と同じ原則が、他の箇所には適用されていなかったことに起因する。

1. `LOCAL_MODE_PARTIAL_FAILURE_DISCARDS_DETECTED_FINDINGS`: ローカルモードの「ローカルモードのgate report読み込み失敗時」の決定は「1つでもYAML解釈に失敗したsegmentがあればdetection:'failed'」とのみ規定しており、GitHub側で直前に是正したばかりの「成功した経路の検出結果を保持する」という部分障害合成規則が、ローカルモードの全segment走査には反映されていなかった。反例: `reviews/implementation.yaml`が正常に読め`origin: implementation`のblocking findingが記録されている一方、`reviews/spec.yaml`が壊れたYAMLの場合、現行の決定では検出済みのfindingごと`detection: 'failed'`一文に置き換わる。GitHub側とローカル側とで対称な決定にすると自ら明記していながら、実際には非対称なままだった。
2. `PR_RESOLUTION_FAILURE_SILENTLY_TREATED_AS_NO_PR`: 「`findOpenPrByHead()`が`undefined`を返す場合はPR未作成として扱う」という決定は、branch解決失敗について直前に確定した「区別できない失敗を『無し』と同一視しない」という原則（AC-5）と矛盾する。`findOpenPrByHead()`の`undefined`は「PRがまだ存在しない（正常系）」と「`gh pr view`呼び出し自体が失敗した（異常系）」を区別しないため、Issue側コメントが0件の状態でPR側に一時的な`gh`障害が起きると、実在するかもしれない`CHANGES_REQUESTED`や未対応コメントが「PR未作成」として静かに0件扱いされ、本Issueが解消対象とする失敗モードが再現し得る。同一クラスの指摘が2ラウンド連続で発生したため、本ADRはこの決定を先送りせずここで是正する。

2026-08-05、PR側の直接`gh pr view`呼び出しへ是正した版（`691e63a8`）に対する design-gate（strict、独立2レビュア）が再度実行され、1名がblocking findingを検出した（もう1名はwarningのみ）。

3. `PR_RESOLUTION_NOT_BOUND_TO_TARGET_ISSUE`: PR側は`resolveCurrentBranch()`が返す現在のbranch名だけを鍵に`gh pr view <branch>`を呼ぶ設計であり、解決されたbranch・PRが対象Issue（`detectGithubReviewStatus(root, issueNumber)`の`issueNumber`引数）に紐づくものであることを検証する手順が設計要素に一切無かった。反例1（誤検出、AC-4/AGENTS.md I4違反）: `segment start`が対象Issueとは異なるbranch（`main`や他Issueの`feature/441-...`）へcheckoutされたworktreeで実行されると、そのbranchのPRのレビュー・コメントが対象Issueへの「対応が必要な既存レビュー」として誤ってworkerプロンプトへ同梱される（AGENTS.md I4「1 Issue = 1 ブランチ = 1 worktree = 1 PR」の前提崩れを検出できない）。反例2（握りつぶし、AC-2/AC-3/AC-5違反）: 同じ状況で`gh pr view <branch>`が`no pull requests found`で失敗した場合（例: 対象branchが`main`）、「PR未作成＝非失敗・成功・0件」に分類され、対象Issueの実際のPRに存在するかもしれない未対応レビュー・コメントが警告なしに「無い」として握りつぶされる。branch解決自体の成否では検出できない失敗モードのため、本ADRはこれを是正する。

2026-08-05、PR側のIssue紐づけ検証を反映した版（`23ed2457`）に対するdesign-gate（strict、独立2レビュア）が再度実行され、両レビュアともプロンプト展開の一部truncationにより`inconclusive: true`（SPEC.md本文・ADR本文の一部が展開されず検証不能）となったが、展開済みテキストのみから確認できる範囲で、レビュア1が`DESIGN_DANGLING_SCOPE_SECTION`（blocking、DESIGN.mdが自身に存在しない「スコープ外節」を複数箇所で参照し、成果物の自己完結性を欠く）を、レビュア2が`LOCAL_FINDING_PROVENANCE_LOST`（warning、ローカルモードの出力構造がcross-segmentで収集した各findingの由来ゲートを区別せず、差し戻し先workerがどのゲートを再実行すべきか判断できない）を検出した。前者はDESIGN.mdへ「対象外」節を新設し既存のあいまいな参照を是正する編集上の対応で足り、Decision（判定基準そのもの）の変更を伴わない。後者はローカルモードの出力データ構造にフィールドを追加する必要があり、本ADRのDecisionに影響するため、以下に選択肢を追加する。

検討した選択肢（(a)コメント判定について）:

1. **since基準を維持する（ADR-0025のまま）**: 既知の取りこぼしを引き続き受け入れる。本Issueの目的（resumeしたworkerが既存レビューフィードバックを確実に確認する）そのものを損なう既知の欠陥を放置することになり、implementation-gateの指摘と正面から矛盾するため不採用。
2. **since基準を「コメント投稿時点で存在した最新commit」に変更する**: 各コメント個別の投稿時刻と、その時点でのHEAD commitを比較する方式。これでも「投稿直後に無関係なcommitが1つ挟まる」ケースを救えない点はADR-0025と同型の欠陥が残るため不採用。
3. **「対応済み」を判定するための新規永続状態（例: 対応済みコメントIDを記録するファイル）を導入する**: SPEC.mdのスコープ（「本対応は進行役による成果物内容の著述・取り込みを新設しない。プロンプトへ含める内容はCoordination Backend側が既に保持する調整状態の転記に限る」）に反し、Coordination Backendが保持しない新しい調整状態を追加することになるため不採用。
4. **時刻によるカットオフを廃止し、定型marker（`<!-- agent-skill-chain:`）で始まらない全コメントを常に「未対応」とみなす（採用）**: GitHubのコメントAPIには解決状態が無い以上、時刻ベースの近似はいずれも取りこぼしを生む。時刻カットオフ自体を廃止すれば取りこぼしは原理的に発生しない。トレードオフとして、既に別の手段（例えば直後のcommitメッセージでの言及）で実質的に対応済みのコメントも次回resumeのたびに再掲され続けるが、内容がそのままプロンプトに含まれるためworker・進行役が「既に対応済み」と判断して読み飛ばせる。ADR-0025のConsequences節が既に「過検出は内容が見えるため気付ける」という同種の理由で許容していたトレードオフの延長であり、AC-4（レビュー・コメントが実際に存在しない場合の誤検出禁止）は「PR/Issueコメントが1件も無い」ケースを要求するのみで、「過去に存在したコメントを繰り返し示さない」ことまでは要求しない。

検討した選択肢（(b)ローカルモードのgate report走査について）:

1. **同名gate reportのみを読む（ADR-0025のまま）**: origin基準の差し戻しという主用途を機械的に検出できず、AGENTS.mdが定める差し戻し機構の一部が実質的に機能しない。不採用。
2. **全segmentのgate reportを走査し、origin値が起動対象segment（差し戻し先）と一致するblocking findingのみを収集する（採用）**: `origin`列挙値（`specification|design|implementation|validation`）とsegment名（`spec|design|implementation|validation`）は`spec`↔`specification`を除き1:1対応するため、追加のマッピング表は`spec`↔`specification`の1エントリのみで済む。走査対象を全segmentに広げても、フィルタ条件（origin一致）は変わらないため誤検出（無関係なblocking findingの混入）は生じない。

検討した選択肢（(c) GitHubモードのIssue側／PR側検出について、design-gate指摘を受けて追加）:

1. **現状どおり、PRが解決できなければIssueコメントの検出も省略する**: 実装が単純だが、Draft PR作成前（spec segment初回起動時等）に投稿されたIssueコメントへのフィードバックを一切検出できず、本Issueが解消対象とする失敗モードがこのケースで再現する。design-gateのblocking finding（`ISSUE_COMMENTS_UNREACHABLE_WITHOUT_PR`）と正面から矛盾するため不採用。
2. **PR解決を先に試み、失敗時のみIssueコメントを個別取得するフォールバックにする**: PR解決の成否によって呼び出し回数・経路が変わり、`gh`呼び出しが2通りの組み合わせ（PR有り時はissue呼び出しを省略する等）になり得るため、失敗経路の網羅がテストしにくくなる。
3. **Issue側とPR側を常に独立した経路として実行し、結果を合成する（採用）**: Issue側は`resolveCurrentBranch`・PR解決の成否に関わらず常に`gh issue view`を1回呼ぶ。PR側は解決できた場合のみ実行する。呼び出し回数は「PR解決成功時2回（issue view + pr view）、失敗・未作成時1回（issue viewのみ）」で決定的であり、経路が分岐しないためテストしやすい。`gh`呼び出しが従来より最大1回（Issue側）増えるが、Issueコメント取得は元々AC-3の要求に含まれていたものであり新規のAPI負荷ではない。

検討した選択肢（(d) Issue側／PR側の一方のみが失敗した場合の合成方針について、design-gate指摘（`PARTIAL_FAILURE_DISCARDS_DETECTED_FEEDBACK`／`PARTIAL_SUCCESS_DISCARDED_ON_ONE_SIDE_FAILURE`）を受けて追加）:

1. **一方でも失敗すれば全体を`detection: 'failed'`とする（初版の決定のまま）**: 実装・出力型が単純だが、他方の経路で実際に検出済みの未対応レビュー・コメントまで一律で破棄することになる。反例: PR側で`CHANGES_REQUESTED`が検出できていても、Issue側の一時的なレートリミットだけで、その検出結果ごと消えてプロンプトには`detection: 'failed'`の一文しか残らない。本Issue自身が解消対象とする失敗モード（resumeしたworkerがフィードバックを一切参照しない）を合成ロジックが部分障害時に再現するため不採用。
2. **成功した側の検出結果を保持し、失敗した側を`partial_failures`として付加する（採用）**: 出力型は`detection: 'succeeded'`に`partial_failures`（非空の場合のみ）を加える形になり、両方失敗時のみ`detection: 'failed'`を返す。型がやや複雑になるが、成功側の検出結果を破棄しないためAC-2/AC-3の要求（検出漏れしない）とAC-5の要求（失敗を隠さない）を同時に満たせる唯一の案である。

検討した選択肢（(e) ローカルモードの全segment走査における部分障害の合成方針について、design-gate指摘`LOCAL_MODE_PARTIAL_FAILURE_DISCARDS_DETECTED_FINDINGS`を受けて追加）:

1. **1segmentでも読み込みに失敗すれば全体を`detection: 'failed'`とする（初版の決定のまま）**: 実装は単純だが、他segmentで既に収集済みのblocking findingまで一律で破棄する。GitHubモードで直前に是正した「成功側の検出結果を保持する」原則と非対称になり、design-gateの指摘と正面から矛盾するため不採用。
2. **読み込みに成功したsegment（ファイル不存在＝0件を含む）から収集したblocking findingを保持し、読み込みに失敗したsegmentがあれば`local_read_failures`として付加する。全segmentの読み込みが失敗した場合のみ`detection: 'failed'`とする（採用）**: GitHubモードの`partial_failures`と対称な決定になる。`spec`/`design`/`implementation`/`validation`という有限（4つ）のsegment集合を毎回全走査するため、「一部成功・一部失敗」と「全滅」を機械的に判定できる。既に収集済みのfindingを保持したまま読み込み失敗の事実も隠さないため、AC-6（findingの検出・同梱）とAC-5（失敗を隠さない）を同時に満たす。

検討した選択肢（(f) `findOpenPrByHead()`の`undefined`が「PR未作成」と「`gh`呼び出し失敗」を区別しない問題について、design-gate指摘`PR_RESOLUTION_FAILURE_SILENTLY_TREATED_AS_NO_PR`を受けて追加）:

1. **現状の決定を維持し、`undefined`を一律「PR未作成」として扱う（初版の決定のまま）**: branch解決失敗について「区別できない失敗を『無し』と同一視しない」と決定していながら、PR解決失敗についてだけ同一視を許容しており矛盾する。一時的な`gh`障害が実在するPRのレビュー・コメントを静かに0件扱いする余地を残すため不採用。
2. **`gh-open-pr.ts`の`findOpenPrByHead()`自体の戻り値をエラー区別可能な形（例: 判別可能なunion型）へ変更する**: release bump（Issue #196）・root-cleanup run（Issue #208）という既存呼び出し元が`OpenPr | undefined`という現行の戻り値契約に依存しており、契約変更はこれらの既存呼び出し元の変更・再検証を伴う。本Issueのスコープ（resumeしたworkerのレビューフィードバック検出）を超えて無関係な既存機能への影響を広げるため不採用。
3. **`review-status.ts`のPR側検出は`findOpenPrByHead()`を経由せず、`gh pr view <branch> --json number,state,headRefName,latestReviews,comments`を直接1回呼び、終了コード・stderr・JSONを自前で解釈する（採用）**: `gh-open-pr.ts`・その既存呼び出し元には一切手を加えない。`gh pr view <branch>`がbranchに対応するPRを解決できない場合、`gh` CLIは終了コード非ゼロかつstderrに`no pull requests found`を含む既知の固定文言を出力する（他の失敗要因、例: 認証切れ・ネットワーク障害・レートリミットのstderrはこの文言を含まない）。この文言に一致する場合のみ「PR未作成（成功・0件）」とし、一致しない非ゼロ終了・JSON解釈失敗はすべて「失敗」として扱う。`gh` CLIの将来のメッセージ文言変更により誤って「失敗」側へ倒れたとしても、それは安全側（AC-5が優先する「わからないものは隠さない」）であり、逆に「未作成」側の誤判定（実際の失敗を隠す）より許容できる。既存の`gh pr view --json latestReviews,comments`呼び出し（設計上PR解決成功後に別途行っていたもの）をこの1回の呼び出しへ統合できるため、GitHub API呼び出し回数も従来設計（成功時2回）から1回へ減る。

検討した選択肢（(g) PR側で解決したbranch・PRが対象Issueに紐づくことの検証について、design-gate指摘`PR_RESOLUTION_NOT_BOUND_TO_TARGET_ISSUE`を受けて追加）:

1. **検証を行わない（初版の決定のまま）**: `resolveCurrentBranch()`が非空を返せば対象Issueのbranchであるとみなす。1 Issue = 1 branch = 1 worktreeであることは運用上の前提だが、この前提が崩れた状態（進行役の`cd`誤り等）を検出する機構が無く、design-gateの指摘と正面から矛盾するため不採用。
2. **`gh-open-pr.ts`や`worktree.ts`側にIssue紐づけ検証層を追加する**: 検証ロジックを`review-status.ts`外の既存モジュールへ持ち込むと、それらモジュールの既存呼び出し元（release bump・root-cleanup run等）にも影響が及ぶ可能性があり、本Issueのスコープ（resumeしたworkerのレビューフィードバック検出）を超えるため不採用。
3. **`review-status.ts`内で、`resolveCurrentBranch()`が返すbranch名をAGENTS.mdのブランチ命名規則（`<type>/<issue-id>-<slug>`）に照らし、対象issueNumberと一致するか（正規表現 `^[^/]+/${issueNumber}-`）を`gh pr view`呼び出し前に検証する（採用）**: 既存モジュール（`worktree.ts`・`gh-open-pr.ts`）への変更を伴わず、`review-status.ts`が既に持つ`issueNumber`引数のみで判定できる。`gh pr view`呼び出し前に検証することで、無関係なIssueのPRへのAPI呼び出し自体を避けられる。不一致の場合はbranch解決失敗と同じ「明示的な失敗」経路へ合流させるため、既存の合成規則（Issue側／PR側の分離）をそのまま再利用でき、新たな出力型の分岐を追加する必要が無い。

検討した選択肢（(h) ローカルモードで収集する各blocking findingの由来ゲートを区別するかについて、design-gate指摘`LOCAL_FINDING_PROVENANCE_LOST`を受けて追加）:

1. **由来ゲートを区別しない（初版の決定のまま）**: `unresolved_blocking_findings`の各要素は起動対象segmentと同じ単一の`gate`フィールドの下に並び、実際にどのgate reportから収集されたかは出力に現れない。差し戻し先workerが是正後にどのgateの再実行を進行役へ依頼すべきか、finding本文の自然文記述のみから推測する必要があり、AGENTS.md I1（追跡可能性）の観点で機械的な追跡性が弱い。不採用。
2. **各findingに由来segment名を`source_segment`として付加する（採用）**: `detectLocalBlockingFindings()`が`spec`/`design`/`implementation`/`validation`のどのgate reportからfindingを収集したかは走査時点で既知の情報であり、追加のAPI呼び出し・ファイル読み込みを伴わずに各finding要素へ付加できる。差し戻し先workerは`source_segment`を見て是正後にどのgateの再実行が必要かを機械的に判断できる。

## Decision

resumeされたセグメント作業ワーカーへ同梱する「未対応の既存レビューフィードバック」の判定基準を、ADR-0025の決定を置き換えて次のとおり確定する。

- **レビュー（Approve/Request Changes）**: ADR-0025の決定を維持する。`gh pr view <pr> --json latestReviews` が返すreviewer毎の最新reviewのうち、`state === 'CHANGES_REQUESTED'` のものを未対応として扱う。
- **単純コメント（Issue・PR双方）**: 対象ブランチの最新commit時刻による時刻カットオフを廃止する。コメント本文が定型marker（`<!-- agent-skill-chain:` で始まる行。worker完了報告・gate-review-evidence双方が用いる既存prefix）で始まらない限り、作成時刻に関わらず常に「未対応」として扱う。時刻カットオフの廃止に伴い、`git` 呼び出し（commit時刻取得）は判定・出力のいずれからも完全に除去する——「時刻カットオフは行わないが commit時刻は参考情報として残す」という中間案は採らない。中間案は、廃止したはずの入力源を設計・実装へ残置させ、design-gateが指摘した「決定と設計要素の矛盾」を再発させるため不採用とする。
- **Issue側とPR側の検出を分離する**: GitHubモードではIssueは常にPRより先に存在する（Draft PRはspec workerが最初のcheckpointをpushした後にしか作られない）。「PRが解決できなければIssueコメントの検出も行わない」という一体化した設計では、Draft PR作成前に投稿されたIssueコメントへのフィードバックが検出できず、本Issueが解消対象とする失敗モードがこのケースで再現する。したがって、Issue側コメント検出（`gh issue view --json comments`）とPR側検出（`resolveCurrentBranch` → `findOpenPrByHead` → `gh pr view --json latestReviews,comments`）を独立した経路として実行し、結果を合成する。Issue側は常に実行し、PR側は解決できた場合のみ実行する。
- **branch解決失敗はPR未作成と区別する**: `resolveCurrentBranch()` が失敗する場合（detached HEAD等）、PR側を「PR未作成」（0件・非失敗）として扱うと、実際には存在するかもしれないPR側のレビュー・コメントを「無し」と偽装する（AC-5違反）ため区別し、PR側を明示的な `detection: 'failed'` として扱う。
- **PR側の解決は`findOpenPrByHead()`を経由せず、`review-status.ts`が`gh pr view <branch> --json number,state,headRefName,latestReviews,comments`を直接1回呼ぶ**（2026-08-05再改定、design-gate指摘`PR_RESOLUTION_FAILURE_SILENTLY_TREATED_AS_NO_PR`）: `gh-open-pr.ts`の`findOpenPrByHead()`・その既存呼び出し元（release bump・root-cleanup run）は変更しない。終了コードが非ゼロで、かつstderrが`gh` CLIの固定文言`no pull requests found`に一致する場合のみ「PR未作成（成功・0件、branch解決成功時のPR側の正常系）」として扱う。それ以外の非ゼロ終了（認証切れ・ネットワーク障害・レートリミット等）およびJSON解釈失敗は「失敗」として扱う。state が `OPEN` でない場合（closed/merged）は既存の`findOpenPrByHead()`と同じ扱い（PR側0件、非失敗）とする。branch解決失敗の扱い（直前の決定）と同じ「区別できない失敗を『無し』と同一視しない」原則を、PR解決失敗にも一貫して適用する。
- **PR側で解決したbranch・PRが対象Issueに紐づくものであることを検証する**（新設、2026-08-05再改定、design-gate指摘`PR_RESOLUTION_NOT_BOUND_TO_TARGET_ISSUE`）: `resolveCurrentBranch()`が返すbranch名を、`gh pr view <branch>`呼び出しより前に、AGENTS.mdのブランチ命名規則（`<type>/<issue-id>-<slug>`）へ照らし対象issueNumberと一致するか（正規表現 `^[^/]+/${issueNumber}-`）を検証する。一致しない場合は「PR未作成」とは扱わず、branch解決失敗と同じ明示的な失敗（理由に不一致であることを明記）として扱う。`resolveCurrentBranch()`が非空を返すこと自体は「対象Issueのbranchである」ことを保証しないため、branch解決の成否とは別に検証する。
- **検出処理自体が失敗した場合**（Issue側の`gh`呼び出し失敗・JSON解釈失敗、またはPR側のbranch解決失敗・branchの対象Issue不一致・`gh`呼び出し失敗・JSON解釈失敗）: Issue側・PR側それぞれを「成功（0件以上のデータを実際に取得できた。PR側の『PR未作成』も非失敗の成功として扱う）」「失敗」に正規化したうえで、次のとおり合成する（ADR-0025の決定を置き換える）。
  - 両方失敗した場合のみ、検出結果を「未対応が無い」として扱わず`detection: 'failed'`（両側の失敗理由を含む`reason`）として明示的にプロンプトへ含める。
  - 一方が成功・他方が失敗した場合は、`detection: 'succeeded'`とし、成功した側で実際に検出済みの未対応レビュー・コメント（0件でもよい）をそのまま保持したうえで、失敗した側の理由を`partial_failures`として付加する。他方の一時的な障害を理由に、既に検出できていたフィードバックを破棄してはならない——これは本Issue自身が解消対象とする失敗モード（resumeしたworkerがフィードバックを一切参照しない）を合成ロジック自身が部分障害時に再導入することを防ぐための決定である。
- **ローカルモードのgate report走査**: 起動対象segment（差し戻し先）と同名のgate reportだけでなく、`spec`/`design`/`implementation`/`validation` 全segmentのgate report（`reviews/<segment>.yaml`）を走査し、`gate.blockers` のうち `origin` が起動対象segmentに対応する値（`spec`→`specification`、それ以外は同名）と一致する `severity: blocking` のfindingのみを収集する。収集した各findingには、由来元のgate reportのsegment名を`source_segment`として付加する（design-gate指摘`LOCAL_FINDING_PROVENANCE_LOST`是正）。
- **ローカルモードのgate report読み込み失敗時**: `tryReadYamlFile()`（`src/lib/yaml-io.ts`、既存・変更なし）を用いる。同関数は「ファイル不存在」時は例外を投げず`undefined`を返し、「ファイルは存在するがYAML解釈に失敗」した場合は例外を投げる既存挙動を持つ。前者（ファイル不存在）はそのsegmentにgate report自体が無い正常系として「0件」で継続し、後者（YAML解釈失敗）のみをsegment単位で捕捉し失敗として扱う。読み込みに成功したsegment（ファイル不存在による0件を含む）から収集した`origin`一致のblocking findingは、他のsegmentの読み込みが失敗していても保持する（2026-08-05再改定、design-gate指摘`LOCAL_MODE_PARTIAL_FAILURE_DISCARDS_DETECTED_FINDINGS`。GitHub側の「Issue側／PR側の一方のみが失敗した場合の合成方針」と対称にする）。`spec`/`design`/`implementation`/`validation`の全4segmentの読み込みがすべて失敗した場合のみ`detection: 'failed'`とする。1segmentでも読み込みに成功していれば`detection: 'succeeded'`とし、収集済みのblocking finding（0件でもよい）をそのまま保持したうえで、読み込みに失敗したsegment名・理由を`local_read_failures`（非空の場合のみ付加するフィールド）として明示する。ADR-0025では「blocker無し」と区別せずundefinedを返す設計だったが、AGENTS.md I8（安全側ラチェット）に照らし、検出失敗と検出結果ゼロを区別しない状態、および部分障害時に既に検出済みの情報を破棄する状態はいずれも是正する。

## Consequences

- 利点: コメント判定の時刻カットオフ廃止により、「未対応フィードバックが無関係なcommitの存在によって不可視化される」という、本Issue #446自身が解決対象とする失敗モードと同型の取りこぼしが原理的に発生しなくなる。ローカルモードの全segment走査により、AGENTS.mdが定めるorigin基準の差し戻し機構が実際に機能するようになる。Issue側／PR側の検出分離により、Draft PR作成前でも進行役の修正依頼コメントが検出可能になり、AC-3の要求範囲が実装可能になる。Issue側・PR側の一方のみが失敗した場合に成功側の検出結果を保持する合成規則、およびそれと対称なローカルモードの全segment走査における部分障害合成規則により、一時的な障害が、既に検出できていた未対応フィードバックを不可視化する（本Issueが解決対象とする失敗モードと同型の退行）ことをGitHub・ローカル両モードで防ぐ。`findOpenPrByHead()`を経由しない直接`gh pr view`呼び出しへの変更により、PR側の一時的な障害を「PR未作成」として握りつぶす経路も解消し、GitHub API呼び出し回数もPR解決成功時2回から1回へ削減される。branchが対象Issueに紐づくものであることの検証により、AGENTS.md I4（1 Issue = 1 ブランチ = 1 worktree = 1 PR）の前提が崩れた状態（誤ったworktree・branchでの`segment start`実行）を、無関係なIssueのレビュー・コメントを誤って同梱する、または対象Issueの実際の未対応フィードバックを握りつぶす、のいずれの方向にも倒さず明示的な失敗として検出できるようになる。ローカルモードで収集する各findingに`source_segment`を付加することで、差し戻し先workerが是正後に再実行を依頼すべきゲートを機械的に特定できるようになる（AGENTS.md I1 追跡可能性）。
- 欠点・limitation:
  - ローカルモードのcross-segment走査は、由来元のゲートが再実行され`reviews/<segment>.yaml`が更新されるまでの間、是正済みのfindingが`source_segment`付きのまま次回resumeで繰り返し検出され続ける（過検出）。コメント側の時刻カットオフ廃止トレードオフと同様の性質（見せすぎる方が安全側）であり、AC-6の要求とは競合しない（AGENTS.md I8）。
  - コメント判定は時刻カットオフを廃止したことで、既に別の手段で実質的に対応済みの過去コメントも、そのPRが存在する限り毎回のresumeで再掲され続ける（過検出）。内容がそのままプロンプトに含まれるため、worker・進行役が既知の対応済みコメントと判断して読み飛ばせることを前提とする。プロンプト肥大化のトリミング戦略はSPEC.mdスコープ外節のとおり引き続き別Issue対応とする。
  - ローカルモードの全segment走査は、対象Issueのsegment数（最大4ファイル）分のファイル読み込みが増えるが、いずれも小さいYAMLファイルでありパフォーマンス上の懸念は無い。
  - PR側の「PR未作成」判定は`gh` CLIが出力するstderrの固定文言`no pull requests found`への一致に依存する。将来の`gh` CLIバージョンでこの文言が変更された場合、実際にはPRが単に存在しないだけのケースが「失敗」側へ倒れる（stderr不一致→失敗扱い）が、これは安全側（AC-5）であり、逆方向（実際の失敗を「PR未作成」として握りつぶす）より許容できる。
  - 出力の型が`detection: 'succeeded' | 'failed'`の二値から、`partial_failures`（GitHubモード）・`local_read_failures`（ローカルモード）という付加フィールドを持つ形へ複雑化する。worker（プロンプトの読み手）は「検出結果が存在するが一部の経路は失敗している」という中間状態を理解する必要がある。
  - branchが対象Issueに紐づくものであることの検証は、AGENTS.mdのブランチ命名規則（`<type>/<issue-id>-<slug>`）への正規表現一致にのみ依存する。将来ブランチ命名規則自体が変更された場合、本検証も追随して変更する必要がある。
- follow-up: 過検出が実運用で許容できないほど頻発する場合、コメント単位の既読管理（新規永続状態の導入）を別Issueで検討する余地がある（本ADRの選択肢3を参照）。`gh` CLIの`no pull requests found`文言が実運用で一致しなくなった場合、`gh-open-pr.ts`側の戻り値契約自体を変更する対応（本ADR選択肢(f)-2）を別Issueで検討する余地がある。

---

## accepted 後の不変項目・可変項目

| 区分 | 項目 |
|---|---|
| 不変（accepted 後は変更不可） | `id`、Context、Decision、Consequences、`supersedes` |
| 可変（ライフサイクル遷移に伴い更新可） | `status`、`superseded-by`、`deprecated-reason`、`tags` |

本文（Context / Decision / Consequences）の変更が必要になった場合は、新しい ADR を作成し `supersedes` / `superseded-by` で旧 ADR との関係を記録する。既存 ADR の本文を書き換えてはならない。

## ライフサイクル

```text
DESIGNワーカー   → ADR を proposed で作成
設計レビュア     → ADR 本文をレビュー（read-only）→ content digest を承認
進行役           → adr-finalize.sh を起動
ADR finalization → writer lease を取得 → status を accepted へ更新
ワーカー           → commit・push → content digest を再検査
```

- `proposed → accepted`: 設計ゲート承認時に遷移する。設計レビュアは ADR 本文をレビューし content digest を承認するのみ（read-only、直接 status を書き換えない）。進行役が `.agent-skill-chain/scripts/adr-finalize.sh` を起動し、専任の ADR finalization ワーカーが writer lease を取得したうえで `status` のみを `accepted` に更新して commit・push する（`.agent-skill-chain/config/roles.yaml` の `adr_finalization_worker`、`scope: adr_status_only`）。finalization ワーカーは書込み前に content digest を再検査する。
- `accepted → superseded`: 新しい ADR を含む同一 PR 内で、新 ADR の作者（ワーカー）が旧 ADR の `status` / `superseded-by` を同一 PR で更新する。`supersedes` ⇔ `superseded-by` の対称性・参照先の実在が機械検査される。
- `accepted → deprecated`: 前提が消滅し後継が無い場合に遷移する。`deprecated-reason` に1行の理由を記録する（存在検査あり）。

## related_adrs 参照ルール

他 Issue の `DESIGN.md` から本 ADR を参照する場合は `related_adrs:` フィールド（構造化リスト）を用いる。stale 参照検査（`adr-lint.sh check`）はこのフィールドのみを対象とし、`accepted` の ADR のみ参照可能とする。本文中の自然文による歴史的言及（例: 「本決定は ADR-0007 を置き換える」）は検査対象外であり許可される。
