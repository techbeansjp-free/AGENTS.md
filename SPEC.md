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

- **quick 免除**: Issue の size シグナル（GitHub モードは Issue ラベル `size:quick`、ローカルモードは `state.yaml` の `size: quick`）が quick であり、かつ risk が `normal` であり、かつ変更差分が `docs/adr/`・`.agent-skill-chain/config/segments.yaml`・`AGENTS.md`・`.agent-skill-chain/schemas/` のいずれも含まないときに限り成立する、4 成果物の作成義務免除。既定は standard であり、自動昇格しない。
- **免除不成立**: size シグナルが quick だが上記ガードレールに抵触する状態、およびシグナル自体を解決できない状態（安全側として standard と同じ扱いにする）。
- **判定プロンプト**: レビュアへ渡される read-only の判定指示文字列。レビュアにはツール呼び出しが一切許可されないため、判定に使える情報はこの文字列に展開済みの内容のみである。
- **conformance / falsification / final**: 立証観点・反証観点の判定値（`pass|fail|pending`）と、そこから機械導出される最終判定（`approved|rejected|human_required`）。

## 前提・制約

- 本 Issue は quick 免除の範囲そのものを変更しない。憲法が定める免除規定を所与とし、判定機構側を適合させる。
- 不変条件 I8（安全側ラチェット）を緩めない。判定不能な状態から `approved` を導出してはならず、silent pass を作ってはならない。
- レビュアはツールを持たないため、conformance の代替判定基準は判定プロンプト内に実体として展開されていなければならない。展開できない場合は判定不能として扱う。
- 判定プロンプトは digest 照合の対象である。同一の Issue・ゲート・target SHA・base SHA に対して決定的でなければ、証跡照合が破綻して誤った `human_required` を生む。
- 反証（falsification）側のルーブリックは Issue #729 が扱う。両者は同一の判定プロンプト生成箇所を変更するため、着手順序を調整し、先にマージした側の変更を後続が作り直さないこと。

## 入力・出力

- 入力: Issue の size シグナルと risk、base SHA から target SHA までの変更差分、target SHA 時点の成果物、Issue 本文（要求・期待する挙動・受入基準の記述）、対象ゲート ID。
- 出力: 判定プロンプト文字列、およびゲートレビュー起動の成否（起動できた場合は verdict と gate-report）。

## 要求 → 要件 → 受入条件

### 要求

quick 免除に正しく従った Issue が、進行役による判定の上書き無しにゲートを通過できること。同時に、成果物が本来存在すべきなのに欠落している Issue では、従来どおり安全側（`human_required`）へ倒れること。

### 要件

- 要件1: 判定機構が「quick 免除により成果物・AC-ID が正当に存在しない状態」と「本来存在すべき成果物・AC-ID を検出できない異常状態」を区別する。
- 要件2: 前者では、AC-ID 網羅に代わる判定基準（Issue 本文に記載された要求・期待する挙動・受入基準）を判定プロンプトへ実体として展開し、conformance が成立しうるようにする。
- 要件3: 後者では、従来どおり conformance を inconclusive とし `human_required` へ倒す指示を維持する。
- 要件4: quick 免除が成立する場合、必須成果物が target SHA に存在しないことを理由にゲートレビュー起動を中断しない。免除が成立しない場合の中断挙動は維持する。
- 要件5: size シグナルを解決できない場合は standard として扱い、安全側の挙動を選ぶ。
- 要件6: 判定プロンプトの決定性と digest 照合の成立を維持する。
- 要件7: GitHub モードとローカルモードの双方で上記が成立し、自動テストで検証される。

### 受入条件（Acceptance Criteria）

#### AC-1: quick 免除下の SPEC.md 不在で inconclusive 指示を出さない

- Given: quick 免除が成立する Issue があり、target SHA に `SPEC.md` が存在しない。
- When: 当該 Issue の任意のゲートについて判定プロンプトを生成する。
- Then: 「conformance は inconclusive とし human_required へ倒すこと」に相当する指示が出力に含まれず、代わりに AC-ID が quick 免除により存在しない旨と、それに代わる判定基準が明示される。
- 検証方法見込み: `automated`

#### AC-2: quick 免除下でも conformance が pass へ到達しうる

- Given: AC-1 と同じ状況で、成果物に欠陥が無い。
- When: レビュアが conformance と falsification の双方を pass、blocking finding 無しと判定した verdict を返す。
- Then: final が `approved` として導出され、判定プロンプト由来の理由で conformance が pending に固定されることがない。
- 検証方法見込み: `automated`

#### AC-3: quick でない Issue の従来挙動を維持する

- Given: size シグナルが quick でない Issue があり、target SHA に `SPEC.md` が存在しない、または `SPEC.md` はあるが AC-ID を 1 件も抽出できない。
- When: 判定プロンプトを生成する。
- Then: 従来どおり conformance を inconclusive とし `human_required` へ倒す指示が出力に含まれる。
- 検証方法見込み: `automated`

#### AC-4: 免除不成立時は quick 指定でも従来挙動へ倒れる

- Given: size シグナルは quick だが、risk が `normal` ではない、または変更差分がガードレール対象パスを含む、または size シグナルを解決できない。
- When: 判定プロンプトを生成する。
- Then: AC-3 と同一の従来挙動になり、quick 用の代替判定基準は適用されない。
- 検証方法見込み: `automated`

#### AC-5: quick でも SPEC.md がある場合は AC-ID 網羅で判定する

- Given: quick 免除が成立する Issue だが、target SHA に AC-ID を含む `SPEC.md` が存在する。
- When: 判定プロンプトを生成する。
- Then: 従来どおり抽出された AC-ID の全件網羅を conformance の判定軸とする指示が出力され、代替判定基準への切り替えは起きない。
- 検証方法見込み: `automated`

#### AC-6: 代替判定基準が実体として展開される

- Given: quick 免除が成立し、AC-ID が存在しない。
- When: 判定プロンプトを生成する。
- Then: Issue 本文に記載された要求・期待する挙動・受入基準が判定プロンプト内に文字列として展開される。Issue 本文を取得できない場合は、pass を導出しうる状態にせず、生成を失敗させるか従来の inconclusive 指示へ倒す。
- 検証方法見込み: `automated`

#### AC-7: quick 免除下でゲートレビューが起動できる

- Given: quick 免除が成立する Issue があり、target SHA に当該ゲートの必須成果物（spec は `SPEC.md`、design は `DESIGN.md`・`PLAN.md`、validation は `VALIDATION.md`）が存在しない。
- When: 当該ゲートのレビューを起動する。
- Then: `target SHAの必須成果物を読めません` に相当する中断が発生せず、レビュアが起動され、conformance と falsification の判定値を伴う gate-report が生成される。spec・design・validation の 3 ゲートすべてを対象に含める。
- 検証方法見込み: `automated`

#### AC-8: 免除不成立時の必須成果物欠落は従来どおり中断する

- Given: quick 免除が成立しない Issue で、target SHA に当該ゲートの必須成果物が存在しない。
- When: 当該ゲートのレビューを起動する。
- Then: 従来どおり中断し、`approved` を導出しない。
- 検証方法見込み: `automated`

#### AC-9: 判定プロンプトの決定性と digest 照合を維持する

- Given: 同一の Issue・ゲート・target SHA・base SHA。
- When: 判定プロンプトを複数回生成し、証跡照合側でも同じ条件で再生成する。
- Then: 出力が一致し、prompt digest 照合が成立する。quick 経路の追加によって既存の決定性が損なわれない。
- 検証方法見込み: `automated`

#### AC-10: 両モードを対象とする自動テストが存在する

- Given: 本 Issue の変更が適用されたリポジトリ。
- When: `npm test` を実行する。
- Then: GitHub モード（`size:quick` ラベル由来のシグナル）とローカルモード（`state.yaml` の `size` 由来のシグナル）の双方について、AC-1 から AC-9 の挙動を検証するテストが実行され、すべて成功する。
- 検証方法見込み: `automated`

#### AC-11: silent pass を生まない

- Given: 判定に必要な入力（size シグナル、Issue 本文、成果物のいずれか）を解決できない状態。
- When: 判定プロンプト生成またはゲートレビュー起動を行う。
- Then: `approved` を導出せず、失敗するか `human_required` へ倒れる。判定不能を pass として扱う経路が新設されない。
- 検証方法見込み: `automated`

## 完了条件

- AC-1 から AC-11 のすべてが満たされ、対応する自動テストが成功する。
- 既存のゲート判定・証跡照合の自動テストが回帰しない。
- 常時必須の検証（lint / format、型検査、単体テスト、変更範囲の結合テスト、SAST、依存関係・secret スキャン）が成功する。本変更は利用者操作画面・API 境界・認証認可・性能ホットパス・DB migration・デプロイ運用・外部連携のいずれにも該当しないため、それらに紐づく追加検証は適用しない。

## 未決事項

- quick 免除下の conformance 判定基準として、Issue 本文以外の入力（実装差分・テスト実行結果・CI 結果）をどこまで判定プロンプトへ展開するかは設計セグメントで確定する。
- Issue #729（反証ルーブリック）との着手・マージ順序の具体的な調整方法は進行役の判断で確定する。

## スコープ外

- quick 免除の対象そのものの見直し（憲法である `AGENTS.md` の改定）。
- falsification 側のルーブリックの停止条件・severity 基準・過去ラウンド反映（Issue #729）。
- 変更規模に応じた反証強度の調節（Issue #698）。
- strict attempt の実行独立性とレビュー履歴 pagination（Issue #732）。
- GitHub モードにおける I2 の自動 CI 強制の再導入。
