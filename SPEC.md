# SPEC: review:light ラベルで軽量レビュープロファイルを導入する

- Issue: `ISSUE-449`
- 作成者: `spec_worker`
- 対象ブランチ: `feature/449-review-light-profile`

## 目的・背景

AGENTS.md I8（安全側ラチェット）は「既定は常に安全側であり、速度は人間の明示的なオプトイン、危険信号による降格は自動である」と定める。現状のレビュープロファイルは以下の2種類のみである。

- **Standard**（既定）: レビュア1体がconformance（立証）→falsification（反証）を順に実行する。
- **Strict**: `risk != normal`（`unclassified` 含む）OR `autonomy == full`、または `.agent-skill-chain/project/manifest.yaml` の `model_selection.core_review.triggers`（`review:core-audit` ラベル／ローカル `core_audit` 状態値／`exact_paths`・`path_prefixes` 該当）に該当する場合、専任2名の独立レビュアが必須になる。

既に `size:quick` ラベル（`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` の作成義務免除、`risk:normal` かつ ADR 等の自己参照的変更を含まない場合限定）という、構造化ラベルによる機械的シグナルの前例がある。

ユーザーが「PoC的にさっさと作ってほしい」と明示的に依頼した場合でも、現状はゲートレビュー（Strictの場合は専任2名によるblocking finding→修正→再レビューの反復ループを含む）を毎回フル実施しており、時間がかかりすぎる。2026-08-05、Issue #446（`src/lib/`・`src/commands/` に変更が及ぶバグ修正）で、strict design-gateのblocking finding対応が実に6ラウンドの反復修正を要した。これは核心インフラ変更として妥当な厳密さだったが、同種の反復ループが「とりあえず動くものを早く」という意図の変更にまで一律適用されると、quickモードの本来の目的（軽量な変更を素早く回すこと）を損なう。

進行役（Claude Code）が当初「ユーザーが明示的にPoC/quickと言った時だけ簡略化する」という運用で対応しようとしたが、ユーザーから「それは進行役の裁量任せでブレが大きい。`size:quick`／`review:core-audit`のような構造化ラベルにして機械的に検査可能にすべきでは」という指摘を受けた。この指摘はAGENTS.mdの設計哲学（判断は労働者の解釈ではなく構造化されたラベル・設定項目に落とし込み、CIやスクリプトが機械的に検査できる形にする）と整合する。

設計に着手する前に、fable・codex（openai-codex plugin経由）へアドバイザーとして意見を求めた（2026-08-05）。両者の助言はおおむね以下の点で一致した。

1. `core_review` のstrict必須トリガー（`risk != normal`・`autonomy == full`・`path_prefixes` 該当）は軽量プロファイルより常に優先されるべきであり、「軽量プロファイルがあればstrictを上書き可能」はI8が禁じる「危険信号による降格の自動解除」と同型であり許容できない。`size:quick` が `risk` や `docs/adr/` 等の変更で強制解除される既存パターン（ADR-0022）と同じ設計にすべきである。
2. ゲート自体の完全省略はI1（追跡可能性）・I7（AC⇔検証の追跡）を壊すため不可。Standard相当のレビュア1体・1パスとし、blocking findingのみ修正必須、warning以下は記録のみで後続対応を必須としない。反復ループの打ち切り基準は、本システムの既存パターン（`inconclusive: true` → `human_required`）と整合させる必要がある。
3. 軽量プロファイルは `size:quick` とは独立した新規シグナルとすべきである（`size:quick` ＝成果物量、軽量プロファイル ＝検証強度で関心が直交する）。
4. 見落としがちなリスクとして、(a) シグナル付与者の検証（進行役が自らシグナルを付与できる設計は「進行役の裁量任せ」問題の再帰）、(b) 循環シグナル禁止（発動条件を免除対象の成果物自体に依存させない）、(c) AC未達は軽量プロファイル下でも常にblocking扱いとすること（I7）、(d) セキュリティ・データ喪失・互換性破壊・不変条件違反に該当する指摘は自動的にblocking扱いへ昇格させること、(e) 軽量プロファイル適用の事実を機械可読な証跡として残し追跡可能にすることが挙げられた。

本Issueは2026-08-05、ユーザーの明示的指示「起票はもちろんしてください。fable / codex をアドバイザーにして」により、上記2アドバイザーの助言を踏まえて起票された。関連する反復ループの実例はIssue #446（PR #447）のdesign-gate、strict・6ラウンドである。

## 要求 → 要件 → 受入条件

### 要求

ユーザーが「PoC的に素早く進めたい」と明示的に意図した変更について、ゲートレビューの反復コストを構造化された機械検査可能なシグナルにより軽量化できるようにしたい。ただし、AGENTS.md I8の安全側ラチェット（危険信号による降格は自動、速度は人間の明示的なオプトインのみ）を一切損なわないこと。

### 要件

- 要件1: GitHubモードのIssueラベル、およびローカルモードの `state.yaml` 対応フィールドとして、軽量レビュープロファイルを宣言する新規の構造化シグナル（以下「軽量シグナル」）を導入する。GitHubモードのラベル名は `review:light` とする。既存の `size:quick`（成果物量の免除）とは独立した軸として扱い、一方の有無がもう一方の判定に暗黙に影響しないこと。
- 要件2: 軽量シグナルは、`model_selection.core_review` のStrict必須トリガー（`review:core-audit` ラベル／ローカル `core_audit` 状態値／`exact_paths`・`path_prefixes` 該当）に該当する場合、無効化されStrict・専任2名レビューが強制されること。
- 要件3: 軽量シグナルは、AGENTS.md I8のStrict必須トリガー（`risk != normal`（`unclassified` 含む）OR `autonomy == full`）に該当する場合も、同様に無効化されStrictが強制されること。
- 要件4: 軽量シグナルは、変更差分が `docs/adr/`・`.agent-skill-chain/config/segments.yaml`・`AGENTS.md`・`.agent-skill-chain/schemas/` のいずれかのパスを含む場合、`model_selection.core_review.triggers` の現在の登録内容（`exact_paths`・`path_prefixes` に何が含まれているか）とは独立に無効化され、Strictが強制されること。これはADR-0022が `size:quick` に課すパスベース強制解除条件と同型の独立ガードレールであり、`core_review` のtrigger設定が将来変更・縮小されても本条件単独で安全側を維持する。
- 要件5: 軽量シグナルが有効なゲートは、Standard相当（レビュア1体によるconformance→falsificationの1パス）を基本とし、blocking findingのみ修正必須、warning以下は記録のみで後続対応を必須としないこと。
- 要件6: 軽量シグナル下でのblocking finding対応の反復ループには、通常プロファイルとは別の打ち切り基準を設け、基準に達しても未解消の場合は当該ゲートを承認せず、既存の `human_required` パターン（進行役が解釈で人間判断へ昇格させるのではなく、判定不能な状態をレビュア／機械判定自身が表明する）に整合する形で人間判断へ安全側に倒すこと。
- 要件7: AC-ID未達の指摘は、軽量シグナル適用下でも常にblocking扱いとし、warning以下へ格下げされないこと。
- 要件8: セキュリティ・データ喪失・互換性破壊・AGENTS.md不変条件（I1〜I8）違反に該当する指摘は、軽量シグナル適用下でも自動的にblocking扱いへ昇格すること。
- 要件9: 軽量シグナルの付与が人間による明示行為であることを判定できない場合（付与主体を人間と確認できない、または確認手段自体が存在しない場合を含む）は、軽量プロファイルを適用せず、既存のI8ロジックに基づく通常プロファイル（Standard/Strict）を適用すること（安全側）。
- 要件10: 軽量シグナルの発動条件は、免除・軽量化の対象そのものである成果物（`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`）の内容や、軽量プロファイルの判定ロジック自体が定義された資産に依存しないこと（循環シグナル禁止）。要件4のパスベース無効化条件は変更差分のパス集合のみを入力とし、当該成果物の内容自体には依存しないため本条件に抵触しない。
- 要件11: 各ゲートについて、軽量プロファイルが適用されたか否か、および無効化された場合はその理由を、ゲート証跡（ローカルモード: `reviews/<gate>.yaml`、GitHubモード: Check Run または PRレビュー相当の記録）に機械可読な形で残すこと。
- 要件12: 軽量シグナルが一切付与されていない既存のIssueの振る舞い（Standard/Strictの判定・実施内容）に変更が生じないこと（後方互換）。
- 要件13: 軽量シグナルの有効化・無効化は、`human_confirmation.before_implementation`・`merge.autonomous` という別軸の設定に一切影響を与えないこと。これらの設定は軽量シグナルの状態と独立に、既存の設定値どおりに評価されること。

### 受入条件（Acceptance Criteria）

#### AC-1: 軽量シグナル未指定時は既存のStandard/Strict判定から変化しない

- Given: Issue（GitHubモードのラベル、またはローカルモードの `state.yaml`）に軽量シグナルが一切付与されていない
- When: 進行役またはゲートレビュー起動処理がレビュープロファイルを解決する
- Then: 既存のI8ロジック（`risk != normal` OR `autonomy == full` → Strict、それ以外 → Standard）どおりに解決され、軽量プロファイル固有の振る舞いは一切発生しない
- 検証方法見込み: `automated`

#### AC-2: 適格なIssueに人間が軽量シグナルを付与すると軽量プロファイルとして解決される

- Given: `risk:normal`・`autonomy:gated`・`core_review` 非該当のIssueに、人間が軽量シグナルを明示的に付与済みである
- When: 当該Issueの各ゲートのレビュープロファイルが解決される
- Then: レビュア1体によるconformance→falsificationの1パスとして解決され、Strictの専任2名要求は課されない
- 検証方法見込み: `automated`

#### AC-3: core_review必須トリガー該当時は軽量シグナルが無効化されStrictが強制される

- Given: Issueに軽量シグナルが付与されており、かつ `review:core-audit` ラベル（またはローカル `core_audit` 状態値）が付与されている、または変更差分が `model_selection.core_review.triggers` の `exact_paths`・`path_prefixes` に該当する
- When: レビュープロファイルが解決される
- Then: 軽量シグナルは無効化され、Strict・専任2名レビューが適用される。無効化された事実と理由が記録される
- 検証方法見込み: `automated`

#### AC-4: risk!=normalまたはautonomy==fullの場合も軽量シグナルが無効化されStrictが強制される

- Given: `risk:high` または `risk:unclassified`、あるいは `autonomy:full` のIssueに軽量シグナルが付与されている
- When: レビュープロファイルが解決される
- Then: 軽量シグナルは無効化され、既存のI8ロジックどおりStrictが適用される
- 検証方法見込み: `automated`

#### AC-5: docs/adr等のパスを変更差分に含む場合はcore_reviewの登録内容に関わらず軽量シグナルが無効化される

- Given: Issueに軽量シグナルが付与されており、かつ変更差分が `docs/adr/`・`.agent-skill-chain/config/segments.yaml`・`AGENTS.md`・`.agent-skill-chain/schemas/` のいずれかのパスを含む
- When: レビュープロファイルが解決される。このとき `model_selection.core_review.triggers` の `exact_paths`・`path_prefixes` が当該パスを含むかどうかは問わない
- Then: 軽量シグナルは無効化され、Strict・専任2名レビューが適用される。無効化された事実と理由（本パスベース条件に該当したこと）が記録される
- 検証方法見込み: `automated`

#### AC-6: 軽量プロファイル下でもAC未達の指摘は常にblocking扱いになる

- Given: 軽量プロファイルが適用されたゲートレビューで、いずれかのAC-IDが未達であるという指摘がある
- When: レビュアが当該指摘のverdictを記録する
- Then: severityはblockingとして扱われ、warning以下へ格下げされない
- 検証方法見込み: `hybrid`

#### AC-7: セキュリティ・データ喪失・互換性破壊・不変条件違反の指摘は軽量プロファイル下でも自動的にblockingへ昇格する

- Given: 軽量プロファイルが適用されたゲートレビューで、セキュリティ・データ喪失・互換性破壊・AGENTS.md不変条件（I1〜I8）違反のいずれかに該当する指摘がある
- When: レビュアが当該指摘のverdictを記録する
- Then: severityは自動的にblockingへ昇格し、記録されたseverityがwarning以下のままにはならない
- 検証方法見込み: `hybrid`

#### AC-8: 打ち切り基準に達したblocking findingは軽量プロファイルでも自動承認されず人間判断へ昇格する

- Given: 軽量プロファイルが適用されたゲートで、打ち切り基準（ラウンド数等、design segmentで確定する）に達してもなおblocking findingが解消されていない
- When: 進行役が次ラウンドの要否、またはゲートの最終判定を確認する
- Then: 当該ゲートは承認（approved）とならず、`human_required` として記録され、進行役が解釈で人間判断へ昇格させるのではなく判定不能な状態自体が機械的に表明される
- 検証方法見込み: `automated`

#### AC-9: 軽量シグナルの付与者を人間と確認できない場合は軽量プロファイルを適用しない

- Given: 軽量シグナルは付与されているが、その付与主体が人間であることを確認できない、または確認手段自体が存在しない
- When: レビュープロファイルが解決される
- Then: 軽量プロファイルは適用されず、既存のI8ロジックに基づく通常プロファイル（Standard/Strict）が適用される
- 検証方法見込み: `hybrid`

#### AC-10: 軽量プロファイルの適用有無と理由がゲート証跡に機械可読な形で記録される

- Given: あるゲートについて軽量プロファイルが適用された、またはガードレールにより無効化された
- When: 当該ゲートのレビューが完了する
- Then: ゲート証跡（ローカルモード: `reviews/<gate>.yaml`、GitHubモード: Check Run またはPRレビュー相当の記録）に、軽量プロファイルの適用有無、および無効化された場合はその理由が機械可読な形で残る
- 検証方法見込み: `automated`

#### AC-11: 軽量シグナルの発動条件が免除対象成果物や判定ロジック自体に循環依存しない

- Given: 軽量シグナルの発動条件・ガードレール判定ロジック
- When: 当該ロジックが読み取る入力を確認する
- Then: 軽量シグナル自体の発動（付与）条件の入力はIssue起票時点・ラベル付与時点で存在するシグナル（ラベルまたは `state.yaml` フィールド）のみであり、`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` など軽量プロファイル自体の適用対象となる成果物の内容には一切依存しない。AC-3・AC-5の無効化条件が変更差分のパス集合を参照することはこの制約に抵触しない
- 検証方法見込み: `automated`

#### AC-12: size:quickと軽量シグナルは独立した軸として組合せ可能である

- Given: `size:quick` と軽量シグナルが同一Issueに共存する、またはいずれか一方のみが付与されている
- When: それぞれのシグナルが解決される
- Then: 一方の有無がもう一方の判定結果に暗黙に影響せず、`size:quick` は成果物作成義務の免除のみを、軽量シグナルはレビュープロファイルの軽量化のみを、互いに独立したガードレールに従って決定する
- 検証方法見込み: `automated`

#### AC-13: 軽量シグナルはhuman_confirmation.before_implementation・merge.autonomousという別軸設定に影響しない

- Given: Issueに軽量シグナルが付与されている、または無効化されている
- When: `human_confirmation.before_implementation` または `merge.autonomous` の設定値が評価される
- Then: これらの設定値は軽量シグナルの有効・無効状態に関わらず変化せず、既存の設定どおりに評価される
- 検証方法見込み: `automated`

## スコープ外

- Codexアダプタ・ゲートレビュアの起動系自体の変更。
- `size:quick` 自体の仕様変更（存在要求の免除条件・対象出力の変更）。
- 反復ループの打ち切り基準の具体的な数値（許容ラウンド数等）の確定。design segmentで確定する。
- 軽量シグナルの付与主体が人間であることを検証する具体的な技術的方式（GitHub Actor種別の判定方法等）の確定。design segmentで確定する。
- `docs/system-spec/` の構築（Issue本体未accepted、別Issueで対応）。
- 既存の `gate-report.schema.yaml`・`state.schema.yaml` 以外のスキーマへの波及的変更。
