# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 1 |
| 対象SHA・文書ダイジェスト | `fb384af6d097149f9ad4da7fd0a745fe59c4a0dc` |
| 比較基点 | `33242c62cee62cc131dc45279ffab0c682f3abc2` |
| H_impl | `fb384af6d097149f9ad4da7fd0a745fe59c4a0dc` |
| 対象差分 | `33242c62cee62cc131dc45279ffab0c682f3abc2..fb384af6d097149f9ad4da7fd0a745fe59c4a0dc`。8 file。**本artifactは`H_impl`より後のcommitで加わるためこの範囲に含まれない** |
| 対象外 | job-levelの`if:`と`needs:`の解釈、job-levelの`continue-on-error`（Issue #1236へ分離）、`; exit 0`のshell意味論、`npm publish`との実行順契約の再定義、`checkDistributionGateReachability`の保護対象化 |
| 残り予算 | 3ラウンドのうち1使用。**残り2** |
| ラウンド数 | 1 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260906_143836_配布gate到達性検査がjob条件-job依存-失敗握り潰しを解釈せず-gateを実行しない入力を受理する |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md`のREQ-SQ-020。引用: 「**判定不能は合格へ倒さない。**」 |
| 成果物行数 | 製品の変更行数 91挿入17削除の行（`scripts/check_conformance.ts`）。test 199挿入3削除行。仕様 10挿入1削除行。支援層は諮問文1件と変異試験script 1件 |
| 縮小の先行評価 | 代替案5件を`02_設計.md`§12で根拠つきで不採用にした。**独立諮問により、当初案のD・E（job-level）を対象外へ落とし、実装範囲を4条項へ縮めた。** GitHub式の評価器を書かない判断が最大の縮小である |
| 実施者・日時 | reviewer / 2026-09-06 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類、差分全文、変異試験結果 | standard（riskはmedium、scopeは配布gate判定） | project choiceのprovider上限に従う | project choiceのtier mappingに従う | 未解決Critical/Highがあれば停止し次roundで再評価する | reviewerはimplementerと別contextで起動する。reviewerは対象差分pathを1件も変更していない |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #980、staging `01_要件定義.md`§6 | AC-01〜AC-05、INV-01〜INV-04 | 一次資料 |
| 差分 | `33242c62cee62cc131dc45279ffab0c682f3abc2..fb384af6d097149f9ad4da7fd0a745fe59c4a0dc` | 8 file、300挿入、21削除（本artifactを除く） | 既存コード |
| テスト | `npm test` | 1542 scenarios（1526 passed、16 skipped）、失敗0 | テスト出力 |
| 変異試験 | 12変異を1件ずつ適用 | **12件すべてkill。** 生存0件 | テスト出力 |
| 仕様 | `docs/specs/01_システム概要/`、`02_要件/`、`11_非機能/`、`15_要件追跡/` | updated | 既存文書 |
| commit前candidate | 本artifactを除く8 file | `fb384af6d097149f9ad4da7fd0a745fe59c4a0dc` | Git観測 |
| Phase A artifact | `docs/reviews/157_課題980gate呼び出しstepの無条件性レビュー.md` | 本commitで追加する1 fileのみ | Git観測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **確認した。** 依存は`checkDistributionGateReachability`→`releaseRunSteps`→`node:fs`の単方向1本で、追加importは0件。本artifactへ自身のcommit SHAを書いていない
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけであり、trusted providerが観測したPR/CI/reviewが`H_final`へ一致している: `H_impl`は`fb384af6d097149f9ad4da7fd0a745fe59c4a0dc`。本artifactの1 fileだけを加えて`H_final`にする
- reviewer stable IDがPR author/provider観測済み`H_impl` author stable IDと異なる: reviewerはimplementerと別contextで起動する。差分pathを1件も変更していない
- 既定branch追随を行った場合: **行っていない。** baseは`33242c62cee62cc131dc45279ffab0c682f3abc2`のままである

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `scripts/check_conformance.ts` | M | 本repository | project | `releaseRunSteps`へstep属性2件とblock終端を足し、`checkDistributionGateReachability`へ失格原因の特定を足す | pass。追加importは0件で単方向 | REQ-SQ-020、QLT-DISTGATE-006 / AC-01〜AC-05 / SCN-INT-DISTGATE-021〜027 | 読み取り専用。判定不能を合格へ倒さない。revertで完全に戻る | pass |
| `test/features/integration/distribution-gate-reachability.feature` | M | 本repository | evidence | SCN-INT-DISTGATE-021〜027のscenario定義 | pass | AC-01〜AC-05 | 一時directoryのfixtureのみ。SCN-025はrepository rootを読み取るだけ | pass |
| `test/steps/distribution-gate-reachability.steps.ts` | M | 本repository | evidence | 上記scenarioのstep定義とfixture。SCN-009のassertionを新しい診断文言へ追随 | pass | 同上 | 同上 | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | 本repository | spec | REQ-SQ-020へgate呼び出しstepの無条件性と、step-levelとjob-levelを同じ規則で扱わない根拠を追記 | pass | REQ-SQ-020、AC-SQ-020 | 追加なし | pass |
| `docs/specs/11_非機能/01_品質要件.md` | M | 本repository | spec | QLT-DISTGATE-006を追加 | pass | REQ-SQ-020 | 同上 | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | 本repository | spec | TERM-ASC-089〜091を追加 | pass | 同上 | 同上 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | 本repository | spec | REQ-SQ-020行へSCN-INT-DISTGATE-021〜027を追加 | pass | 同上 | 同上 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | 本repository | spec | 本変更の履歴行 | pass | 同上 | 同上 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **確認した。** `比較基点..H_impl`の`git diff --name-status`が返す8件と表の8行が一致する。**本artifactは`H_impl`より後のcommitで加わるため、この範囲には現れず表にも置かない。** 生成物である`dist/`配下の差分は0件で、`scripts/`はbuild対象に含まれない
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **確認した。** 判定は`scripts/`の検査へ、契約は`docs/specs/`へ置き、`src/`へ触れていない
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **確認した。** 変異試験による是正は`scripts/check_conformance.ts`とtest 2 fileに閉じている

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| ID | 発見 | 対処 |
|---|---|---|
| DISC-001 | job-levelの`continue-on-error`は「skipは伝播する」という本Issueの根拠が及ばない。gateは実行され失敗するが、`needs.<job>.result`の値を実測していない | **断定せずIssue #1236へ分離した。** 確認方法を2案記載し、`failure`ならnot-a-bugでcloseすると明記した |
| DISC-002 | `if: false`が`conditional`にも該当するため、SCN-INT-DISTGATE-009の診断文言が汎用から`if:`名指しへ変わった | 拒否する事実は変わらない。assertionを新しい文言へ追随させた。原因を名指しする方向の変更でありDC-OBSERVABILITYと一致する |
| DISC-003 | 変異M10（`continue-on-error`をfile全域で拒否）が最初の実装で生存した。**原因はscenario不足ではなく実装で、失格した呼び出しが在るのに原因を特定できないとerror 0件で受理していた** | 原因不特定時は汎用の拒否へ倒す形へ是正した。M10はSCN-024・025が殺すようになった |
| DISC-004 | 変異M6（終端条件を`width < indent`へ狭める）が生存した。**等価変異ではない。** YAMLはsequenceを親keyと同じindentへ置けるため、step markerとjob-level keyのindentが等しくなる形が実在する | SCN-INT-DISTGATE-027を足して殺した |
| DISC-005 | FR-04の「`continue-on-error`の実行時式を静的な`false`と同一視しない」条項に対応するscenarioが無かった | SCN-INT-DISTGATE-026を足し、変異M4で殺されることを確認した |

### 2.1 受け入れ条件とシナリオ

| AC | 内容 | SCN | 結果 |
|---|---|---|---|
| AC-01 | gate呼び出しstepの`if:`を`if:`名指しの診断で拒否する | SCN-INT-DISTGATE-021 | pass |
| AC-02 | gate呼び出しstepの`continue-on-error: true`を名指しの診断で拒否する | SCN-INT-DISTGATE-022 | pass |
| AC-03 | 最終stepの直後に条件付きjobが続く形を受理する | SCN-INT-DISTGATE-023、027 | pass |
| AC-04 | gate呼び出し以外のstepの`continue-on-error: true`を拒否しない | SCN-INT-DISTGATE-024 | pass |
| AC-05 | 現行`release.yml`をerror 0件で受理する | SCN-INT-DISTGATE-025 | pass |
| FR-04 | `continue-on-error`の実行時式を静的な`false`と同一視しない | SCN-INT-DISTGATE-026 | pass |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | 配布前品質検証が実行されるかを決める判定であり信頼境界に属する。ただし秘密情報と個人情報は扱わない | 判定は`release.yml`と`package.json`の字面のみを読み、network・環境変数・実行時contextを参照しない。追加importは0件で`src/lib/security.ts`へ触れない。error行はscript名とYAMLの属性名だけを出しfile内容を転記しない |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 原因を名指ししない拒否は是正できず、流れだけを止める門になる | SCN-INT-DISTGATE-021と022が診断文言と行動指示の双方を検査する。変異M7・M8が行動指示の欠落で殺される。出力は`conformance:check`のstdoutのみで、log保持・rotation・監視・常駐processを持たない。復旧は該当stepの属性を外して再実行することである |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | CIが非対話で実行する検査であり、人が操作する画面・入力要素・focus順序・支援技術の対象になる成果物を持たない | 差分9 fileのいずれも表示層に属さない |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 描画対象が無いためtokenの適用先が存在しない | DC-UXと同じ根拠 |

## 3. 肯定的評価

- **判定の分割軸を実測で正した。** 当初案の「静的に偽と決定できるか」は、最も危険なstep-levelの実行時条件を素通しにしていた。skipの伝播先で分けたことで、GitHub式の評価器を書かずに真のfail-openだけを閉じた。
- **`if:`の真偽を判定しない設計により、支援層が成果物を超えなかった。** 製品差分は`scripts/check_conformance.ts`の1関数群に収まっている。
- **対象外の根拠をすべて実測または原文引用で残した。** `bash -e -c 'false; exit 0'`のexit 1、`tag`の`needs.validate.result == 'success'`条件、`validateReleaseWorkflow`を実物へ当てるstep定義の行番号。後続が同じ判断を再現できる。
- **変異試験が実装の穴を出し、その是正が新しいscenarioなしに既存scenarioで殺されるようになった。** DISC-003は「テストを足して通す」ではなく「実装を直す」で解いている。

## 4. 敵対的評価

- **「gate呼び出しstepの無条件性」だけで配布gateの実行を保証できるか。** 保証できない。job-levelの`continue-on-error`が未確認であり（DISC-001）、`shell:`の差し替えも対象外である。**本変更が担保するのは、step-levelの条件と失敗許容による回避の回帰検出だけである。** 「継続的担保」と書かない。
- **候補側の検査であり敵対耐性が無い。** 同一PRで`scripts/check_conformance.ts`自体を書き換えられる。この事実は`02_設計.md`§5へ明記した。保護対象化はowner決裁であり#1020が所有する。
- **SCN-INT-DISTGATE-025が現行`release.yml`へ結合している。** `release.yml`の正当な変更でこのscenarioが落ちうる。ただし落ちた場合に問うべきことは「gate呼び出しstepが無条件か」であり、問いとして正しい。
- **SCN-INT-DISTGATE-009のassertion変更は、実装に合わせてテストを緩めたのではないか。** 拒否する事実は変わらず、文言はより具体的になった。**変異M11（`conditional`を`if: false`リテラルへ縮める）がSCN-021に殺されることで、緩めていないことを示している。**
- **`disqualified`の判定は`reliableSegments`に依存する。** `||`を含む区間は候補から外れるため、`true || npm run verify:distribution`は「呼び出しが無い」として汎用errorになる。既存SCN-017の意味を維持しており変更していない。

## 5. 指摘

| ID | 分類 | 内容 | 対処 |
|---|---|---|---|
| F-01 | High | 失格した呼び出しが在るのに原因を特定できないとerror 0件で受理する | 是正済み。DISC-003 |
| F-02 | Medium | step block終端の`width <= indent`が変異で生存した。等価変異ではない | 是正済み。SCN-027を追加。DISC-004 |
| F-03 | Medium | FR-04の実行時式の条項に対応するscenarioが無い | 是正済み。SCN-026を追加。DISC-005 |
| F-04 | Low | 変更履歴の変更file一覧へ`dist/`を書いていたが、`scripts/`はbuild対象でなくdiffは0件 | 是正済み。`dist/`を外した |

未解決のCritical/Highは0件である。

## 6. ラウンド固有の確認

### ラウンド1

固定initial HEADに対する全scope reviewである。`previousBlocking`、`fixedDiff`、`adjacentScope`はいずれも空である。

## 7. テスト結果

実行したcommandの一覧: `npm run lint`、`npm run format:check`、`npm run typecheck`、`npm run trace:check`、`npm run conformance:check`、`npm test`、`npm run build`、変異試験script

全layerの合計: **1542 scenarios（1526 passed、16 skipped）、失敗0**

失敗またはskipがある層: skipは16 scenarioで、いずれも本変更以前から存在する環境依存scenarioである。失敗は0件のため展開する層は無い

runnerは`@cucumber/cucumber`、`projectChoices.gherkinDialect`は英語keyword・日本語説明である。

対応する成功CI runの参照: **push前のため未観測。** PR作成後に必須checkの結果を観測する。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `scripts/check_conformance.ts` | 入る | `conformance:check`の受理集合が狭まる。gate呼び出しstepが条件付き・失敗許容の利用者projectは拒否される |
| `test/`配下2件 | 入らない | なし |
| `docs/specs/`配下5件 | 入らない | なし |
| `docs/reviews/`配下1件（本artifact） | 入らない | なし |

判断: 配布物を更新した

根拠: `scripts/check_conformance.ts`は`npm pack`の対象であり利用者が実行する。**拒否が増える方向の変更であるため、既に条件付きでgateを呼んでいるprojectは是正が要る。** 診断へ行動指示を含めた理由である。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | push前のため未取得。PR作成後に外部reviewerの指摘を観測する |
| reviewerがPR author・実装commit authorと異なる | はい |
| 観測したreview commentとapprovalの件数 | 内部の敵対review finding 4件（High 1、Medium 2、Low 1）。すべて是正済み。外部reviewとapprovalはPR作成後に観測する |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `01_システム概要/02_用語・略語.md`、`02_要件/04_仕様・品質管理要件.md`、`11_非機能/01_品質要件.md`、`15_要件追跡/`
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: **確認した。** TERM-ASC-089〜091を`01_要件定義.md`§2.1の確定差分から台帳へ移した。既存最大は088で、全remote branchとworktree stagingを走査して衝突が無いことを確認した
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: **確認した。** `conformance:check`が合格している
- 要件・変更・SCN・テストの追跡: REQ-SQ-020 → AC-SQ-020 → SCN-INT-DISTGATE-021〜027。`trace:check`でorphan 0件
- `no-spec-impact`の場合の限定的根拠: 該当しない
- UI・トークンの判断: UI無し

## 11. 総合判定と再開地点

- 未解決Critical/High: **0件**
- Medium/Lowの記録: F-02〜F-04をresolvedとして記録した
- 判定: approved
- 新しい権限が必要な事項: **なし。** `PROTECTED_FILES`所属fileを1件も変更していない
- 残存リスク: **job-levelの`continue-on-error`の扱いが未確認である。** `needs.<job>.result`の値を実測しておらず、`success`になるならfail-openが残る。Issue #1236が所有する。**`shell:`を非bash系へ差し替えた場合の`; exit 0`も対象外である。** また**本検査は候補側にあり敵対耐性を持たない。** 担保するのは偶発的劣化の回帰検出だけである
