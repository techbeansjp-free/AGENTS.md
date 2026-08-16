# SPEC: implementationセグメントのworker contract生成がsize:quickラベルを考慮しない

- Issue: `ISSUE-690`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/690-impl-contract-size-quick`

## 目的・背景

セグメント作業ワーカーへ渡る動作契約（worker contract）は、`agent-skill-chain segment start <issue_id> <segment>` の標準出力として生成される。起動ラッパー（`.agent-skill-chain/scripts/worker-launch.sh`）とアダプタは、この標準出力を丸ごと取得してワーカーへ渡す。

本SPEC作成時点の implementation セグメントでは、この契約本体が `.agent-skill-chain/config/roles.yaml` の `role_contracts.implementation_worker` を無条件に転記した固定内容であり、当該 Issue の size シグナル（GitHub モードの `size:quick` ラベル、ローカルモードの Issue 状態ファイルの `size` フィールド）を一切参照しない。その結果、契約の inputs は常に `SPEC.md`・`DESIGN.md`・`PLAN.md`・承認済みADR の4件であり、rules には常に「PLANの順序に従う（中断時は報告する。推測で補完しない）」が含まれる。

一方、AGENTS.md は「quick の Issue は `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` の作成義務を免除する」と定めており、成果物存在検査（`verify` の成果物検査）はこの免除を size・risk シグナルとガードレールから解決して適用する経路を既に備えている。契約生成の経路だけがこの解決を行っていない。

さらに GitHub モードでは、当該 Issue のタイトル・本文が契約へ一切同梱されない（ローカルモードでのみ、Issue 状態ファイル由来のタイトル・要求本文が契約へ同梱される）。したがって GitHub モードの quick Issue で免除対象成果物を作らずに implementation ワーカーを起動すると、ワーカーへ渡る契約の中に要求内容の情報源が一つも存在しない状態になる。ワーカーは契約通り推測補完を避けて `blocked` を報告し、進行役が最小限の `PLAN.md` を手で用意して再ディスパッチする回避策に追い込まれる。これは進行役が調整状態のみを読み書きし成果物の著述を行わないという不変条件（進行役の純粋性）に反し、quick の免除規約が implementation セグメントで実効しないことを意味する。

本Issueは、契約生成が size シグナルを解決し、quick が実効する場合に「免除対象成果物の存在を前提としない契約」を、要求内容の情報源を伴って生成するようにすることを目的とする。同時に、quick の指定がガードレールに抵触する場合と standard の場合には、従来と同一の契約が渡ることを保証する。

## 対象範囲

本SPECが仕様を定める対象は次に限る。

- implementation セグメント向けに生成される worker contract の内容（inputs、rules、completion、forbidden、同梱される Issue 内容、解決結果の明示）。GitHub・ローカル両 Coordination Backend を対象とする。
- 契約生成時における quick 免除の適用可否判定の入力、安全側既定、および非適用理由の提示経路。
- 上記の変更が standard 構成の Issue および implementation 以外のセグメントに回帰を生じさせないこと。

対象外は本SPEC末尾の「スコープ外」に列挙する。

## 前提

本SPECの要件・受入条件は、次の前提が成立する環境で評価する。

- Coordination Backend は GitHub モードまたはローカルモードのいずれか一方であり、二重化されていない。
- size シグナルは、GitHub モードでは Issue ラベル `size:quick` の有無、ローカルモードでは Issue 状態ファイルの `size` フィールド（`quick`|`standard`）である。既定は standard であり、自動昇格は行わない。
- risk シグナルは、GitHub モードでは `risk:normal`・`risk:high` ラベル、ローカルモードでは Issue 状態ファイルの `risk` フィールドである。いずれも明示が無い場合は `unclassified` として扱う。
- quick 免除のガードレールは、risk が `normal` 以外であること、または変更差分に `docs/adr/` 配下・`.agent-skill-chain/config/segments.yaml`・`AGENTS.md`・`.agent-skill-chain/schemas/` 配下のいずれかを含むことである。変更差分は base ブランチとの差分と未コミット差分の合成であり、これを機械的に解決できない場合も抵触として扱う。
- 契約はコマンドの標準出力そのものであり、標準エラー出力は契約に含まれない。したがって標準出力へ書いた内容はすべてワーカーへ渡り、標準エラー出力へ書いた内容は進行役の実行ログにのみ現れる。
- 対象 Issue の worktree は一意に解決済みであり、writer lease は取得済みである。
- implementation セグメントの着手には人間確認ゲートが別途存在し、本Issueはその挙動を変更しない。
- 契約生成時点では、当該 Issue のブランチには実装差分がまだ入っていない場合がある（差分が空である状態は正常であり、ガードレール抵触ではない）。

## 用語

本SPEC内で用いる語を次の意味に固定する。

- **worker contract**: `segment start <issue_id> <segment>` が標準出力へ返すテキスト全体。役割名、inputs、outputs、rules、completion、forbidden、完了報告手順、および Coordination Backend 由来の付随ブロックを含む。
- **免除対象成果物**: `SPEC.md`・`DESIGN.md`・`PLAN.md`。implementation セグメントの契約が現在 inputs として要求している Issue スコープの文書成果物のうち、quick が作成義務を免除するもの。
- **size シグナル／risk シグナル**: 「前提」で定義した、Coordination Backend 側に置かれた size・risk の指定。いずれも免除対象成果物の内容・存在に依存しない場所にある。
- **quick 実効**: size シグナルが quick であり、かつガードレール抵触が一つも無い状態。
- **quick 要求済み・非実効**: size シグナルが quick であるが、ガードレール抵触が1つ以上ある状態。
- **standard 構成**: size シグナルが quick でない状態、および size シグナルを読み取れない状態。
- **Issue 内容**: 当該 Issue のタイトルと本文。GitHub モードでは GitHub Issue のタイトルと本文、ローカルモードでは Issue 状態ファイルが保持するタイトルと要求本文を指す。
- **PLAN順序規則**: 契約の rules に含まれる「PLANの順序に従う」ことを求める規則。
- **変更前契約**: 本Issueによる変更を適用する前の実装が、同一の Issue・セグメント・Coordination Backend に対して生成する worker contract。

## 要求 → 要件 → 受入条件

### 要求

quick を明示した Issue において、`SPEC.md`・`DESIGN.md`・`PLAN.md` を作成せずに implementation セグメントのワーカーを起動しても、ワーカーが契約の内部だけで要求内容を特定でき、免除対象成果物が存在しないことのみを理由に `blocked` へ倒れないこと。これにより、進行役が PLAN 相当の成果物を手で用意する回避策を不要にすること。

同時に、standard の Issue では従来どおり免除対象成果物を前提とした契約が渡ること、および quick が指定されていてもガードレールに抵触する場合は自動的に standard 側へ倒れ、その理由が進行役に見える形で提示されることを、安全側の既定として保証すること。

### 要件

- implementation セグメントの契約生成は、契約を標準出力へ書き出す前に size シグナル・risk シグナル・変更差分を解決し、quick 実効か否かを判定する。
- 判定の入力は免除対象成果物の存在・内容に一切依存しない。免除対象成果物の内部（フロントマター等）に置かれた指定を判定入力にしてはならない。
- size シグナル・risk シグナル・変更差分のいずれかを読み取れない場合（GitHub への問い合わせ失敗、Issue 不在、Issue 状態ファイル欠落、差分解決不能を含む）は quick を適用せず standard 構成として扱う。
- quick 実効時に生成する契約の inputs には、免除対象成果物のうち契約生成時点で対象 worktree に存在しないものを含めない。契約生成時点で存在する免除対象成果物は inputs に含めてよい。承認済みADR を入力として示すことは維持してよい。
- quick 実効時に生成する契約は、Issue 内容（タイトルと本文）を契約本文へ含める。GitHub モード・ローカルモードのいずれでも含める。
- quick 実効時に生成する契約の rules には PLAN順序規則を含めない。代わりに、要求の情報源が契約へ同梱された Issue 内容であること、および Issue 内容から実装範囲を確定できない場合は推測で補完せず `blocked` を報告することを求める規則を含める。
- quick 実効時であっても、次の既存の制約と完了条件は維持する——承認済み成果物を変更しないこと、gate report 準拠ファイルを書き換えないこと、自 worktree 内でのみ作業すること、作業再開時に対象 Issue/PR の最新レビュー・コメントを確認しファイル存在や commit 済みであることのみを根拠に完了と判定しないこと、および完了条件としての実装完了・必須チェック（lint/test/build）実行・commit と push。
- quick 実効と判定したが Issue 内容を取得できない場合は、契約を標準出力へ出力せず、理由を含む日本語メッセージを標準エラー出力へ出して非ゼロ終了コードで停止する。要求の情報源を持たない quick 契約をワーカーへ渡してはならない。
- quick 要求済み・非実効の場合に生成する契約は standard 構成の契約と同一とする。加えて、非実効となった全理由を進行役が観測できる形で提示する。この提示は契約本文（標準出力）へ混入させず、標準エラー出力へ書く。
- 契約には、解決結果が quick 実効であるか standard 構成であるかを機械的に判別できる固定のキー名を持つ表示を含める。quick 実効時と standard 構成時の双方で出力し、値のみが異なるようにする。
- standard 構成では、契約は変更前契約と同一とする。inputs に免除対象成果物3件を含むこと、PLAN順序規則を含むこと、GitHub モードでは Issue 内容を同梱しないこと、ローカルモードでは既存の Issue 情報ブロックの有無と書式が変わらないことを含む（前項が定める解決結果の表示行の追加を除く）。
- 本変更は spec・design・validation セグメントの契約生成の挙動を変更しない。
- 契約生成が用いる size シグナル・risk シグナル・ガードレールの定義は、成果物存在検査が用いる定義と同一の判定結果を与える。同一の Issue・worktree 状態に対して、両者の quick 免除の適用可否が食い違ってはならない。

### 受入条件（Acceptance Criteria）

#### AC-1: GitHubモードのquick実効で免除対象成果物を要求しない契約が生成される

- Given: GitHub モード、`size:quick` と `risk:normal` のラベルを持つ Issue、対象 worktree に `SPEC.md`・`DESIGN.md`・`PLAN.md` がいずれも存在せず、変更差分がガードレール対象パスを含まない状態
- When: 当該 Issue の implementation セグメントについて worker contract を生成する
- Then: 生成された契約の inputs に `SPEC.md`・`DESIGN.md`・`PLAN.md` のいずれも現れず、契約本文に当該 Issue のタイトルと本文が含まれ、rules に PLAN順序規則が含まれない
- 検証方法見込み: `automated`

#### AC-2: quick実効時も安全側の規則と完了条件が維持される

- Given: GitHub モード、`size:quick` と `risk:normal` のラベルを持つ Issue、対象 worktree に免除対象成果物がいずれも存在せず、変更差分がガードレール対象パスを含まない状態
- When: 当該 Issue の implementation セグメントについて worker contract を生成する
- Then: 生成された契約の rules に「自 worktree 内でのみ作業する」「gate report 準拠ファイルを書き換えない」「作業再開時に対象 Issue/PR の最新レビュー・コメントを確認し、ファイル存在や commit 済みであることのみを根拠に完了と判定しない」に相当する規則が残り、completion に実装完了・必須チェック実行・commit と push に相当する条件が残り、rules に「Issue 内容から実装範囲を確定できない場合は推測で補完せず blocked を報告する」に相当する規則が含まれる
- 検証方法見込み: `automated`

#### AC-3: GitHubモードのstandard構成では契約が変更前と同一である

- Given: GitHub モード、`size:quick` ラベルを持たない Issue
- When: 当該 Issue の implementation セグメントについて worker contract を生成する
- Then: 生成された契約は、解決結果の表示行を除いて変更前契約と一致する。すなわち inputs に `SPEC.md`・`DESIGN.md`・`PLAN.md` を含み、rules に PLAN順序規則を含み、Issue のタイトル・本文を同梱しない
- 検証方法見込み: `automated`

#### AC-4: riskがnormalでないquick指定はstandard構成へ倒れ理由が提示される

- Given: GitHub モード、`size:quick` ラベルを持ち、risk ラベルが未付与（`unclassified`）である Issue、および `risk:high` ラベルを持つ Issue の2構成
- When: それぞれの Issue の implementation セグメントについて worker contract を生成する
- Then: いずれの構成でも生成された契約が、解決結果の表示行を除いて変更前契約と一致する（inputs に免除対象成果物3件を含み、rules に PLAN順序規則を含み、Issue のタイトル・本文を同梱しない）。加えて、risk が normal でないため quick を適用しない旨の日本語の理由が標準エラー出力へ出力され、かつ標準出力（契約本文）にはその理由が含まれない
- 検証方法見込み: `automated`

#### AC-5: ガードレール対象パスを含む差分のquick指定はstandard構成へ倒れ理由が提示される

- Given: GitHub モード、`size:quick` と `risk:normal` のラベルを持つ Issue で、変更差分が `docs/adr/` 配下・`.agent-skill-chain/config/segments.yaml`・`AGENTS.md`・`.agent-skill-chain/schemas/` 配下のいずれか1つを含む4構成（各パスごとに1構成）
- When: それぞれの構成で implementation セグメントの worker contract を生成する
- Then: 4構成すべてで、生成された契約が解決結果の表示行を除いて変更前契約と一致し（inputs に免除対象成果物3件を含み、rules に PLAN順序規則を含む）、抵触したガードレールに対応する日本語の理由が標準エラー出力へ出力され、標準出力（契約本文）にはその理由が含まれない
- 検証方法見込み: `automated`

#### AC-6: ローカルモードのquick実効でも同じ形の契約が生成される

- Given: ローカルモード、Issue 状態ファイルが `size: quick` と `risk: normal` を保持し、タイトルと要求本文を保持しており、対象 worktree に免除対象成果物が存在せず、変更差分がガードレール対象パスを含まない状態
- When: 当該 Issue の implementation セグメントについて worker contract を生成する
- Then: 生成された契約の inputs に免除対象成果物が現れず、rules に PLAN順序規則が含まれず、契約本文に Issue 状態ファイル由来のタイトルと要求本文が含まれる
- 検証方法見込み: `automated`

#### AC-7: ローカルモードのstandard構成では契約が変更前と同一である

- Given: ローカルモード、Issue 状態ファイルが `size` に quick を持たず、タイトルと要求本文を保持している状態
- When: 当該 Issue の implementation セグメントについて worker contract を生成する
- Then: 生成された契約は、解決結果の表示行を除いて変更前契約と一致する。すなわち inputs に免除対象成果物3件を含み、rules に PLAN順序規則を含み、既存の Issue 情報ブロックの有無と書式が変わらない
- 検証方法見込み: `automated`

#### AC-8: シグナルを読み取れない場合はquickを適用しない

- Given: 次の3構成——(a) GitHub モードで Issue のラベル問い合わせが失敗する状態、(b) ローカルモードで Issue 状態ファイルが存在しない状態、(c) size シグナルが quick かつ risk が normal だが変更差分を機械的に解決できない状態
- When: それぞれの構成で implementation セグメントの worker contract を生成する
- Then: 3構成すべてで、生成された契約が解決結果の表示行を除いて変更前契約と一致し（inputs に免除対象成果物3件を含み、rules に PLAN順序規則を含む）、免除対象成果物を inputs から外した契約は生成されない
- 検証方法見込み: `automated`

#### AC-9: quick実効でIssue内容を取得できない場合は契約を出力せず停止する

- Given: size シグナルが quick かつガードレール非抵触と判定できるが、Issue 内容（タイトル・本文）を取得できない状態（GitHub モードでは本文取得の失敗、ローカルモードでは Issue 状態ファイルにタイトル・要求本文がいずれも無い状態）
- When: 当該 Issue の implementation セグメントについて worker contract を生成する
- Then: 標準出力へ契約が一切出力されず、Issue 内容を取得できないため quick 契約を生成できない旨の日本語メッセージが標準エラー出力へ出力され、終了コードが非ゼロになる
- 検証方法見込み: `automated`

#### AC-10: quick実効でも既存の免除対象成果物は入力として渡る

- Given: quick 実効の Issue で、対象 worktree に `PLAN.md` のみが存在し `SPEC.md`・`DESIGN.md` は存在しない状態
- When: 当該 Issue の implementation セグメントについて worker contract を生成する
- Then: 生成された契約の inputs に `PLAN.md` が含まれ、`SPEC.md`・`DESIGN.md` は含まれない
- 検証方法見込み: `automated`

#### AC-11: 解決結果が契約から機械的に判別できる

- Given: quick 実効の Issue と standard 構成の Issue の2構成
- When: それぞれの構成で implementation セグメントの worker contract を生成する
- Then: いずれの契約にも同一の固定キー名を持つ解決結果の表示が1行含まれ、その値が quick 実効と standard 構成とで異なる
- 検証方法見込み: `automated`

#### AC-12: implementation以外のセグメントの契約は変更されない

- Given: quick 実効の Issue と standard 構成の Issue の2構成
- When: それぞれの構成で spec・design・validation の各セグメントについて worker contract を生成する
- Then: 生成された6通りの契約がいずれも変更前契約と一致する
- 検証方法見込み: `automated`

#### AC-13: 起票時の再現手順でblockedにならない

- Given: GitHub モードで `size:quick` と `risk:normal` を付与した Issue を起票し、worktree を作成し、`SPEC.md`・`DESIGN.md`・`PLAN.md` を一切作成していない状態
- When: `.agent-skill-chain/scripts/worker-launch.sh <issue_id> implementation` を実行し、ワーカーへ渡る契約を確認する
- Then: 契約に当該 Issue の要求内容が含まれ、免除対象成果物および承認済みADRが存在しないことのみを理由とする `blocked` 報告が発生しない
- 検証方法見込み: `hybrid`

## 未決事項

本SPEC作成時点で未解決の曖昧さは無い。判断が分かれ得た点は次のとおり確定済みである。

- quick 実効時に免除対象成果物が偶発的に存在する場合の扱いは、「存在するものは入力として渡す（quick は作成義務の免除であって利用の禁止ではない）」に確定した。
- quick 実効時の要求の情報源は Issue 内容に確定した。契約生成時に要求内容を新たに要約・再構成して契約へ書き起こすことはしない（進行役側で成果物相当の著述を行わないため）。
- ガードレール抵触時の挙動は「安全側へ倒し standard 構成の契約を渡す」に確定した。契約生成を失敗させることはしない。
- Issue 内容を取得できない quick 実効時のみ、契約生成自体を失敗させることに確定した。要求の情報源を持たない契約を渡すと、ワーカーが推測補完に誘導されるか無意味な `blocked` を返すかのいずれかにしかならないため。

## スコープ外

- validation セグメントにおける quick 対応。quick は `VALIDATION.md`・受入テスト結果・回帰テスト結果の作成義務も免除するが、免除下で検証証跡をどう構成するかは独立した設計判断であり、本Issueの再現条件（implementation セグメントの `blocked`）とは別の問題として別Issueで扱う。
- spec・design セグメントの契約内容の変更。
- quick 判定に用いるシグナルの定義自体の変更（ラベル名の追加・変更、ガードレール対象パスの追加・削除、risk の既定値の変更）。
- 成果物存在検査（`verify` の成果物検査）側の挙動変更。
- standard 構成の Issue に対して Issue 内容を契約へ同梱すること。
- 実装セグメント着手前の人間確認ゲートの挙動変更。
- `issue_sync` による Issue/PR 本文への転記内容の変更。
- size ラベルの自動付与、および size の自動昇格・自動降格。
- ワーカー起動アダプタの選択、モデル選択、reasoning effort の決定。
- 契約を受け取ったワーカーの実装品質・判断の良否。
