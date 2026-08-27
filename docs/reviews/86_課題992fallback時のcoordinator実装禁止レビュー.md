# 86 課題992 fallback時のcoordinator実装禁止 実装レビュー

> 状態: `candidate-verified`（外部承認待ち）。`authorizeImplementation`のcoordinator禁止が`preferred` routeに限定されており、fallback時にcoordinatorのproduct実装が許可されていた欠陥を、merge済みdefault branch headを比較基点として固定した内部監査証拠である。**`valid: true`は候補が既定branchを基準に検証を通過したことを示すだけであり、既定branchへの反映を示さない。**

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象Issue | #992（親 #1025 第1層） |
| 比較基点 | `f3d6c2611f163f0a17cc451d00aafa7d5f805787` |
| H_impl | `a0bbd0c3c53f958de74e806b66993433df72e896` |
| reviewer | claude（実装読解と反例の書き換え）。外部諮問としてcodexとfableへ独立に判定させた |
| 実施日 | 2026-08-28 |
| ラウンド数 | 1 |
| Step chain | 迂回: 手書き運用で進めており、workflow recordを経由していない |
| 仕様の所有箇所 | `docs/specs/04_機能/01_ワークフローv0.3.md:78`「既存routing形式のfallbackがClaude coordinatorをimplementer候補へ解決しても、role operation契約はcoordinatorによるproduct実装を許可せず、独立implementerへ再割当するまで停止する」。`docs/specs/10_セキュリティ/01_信頼境界.md:51`、`docs/specs/12_運用保守/00_運用設計.md:160`も同旨 |
| 成果物行数 | **製品6行**（`src/domain/routing.ts` +11/-5。うち注釈5行）。支援層はtest 33行（既存反例の書き換え）、仕様0行 |
| 縮小の先行評価 | **routing側を変更しない案を選んだ。** 当初は`roleIdentities`のidentity置換を削り、`coordinatorIdentity === implementerIdentity`拒否を全routeへ広げる案（fableの最小形A）を実装したが、**仕様の原文を読んで取り下げた。** 仕様はfallbackがcoordinatorをimplementer候補へ解決すること自体を許しており、止める場所をrole operation契約と明示している。routing側を変えると「再割当するまで停止」を再割当なしに満たしたことにしてしまう |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| **fallbackでidentityが置き換わる** | `src/domain/routing.ts:101-110` | `routeMode === "fallback"`のとき`implementer.identity`が`input.coordinatorIdentity`になる | 既存コード |
| **禁止がpreferredに限定されていた** | `src/domain/routing.ts:290`（比較基点） | `routeMode === "preferred" && actor === coordinator`のときだけ拒否。fallbackでは`roles.implementer.identity`がcoordinatorなので2つ目の検査も通る | 既存コード |
| **testが違反を固定していた** | `test/features/unit/routing-resolution.feature:28`（比較基点） | SCN-UNIT-ROUTING-007「Claude coordinatorをimplementerへ切り替える」が`authorizeImplementation`の`{allowed: true}`を断定していた | 既存コード |
| 配布規範 | `.agent-skill-chain/docs/00_運用ポリシー.md:41` | coordinatorは「product code・test・specを実装しない」 | 仕様 |
| **仕様は止める場所を名指ししている** | `04_機能/01_ワークフローv0.3.md:78`、`10_セキュリティ/01_信頼境界.md:51`、`12_運用保守/00_運用設計.md:160` | routing decisionを実行authorityにせず、独立implementerへ再割当するまで実装を開始しない | 仕様 |
| 固定値の強制 | `src/domain/policy.ts:405`、`src/domain/routing.ts:126`、両schema、`src/domain/project-choice-diff.ts:391`、`src/types.ts:62` | `fallback.role`は`coordinator`固定で利用側は変更できない | 既存コード |

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/routing.ts` | M | package owner | domain（role operation） | coordinatorのproduct実装をroute modeによらず拒否する | 追加依存なし | REQ-WF-006相当のrouting要件、SCN-UNIT-ROUTING-004、SCN-UNIT-ROUTING-007 | 逆変換で戻る。**許可を狭める方向の変更である** | pass |
| `test/steps/routing-resolution.steps.ts` | M | package owner | test | 拒否理由の更新と、fallback時の停止を断定する | 実装へ単方向 | 同上 | 逆変換で戻る | pass |
| `test/features/unit/routing-resolution.feature` | M | package owner | test | SCN-UNIT-ROUTING-007の題と断定を仕様へ合わせる | 実装へ単方向 | 同上 | 逆変換で戻る | pass |

## 2. 受け入れ条件の確認

| 条件 | 結果 | 証拠 |
|---|---|---|
| fallbackでcoordinatorがproduct実装を担当できない | 充足 | SCN-UNIT-ROUTING-007が`{allowed: false, ruleId: "BR-836-01"}`を断定する |
| preferredの既存拒否が維持される | 充足 | SCN-UNIT-ROUTING-004が通る |
| 拒否理由が次の行動を示す | 充足 | 「独立implementerへ再割当するまで実装を開始しないでください」 |
| routingの解決結果を変えない | 充足 | `roleIdentities`と`resolveRouting`は無変更。`decision.provider`・`modelSelection`の断定はそのまま通る |
| 既存シナリオが全通過 | 充足 | `npm test`が**1012 scenario全通過** |

### 2.1 開発考慮事項の適用判定（必須）

| ID | 判定 | 確認 |
|---|---|---|
| DC-PRIVACY | not-applicable | 扱う情報は変わらない |
| DC-OBSERVABILITY | applicable | 拒否理由が停止と再開条件を示す |
| DC-UX | not-applicable | UIを持たない |
| DC-TOKENS | not-applicable | UI要素を持たない |

## 3. 肯定的評価

- **仕様の原文が是正箇所を1つに縮めた。** 諮問では routing 側を変える案が出ていたが、仕様は「止める場所はrole operation契約」と名指ししている
- **testが規範違反を固定していたことを可視化した。** SCN-UNIT-ROUTING-007は題名からして違反を意図した挙動として書かれていた
- **許可を狭める方向にしか動かない。** authority boundary を広げない
- **利用側の移行がない。** `fallback.role: "coordinator"` はそのまま有効で、schema も `development.json` も変えていない

## 4. 敵対的評価

| 反例 | 結果 |
|---|---|
| routing側でidentity置換を削るべきだ | **採らない。**仕様はfallbackがcoordinatorをimplementer候補へ解決することを許している。削ると「独立implementerへ再割当するまで停止」を、再割当なしに満たしたことになる |
| fallbackでは誰も実装できなくなる | **成立する。それが仕様の要求である。**再割当した独立implementerのidentityで再解決すれば、preferred routeとして実装できる |
| 発火理由で分けるべきだ（当初の私の案D） | **不成立。**`preferred_implementer_unavailable`が見ているのは**providerの観測状態であってidentityの不在ではない**（`src/cli.ts:1581`）。両アドバイザーが独立に否定した |
| 規範側へ例外を書くべきだ（案C） | **不成立。**仕様が既に「許可しない」と書いており、例外を彫る理由がない。両アドバイザーとも却下 |
| **implementer identityがfallback先providerで実行可能か検証していない** | **成立する。**本PRの範囲外であり、比較基点でも同じ穴である（S86-M-01） |
| coordinator以外なら誰でも実装できてしまう | **不成立。**2つ目の検査が`roles.implementer.identity`との一致を要求する。fallbackではそれがcoordinatorなので、結果として誰も実装できない |

## 5. 指摘

| ID | 深刻度 | 内容 | 状態 |
|---|---|---|---|
| S86-M-01 | Medium | fallback時、implementer identityがfallback先provider（coordinatorのprovider）で実行可能かを検証していない。CLIはpreferred providerだけを観測する | 未是正。**比較基点でも同じである。**codexが指摘した。別Issueへ分離する |
| S86-M-02 | Medium | fallback時、implementerとreviewerが同一provider・同一logicalTierへ解決する。`validateRoleConfigurationIndependence`は宣言configだけを検査するため通る | 未是正。**比較基点でも同じである。**fableが指摘した。runtimeの独立性はidentity分離だけが担保する |
| S86-L-01 | Low | `fallback.role`という名前は「実行するrole」と読める。実体は「どのroleのmodel設定を借りるか」である | 未是正。改名は配布契約の破壊であり、費用が便益を上回る。schema descriptionでの明示は別Issueで評価する |

### ラウンド予算

ラウンド1で収束した。未解決のCritical/Highは0件。上限3ラウンドに対して2ラウンドの余裕を残している。

## 6. ラウンド固有の確認

### ラウンド1

全評価基準を確認した。Medium 2、Low 1。新規Critical/High 0件。判定 **candidate-verified（自動reviewを待つ）**。

**外部諮問2件を入力にした。** codexは「案D改（即時は停止、恒久はfallback modelとimplementer identityの分離）」、fableは「最小形の案A（`roleIdentities`のidentity置換を削る）」を選び、**両者とも案C（規範へ例外を書く）を却下した。** また**両者が独立に、私の案Dの前提が誤りであることを指摘した**（`preferred_implementer_unavailable`はproviderの観測状態を見ており、identityの不在ではない）。

**割れた点は仕様の原文で決着させた。** fableの案Aを実装したところ、SCN-UNIT-ROUTING-007が落ちた。仕様を読み直すと、fallbackがcoordinatorをimplementer候補へ解決すること自体は許されており、止める場所はrole operation契約だと明記されていた。**routing側の変更を取り下げ、authorization層だけに絞った。** 結果として成果物は11行から6行へ縮んだ。

## 7. テスト結果

| 層・検査 | コマンド | 結果 |
|---|---|---|
| 全層 | `npm test` | **1012 scenario全通過** |
| 契約 | `project:quality`、`trace:check`、`architecture:check`、`package:check`、`conformance:check`、`docs:format`、`test:format` | すべてexit 0 |
| 静的 | `typecheck`、`lint`、`format:check` | exit 0 |

**変更前後の判定。** 同じ入力（fallback route、actorはcoordinator identity、変更pathは`src/domain/routing.ts`）に対する`authorizeImplementation`の結果である。

| 版 | 判定 |
|---|---|
| 比較基点 `f3d6c261` | **`{ allowed: true }`（素通り）** |
| 本PR | **`{ allowed: false, ruleId: "BR-836-01", reason: "coordinatorはproduct実装を担当できません。独立implementerへ再割当するまで実装を開始しないでください" }`** |

比較基点の値は、書き換える前のSCN-UNIT-ROUTING-007が`assert.deepEqual(..., { allowed: true })`として固定していたものである。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/routing.ts` | **入る**（`files`が`dist/src/`を列挙する） | **fallback時にcoordinatorがproduct実装を開始できなくなる。** 利用側は独立implementerへの再割当が必要になる |
| `test/` | 入らない | `files`が列挙しない |

判断: 配布物を更新した

根拠: `dist/src/domain/routing.js`の判定が変わる。**許可を狭める方向であり、authorityを広げない。**`npm run package:check`はexit 0。

## 9. 独立reviewの成立

| 条件 | 充足 |
|---|---|
| reviewerが実装担当の判断を入力に持たない | 充足。仕様原文、実装の分岐、既存testの断定を入力にした |
| 各ラウンドの判定と根拠が原文引用を伴う | 充足。3つの仕様fileと`routing.ts`の該当行を引用 |
| 有限ラウンドで終了する | 充足。1ラウンドで収束 |
| 外部証拠 | PR作成後のCI結果と自動reviewで補う |

**諮問が割れたときに仕様の原文へ戻ったことが、この変更で最も効いた判断である。** 2件連続で同じ手順が効いている（#965、#992）。

## 10. 仕様整合性

`docs/specs/`は更新していない。**本変更は仕様が既に定める「role operation契約はcoordinatorによるproduct実装を許可しない」を実装が満たすための修正であり、新しい要件を導入しない。**

## 11. 総合判定と再開地点

**判定: candidate-verified（外部承認待ち）**

- 未解決Critical: 0件
- 未解決High: 0件
- 未解決Medium: 2件（S86-M-01、S86-M-02はいずれも比較基点でも同じで、別Issueへ分離する）
- 記録したLow: 1件

再開地点: ステップ11（PR作成）。**merge後にS86-M-01とS86-M-02を別Issueへ起票する。**
