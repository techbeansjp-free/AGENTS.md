# DESIGN: bugfix: resumeしたsegment workerがPR/Issueのレビューフィードバックを一切参照せず静的completion checklistだけで完了と自己判定する

- Issue: `ISSUE-446`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1（全セグメント作業ワーカー（spec_worker/design_worker/implementation_worker/validation_worker）のrole_contractに再開時レビュー確認ルールが常に含まれる。SPEC.md AC-1が対象を明示的にこの4ワーカーへ限定しており、`adr_finalization_worker`等の他roleは対象外） | `.agent-skill-chain/config/roles.yaml` の `role_contracts.{spec_worker,design_worker,implementation_worker,validation_worker}.rules` への静的行追加 | backend・検出成否に関わらず常に含まれる最小対応（SPEC要件1）。既存の `loadRoles`／`toYamlString` 経路をそのまま通るため新規コードは不要。 |
| AC-2（GitHubモード：未対応レビューの検出・同梱） | `src/lib/review-status.ts`（新規）`detectGithubReviewStatus()` の `unresolved_reviews` | `gh pr view <pr> --json latestReviews` はreviewer毎の最新reviewのみを返す（GitHub自身のマージブロック判定と同じ基準）ため、追加の重複排除ロジックを持たない。 |
| AC-3（対象Issue/PRの未対応コメントの検出） | 同モジュール `detectGithubReviewStatus()` の `unresolved_comments` | PRコメント（`gh pr view --json comments`）とIssueコメント（`gh issue view --json comments`）の双方を対象にし、定型marker始まりでないものはすべて「未対応」とみなす（時刻カットオフは行わない。下記「未対応の判定基準」参照、ADR-0026）。Issueコメントの取得はPRの存在・解決に依存しない独立した経路とする（Issueは常にPRより先に存在するため。下記「Issue側／PR側の分離」参照）。 |
| AC-4（誤検出しない） | 同モジュールの判定ロジック自体（`state !== 'CHANGES_REQUESTED'` を除外・`<!-- agent-skill-chain:`定型marker始まりのコメントを除外）＋ `src/commands/segment.ts` 側で空配列時はブロック自体を省略 | 「対応が必要な既存レビューが存在する」という虚偽の通知を作らないためには、該当が無い場合にセクション自体を出力しないのが最も確実（`buildIssueBlock` が採る既存パターンと同じ方針）。marker除外の根拠は「未対応の判定基準」節参照。時刻カットオフを廃止したため「過去に存在したコメントを繰り返し示さない」ことは要求しない（AC-4は「コメントが実際に存在しない場合の誤検出禁止」のみを要求、ADR-0026）。 |
| AC-5（検出失敗時の安全側継続） | 同モジュールが `gh` 呼び出し失敗・JSON解釈失敗を、他方の経路が成功していれば `{ detection: 'succeeded', ..., partial_failures: [...] }` の一部として、両方失敗していれば `{ detection: 'failed', reason }` として明示的に返す。ローカルモードも対称に、1segmentでも読み込みに成功していれば `{ detection: 'succeeded', ..., local_read_failures: [...] }`、全segment読み込み失敗時のみ `{ detection: 'failed', reason }` を返す。`segment start`（`src/commands/segment.ts`）は例外を投げずこの値をそのままプロンプトへ含め、AC-1の静的ルール追加（roles.yaml）とは独立に動作を継続する | 「握りつぶし」には2種類ある——(1) 検出失敗を「未検出（＝レビュー無し）」として扱うこと、(2) 一方（または一部）の経路が失敗した際に、既に他の経路で検出済みのフィードバックまで一緒に破棄すること。本設計はいずれも行わない（下記「Issue側／PR側の分離」「ローカルモードのgate report読み込み失敗」の合成規則参照、design-gate指摘・ADR-0026再改定）。AC-4の「誤検出しない」とは競合しない（失敗は「無い」ではなく「わからない」として区別する）。 |
| AC-6（ローカルモード：gate-report上の未解決blocking findingの検出・同梱） | 同モジュール `detectLocalBlockingFindings()` | `spec`/`design`/`implementation`/`validation` 全segmentのgate report（`reviews/<segment>.yaml`、`src/lib/local-state.ts` の `reviewFilePath()`）を走査し、`gate.blockers` のうち `origin` が起動対象segment（差し戻し先）に対応する値（`spec`→`specification`、他は同名）と一致する `blocking` findingを収集する。AGENTS.mdが定めるorigin基準の差し戻し（他segment起因のblocking findingを差し戻し先が読む）を機械的に成立させるため、同名gate reportのみの走査では不十分（ADR-0026）。 |
| AC-7（実地再現シナリオでの言及付き完了判定） | 上記AC-2/AC-3/AC-5の実装が土台となる。設計要素自体は追加しない（実装・独立検証セグメントでworker-launch.shの実起動を通じて確認するhybrid検証） | SPEC「検証方法見込み: hybrid」のとおり、本ACは自動テストだけでなく実際のworker起動ログの確認を要する。DESIGN/PLANでは対応する自動化可能な設計要素（AC-2/3/5）を確実に満たすことが前提条件になる。`worker-launch.sh` はadapter（`.agent-skill-chain/adapters/{claude,codex,human}.sh`）の `launch_worker()` を呼び出し、`launch_worker()` は起動対象workerへ渡すprompt本文を得るために `_asc_cli segment start <issue_id> <segment>` を呼ぶ（`claude.sh` の `launch_worker()` で確認済み。既存・変更なし）。したがってresumeされたworkerへの`review_status`同梱は、通常の`segment start`呼び出し経路と完全に同一であり、resume専用の別経路は存在しない（design-gate指摘、2026-08-05）。 |

## 責務・境界

### コンポーネント構成

- `roles.yaml`（`.agent-skill-chain/config/roles.yaml`）: 4ワーカー共通の静的ルール文字列を保持するだけの宣言的データ。ロジックを持たない（AC-1）。
- `review-status.ts`（`src/lib/review-status.ts`、新規）: Coordination Backend（GitHub API／ローカルgate-report）から「未解決のレビューフィードバック」を検出し、プロンプトへ埋め込み可能な構造化データへ変換する責務のみを持つ。GitHub呼び出し（`gh`）・ローカルYAML読み込みの2つの入力源を抽象化し、`segment.ts` へは判定済みの結果だけを返す。コメント時刻カットオフを廃止した（ADR-0026）ため、`git` 呼び出し（commit時刻取得）は本モジュールの入力源から完全に除外する——`since` に相当する値は判定にも出力にも用いない。
- `segment.ts`（`src/commands/segment.ts`）: 既存の `buildIssueBlock`（ローカルモードのtitle/request同梱）と同列に、`review-status.ts` の結果をYAML整形して起動プロンプトへ連結するだけのオーケストレーション責務。判定ロジック自体は持ち込まない。
- `gh-open-pr.ts`（`src/lib/gh-open-pr.ts`、既存・変更なし）: release bump（Issue #196）・root-cleanup run（Issue #208）が使う既存関数 `findOpenPrByHead()` は変更しない。`review-status.ts` はこの関数を経由しない——`findOpenPrByHead()` は「PR未作成」と「`gh pr view`呼び出し自体の失敗」を区別しない`undefined`を返す既存契約であり、本モジュールはこの2ケースを区別する必要があるため（下記「未対応の判定基準」参照、design-gate指摘・ADR-0026再改定）。PR解決は `review-status.ts` 内で `gh pr view <branch> --json number,state,headRefName,latestReviews,comments` を直接1回呼び、終了コード・stderr・JSONを自前で解釈する。
- `worktree.ts`（`src/lib/worktree.ts`、既存・変更なし）: 現在の作業ブランチ名解決に既存の `resolveCurrentBranch()` をそのまま再利用する。
- `local-state.ts`（`src/lib/local-state.ts`、既存・変更なし）: ローカルモードのgate-reportパス解決に既存の `reviewFilePath()` をそのまま再利用する。

責務集中の確認（反証観点）: GitHub API呼び出し・ローカルYAML読み込み・「未対応」の判定基準（CHANGES_REQUESTED判定／定型marker除外／origin一致フィルタ）はすべて `review-status.ts` 1箇所に閉じ込め、`segment.ts` は「結果を埋め込むかどうか（空なら省略）」というプレゼンテーション層の判断だけを行う。判定基準を変更する際に `segment.ts` を触る必要が無いようにする。

### 未対応の判定基準（設計判断）

SPEC.mdは「未対応のレビュー・コメント」の検出を要求するが、GitHubのコメントAPI自体には「対応済み/未対応」を表すフラグが無いため、機械的に判定可能な基準を本設計で確定する。本節の基準はADR-0025からADR-0026への置き換えを反映した最新版であり、ADR-0025が採用していた「対象ブランチの最新commit時刻より後」というコメント時刻カットオフは廃止した（理由は下記参照）。

- **レビュー（AC-2）**: `gh pr view <pr> --json latestReviews` はreviewer毎に最新の1件だけを返す。GitHubのマージブロック判定自体もこの「reviewer毎の最新state」を基準にしており、同一reviewerが後から `APPROVED` を出せば古い `CHANGES_REQUESTED` は自動的に上書きされる。したがって `latestReviews` の中で `state === 'CHANGES_REQUESTED'` のものだけを「未対応」とみなせば十分であり、追加の重複排除・時系列比較ロジックは不要。
- **コメント（AC-3）**: 単純コメント（Issue/PRいずれも）には状態フラグが無く、時刻カットオフ（「対象ブランチの最新commit時刻より後」）を採用すると、「レビュアがコメント投稿→workerが未対応のまま無関係な別のcommitを実行→再開時にはそのコメントがcutoff以前となり消える」という取りこぼしが発生する（ADR-0025のConsequences節が既知の限界として明示し、implementation-gateが実際に検出。ADR-0026参照）。これは本Issueが解消対象とする「commit済みであることのみを根拠に完了と判定する」失敗モードを検出機構自身が再導入するため、時刻カットオフ自体を廃止する。定型marker（下記）で始まらないコメントは、作成時刻に関わらず常に「未対応」とみなす。コメント判定はcommit時刻を一切参照しないため、`git`呼び出し（`git log -1`等）は本モジュールに一切登場しない（依存関係節参照、design-gate指摘、2026-08-05）。コメントのスレッド解決状態（resolved/unresolved、GraphQL専用）までは扱わない——スコープ外節「PRレビュー本文・コメント本文の要約・翻訳・NLP処理」と同様、機械的に判定可能な最小基準に留める。
- **Issue側／PR側の分離（AC-3関連の設計判断）**: GitHubモードではIssueは常にPRより先に存在する（`SPEC.md`作成→spec segment初回起動の時点でIssueは既に存在するが、Draft PRはspec workerがcheckpointをpushした後にしか作られない）。従来案のように「`resolveCurrentBranch`→`findOpenPrByHead`でPRが見つからなければIssueコメント取得も含め`review_status`全体を省略する」設計では、Draft PR作成前に進行役がIssueへ投稿した修正依頼コメントが一切検出できず、本Issueが解消対象とする失敗モードが残る（design-gate指摘、2026-08-05）。これを避けるため、`detectGithubReviewStatus()` は次の2経路を独立に実行し、結果を合成する。
  1. **Issue側（常に実行）**: `gh issue view <issueNumber> --json comments` を呼び、対象Issueのコメントを取得する。branch解決・PR解決の成否に関わらず必ず実行する。
  2. **PR側（branch解決に依存）**: `resolveCurrentBranch()` が成功した場合のみ、`gh pr view <branch> --json number,state,headRefName,latestReviews,comments` を直接1回呼び、レビュー・PRコメントを取得する。`findOpenPrByHead()`（`src/lib/gh-open-pr.ts`）は経由しない——同関数は「PR未作成」と「`gh pr view`呼び出し自体の失敗」を区別しない`undefined`を返す既存契約であり、本経路ではこの2ケースを区別する必要があるため（下記「検出失敗（GitHubモード）」参照、design-gate指摘・ADR-0026再改定）。
  - **合成規則（部分障害時も検出済み情報を保持する、design-gate指摘・2026-08-05再改定）**: Issue側・PR側それぞれの結果を「成功（0件以上のデータを実際に取得できた。PR側の『PR未作成』も非失敗の成功として扱う）」「失敗（`gh`非ゼロ終了・JSON解釈失敗・branch解決失敗）」のいずれかに正規化したうえで合成する。
    - **両方成功**: Issue側コメント・PR側コメント・PR側レビューを合成する。合計が0件なら`undefined`（AC-4、セクション省略）、1件以上なら`mode: 'github', detection: 'succeeded'`（`partial_failures`は省略、またはキー自体を持たない）を返す。
    - **一方が成功・他方が失敗（新設、直前の設計では両方の検出結果を握りつぶし`detection: 'failed'`のみを返していたが、これは成功側で実際に検出済みの未対応フィードバックまで破棄してしまい、本Issueが解消対象とする失敗モードを合成ロジック自身が再導入していた——design-gate blocking finding `PARTIAL_FAILURE_DISCARDS_DETECTED_FEEDBACK`／`PARTIAL_SUCCESS_DISCARDED_ON_ONE_SIDE_FAILURE`）**: `mode: 'github', detection: 'succeeded'` とし、成功した側で実際に検出した`unresolved_reviews`/`unresolved_comments`（0件でもよい）をそのまま含めたうえで、`partial_failures: [{ side: 'issue' | 'pr', reason }]`（非空、1要素）を付加する。失敗自体を隠さない（AC-5）ことと、成功側の検出結果を破棄しない（AC-2/AC-3）ことを両立する。この場合、`unresolved_reviews`/`unresolved_comments`が両方とも0件であっても、`partial_failures`が非空である限りセクションを省略しない（下記「AC-4との関係」参照）。
    - **両方失敗**: `mode: 'github', detection: 'failed'`、`reason`にIssue側・PR側両方の失敗理由を含める（例: `"issue側: <理由>; pr側: <理由>"`）。実際に取得できたデータが無いため`unresolved_*`フィールド自体を持たない。
    - PRが未作成（成功側の一種）の場合、出力の `pr_number` フィールドは省略する（`pr_number?: number`）。
  - **AC-4との関係**: AC-4（誤検出しない）が要求するのは「レビュー・コメントが実際に0件のときにセクションを出力しない」ことであり、`partial_failures`は「未対応レビュー・コメントの検出結果」ではなく「検出処理自体の失敗有無」を伝えるための別フィールドである。したがって`partial_failures`が非空の場合にセクションを出力してもAC-4には抵触しない（AC-5が要求する「失敗を『無い』で偽装しない」を優先する）。
- **検出失敗（GitHubモード、AC-5関連の設計判断）**: 「Issue側／PR側の分離」で述べた2経路それぞれの失敗の扱いを次のとおり確定する。失敗と判定された経路は、上記合成規則により、他方が成功していれば`partial_failures`として、両方失敗していれば`detection: 'failed'`の`reason`として反映される。
  - **branch解決失敗**（`resolveCurrentBranch()` が空文字列・undefined相当を返す。detached HEAD、または対象worktreeがIssueに紐づくbranchへcheckoutされていない異常状態を含む）: 「PR未作成」とは区別し、PR側を明示的な失敗（理由: 「現在のブランチ名を解決できません」）として扱う。branch解決失敗を「PR未作成」と同一視すると、実際にはPR側に検出すべきレビュー・コメントが存在するかもしれない状態を「無し」として握りつぶすことになり、AC-5に反するため区別する。
  - **`gh pr view <branch>` が非ゼロ終了、またはJSON解釈に失敗する場合**（branch解決は成功、2026-08-05再改定、design-gate blocking finding `PR_RESOLUTION_FAILURE_SILENTLY_TREATED_AS_NO_PR`）: 「一律成功・0件」とは扱わない。終了コードが非ゼロで、かつstderrが`gh` CLIの固定文言`no pull requests found`に一致する場合のみ「PR未作成」（PR側は非失敗・成功・0件）として扱う。それ以外の非ゼロ終了（認証切れ・ネットワーク障害・レートリミット等、stderrが当該文言と不一致）、およびJSON解釈失敗は、branch解決失敗と同様にPR側を明示的な失敗として扱う。直前の設計は`findOpenPrByHead()`の`undefined`（「PR未作成」と「`gh pr view`呼び出し失敗」を区別しない既存契約）を一律「PR未作成」として扱っており、branch解決失敗について直前に確定した「区別できない失敗を『無し』と同一視しない」という原則（AC-5）と矛盾していた。`gh-open-pr.ts`の`findOpenPrByHead()`・その既存呼び出し元（release bump・root-cleanup run）には一切手を加えない——本経路はこの関数を経由せず独自に`gh pr view`を呼ぶため、既存呼び出し元への影響は無い。stderrの固定文言一致に依存する点は、`gh` CLIの将来のバージョンアップで文言が変わった場合に「PR未作成」の判定が「失敗」側へ倒れる可能性を残すが、これは安全側（AC-5が優先する「わからないものは隠さない」）であり、逆方向の誤判定より許容できる。state が `OPEN` でない場合（closed/merged）は「PR未作成」と同じ扱い（PR側0件、非失敗）とする。
  - **Issue側の`gh issue view`呼び出し失敗・JSON解釈失敗**: 明示的に失敗として扱う。Issueは`resolveCurrentBranch`やPR解決の成否と無関係に常に存在するため（AGENTS.md I1）、「Issue未作成」に相当する黙認経路は存在しない。PR側が成功していれば、その検出結果は上記合成規則により保持される。
- **定型marker除外（AC-4関連の設計判断）**: 時刻カットオフを廃止したため、workerやgate-review自体がIssue/PRへ投稿する定型コメント（完了報告・review evidence等）を除外する仕組みが唯一の誤検出防止手段になる。`detectGithubReviewStatus()` は、コメント本文が既知の定型marker（`<!-- agent-skill-chain:` で始まる行）で始まる場合、そのコメントを「未対応」の判定対象から除外する。当該prefixの実在は実装コードで確認済みである（`src/lib/review-evidence.ts` がexportする `REVIEW_EVIDENCE_MARKER` の値は `<!-- agent-skill-chain:gate-review-evidence -->`、`src/commands/report.ts` 内定数 `MARKER` の値は `<!-- agent-skill-chain:worker-report -->`。design-gate指摘、2026-08-05）。実装セグメントでは、この2箇所が独立にprefixをハードコードしている重複を避けるため、`review-status.ts` の定型marker判定は `REVIEW_EVIDENCE_MARKER` 等の既存exportを再利用するか、共有定数へ切り出すことを推奨する（PLAN.md変更単位#3参照）。**投稿者（author）による除外は採用しない**——本リポジトリ実測（Issue #441/#445コメント履歴）のとおり、worker報告・gate-review-evidence・進行役による純粋な人間向け修正依頼コメントは全て同一のGitHub actor（`gh` credentialの実行主体）から投稿されており、author単位で除外すると本Issueが解消対象とする「進行役の修正依頼コメントそのもの」まで誤って除外してしまう（design-gate指摘、2026-08-05）。定型marker（機械可読な構造化データの先頭に付与される既存prefix）の有無だけが、自動化由来コメントと人間向け自由文コメントを区別できる唯一の機械的信号である。
- **時刻カットオフ廃止のトレードオフ**: 既に別の手段で実質的に対応済みの過去コメントも、そのPRが存在する限り毎回のresumeで再掲され続ける（過検出）。内容がそのままプロンプトに含まれるため、worker・進行役が既知の対応済みコメントと判断して読み飛ばせることを前提とする。AC-4は「コメントが実際に存在しない場合の誤検出禁止」のみを要求し、「過去に存在したコメントを繰り返し示さない」ことまでは要求しないため、AC-4とは競合しない（ADR-0026）。
- **ローカルモードのgate report走査（AC-6関連の設計判断）**: 起動対象segmentと同名のgate reportのみを読む基準（ADR-0025）では、AGENTS.mdが定めるorigin基準の差し戻し（例: implementationゲートが`origin: specification`のblocking findingを検出し、進行役がspecセグメントへ差し戻すケース）で、差し戻し先のワーカーが他segmentのgate reportに記録されたblocking findingを一切参照できない欠落があった（implementation-gate指摘、2026-08-05）。`detectLocalBlockingFindings()` は `spec`/`design`/`implementation`/`validation` 全segmentのgate reportを走査し、`origin` が起動対象segmentに対応する値（`spec`→`specification`、他は同名）と一致する `blocking` findingのみを収集する（ADR-0026）。
- **ローカルモードのgate report読み込み失敗（AC-5関連の設計判断、2026-08-05再改定、design-gate blocking finding `LOCAL_MODE_PARTIAL_FAILURE_DISCARDS_DETECTED_FINDINGS`）**: `detectLocalBlockingFindings()` は各segmentのgate reportを `src/lib/yaml-io.ts` の `tryReadYamlFile()`（既存・変更なし）で読む。`tryReadYamlFile()` は「ファイルが存在しない」場合に例外を投げず `undefined` を返し、「ファイルは存在するがYAMLとして解釈できない（壊れたYAML）」場合は内部の `parse()` が投げる例外をそのまま呼び出し元へ伝播させる（`src/lib/yaml-io.ts` 実装済みの既存挙動）。本設計はこの2ケースを次のとおり区別したうえで、GitHub側の「Issue側／PR側の分離」合成規則と対称な部分障害合成を行う。
  - ファイル不存在（`tryReadYamlFile()` が `undefined` を返す）: 当該segmentにgate report自体がまだ無いだけであり、正常系として「そのsegmentからのblocking findingは0件」を意味する。失敗として扱わない（ほとんどのIssueでは4segment中1〜2個のgate reportしか存在しない）。
  - YAML解釈失敗（`tryReadYamlFile()` が例外を投げる）: `detectLocalBlockingFindings()` はsegment単位で `try/catch` し、例外を握りつぶさず失敗理由として記録するが、他segmentの走査は継続する（1segmentの失敗で走査全体を打ち切らない）。
  - **合成規則**: `spec`/`design`/`implementation`/`validation`の4segmentのうち、読み込みに成功した（ファイル不存在による0件を含む）segmentから収集した`origin`一致のblocking findingは、他segmentの読み込みが失敗していても保持する。
    - **全segmentが失敗**: `{ mode: 'local', detection: 'failed', reason }`（各segmentの失敗理由を含む）を返す。GitHubモードの「両方失敗」と対称。ADR-0025時点では「blocker無し」と区別せず`undefined`を返す設計だったが、AGENTS.md I8（安全側ラチェット）に照らし是正する（ADR-0026）。
    - **1segment以上が成功**: 収集済みのblocking findingが1件以上なら `{ mode: 'local', detection: 'succeeded', gate: segment, unresolved_blocking_findings: [...] }`、0件なら`undefined`（AC-4、セクション省略。ただし読み込み失敗が無い場合に限る）を返す。1segmentでも読み込みが失敗していれば、findingが0件であっても`undefined`にはせず、`{ mode: 'local', detection: 'succeeded', gate: segment, unresolved_blocking_findings: [...]（0件可）, local_read_failures: [{ segment, reason }] }`（`local_read_failures`は非空）を返す——読み込み失敗を「blocker無し」に偽装しない（AC-5）ことと、成功したsegmentの検出結果を破棄しない（AC-6）ことを両立する。GitHub側の`partial_failures`と対称なフィールドだが、ローカルモードは4segment分の失敗が同時に起こり得るため`local_read_failures`は配列（0〜4要素）とする。
- **埋め込むコメント本文のシリアライズ安全性（AC-2/AC-3関連の設計判断、design-gate指摘・2026-08-05）**: 時刻カットオフ廃止により、非markerコメント本文は毎回無加工でrole_contractプロンプトへ埋め込まれる。コメント本文は第三者（レビュアー・進行役）が自由に書ける文字列であり、`rules:` や `---` 等のYAML構造を模した内容、または複数行文字列を含み得る。`formatReviewStatusBlock(data)` は文字列連結ではなく、既存の `src/lib/yaml-io.ts` がexportする `toYamlString()`（`segment.ts` の `issueBlock` 構築・`lease.ts` 等で既に使われているYAMLシリアライザ、依存関係節参照）へ構造化データ（コメント本文を含む）をそのまま渡し、その戻り値をインデントして連結する。手書きの文字列補間・エスケープ処理を独自実装しない。これにより、コメント本文の内容によって生成されるrole_contractプロンプトの構造（`rules:`セクション等）が破壊されたり、worker宛ての指示として誤解釈されたりすることを防ぐ。
- **GitHubモードとローカルモードの非対称性（既知の範囲限定、design-gate指摘・2026-08-05）**: AC-6（gate-report上のblocking findingの検出・同梱）はSPEC.md本文のとおりローカルモード限定であり、GitHubモードでゲートのblocking findingそのもの（Check Run・gate-review-evidenceコメントの構造化内容）をworker起動プロンプトへ機械的に伝える経路は本設計のスコープに含まない。GitHubモードでは、進行役がgate-reviewの指摘内容を人間向け自由文コメントとしてIssue/PRへ投稿した場合に限り、そのコメント本文が「未対応の判定基準」節の合成規則を通じて検出・同梱される（AC-2/AC-3の対象は「未対応レビュー・コメント」であり「gate reportのblocking finding」ではない）。この非対称性はSPEC.mdのスコープ限定に起因する既知の設計上の境界であり、本Issueの欠陥ではない。

### 依存関係

```text
.agent-skill-chain/config/roles.yaml（role_contracts.rules、静的データ）
                                                          ↘
src/commands/segment.ts（start）
  ├─ backend === 'local' → src/lib/review-status.ts: detectLocalBlockingFindings()
  │                          → src/lib/local-state.ts: reviewFilePath()
  │                          → src/lib/yaml-io.ts: tryReadYamlFile()
  └─ backend === 'github' → src/lib/review-status.ts: detectGithubReviewStatus()
                              ├─ Issue側（常に実行） → src/lib/exec.ts: gh()（`issue view --json comments`）
                              └─ PR側（branch解決成功時のみ）
                                  → src/lib/worktree.ts: resolveCurrentBranch()
                                  → src/lib/exec.ts: gh()（`pr view --json number,state,headRefName,latestReviews,comments`、直接1回、2026-08-05再改定）
```

PR側は`src/lib/gh-open-pr.ts`の`findOpenPrByHead()`を経由しない（「PR未作成」と「呼び出し失敗」を区別する必要があるため。上記「未対応の判定基準」参照）。`gh-open-pr.ts`自体・その既存呼び出し元（release bump・root-cleanup run）への依存は本設計に含まれない。

`git`呼び出し（commit時刻取得）は依存に含まれない（コメント時刻カットオフ廃止、ADR-0026）。呼び出し元（`worker-launch.sh` → 各adapter `launch_worker()` → `_asc_cli segment start`）の起動経路は上記「要件 → 設計要素の対応表」AC-7行参照。

### 図示要否の判断

- 判断: `要`
- 根拠: 依存関係が3つ以上ある（`review-status.ts` は `local-state.ts`／`yaml-io.ts`／`worktree.ts`／`exec.ts` の4モジュールに依存する）ため、下記に依存関係・分岐フローを図示する。

```mermaid
graph TD
  A["segment start（segment.ts）"] --> B{"coordination.backend"}
  B -->|local| C["detectLocalBlockingFindings(root, issue, segment)"]
  C --> D["全segment（spec/design/implementation/validation）の reviewFilePath を tryReadYamlFile で走査"]
  D -->|ファイル不存在segmentは0件として継続| DR["segmentごとにread結果を成功/失敗へ正規化"]
  DR -->|全segmentが失敗| DF["review_status: mode=local, detection=failed を同梱（握りつぶさない）"]
  DR -->|1segment以上が成功・失敗segmentあり・origin一致findingが非空| DPF["review_status: mode=local, detection=succeeded、収集済みfinding＋local_read_failures（非空）を同梱（成功側の検出結果を破棄しない）"]
  DR -->|1segment以上が成功・失敗segmentあり・origin一致findingが空| DPZ["review_status: mode=local, detection=succeeded、findingは空＋local_read_failures（非空）を同梱（失敗を隠さない）"]
  DR -->|全segment成功・origin一致findingが非空| E["review_status: mode=local, detection=succeeded を起動プロンプトへ同梱（AC-6）"]
  DR -->|全segment成功・該当findingが空| F["review_statusブロックを省略"]
  B -->|github| G["detectGithubReviewStatus(root, issue)"]
  G --> GI["Issue側: gh issue view --json comments（常に実行）"]
  G --> GP["PR側: resolveCurrentBranch 成功時のみ"]
  GI -->|失敗（gh呼び出し失敗・JSON解釈失敗）| GIF["issueResult=失敗"]
  GI -->|成功| GIS["issueResult=成功（コメントN件、0件可）"]
  GP -->|branch解決失敗| GPF["prResult=失敗"]
  GP -->|branch解決成功| PV["gh pr view --json number,state,headRefName,latestReviews,comments（直接1回）"]
  PV -->|非ゼロ終了かつstderrが「no pull requests found」に一致| GPZ["prResult=成功・0件（PR未作成）"]
  PV -->|非ゼロ終了（上記に不一致）またはJSON解釈失敗| GPF
  PV -->|成功（state!==OPENも含めPR無しと同一視）| GPS["prResult=成功（レビュー・コメント合算M件、0件可）"]
  GIS --> MRG
  GIF --> MRG
  GPZ --> MRG
  GPS --> MRG
  GPF --> MRG
  MRG{"合成: issueResult/prResultの成否を突き合わせる（時刻カットオフ無し、非markerのみ）"}
  MRG -->|両方失敗| J["review_status: detection=failed、reasonに両方の失敗理由を含める（AC-5）"]
  MRG -->|一方が成功・他方が失敗| PF["review_status: detection=succeeded、成功側の検出結果（0件可）+ partial_failures（非空）を同梱（成功側の検出結果を破棄しない、design-gate指摘再改定）"]
  MRG -->|両方成功・合計1件以上| L["review_status: mode=github, detection=succeeded、unresolved_reviews/unresolved_comments を同梱（pr_numberはPR有りの場合のみ、AC-2/AC-3）"]
  MRG -->|両方成功・合計0件| F
  A --> M["role_contract.rules に再開時レビュー確認ルールを常時含める（roles.yaml、AC-1）"]
```

## 関連ADR

```yaml
related_adrs: []
```

本Issue専用のADRとして、`docs/adr/ADR-0025-worker-resume-review-feedback-detection.md`（初版、レビュー基準・時刻カットオフ・同名gate report限定の各判定基準を確定、design-gate承認済みで一度 `accepted` になったのち本節が反映する内容で `superseded` へ遷移）と、それをsupersedeする `docs/adr/ADR-0026-worker-resume-review-feedback-detection-cross-commit-and-cross-segment.md`（`status: proposed`、コメント時刻カットオフの廃止とローカルモード全segment走査への変更を確定）の2件を作成した。ADR本文の不変原則（accepted後は書き換え不可）により、判定基準の変更はADR-0025の本文修正ではなく新ADR（ADR-0026）の作成で反映する。既存の他Issueの `accepted` ADRで本設計が直接 `adopts` するものは無いため、`related_adrs` は空にする（本文中の自然文言及のみ行う）。

## 障害・ロールバック考慮

- 想定される失敗モード:
  - (a) GitHubモードで対象branchにOPENなPRがまだ無い（例: spec segmentの初回起動時、Draft PR作成前）: `gh pr view <branch>` は非ゼロ終了しstderrが`no pull requests found`に一致するため、PR側（レビュー・PRコメント）は0件（非失敗）として扱うのみで、Issue側コメントの検出は独立して継続する（上記「Issue側／PR側の分離」）。エラーにはせず、Issue側・PR側とも該当が0件なら `review_status` ブロックを省略するだけで従来どおり `segment start` は成功する。この文言に一致しない非ゼロ終了は「検出失敗（GitHubモード）」節のとおり明示的な失敗として扱う（2026-08-05再改定）。
  - (b) `gh` コマンド自体が失敗する（未認証・ネットワーク障害・レートリミット等）: Issue側・PR側の両方で発生した場合は `detection: 'failed'` として明示し、理由文字列（stderr先頭200文字程度、両側の理由を含む）をプロンプトへ渡す。一方のみで発生した場合は、他方で実際に検出済みの`unresolved_reviews`/`unresolved_comments`（0件でもよい）を`detection: 'succeeded'`として保持したまま、`partial_failures`に失敗した側の理由文字列を含める——一方の一時的な障害を理由に、他方で既に検出できていたフィードバックまで消してはならない（AC-2/AC-3/AC-5、「Issue側／PR側の分離」合成規則参照）。いずれの場合も「レビュー無し」と偽装しない（AC-5）。`segment start` 自体は失敗させない——検出失敗を理由にworker起動全体をブロックすると、GitHub API障害時に全セグメントが進行不能になり、AC-5が要求する「検出失敗時も最小対応が機能し続ける」に反するため。
  - (c) `gh` の出力がJSONとして解釈できない（将来の `gh` CLI仕様変更等）: try/catchで捕捉し(b)と同じ `detection: 'failed'` 経路に合流させる。
  - (d) ローカルモードで `reviews/<segment>.yaml` が存在するが壊れたYAML（手動編集・中断書き込み等）: `tryReadYamlFile` はファイル不存在時のみ例外を投げず `undefined` を返し、壊れたYAMLの場合は内部の`parse()`例外をそのまま伝播させる。`detectLocalBlockingFindings` 内でsegment単位にtry/catchし、`segment start` 自体はクラッシュさせない。他segmentが読み込みに成功していれば、その`origin`一致findingは破棄せず保持したまま `local_read_failures` に失敗segment・理由を付加する（2026-08-05再改定、GitHubモードの`partial_failures`と対称）。`spec`/`design`/`implementation`/`validation`全segmentの読み込みがすべて失敗した場合のみ `{ mode: 'local', detection: 'failed', reason }` を返す（ADR-0026。AGENTS.md I8 安全側ラチェット＝既定は安全側だが、機能停止そのものは安全側ではないため「握りつぶし」自体は解消する）。ファイル不存在（segmentのgate reportがまだ無い）は失敗ではなく「0件」として扱う（上記「ローカルモードのgate report読み込み失敗」参照）。
  - (e) `latestReviews`／`comments` の件数が多く、プロンプトが際限なく肥大化する: 本Issoのスコープ外（「role_contractへ埋め込む情報量が増えることに伴うトークン量・長大化のトリミング戦略の確定」）。設計時点では件数上限・本文トリミングを導入せず、全件をそのまま埋め込む。肥大化が実運用で問題になった場合は別Issueで対処する。
  - (f) worker自身・gate-review自身がIssue/PRへ投稿した定型コメント（完了報告・review evidence等）が、次回resume時に「未対応の既存コメント」として誤って再検出される: 「未対応の判定基準」節の定型marker除外（`<!-- agent-skill-chain:` 始まりの本文を除外）により対処済み。author単位の除外は、進行役の正当な修正依頼コメントも同一actorから投稿されるため採用しない。
  - (g) GitHubモードで現在のブランチが解決できない（`resolveCurrentBranch` が空・detached HEAD等）: 「PR無し」とは区別し、PR側を明示的な失敗として扱う（上記「検出失敗（GitHubモード）」参照）。Issue側コメントの検出はこの失敗と独立に継続し、Issue側が成功していれば上記合成規則によりその検出結果は保持される（`partial_failures`にPR側の失敗理由が付加される）。
- ロールバック手順: 本変更は既存の `role_contract` 出力へ新しいセクション（`review_status:`）を追加するだけで、既存フィールド（`role:`／`issue:`／`rules:` 等）の意味・順序は変更しない。問題が発覚した場合は `roles.yaml` の追加ルール行と `segment.ts` の `review_status` 組み込み呼び出しを削除するだけで従来動作に戻せる（新規ファイル `review-status.ts` は未参照になるだけで副作用を残さない）。
- 影響を受ける既存機能: `buildIssueBlock`（ローカルモードのtitle/request同梱、Issue #183 AC-5）はスコープ外節のとおり変更しない。`worktree.ts`／`local-state.ts`／`yaml-io.ts` の既存関数はシグネチャ変更を伴わない再利用のみで、既存呼び出し元への影響は無い。`gh-open-pr.ts`の`findOpenPrByHead()`は本設計から一切参照されず（上記「未対応の判定基準」参照）、既存呼び出し元（release bump・root-cleanup run等）はそのまま変更されない。
