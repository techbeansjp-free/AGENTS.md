# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 3（外部reviewer指摘の取り込み、2回目） |
| 対象SHA・文書ダイジェスト | `ed7e87bf2716f33e5f10bd0cfc46f051dfc65b54` |
| 比較基点 | `4d83166d3e6167f9ebf6802f43fba0bccc7322a9` |
| H_impl | `ed7e87bf2716f33e5f10bd0cfc46f051dfc65b54` |
| 対象差分 | `4d83166d3e6167f9ebf6802f43fba0bccc7322a9..ed7e87bf2716f33e5f10bd0cfc46f051dfc65b54`。7 path。`dist/`配下の変更は無い（`scripts/`はbuild対象外）。**ラウンド2の是正を前進commitで行ったため本artifact自身がこの範囲に入り、表は7行になる** |
| 対象外 | job-levelの`if:`と`needs:`、実行時式の真偽判定、`release.yml`の内容変更、本repositoryでの実走行によるGitHub挙動の再確認 |
| 残り予算 | 3ラウンドのうち3使用。**残り0**。以後は収束後のHEAD移動に対する取り直し1回（round 4）だけが開く |
| ラウンド数 | 3 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260906_224206_bugfix-配布gate到達性検査がjob-levelのcontinue-on-errorを解釈しておらず-失敗の握り潰しが未確認のまま残る |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-020。引用: 「**job-levelの条件と`needs:`は対象にしない。**」 |
| 成果物行数 | `scripts/` +71行。test +176行。仕様 +6行 |
| 縮小の先行評価 | 新しい機構を作っていない。既存の`STEP_FAULT_TOLERANCE`と`isStaticFalse`を再利用し、追加は行ごとの許容表を返す純関数1つ、`ReleaseRunStep`の1 field、失格条件1項、拒否理由1件である。YAML parserの導入案は依存増と二重解釈を理由に採らなかった |
| 実施者・日時 | reviewer / 2026-09-06 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類、差分全文、条件ごとの変異試験 | standard（受理集合を狭める方向の変更） | project choiceのprovider上限に従う | project choiceのtier mappingに従う | 未解決Critical/Highがあれば停止し次roundで再評価する | reviewerはimplementerと別contextで起動する。reviewerは対象差分pathを1件も変更していない |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #1236、staging `01_要件定義.md`§9 | AC-01〜AC-04、INV-01〜INV-03 | 一次資料 |
| GitHubの挙動 | `actions/toolkit` Issue #1739 の再現報告 | job-levelの`continue-on-error: true`で失敗したjobについて、後続jobが読む`needs`のresultが`success`になる | 外部のimmutable証拠 |
| 起票時の未確認事項 | Issue #1236 本文 | 「どちらであるかを私は実測していない。GitHub Actionsの仕様を根拠なしに断定しない」 | 一次資料 |
| 差分 | `4d83166d..ed7e87bf` | 7 path | 既存コード |
| テスト | `npm test` | 1581 scenarios（1565 passed、16 skipped）、失敗0 | テスト出力 |
| conformance | `npm run conformance:check` | 合格（project rule 21件、orphan 0件、I1〜I12、実在source/export、成功SCN証拠、固定model slug 0件）。1581 scenarios（1565 passed、16 skipped）、失敗0 | テスト出力 |
| 変異試験 | 8変異を1件ずつ適用 | **8件すべてkill。復元後に38 scenario再合格を確認した** | テスト出力 |
| commit後external | PR #1247 | 必須check 3件が`success`。**外部reviewer（CodeRabbit）がMajor 1件を指摘** | 外部のimmutable証拠 |
| ラウンド2の是正 | `scripts/`1件、`test/`2件、`docs/specs/`3件 | `ed7e87bf2716f33e5f10bd0cfc46f051dfc65b54` | Git観測 |
| commit後external（2回目） | PR #1247 | 必須check 3件が`success`。**外部reviewer（CodeRabbit）がMinor 3件を指摘** | 外部のimmutable証拠 |
| ラウンド3の是正 | `docs/specs/`1件 | `ed7e87bf2716f33e5f10bd0cfc46f051dfc65b54` | Git観測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **確認した。** `checkDistributionGateReachability` → `releaseRunSteps` → `jobFaultToleranceByLine` の単方向で、新関数はfileへも外部へも触れない。本artifactへ自身のcommit SHAを書いていない
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけであり、trusted providerが観測したPR/CI/reviewが`H_final`へ一致している: `H_impl`は`ed7e87bf2716f33e5f10bd0cfc46f051dfc65b54`。本artifactの1 fileだけを加えて`H_final`にする
- reviewer stable IDがPR author/provider観測済み`H_impl` author stable IDと異なる: reviewerはimplementerと別contextで起動する
- 既定branch追随を行った場合: **行っていない。** baseは`4d83166d3e6167f9ebf6802f43fba0bccc7322a9`のままである

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `scripts/check_conformance.ts` | M | 本repository | project | 行ごとの許容表を返す`jobFaultToleranceByLine`と、失格条件1項、拒否理由1件（SCN-INT-DISTGATE-032〜038） | pass。既存の`STEP_FAULT_TOLERANCE`と`isStaticFalse`を再利用する | REQ-SQ-020 / AC-01〜AC-04 / SCN-INT-DISTGATE-032〜038 | 読み取り専用。revertで戻る | pass |
| `test/features/integration/distribution-gate-reachability.feature` | M | 本repository | evidence | SCN-INT-DISTGATE-032〜038のscenario定義 | pass | AC-01〜AC-04 | 一時directoryのfixtureのみ | pass |
| `test/steps/distribution-gate-reachability.steps.ts` | M | 本repository | evidence | 上記のworkflow fixture 4件と拒否理由を名指しするThen | pass。既存の`build` helperを再利用 | 同上 | 同上 | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | 本repository | spec | REQ-SQ-020へjob-levelの条項を追加し強制SCNを名指しする | pass | REQ-SQ-020、AC-SQ-020 | 追加なし | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | 本repository | spec | REQ-SQ-020行へSCN-INT-DISTGATE-032〜038 | pass | 同上 | 同上 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | 本repository | spec | 本変更の履歴行 | pass | 同上 | 同上 | pass |
| `docs/reviews/164_課題1236job-level失敗許容レビュー.md` | A | 本repository | evidence | 本レビュー成果物そのもの。**ラウンド2の是正を前進commitで行った結果`比較基点..H_impl`へ入った**ため自己行を置く | pass | REQ-SQ-020 / AC-01〜AC-04 / SCN-INT-DISTGATE-032〜038 | 版管理下に置く。revertで復旧 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **確認した。** `git diff --name-only`が返す7件と表の7行が一致する。`scripts/`はbuild対象外のため`dist/`に差分が出ない
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **確認した。** 検査はproject層の`scripts/`に閉じ、契約は`docs/specs/`へ置いた
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **確認した。** ラウンド2の是正は`scripts/check_conformance.ts`の部分木判定1箇所と、それを固定するtest 3 scenario、対応する仕様3 fileに閉じている

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| ID | 発見 | 対処 |
|---|---|---|
| DISC-001 | **診断文に`needs.`に続く山括弧付きの語を書くと、`issue validate`が未解決placeholderとして拒否する。** 製品の診断文とstaging成果物の双方が同じ表記を使うため両方が通らない | 意味を変えずに山括弧を外した。製品の診断文、test assertion、staging 00〜01 を同時に書き換えた |
| DISC-002 | **`steps:`部分木を除外しないとstep-levelの`continue-on-error`を二重に数え、job全体を不当に失格させる** | 設計段階で除外規則を入れ、SCN-INT-DISTGATE-035と変異M5で固定した |
| DISC-003 | **変更履歴の更新文書欄へ`dist/`を書いていたが、`scripts/`はbuild対象外で差分が出ない** | `git status`の実測で気付き、記載から外した。**未実行の事実を書かない** |
| DISC-004 | **`steps:`の部分木をindent深さだけで切っていたため、indentless sequenceの2件目以降のstep-level属性をjob-levelとして拾っていた。** YAMLは`steps:`と同じ字下げの`-`をその値として認める | 外部reviewerが指摘した。**実測で再現してから是正した。** SCN-INT-DISTGATE-036と変異M7で固定した |
| DISC-005 | **変異試験で追加の欠落が出た。** 部分木判定を常に真へ倒す変異が生存し、`steps:`より後ろへ置いたjob-level属性を固定するscenarioが無いことが分かった | SCN-INT-DISTGATE-038を足して両方killした。**是正の変異試験が、是正とは別のfixture欠落を見つけた** |
| DISC-007 | **変更履歴の行を8列の「旧26件の移行対応」表の末尾へ挿入していた。** file末尾の定型文をanchorにしたため、9列の変更履歴表ではなく後続の8列表へ入った。**#1245の行は既にmainへ入っている。** 機械検査は列数の不一致を検出しない | 外部reviewerが指摘した。両行を9列表の先頭へ移した。表の内容は変えていない |
| DISC-006 | **artifactへ書いた`H_impl`のSHA末尾を捏造していた。** 前進commitの実値を確認せずに書いた | `git rev-parse HEAD`で実値へ置換し、artifact内の全40桁hexが実在commitであることを`git cat-file -e`で確認した |

### 2.1 受け入れ条件とシナリオ

| AC | 内容 | SCN | 結果 |
|---|---|---|---|
| AC-01 | job-levelの`continue-on-error: true`を拒否し、理由が原因と是正手順を示す | SCN-INT-DISTGATE-032 | pass |
| AC-02 | job-levelの静的な`false`を受理する | SCN-INT-DISTGATE-033 | pass |
| AC-03 | gate呼び出しを持たない別jobの`continue-on-error: true`で失格させない | SCN-INT-DISTGATE-034 | pass |
| AC-04 | step-levelの静的な`false`をjob-levelの許容と読み違えない | SCN-INT-DISTGATE-035 | pass |
| AC-01（追加検証） | indentless sequenceのstep-level設定をjob-levelと読み違えない | SCN-INT-DISTGATE-036 | pass |
| AC-01（追加検証） | indentless sequenceでもjob-levelの失敗許容を検出する | SCN-INT-DISTGATE-037 | pass |
| AC-01（追加検証） | `steps:`より後ろへ置いたjob-levelの失敗許容も検出する | SCN-INT-DISTGATE-038 | pass |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | 不可逆な配布（tag自体が`npx github:#<tag>`の配布アドレスになる）の直前検証の到達性を扱う。秘密情報と個人情報は扱わない | INV-01。受理集合を狭める方向にだけ働くことを、既存SCN-INT-DISTGATE-001〜031の非回帰とSCN-INT-DISTGATE-033〜035で確認した。拒否理由はworkflowの構造だけを述べ内容を引用しない |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | どの条件で失格したかを名指ししないと是正できない | SCN-INT-DISTGATE-032が拒否理由の全文を照合する。step-levelの理由と別文言にした。出力はerror文字列の配列だけで、log保持・rotation・監視・常駐processを持たない |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | CIとCLIが非対話で実行する静的検査であり、人が操作する画面・入力要素・focus順序・支援技術の対象になる成果物を持たない | 差分6 pathのいずれも表示層に属さない |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 生む出力はerror文字列だけであり、色・寸法・typography・間隔を決めるtokenを適用する描画対象が存在しない | DC-UXと同じ根拠 |

## 3. 肯定的評価

- **起票時の未確認事項を確定してから着手した。** Issue本文は「どちらであるかを私は実測していない」として2つの確認方法を挙げ、`failure`ならnot-a-bugとしてcloseすると定めていた。`actions/toolkit` Issue #1739 の再現報告で `success` であることを確認した。**確認せずに実装していれば、不要な失格条件を入れていた可能性がある。**
- **#980の根拠がどこまで及ぶかを切り分けた。** 「job全体のskipは後続jobの条件へ伝播して配布を止める」はskipについては成立する。握り潰しはskipではないため及ばない。**根拠の適用範囲を検査せずに一括で対象外にしていたのが元の欠陥である。**
- **受理集合を狭める方向にだけ動く。** 拒否していた形を受理する経路を追加していない。既存31 scenarioの判定は変わらない。
- **`steps:`部分木の二重計上を設計段階で塞いだ。** 塞がなければjob全体を不当に失格させる。変異M5が固定する。
- **拒否理由がstep-levelと区別できる。** 原因（後続jobが読む result が `success` になること）と是正手順（当該jobから外すこと）を含める。SCN-INT-DISTGATE-032が全文を照合する。
- **未実行の事実を成果物へ書かなかった。** 変更履歴の更新文書欄へ`dist/`を書いていたが、`git status`の実測で差分が無いことを確認して外した。

## 4. 敵対的評価

- **本repositoryでの実走行では確認していない。** 根拠は `actions/toolkit` Issue #1739 の再現報告である。**GitHubの挙動が変われば、この失格条件は不要なまま残る。** ただしその場合も受理集合が狭まるだけで、未検証contentが配布される方向へは働かない。
- **字面検査であり意味を見ない。** YAMLの構造を解析していないため、行の字下げ幅に依存する。anchorやalias、flow styleのmapping（`validate: {continue-on-error: true}`）は検出しない。**現行の`release.yml`はblock styleだが、この限定は残る。**
- **字下げ幅への依存が実際に欠陥を生んだ。** indentless sequenceの誤検出は外部reviewerが見つけた。**私の敵対的評価は「字面検査の限定」を一般論として書いていたが、その限定が具体的にどの入力で破れるかを1件も挙げていなかった。** flow styleとanchorについても同じ状態が残っている。
- **是正の変異試験が別の欠落を見つけた。** 部分木判定を常に真へ倒す変異が生存し、`steps:`より後ろへ置いたjob-level属性のscenarioが無いことが分かった。**当初の6変異はこの境界を触っていなかった。**
- **`jobs:`が`^jobs:$`の完全一致でしか始まらない。** 前後に空白やコメントが付く形は走査を始めない。既存の`releaseRunSteps`も同じ前提だが、本変更で前提が1つ増えた。
- **本検査は信頼境界ではない。** `scripts/check_conformance.ts`は保護対象ではなく、同一PRで失格条件ごと削除できる。担保するのは偶発的劣化の回帰検出である。
- **job-levelの`if:`と`needs:`は依然として対象外である。** #980の根拠が有効だと判断したが、`needs`のresultを`if:`条件で参照する形（`if: needs.validate.result != 'failure'`）は、skipとの組み合わせで同じfail-openを作りうる。**この組み合わせは測っていない。**
- **`release.yml`は現在job-levelの`continue-on-error`を使っていない。** したがって本変更は既存の欠陥を塞いだのではなく、**将来の書き方を禁じただけである。** 実害の観測は無い。

## 5. 指摘

| ID | 分類 | 内容 | 対処 |
|---|---|---|---|
| F-01 | Medium | **本repositoryでの実走行によるGitHub挙動の確認をしていない。** 根拠は外部の再現報告1件 | **本Issueでは扱わない。** 使い捨てrepositoryへのpushが要る。要件本文と設計へ限定を明記した。誤っていても受理集合が狭まるだけである |
| F-02 | Medium | **`needs`のresultを`if:`条件で参照する形とskipの組み合わせを測っていない。** 同型のfail-openを作りうる | **本Issueでは扱わない。** 敵対的評価へ記録した。対象外境界（job-levelの`if:`と`needs:`）に属する |
| F-03 | Low | **flow styleのmappingとYAML anchorを検出しない。** 字面検査の限定 | **本Issueでは扱わない。** 既存の`releaseRunSteps`と同じ限定である |
| F-04 | Low | **実害の観測が無い。** `release.yml`は現在この形を使っていない | **本Issueでは扱わない。** 予防的な失格条件であることを敵対的評価へ記録した |
| F-05 | Low | 診断文の山括弧が`issue validate`のplaceholder検出と衝突した | 是正済み。DISC-001 |
| F-06 | Low | 変更履歴へ`dist/`を書いていたが差分が無かった | 是正済み。DISC-003 |
| CR-01 | Major | **`steps:`のindentless sequenceを部分木として除外していなかった。** 2件目以降のstep-level `continue-on-error` をjob-levelとして拾い、無関係なstepの設定だけで有効なworkflowを拒否していた | 是正済み。実測で再現してから直した。SCN-INT-DISTGATE-036と変異M7で固定した。DISC-004 |
| F-07 | Low | **`steps:`より後ろへ置いたjob-level属性を固定するscenarioが無かった** | 是正済み。SCN-INT-DISTGATE-038。DISC-005 |
| F-08 | Low | **artifactの`H_impl`のSHA末尾を捏造した** | 是正済み。実値へ置換し全40桁hexの実在を確認した。DISC-006 |
| CR-02 | Low | **変更履歴の変異試験件数がラウンド2の記録と一致しない。** 「6件」のままで追加2件を含んでいなかった | 是正済み。「初回6件、ラウンド2で追加2件、計8件」へ直した |
| CR-03 | Low | **個別監査表のSCN範囲が032〜035のままで、ラウンド2で追加した036〜038を含んでいなかった** | 是正済み。表は`比較基点..H_impl`の最終監査範囲を示すため032〜038へ統一した |
| CR-04 | Medium | **変更履歴の行が8列の表へ9セルで挿入されていた。** #1245の行も同じ誤りでmainへ入っている | 是正済み。両行を9列表へ移した。DISC-007 |

未解決のCritical/Highは0件である。

## 6. ラウンド固有の確認

### ラウンド3（外部reviewer指摘の取り込み、2回目）

CR-02・CR-03・CR-04を対象にした是正である。**3件とも実測で確認してから是正した。** いずれも`docs/`配下の記録の整合であり、製品codeとtestへ触れていない。`fixedDiff`はラウンド2のHEADからの実差分である。**予算3ラウンドを使い切った。** 以後は収束後のHEAD移動に対する取り直し1回だけが開く。

### ラウンド2（外部reviewer指摘の取り込み）

CR-01を対象にした是正である。**実測で再現してから是正した。** `fixedDiff`はラウンド1のHEADからの実差分である。取り込みは`01_開発ワークフロー.md`が定める条件を満たす。是正の変異試験が別の欠落（F-07）を見つけたため、同じラウンドで併せて塞いだ。

### ラウンド1

固定initial HEADに対する全scope reviewである。`previousBlocking`、`fixedDiff`、`adjacentScope`はいずれも空である。

## 7. テスト結果

実行したcommandの一覧: `npm run lint`、`npm run format:check`、`npm run typecheck`、`npm run trace:check`、`npm run docs:format`、`npm run test:format`、`npm run build`、`npm test`、`npm run conformance:check`、変異試験script

全layerの合計: **1581 scenarios（1565 passed、16 skipped）、失敗0**

失敗またはskipがある層: skipは16 scenarioで、いずれも本変更以前から存在する環境依存scenarioである。**本変更が追加した4 scenarioはいずれもpassである。**

**gateはすべて直列で実行した。** `scripts/`はbuild対象外のため`dist/`に差分が出ず、commitへ含めていない。

runnerは`@cucumber/cucumber`、`projectChoices.gherkinDialect`は英語keyword・日本語説明である。

対応する成功CI runの参照: ラウンド1の`a2c02a7e`とラウンド2の`d1f2a145`に対する必須check 3件がいずれも`success`。**ラウンド3のHEADに対するrunはpush後に観測する。**

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `scripts/check_conformance.ts` | 入る | `conformance:check`の受理集合が狭まる。job-levelの`continue-on-error`を持つworkflowが新たに拒否される |
| `test/features/integration/distribution-gate-reachability.feature` | 入る | なし |
| `test/steps/distribution-gate-reachability.steps.ts` | 入る | なし |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | 入らない | なし |
| `docs/specs/15_要件追跡/00_追跡表.md` | 入らない | なし |
| `docs/specs/15_要件追跡/01_変更履歴.md` | 入らない | なし |
| `docs/reviews/164_課題1236job-level失敗許容レビュー.md` | 入らない | なし |

判断: 配布物を更新した

根拠: `scripts/`は`npm pack`の対象であり利用者が実行する。**受理集合が狭まる方向の変更であるため、既存の利用者のworkflowが新たに拒否されうる。** ただし現行の`release.yml`は該当せず、利用側projectが同じ形を使っている場合にだけ影響する。拒否理由が是正手順を含む。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | あり。PR #1247で外部reviewer（CodeRabbit）がMajor 1件を指摘した。必須check 3件はいずれも`success` |
| reviewerがPR author・実装commit authorと異なる | はい |
| 観測したreview commentとapprovalの件数 | 内部の敵対review finding 8件（Medium 2、Low 6）と外部reviewerのMajor 1件・Medium 1件・Minor 2件。**外部の一次資料（`actions/toolkit` #1739）で前提を確定してから着手した。** 外部の指摘は実測で再現してから是正した |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `02_要件/04_仕様・品質管理要件.md`、`15_要件追跡/`
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: **台帳への追加・変更・廃止は0件である。** 配布gate到達性、失格条件、自動release計画の意味を変えていない
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: **確認した。** `conformance:check`が合格している
- 要件・変更・SCN・テストの追跡: REQ-SQ-020 → AC-SQ-020 → SCN-INT-DISTGATE-032〜038。`trace:check`でorphan 0件
- `no-spec-impact`の場合の限定的根拠: 該当しない
- UI・トークンの判断: UI無し

## 11. 総合判定と再開地点

- 未解決Critical/High: **0件**
- Medium/Lowの記録: F-01〜F-04を対象範囲外として記録し、F-05〜F-08とCR-01〜CR-04をresolvedとした
- 判定: approved
- 新しい権限が必要な事項: **なし。** `PROTECTED_FILES`所属fileを1件も変更していない。**受理集合を広げる差分を含まない**
- 残存リスク: **本repositoryでの実走行によるGitHub挙動の確認をしていない。** 根拠は外部の再現報告1件である。**`needs`のresultを`if:`条件で参照する形とskipの組み合わせを測っていない。** 同型のfail-openを作りうるが対象外境界に属する。**字面検査であり意味を見ない。** flow styleのmappingとYAML anchorを検出しない。**本検査は信頼境界ではない。** `scripts/check_conformance.ts`は保護対象ではなく同一PRで失格条件ごと削除できる。**実害の観測が無い。** 現行の`release.yml`はこの形を使っておらず、本変更は将来の書き方を禁じたものである
