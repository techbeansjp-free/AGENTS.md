# 80 課題1013 enforcement走査の健全化 実装レビュー

> 状態: `candidate-verified`（外部承認待ち）。`executableSource`が正規表現literalを認識せずenforcement存在確認を迂回できる欠陥を是正する変更を、merge済みdefault branch headを比較基点として固定した内部監査証拠である。独立reviewの承認は自己申告せず、CIとPR reviewの外部証拠で確定する。

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象Issue | #1013 |
| 比較基点 | `90bacd85859a93894f9c4691c9a10394bcb72e4a` |
| H_impl | `21fa20db12335534ebdfce33787b099de3c0c9ab` |
| reviewer | claude（是正前後の同一fixtureによる差分観測で独立に確認） |
| 実施日 | 2026-08-27 |
| ラウンド数 | 3 |
| Step chain | 迂回: 手書き運用で進めており、workflow recordを経由していない |
| 仕様の所有箇所 | `docs/specs/11_非機能/01_品質要件.md` QLT-EXPORTSCAN-001（本PRで新設）。`src/domain/conformance.ts:758`のdoc commentが「commentやliteralの中の名前だけでconformanceを満たせないようにする」という目的を所有していた |
| 成果物行数 | **総変更量で測る。製品164行**（`src/domain/conformance.ts` +155 / -9）。支援層はtest 162行と仕様2行。**推測を除く設計へ切り替えたためラウンド1より増えた** |
| 縮小の先行評価 | **縮小したのは「推測」という手段である。**当てにいく判定を「わからないと言う」判定へ縮めた。新しい機構は作っていない。**TypeScript compiler APIやtoolchain証拠へ置換する案も評価したが採らなかった。**`package.json`は依存ゼロで`dist/`を配布し、`engines`は`>=20`である。consumer repositoryをtypescript無しで検証する用途に成立しない。`module.stripTypeScriptTypes`はNode 22.13+を要し`engines`と矛盾する |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| **偽陽性の再現** | `const pattern = /"/;` の後のblock comment内へ偽export | 除去後の本文が`const pattern = / export function fakeEnforcement(): void {} */ ...`となり**実在と誤認する** | 実行観測 |
| **偽陰性の再現** | `/"([^"]+)"/gu`（引用符3個）の後の実export | 以降が文字列状態のまま進み**exportを見落とす** | 実行観測 |
| 呼び出し範囲 | `conformance.ts` | `executableSource`の呼び出しは`hasExport`の1箇所、`hasExport`の呼び出しは`:933`の1箇所 | 既存コード |
| 影響の所在 | `conformance.ts:935` | `enforcement exportが実在しません`を出す判定 | 既存コード |
| **是正の確認** | 同一fixtureを比較基点・ラウンド1実装・本実装で実行 | **ラウンド1実装は6件で比較基点より悪化していた。**本実装は12件すべて期待どおり | テスト出力 |
| 静的・契約検査 | 9種 | すべてexit 0 | テスト出力 |
| テスト | `npm test` | 995 scenario全通過 | テスト出力 |

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/conformance.ts` | M | package owner | domain | 走査へ正規表現literal対応とEOF脱線検出を追加 | 追加依存なし | QLT-EXPORTSCAN-001、SCN-UNIT-SAT-014 | 追加した2状態と判別関数の除去で戻る | pass |
| `test/features/unit/project-policy-satisfiability.feature` | M | package owner | test | 反例4件 | 実装へ単方向 | SCN-UNIT-SAT-014 | scenarioの削除で戻る | pass |
| `test/steps/project-policy-satisfiability.steps.ts` | M | package owner | test | fixtureとstep定義 | 実装へ単方向 | SCN-UNIT-SAT-014 | 追加分の削除で戻る | pass |
| `docs/specs/11_非機能/01_品質要件.md` | M | 利用側 | 仕様 | QLT-EXPORTSCAN-001の新設 | 参照のみ | 同上 | 1行の除去で戻る | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | 利用側 | 仕様 | REQ-WF-008行へSCN-014を追加 | 参照のみ | 同上 | 1行の復元で戻る | pass |

## 2. 受け入れ条件の確認

| AC（Issue #1013） | 結果 | 証拠 |
|---|---|---|
| 正規表現literalを認識する | 充足 | `regex`と`regex-class`の2状態を追加 |
| 判別不能な`/`を安全側へ倒す | 充足 | 正規表現として除去する。行頭anchorと改行復帰により被害がその行に限定される |
| 走査の脱線を検査不能として拒否する | 充足 | 終了時に`code`でなければ`undefined`を返し、`hasExport`が`false`を返す |
| 偽陽性の反例を固定する | 充足 | `ghost-in-comment`。是正前は失敗 |
| 偽陰性の反例を固定する | 充足 | `odd-quote-regex`。是正前は失敗 |
| 除算を誤検出しない | 充足 | `division`。是正前後とも通過 |

### 2.1 開発考慮事項の適用判定（必須）

| ID | 判定 | 確認 |
|---|---|---|
| DC-PRIVACY | not-applicable | 個人データも秘密情報も扱わない |
| DC-OBSERVABILITY | applicable | **検査の健全性を回復する。**解析不能を無言で合格にしない |
| DC-UX | not-applicable | UIを持たない |
| DC-TOKENS | not-applicable | UI要素を持たない |

## 3. 肯定的評価

- **迂回経路を塞いだ。** 是正前は`const pattern = /"/;`の後のcommentへ`export function ...`と書くだけで、実体の無いenforcementを実在と誤認させられた。**この関数の存在理由そのものが破れていた。**
- **両方向の壊れ方を反例で固定した。** 偽陽性と偽陰性の双方を再現し、是正前に落ちることを確認している。
- **安全側の向きを構造で説明できる。** 利用側の照合patternはいずれも`^\s*export`の行頭anchorであり、正規表現状態は改行で必ず終わる。**除算を正規表現と誤読しても被害はその行の残りに留まり、行頭のexport宣言を消すことは原理的にできない。** 逆に「codeとして残す」誤りは引用符の偶奇を反転させ、被害が次の引用符まで無制限に波及し、向きがfail-openである。
- **曖昧さを成功扱いにしない。** 走査終了時に状態が`code`でなければ`undefined`を返す。今回の欠陥はfile全体の引用符が411個（奇数）であり、この1点で決定的に検出できる。
- **影響範囲が極小である。** `executableSource`の呼び出しは1箇所、`hasExport`の呼び出しも1箇所。

## 4. 敵対的評価

| 反例 | 結果 |
|---|---|
| 除算を正規表現と誤読して実exportを消す | **不成立。**照合patternが行頭anchorで、正規表現状態は改行で終わる。`export`の前に`/`がある行はそもそもanchorに一致しない。`division` fixtureで確認 |
| 正規表現と除算の判別が不完全である | **成立するが受容する。**`dividesBefore`は直前の有意文字だけを見る。ASIやkeyword直後の完全な判別はしていない。**誤りの向きが安全側であることが受容の根拠である** |
| 未終端のtemplate literalで脱線する | **不成立。**終了時の状態確認が`code`以外をすべて拒否する。`unterminated-string` fixtureで確認 |
| `hasExport`が`false`を返すと検査が止まる | **成立するが意図どおり。**解析不能を「export実在」の根拠にしない。止まる側は可視で回復可能、通す側は無言のfail-open |
| 既存の走査結果を変えて他検査を壊す | **不成立。**`npm test`が995 scenario全通過。是正前後で`division`とその他の既存scenarioの判定は変わらない |
| **この検査自体をcandidateが消せる** | **成立する。**`conformance.ts`も`test/`も保護対象外である。**本PRで悪化しない既存の性質であり、Issue #1009 のS78-M-01と同根である** |

## 5. 指摘

| ID | 深刻度 | 内容 | 状態 |
|---|---|---|---|
| S80-L-01 | Low | `)`と`.`の直後を解析不能として拒否するため、将来これらの位置に除算が書かれると検査が止まる | 未是正。**実測0件。**止まる側は可視で、`SCN-INT-SAT-003`がCIで音を立てて落ちる。無音の劣化ではない |
| S80-L-02 | Low | この検査自体をcandidateが同一PRで消せる | 未是正。**既存の性質で本PRで悪化しない。**#1009 のS78-M-01と同根 |

### ラウンド予算

ラウンド3で収束した。未解決のCritical/High/Mediumは0件。**上限3ラウンドを使い切った。**

## 6. ラウンド固有の確認

### ラウンド1

直前1文字による除算判別と`regex`/`regex-class`状態を実装した。

**本Issueはアドバイザー諮問から生まれた。** Issue #1009 の適用PR実装中に`npm test`が4件落ち、当初はfixtureの問題として扱おうとした。codexが「偽陰性だけでなく偽陽性も作れる」と指摘し、実測で再現した。

### ラウンド2

自動reviewが**同型のHighを2件**出した。

| 指摘元 | 内容 | 実測 |
|---|---|---|
| CodeRabbit | `return /"/;`の直後を除算と誤認する | **成立。**諮問でfableが明示していたkeyword例外を実装で落としていた |
| codex | **本PRが新しいfail-openを導入している** | **成立。**`1. / 2`の除算を正規表現と誤読すると直後の`/*`を正規表現の終端と誤認し、comment内の偽exportが漏れる。比較基点では除去されるため回帰である |

codexはさらに`)`後の正規表現、nested template、EOFのline commentを脱線と誤判定する偽陰性、LFしか見ていない点を挙げ、**「直前1文字によるslash判定のままでは収束困難」**と判定した。

**同型のHighが2ラウンド続いたため、機構ごと設計を疑う局面と判断し、自分で3周目を回さず諮問した。**

### ラウンド3

両アドバイザーへ設計を諮問し、**Q1で判定が割れた。**

| 案 | codex | fable |
|---|---|---|
| 走査を続け推測を除く | 暫定策 | **採用（最小差分3点）** |
| toolchain証拠へ置換 | **推奨** | 配布制約で不成立 |

**fableの否定が決定的だった。** 配布CLIはconsumer repositoryを検証する用途で、`package.json`は依存ゼロ、`engines`は`>=20`である。TypeScript compilerもNode 22.13+の`module.stripTypeScriptTypes`も使えない。**codexは配布側の制約を見ていなかった。**

両者のQ2実測は一致した。`src`・`scripts`・`bin`の65 fileに除算は0個、正規表現literalは416個で、**曖昧な`/`は0箇所**である。

全評価基準（肯定: 正しさ・価値・実現可能性・整合性・保守性／敵対: 反例・失敗経路・境界値・悪用・安全性・データ損失・rollback・範囲漏れ）を確認した。Low 2件。新規Critical/High 0件。判定 **candidate-verified（自動reviewを待つ）**。

### ラウンド予算の消化

**3ラウンドを使い切った。**上限に達したため、以降は目的阻害・データ喪失・回帰に限って対応する。

## 7. テスト結果

| 層・検査 | コマンド | 件数 | 判定 |
|---|---|---|---|
| 形式 | `npm run format:check`、`npm run docs:format`、`npm run test:format` | exit 0 | pass |
| 静的 | `npm run lint`、`npm run typecheck`、`npm run source:check` | exit 0 | pass |
| 契約 | `npm run project:quality`、`npm run trace:check`、`npm run architecture:check` | exit 0 | pass |
| 統合 | `npm test` | 995 scenario全通過 | pass |

是正の確認。同一のfixtureを是正前後で実行した。

| fixture | 検証する壊れ方 | 比較基点 | ラウンド1実装 | 本実装 |
|---|---|---|---|---|
| `odd-quote-regex` | 偽陰性（実exportの見落とし） | **失敗** | 通過 | 通過 |
| `ghost-in-comment` | 偽陽性（comment内の偽exportを実在と誤認） | **失敗** | 通過 | 通過 |
| `keyword-regex` | `return`直後の正規表現 | 通過 | **失敗** | 通過 |
| `decimal-divide` | `1. / 2`の除算誤読 | 通過 | **失敗** | 通過 |
| `string-divide` | `+"1" / 2`の除算誤読 | 通過 | **失敗** | 通過 |
| `postfix-divide` | `n++ / 2`の除算誤読 | 通過 | **失敗** | 通過 |
| `regex-divide` | `/x/ / 2`の除算誤読 | 通過 | **失敗** | 通過 |
| `nested-template` | 内側backtickの誤認 | **失敗** | **失敗** | 通過 |
| `eof-line-comment` | EOFのline commentを脱線と誤判定 | 通過 | **失敗** | 通過 |
| `division` | 除算の誤検出 | 通過 | 通過 | 通過 |
| `division-assign` | `/=`の誤検出 | 通過 | 通過 | 通過 |
| `unterminated-string` | 未終端の検出 | 通過 | 通過 | 通過 |

**ラウンド1の実装は6件で比較基点より悪化していた。**回帰を数えずに「直した」と報告しない。

repository自身のcorpusでの確認。

| 観測 | 値 |
|---|---|
| `src`・`scripts`・`bin`の走査file数 | 65 |
| 解析不能で実在exportを見落としたfile | **0件** |

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/conformance.ts` | **入る**（`dist/src/`として） | consumerの`validateRepositoryConformance`の判定が変わる。**enforcement存在確認が厳しくなる方向のみである** |
| `test/`、`docs/specs/` | 入らない | `package.json`の`files`が列挙しない |

判断: 配布物を更新した

根拠: `src/domain/conformance.ts`は`dist/src/`として配布される。consumerが観測する変化は、**これまで誤って合格していたenforcement宣言が拒否されるようになること**と、**解析不能なsourceを合格の根拠にしなくなること**である。いずれも検査を厳しくする方向で、緩和はしない。公開APIの形、schema、templateは変わらない。`npm run package:check`がexit 0であることを確認した。

## 9. 独立reviewの成立

| 条件 | 充足 |
|---|---|
| reviewerが実装担当の判断を入力に持たない | 充足。是正前後の同一fixtureの差分観測だけを入力にした |
| 各ラウンドの判定と根拠が原文引用を伴う | 充足。`executableSource`の状態機械と`hasExport`の照合patternを引用 |
| 有限ラウンドで終了する | 充足。1ラウンドで収束 |
| 外部証拠 | PR作成後のCI結果と自動reviewで補う |

**ラウンド1の実装が比較基点より悪化していたことを、自動reviewの指摘を実測して確認したことが最も効いた判断である。** 検査を直す変更は、直したつもりで悪化していることがある。是正前後の比較を「元の欠陥が消えたか」だけで打ち切らず、**元は通っていた入力が落ちていないか**まで数える。

## 10. 仕様整合性

`docs/specs/`を2箇所更新した。

| file | 更新内容 |
|---|---|
| `11_非機能/01_品質要件.md` | QLT-EXPORTSCAN-001を新設。走査の健全性と、判別不能時の向きを規定 |
| `15_要件追跡/00_追跡表.md` | REQ-WF-008行へSCN-UNIT-SAT-014を追加 |

新しい要件区分は足していない。`conformance.ts:758`のdoc commentが既に「commentやliteralの中の名前だけでconformanceを満たせないようにする」という目的を持っており、**本PRはその目的を実装が満たしていなかったことを是正する。**

## 11. 総合判定と再開地点

**判定: candidate-verified（外部承認待ち）**

- 未解決Critical: 0件
- 未解決High: 0件
- 未解決Medium: 0件
- 記録したLow: 2件（S80-L-01は向きが安全側であることを構造で示して受容。S80-L-02は既存の性質）

再開地点: ステップ11（PR作成）。**merge後にIssue #1009 の適用PRへ戻る。**
