# SPEC: size:quick の Issue でゲートが構造上通過不能な問題の是正

- Issue: `ISSUE-733`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/733-quick-gate-conformance-unpassable`

## 目的・背景

agent-skill-chain の憲法は、`size:quick` を指定した Issue について `SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md` の作成義務を免除する。一方でゲート実装は Issue の size を一切参照しないため、免除規定に正しく従って成果物を作らなかった Issue が、成果物の品質と無関係に構造上ゲートを通過できない。この矛盾は次の 2 経路として現れる。

**経路A（判定プロンプトが立証を封じる）**: ゲートレビュア判定プロンプト（`gate reviewer-prompt` の出力）は、`SPEC.md` から AC-ID を抽出できないとき「conformance は inconclusive とし human_required へ倒すこと」とレビュアへ明示指示する。conformance ルーブリック自体も「適用対象の全 AC-ID / 要件が証跡付きに充足されているか」を唯一の判定軸として書かれている。final は「conformance と falsification の両 pass かつ blocking finding 無し→approved／いずれか fail もしくは blocking→rejected／inconclusive→human_required」と機械的に導出されるため、conformance が pass にならない限り approved は導出されない。

**経路B（レビュアが起動できない）**: ゲートレビュー起動（`gate local-review` 系）は、対象セグメントの必須成果物を target SHA から読めないとき `target SHAの必須成果物を読めません: <path>` で中断する。この中断はレビュア起動前に起きるため、gate-report は conformance・falsification とも `pending`、final は `human_required`、blockers は空のまま確定する。implementation ゲートは成果物不在を許容するが、spec・design・validation の各ゲートは中断する。

観測事実（2026-08-17、profile: strict、独立レビュア 2 体）：ISSUE-680 の implementation ゲートは 13 ラウンド全てで `conformance: pending`（レビュア証跡に「AC-ID を検出できず」「conformance を立証できません」と明記）、ISSUE-692 は 9 ラウンドで同様。ISSUE-680 の validation ゲートは経路B により exit 2 でレビュア 0 体。対照として `SPEC.md` を持つ ISSUE-721 の implementation ゲートは 2 体とも conformance/falsification 双方 pass、blockers 0 件で 1 ラウンド通過した。すなわち欠陥は成果物側ではなく判定機構側にある。

害は 3 点。(1) quick の Issue が自走でマージへ到達せず、進行役が毎回判定を上書きする運用が必要になる。(2) 成果物作成の負担を減らすための quick が、結果としてゲートの手動通過を強いるため意図を失う。(3) conformance が確定しない分レビュアの重心が反証側へ移り、ラウンド数の膨張に寄与する。

## 用語

- **size シグナル**: Issue の作業規模指定。取得元は、GitHub モードは Issue のラベル `size:quick`（付与されていなければ standard）、ローカルモードは `state.yaml` の `size`（`quick|standard`、未設定は standard）。
- **risk シグナル**: Issue のリスク分類。取得元は、GitHub モードは Issue の `risk:` プレフィックスラベル（`risk:normal`・`risk:high`・`risk:unclassified`）、ローカルモードは `state.yaml` の `risk`（`unclassified|normal|high`）。未付与・複数の相反する値・読み取り失敗のいずれかで解決できない場合は `normal` とみなさず `unclassified` 相当として扱う。
- **ガードレール対象パス**: `docs/adr/`・`.agent-skill-chain/config/segments.yaml`・`AGENTS.md`・`.agent-skill-chain/schemas/`。base SHA から target SHA までの変更差分がこれらのいずれかを含む場合、quick 免除は成立しない。
- **quick 免除**: size シグナルが quick であり、かつ risk シグナルが `normal` に解決され、かつ変更差分がガードレール対象パスを含まないときに限り成立する、4 成果物の作成義務免除。既定は standard であり、自動昇格しない。
- **免除不成立**: 上記 3 条件のいずれかを満たさない状態。size シグナルまたは risk シグナルを解決できない状態を含む。免除不成立は「判定不能」ではなく、standard と同一の従来経路へ決定的に解決される状態である。
- **判定プロンプト**: レビュアへ渡される read-only の判定指示文字列。レビュアにはツール呼び出しが一切許可されないため、判定に使える情報はこの文字列に展開済みの内容のみである。
- **可変入力**: size シグナル・risk シグナル・Issue 本文。target SHA・base SHA に固定されず、同一 SHA のまま外部で変化しうる入力を指す。
- **入力スナップショット**: 判定プロンプト生成時点で解決した可変入力の値の組。attempt に 1 対 1 で対応付く。
- **attempt**: 1 回のゲートレビュー起動単位。同一の attempt ID・target SHA・base SHA・プロファイルのもとで起動されたレビュア群と、その証跡の集合を指す。
- **conformance / falsification / final**: 立証観点・反証観点の判定値（`pass|fail|pending`）と、そこから機械導出される最終判定（`approved|rejected|human_required`）。

## 前提・制約

- 本 Issue は quick 免除の範囲そのものを変更しない。憲法が定める免除規定を所与とし、判定機構側を適合させる。
- 不変条件 I8（安全側ラチェット）を緩めない。判定不能な状態から `approved` を導出してはならず、silent pass を作ってはならない。`risk != normal`（`unclassified` 含む）は非 normal 側として扱う。
- レビュアはツールを持たないため、conformance の代替判定基準は判定プロンプト内に実体として展開されていなければならない。展開できない場合は判定不能として扱う。
- 判定プロンプトは digest 照合の対象である。証跡照合は、記録済み証跡の prompt digest と、照合器が同一条件で再生成した判定プロンプトの digest を比較して成立する。再生成が照合の要であるのは、レビュアが供給した digest を無検証で信頼しないためであり、この性質は維持する。
- 上記の帰結として、可変入力を判定プロンプトへ導入する場合、再生成の入力を attempt へ固定しなければ照合が破綻し、成果物に欠陥が無くても誤った `human_required` を生む。
- 再生成の入力に使えるのは trusted base 側の起動経路が生成・保存した値のみとする。レビュアまたはワーカーが供給した値を照合入力にしない。
- 反証（falsification）側のルーブリックは Issue #729 が扱う。両者は同一の判定プロンプト生成箇所を変更するため、着手順序を調整し、先にマージした側の変更を後続が作り直さないこと。

## 入力・出力

- 入力: size シグナル、risk シグナル、base SHA から target SHA までの変更差分、target SHA 時点の成果物、Issue 本文（要求・期待する挙動・受入基準の記述）、対象ゲート ID、attempt に対応する入力スナップショット（証跡照合時）。
- 出力: 判定プロンプト文字列、入力スナップショットの耐久記録、およびゲートレビュー起動の成否（起動できた場合は verdict と gate-report）。

## 仕様判断とその根拠

**判断1: size シグナル・risk シグナルの解決不能は「判定不能」ではなく「免除不成立」とする。**

シグナルを解決できない状態は、免除を適用しない standard 経路へ決定的に解決する。これは silent pass ではない——standard 経路は AC-ID 網羅という従来どおりのより厳しい判定軸を課し、AC-ID を抽出できなければ従来どおり inconclusive へ倒れるためである。逆に「シグナル解決不能を一律に判定不能とする」案は採らない。ラベル取得の一時的失敗のような外形的事由で、適正な `SPEC.md` を持つ通常の Issue まで `approved` へ到達できなくなり、既存の全 Issue に対する回帰となるためである。判定不能として扱うのは、判定基準そのもの（AC-ID 集合または代替判定基準、および照合用の入力スナップショット）を実体化できない場合に限る。

**判断2: 可変入力は attempt ごとにスナップショットとして固定し、証跡照合は保存済みスナップショットのみを入力として再生成する。**

可変入力を digest 対象から除外する案は、判定プロンプトの実内容と証跡が乖離するため採らない。照合時に可変入力を読み直す案は、Issue 本文の編集やラベル変更だけで既存の正当な証跡が不一致となるため採らない。スナップショットを固定することで、再生成による照合の信頼性（判断の前提・制約）と、可変入力の導入（要件2）を同時に満たす。可変入力が変化した後に改めて判定が必要な場合は、既存 attempt を書き換えず新しい attempt を起こす。

## 要求 → 要件 → 受入条件

### 要求

quick 免除に正しく従った Issue が、進行役による判定の上書き無しにゲートを通過できること。同時に、成果物が本来存在すべきなのに欠落している Issue では、従来どおり安全側（`human_required`）へ倒れること。

### 要件

- 要件1: 判定機構が size シグナル・risk シグナルをモード別の取得元から解決し、「quick 免除により成果物・AC-ID が正当に存在しない状態」と「本来存在すべき成果物・AC-ID を検出できない異常状態」を区別する。
- 要件2: quick 免除が成立し AC-ID が存在しない場合、AC-ID 網羅に代わる判定基準（Issue 本文に記載された要求・期待する挙動・受入基準）を判定プロンプトへ実体として展開し、conformance が成立しうるようにする。
- 要件3: 免除不成立の場合、および quick 免除が成立していても AC-ID を抽出できる場合は、従来の AC-ID 網羅を判定軸とする。免除不成立かつ AC-ID を抽出できない場合は従来どおり conformance を inconclusive とし `human_required` へ倒す指示を維持する。
- 要件4: quick 免除が成立する場合、必須成果物が target SHA に存在しないことを理由にゲートレビュー起動を中断しない。免除が成立しない場合の中断挙動は維持する。
- 要件5: size シグナルまたは risk シグナルを解決できない場合は免除不成立として扱う（risk を `normal` とみなさない）。免除不成立から先の到達可能性は成果物の状態が決める。
- 要件6: 判定プロンプト生成に用いた可変入力の解決値を入力スナップショットとして確定し、attempt に対応付けて耐久記録へ保存する。保存先は、GitHub モードは trusted base 側のゲート状態記録、ローカルモードは `reviews/<gate>.yaml` とする。
- 要件7: 証跡照合時の判定プロンプト再生成は、attempt に対応する入力スナップショットのみを入力とし、照合時点の可変入力を読み直さない。スナップショットは trusted base 側の起動経路が生成・保存したものに限る。
- 要件8: 判定基準（AC-ID 集合または代替判定基準）または照合用の入力スナップショットを実体化・解決できない場合、`approved` を導出しない。
- 要件9: 判定プロンプトは、同一の Issue・ゲート・target SHA・base SHA・入力スナップショットに対して決定的である。
- 要件10: GitHub モードとローカルモードの双方で上記が成立し、自動テストで検証される。

### 受入条件（Acceptance Criteria）

#### AC-1: quick 免除下の SPEC.md 不在で inconclusive 指示を出さない

- Given: quick 免除が成立する Issue があり、target SHA に `SPEC.md` が存在しない。
- When: 当該 Issue の任意のゲートについて判定プロンプトを生成する。
- Then: 「conformance は inconclusive とし human_required へ倒すこと」に相当する指示が出力に含まれず、代わりに AC-ID が quick 免除により存在しない旨と、それに代わる判定基準が明示される。
- 検証方法見込み: `automated`

#### AC-2: quick 免除下でも conformance が pass へ到達しうる

- Given: AC-1 と同じ状況で、代替判定基準が判定プロンプトへ実体として展開されている。
- When: レビュアが conformance と falsification の双方を pass、blocking finding 無しと判定した verdict を返す。
- Then: final が `approved` として導出され、判定プロンプト由来の理由で conformance が pending に固定されることがない。
- 検証方法見込み: `automated`

#### AC-3: quick でない Issue の従来挙動を維持する

- Given: size シグナルが quick でない Issue があり、target SHA に `SPEC.md` が存在しない、または `SPEC.md` はあるが AC-ID を 1 件も抽出できない。
- When: 判定プロンプトを生成する。
- Then: 従来どおり conformance を inconclusive とし `human_required` へ倒す指示が出力に含まれる。
- 検証方法見込み: `automated`

#### AC-4: 免除不成立時は成果物の状態に応じた従来挙動へ倒れる

- Given: size シグナルは quick だが免除不成立である Issue（risk シグナルが `normal` 以外に解決される、risk シグナルを解決できない、変更差分がガードレール対象パスを含む、または size シグナルを解決できない、のいずれか）。
- When: 判定プロンプトを生成する。
- Then: quick 用の代替判定基準は適用されない。target SHA に AC-ID を抽出できる `SPEC.md` が存在する場合は、抽出された AC-ID の全件網羅を conformance の判定軸とする指示が出力され、conformance は pass へ到達しうる。AC-ID を抽出できない場合は AC-3 と同一の inconclusive 指示が出力される。
- 検証方法見込み: `automated`

#### AC-5: quick でも SPEC.md がある場合は AC-ID 網羅で判定する

- Given: quick 免除が成立する Issue だが、target SHA に AC-ID を含む `SPEC.md` が存在する。
- When: 判定プロンプトを生成する。
- Then: 従来どおり抽出された AC-ID の全件網羅を conformance の判定軸とする指示が出力され、代替判定基準への切り替えは起きない。
- 検証方法見込み: `automated`

#### AC-6: 代替判定基準が実体として展開される

- Given: quick 免除が成立し、target SHA から AC-ID を 1 件も抽出できない。
- When: 判定プロンプトを生成する。
- Then: Issue 本文に記載された要求・期待する挙動・受入基準が判定プロンプト内に文字列として展開される。Issue 本文を取得できない場合、判定プロンプトの生成は失敗せず、AC-3 と同一の inconclusive 指示を出力へ含める（`human_required` へ倒れる経路のみを残し、pass を導出しうる状態にしない）。
- 検証方法見込み: `automated`

#### AC-7: quick 免除下でゲートレビューが起動でき、判定対象が明示される

- Given: quick 免除が成立する Issue があり、target SHA に当該ゲートの必須成果物（spec は `SPEC.md`、design は `DESIGN.md`・`PLAN.md`、validation は `VALIDATION.md`）が存在しない。
- When: 当該ゲートのレビューを起動する。
- Then: `target SHAの必須成果物を読めません` に相当する中断が発生せず、レビュアが起動され、conformance と falsification の判定値を伴う gate-report が生成される。判定プロンプトには、不在の必須成果物が quick 免除により不在である旨と、判定対象として代替判定基準が明示される（判定対象の成果物が 1 件も無い場合も同様に明示し、無言で空欄にしない）。spec・design・validation の 3 ゲートすべてを対象に含める。
- 検証方法見込み: `automated`

#### AC-8: 免除不成立時の必須成果物欠落は従来どおり中断する

- Given: quick 免除が成立しない Issue で、target SHA に当該ゲートの必須成果物が存在しない。
- When: 当該ゲートのレビューを起動する。
- Then: 従来どおり中断し、`approved` を導出しない。
- 検証方法見込み: `automated`

#### AC-9: 同一の入力スナップショットに対する判定プロンプト生成が決定的である

- Given: 同一の Issue・ゲート・target SHA・base SHA・入力スナップショット。
- When: 判定プロンプトを複数回生成する。
- Then: 出力が完全に一致し、prompt digest が一致する。quick 経路の追加によって既存の決定性が損なわれない。
- 検証方法見込み: `automated`

#### AC-10: 可変入力が変化しても記録済み attempt の証跡照合が成立する

- Given: attempt の記録後に、Issue 本文・size シグナル・risk シグナルのいずれかが変化している（target SHA と base SHA は不変）。
- When: 当該 attempt の証跡を照合する。
- Then: 照合器は attempt に対応付いた入力スナップショットから判定プロンプトを再生成し、その digest が記録済み prompt digest と一致する。照合時点の可変入力の変化は照合結果を変えない。
- 検証方法見込み: `automated`

#### AC-11: risk シグナルを解決できない場合は免除不成立とする

- Given: risk シグナル（GitHub モードは Issue の `risk:` ラベル、ローカルモードは `state.yaml` の `risk`）が未付与、複数の相反する値、または読み取り失敗により解決できない Issue。size シグナルは quick である。
- When: quick 免除の成否を判定する。
- Then: risk を `normal` とみなさず免除不成立として扱い、quick 用の代替判定基準は適用されない。以降の挙動は AC-4 と同一である。
- 検証方法見込み: `automated`

#### AC-12: 判定基準を実体化できない場合に approved を導出しない

- Given: 次のいずれかの状態。(i) quick 免除が成立し AC-ID が不在で、代替判定基準を実体として展開できない。(ii) 免除不成立で、当該ゲートの必須成果物を target SHA から読めない。(iii) attempt に対応する入力スナップショットを解決できない、またはスナップショットから再生成した prompt digest が記録済み digest と一致しない。
- When: 判定プロンプト生成、ゲートレビュー起動、または証跡照合を行う。
- Then: いずれの場合も `approved` を導出せず、中断するか `human_required` へ倒れる。判定不能を pass として扱う経路が新設されない。size シグナル・risk シグナルの解決不能は本 AC の対象外であり、免除不成立として AC-4 の判定軸が適用される。
- 検証方法見込み: `automated`

#### AC-13: 全 AC に対応する自動テストが両モードを対象に存在する

- Given: 本 Issue の変更が適用されたリポジトリ。
- When: `npm test` を実行する。
- Then: AC-1 から AC-12 のそれぞれに対応する自動テストが実行されすべて成功する。このうち size シグナル・risk シグナルの解決を含む AC については、GitHub モード由来のシグナル（Issue ラベル）とローカルモード由来のシグナル（`state.yaml`）の双方を入力とするケースを含む。本 AC は他 AC のテスト集合の存在を要求するメタ受入条件であり、自己言及を避けるため列挙対象に自身を含めない。
- 検証方法見込み: `automated`

## 完了条件

- AC-1 から AC-13 のすべてが満たされ、対応する自動テストが成功する（AC-13 は AC-1 から AC-12 のテスト集合が存在し成功することをもって満たされる）。
- 既存のゲート判定・証跡照合の自動テストが回帰しない。
- 常時必須の検証（lint / format、型検査、単体テスト、変更範囲の結合テスト、SAST、依存関係・secret スキャン）が成功する。本変更は利用者操作画面・API 境界・認証認可・性能ホットパス・DB migration・デプロイ運用・外部連携のいずれにも該当しないため、それらに紐づく追加検証は適用しない。

## 未決事項

- quick 免除下の conformance 判定基準として、Issue 本文以外の入力（実装差分・テスト実行結果・CI 結果）をどこまで判定プロンプトへ展開するかは設計セグメントで確定する。
- 入力スナップショットの具体的なフィールド構造・スキーマ版・attempt との対応付けの表現方法は設計セグメントで確定する。保存先（GitHub モードは trusted base 側のゲート状態記録、ローカルモードは `reviews/<gate>.yaml`）と、照合が保存済みスナップショットのみを入力とすることは本仕様で確定済みとする。
- 本変更の適用前に記録され入力スナップショットを持たない attempt について、移行期に一括で再判定を促す運用手順は進行役の判断で確定する。当該 attempt の判定結果自体は AC-12 により `human_required` へ倒れることが本仕様で確定済みである。
- Issue #729（反証ルーブリック）との着手・マージ順序の具体的な調整方法は進行役の判断で確定する。

## スコープ外

- quick 免除の対象そのものの見直し（憲法である `AGENTS.md` の改定）。
- falsification 側のルーブリックの停止条件・severity 基準・過去ラウンド反映（Issue #729）。
- 変更規模に応じた反証強度の調節（Issue #698）。
- strict attempt の実行独立性とレビュー履歴 pagination（Issue #732）。
- GitHub モードにおける I2 の自動 CI 強制の再導入。
