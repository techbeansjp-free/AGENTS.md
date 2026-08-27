# 70 課題977 保護workflow参照script固定実装レビュー

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象Issue | #977 |
| 比較基点 | `7920ffd4760edcb927b17a11a73ca1775a0121cc` |
| H_impl | `f13b97a93db416b5f0cc35ee155569aa2adbe43f` |
| reviewer | claude（実装担当と別context、別セッション） |
| 実施日 | 2026-08-27 |
| ラウンド数 | 3（うち1ラウンドは自動review） |

### 0.1 routing入力契約

ラウンド1のreviewerへは、差分の全文、追加した検査と反例testの全文、実測値だけを渡した。実装担当の判定は渡していない。ラウンド2は引き継ぎ後の別contextで実施し、変異試験を独自に設計した。ラウンド3は自動reviewであり、対象はPRのheadと差分だけである。判定に用いた値はすべて本artifactへ原文で引用する。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #977、`REQ-SQ-021`、`AC-SQ-021` | 保護workflowの参照集合が固定集合に包含されることを強制する | 一次資料 |
| 差分 | `7920ffd4`..`f13b97a9` | 7 path | 既存コード |
| 保護対象の差分 | 同上 | **0件。**保護fileもpackageのfieldも変更していない | 実行観測 |
| trusted-base相当 | `--root=候補 --trusted-root=既定branch` | `valid: true`、check 8件 | 実行観測 |
| 静的検査 | 12種 | すべてexit 0 | テスト出力 |
| テスト | `npm test` | 940 scenario全通過、4985 step全通過 | テスト出力 |
| 検査の変異試験 | 11経路 | 7経路を検出、4経路が生存。うち2経路をラウンド2、1経路をラウンド3で是正 | 実行観測 |
| 兄弟検査の実装形 | `checkDistributionGateReachability`、`checkModeQuestionText`、`checkLifecycleIgnore` | いずれも合成経路を検証していない既存形 | 既存コード |

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `docs/specs/02_要件/00_要件一覧.md` | M | change owner | 仕様 | REQ-SQ-021の登録 | 参照のみ | REQ-SQ-021 | 行の除去で戻る | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | change owner | 仕様 | REQ-SQ-021の定義 | 参照のみ | REQ-SQ-021 | 節の除去で戻る | pass |
| `docs/specs/11_非機能/01_品質要件.md` | M | change owner | 仕様 | QLT-SCRIPTPIN-001の定義 | 参照のみ | REQ-SQ-021 | 行の除去で戻る | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | change owner | 仕様 | REQ-SQ-021の追跡1行 | 参照のみ | REQ-SQ-021 | 行の除去で戻る | pass |
| `scripts/check_conformance.ts` | M | package owner | gate script | 参照集合の包含検査と、保護workflow列挙の単一正本化 | `check_project_quality.ts`を読む単方向 | REQ-SQ-021、SCN-INT-SCRIPTPIN-001〜007 | 追加関数と合成箇所の除去で戻る | pass |
| `test/features/integration/trusted-script-pinning.feature` | A | package owner | test | 包含と判定不能の受け入れ例 | 実装へ単方向 | SCN-INT-SCRIPTPIN-001〜007 | fileの削除で戻る | pass |
| `test/steps/trusted-script-pinning.steps.ts` | A | package owner | test | step定義と候補treeのfixture | 実装へ単方向 | SCN-INT-SCRIPTPIN全件 | fileの削除で戻る | pass |

### 保護対象との照合

**保護fileとpackageの保護fieldは1件も変更していない。**このため品質契約proposalを要さない。`--root=候補 --trusted-root=既定branch`が`valid: true`を返すことで確認した。

`scripts/check_conformance.ts`は保護対象外である。この事実自体が本Issueの残存riskであり、後述する。

## 2. 受け入れ条件の確認

| AC | 結果 | 証拠 |
|---|---|---|
| 保護workflowの参照scriptを抽出する | 充足 | SCN-INT-SCRIPTPIN-001 |
| 固定集合に無い参照を検出する | 充足 | SCN-INT-SCRIPTPIN-002 |
| 部分一致で帰属させない | 充足 | SCN-INT-SCRIPTPIN-003 |
| commentと`echo`の引数を誤認しない | 充足 | SCN-INT-SCRIPTPIN-004 |
| 参照0件を拒否する | 充足 | SCN-INT-SCRIPTPIN-005。**ラウンド2で追加** |
| 追跡file列挙の失敗を拒否する | 充足 | SCN-INT-SCRIPTPIN-006。**ラウンド2で追加** |
| 引用符付きの参照を抽出する | 充足 | SCN-INT-SCRIPTPIN-007。**ラウンド3で追加** |
| 保護workflowの列挙が単一正本である | 充足 | `PROTECTED_WORKFLOWS`へ集約し`checkPackageManagerBoundary`と共用 |

### 2.1 開発考慮事項の適用判定（必須）

| ID | 判定 | 確認 |
|---|---|---|
| DC-PRIVACY | not-applicable | 個人データも秘密情報も扱わない。一時treeは`os.tmpdir()`配下で検査後に削除する |
| DC-OBSERVABILITY | not-applicable | logも計測も生成しない。診断文だけを返す |
| DC-UX | not-applicable | UIを持たない |
| DC-TOKENS | not-applicable | UI要素を持たない |

## 3. 肯定的評価

- **構造の照合ではなく挙動で確かめている。**参照scriptを全件`true`へ差し替えた候補treeを作り、既定branch側validatorが各scriptを名指しで拒否することを要求する。固定の実装形式が変わっても追随する。
- **既存関数を流用し、新しい機構を足していない。**`releaseRunSteps`は既存であり、`reliableSegments`は`checkDistributionGateReachability`のローカル定義をmodule直下へ括り出して共用した。挙動を変えずに重複を1件減らしている。
- 保護workflowの列挙が`checkPackageManagerBoundary`とこの検査で二重に書かれていたのを`PROTECTED_WORKFLOWS`へ集約した。**片方だけ増やす事故が構造上できなくなる。**
- 保護fileを1件も変更しないため、二段階のproposal手順を要さない。

## 4. 敵対的評価

| ラウンド | 反例 | 結果 |
|---|---|---|
| 1 | `echo "npm run x"`の引数を参照と誤認する | **成立。**step構造と失敗伝播区間の走査へ是正 |
| 1 | 固定済み`project:quality`の診断文が未固定`project`を部分文字列として含み見逃す | **成立。**token境界での照合へ是正 |
| 1 | `npm run-script`と引用符付きの記法を参照と認識しない | **成立。**正規表現を拡張して是正 |
| 2 | **参照0件の拒否を外しても6 scenario中1件も落ちない** | **成立。**下記「仕様と証拠の不一致」を参照 |
| 2 | 追跡file列挙の失敗の拒否を外しても落ちない | **成立。**SCN-006を追加して是正 |
| 2 | `if: false`の無効step除外を外しても落ちない | 成立。**残存Low**として記録 |
| 2 | `npm run-script`と引用符の認識を外しても落ちない | 成立。**残存Low**として記録 |
| 2 | 検査を`checkRepositoryRuleLedger`の合成から外しても落ちない | 成立。**兄弟3検査と同型の既存構造。**下記「残存risk」を参照 |
| 3 | **`npm run 'x'`の単一引用符を抽出できず、固定漏れが検出されない** | **成立。**下記「引用符の取りこぼし」を参照 |
| 3 | artifactのテスト件数の記載が節ごとに食い違う | **不成立。**下記のとおり別時点の実測値であり、時点を明記して是正 |

### 仕様と証拠の不一致

**ラウンド2で、仕様が引用するSCNが仕様の主張を検証していない状態が検出された。**

`docs/specs/11_非機能/01_品質要件.md`のQLT-SCRIPTPIN-001は「判定不能は拒否する」と述べ、根拠としてSCN-INT-SCRIPTPIN-001、002を引用していた。しかし**この2件はいずれも判定不能の経路を通らない。**参照0件の拒否を外す変異が4 scenario全通過で生き残ることで確認した。

是正の方向を2つ評価した。

1. **仕様側を縮小する。**QLT-SCRIPTPIN-001から「判定不能は拒否する」を削る。
2. **証拠側を足す。**判定不能の2経路にSCNを与える。

**1を採らなかった理由は運用ポリシーである。**`.agent-skill-chain/docs/00_運用ポリシー.md`は「縮小の対象は手段の実施回数、範囲、所要時間であり、安全条件、authority分離、fail-closed不変条件に属する手段を含まない」と明記する。判定不能の拒否はfail-closed不変条件そのものであり、縮小対象に入らない。REQ-SQ-021本文も2経路を名指しで要求している。仕様を弱めれば、実装に残る保護が仕様の裏付けを失う。

よって2を採り、SCN-005とSCN-006を追加した。**追加は16行で、新しい機構を伴わない。**既存の`CHECKS`表へentryを2件足しただけである。

### 引用符の取りこぼし

**ラウンド3の自動reviewで、参照抽出が単一引用符を取りこぼすことが検出された。**

抽出の正規表現は`/^npm\s+run(?:-script)?\s+"?([A-Za-z0-9:._-]+)"?/u`であった。実測すると次のとおりである。

| 記法 | 変更前 | 変更後 |
|---|---|---|
| `npm run workflow:check` | 抽出する | 抽出する |
| `npm run "workflow:check"` | 抽出する | 抽出する |
| `npm run 'workflow:check'` | **抽出しない** | 抽出する |
| `npm run-script workflow:check` | 抽出する | 抽出する |
| `npm run "workflow:check` | **抽出する** | 抽出しない |

**抽出できない参照は候補treeで差し替えられず、固定漏れが検出されないまま合格になる。**これは本Issueが塞ごうとしている事故そのものである。

片側だけを任意にする`"?`は、単一引用符を取りこぼす一方で不均衡な記法を受理していた。引用符を後方参照で対に照合する形へ変えて、両方を同時に是正した。**文字クラスの変更だけで、新しい機構は伴わない。**不均衡な記法はshellの構文誤りであり、そのstepは実行されずCIが赤くなるため、抽出対象から外して差し支えない。

SCN-INT-SCRIPTPIN-007を追加し、元の記法へ戻す変異でこのscenarioが失敗することを確認した。

### テスト件数の記載についての指摘

自動reviewは「節ごとにテスト件数が食い違う」と指摘した。**この指摘は成立しない。**

「9. 独立reviewの成立」が記す937 scenarioは、**ラウンド2で不一致を検出した時点の実測値**である。SCN-005とSCN-006を追加した後の939、SCN-007を追加した後の940とは別の時点を指す。件数を揃えると、検出時点の記述が事実でなくなる。

ただし時点が読み取れない書き方であったため、**数値ではなく時点を明記する形へ是正した。**

### 残存risk

**この検査自体が候補側にある。**`scripts/check_conformance.ts`は保護対象外であり、意図的な迂回者は検査ごと削除できる。本Issueが塞ぐのは「固定側への追加を忘れる」事故であって、意図的な迂回ではない。

**合成経路が検証されていない。**`checkRepositoryRuleLedger`から`checkTrustedScriptPinning`の呼び出しを外しても、6 scenarioは全通過し、`conformance:check`もexit 0のままである。ただしこれは本Issue固有ではない。`checkDistributionGateReachability`、`checkModeQuestionText`、`checkLifecycleIgnore`の3件も同じ形で、いずれも関数を直接呼ぶscenarioしか持たない。**本Issueの範囲で4件のうち1件だけへ機構を足すと、同型の検査に不統一な保護が生まれる。**4件へ一律に適用する判断は別Issueが持つべきである。

`if: false`の無効step除外と、`npm run-script`の記法の認識は変異が生存する。いずれも誤検出を減らす方向の分岐であり、外しても検査は緩まず厳しくなる。**目的阻害、データ喪失、回帰のいずれにも該当しない。**

## 5. 指摘

| ID | 深刻度 | 内容 | 状態 |
|---|---|---|---|
| S70-H-01 | High | `echo`の引数とcommentを参照と誤認していた | 是正済み。SCN-004で確認 |
| S70-H-02 | High | 部分一致で帰属させ、固定済みscriptの接頭辞である未固定scriptを見逃していた | 是正済み。SCN-003で確認 |
| S70-M-01 | Medium | **仕様が引用するSCNが「判定不能は拒否する」を検証していなかった** | 是正済み。SCN-005、006を追加し引用を001〜006へ更新 |
| S70-M-02 | Medium | 合成経路が無検証で、呼び出しを外しても全gateが緑になる | 未是正。**#988へ分離** |
| S70-L-01 | Low | `if: false`の無効step除外が無検証 | 未是正。外しても検査は緩まない |
| S70-H-03 | High | **`npm run 'x'`の単一引用符を抽出できず固定漏れが検出されない** | 是正済み。SCN-007で確認 |
| S70-L-02 | Low | `npm run-script`と引用符付き記法の認識が無検証 | 是正済み。SCN-007がラウンド3で閉じた |
| S70-L-03 | Low | 検査自体が保護対象外で削除できる | 未是正。**構造的限界。**本Issueの対象外 |
| S70-FP-01 | 該当なし | 自動reviewの「テスト件数の不統一」 | **false-positive。**別時点の実測値。時点を明記して是正 |
| S70-FP-02 | 該当なし | 静的解析の「動的commandを`exec`へ渡している」 | **false-positive。**`spawnSync`へ引数配列で渡しており`exec`を使っていない |

### ラウンド予算による打ち切り

**ラウンド3で打ち切った。**`.agent-skill-chain/docs/02_品質基準.md`は「同じ範囲の上限は3ラウンドで、自動更新しない」と定める。ラウンド3は上限であり、これ以上のラウンドへ自動更新しない。残った指摘はS70-M-02とLow 2件で、未解決のCritical/Highは0件である。S70-M-02は本Issue固有ではなく兄弟3検査と同型であるため、機構ごと#988へ分離した。

## 6. ラウンド固有の確認

### ラウンド1

High 2、Low 1。判定 **rejected**。`d0b148c6`で是正した。

### ラウンド2

未解決のHighは0件と確認した。新規にMedium 1、Low 2を検出した。Medium 1は仕様と証拠の不一致であり、`9e9c0e8a`で是正した。判定 **rejected（ラウンド3の自動reviewを待つ）**。

### ラウンド3（自動review）

Major 1、Minor 1。Major 1は参照抽出が単一引用符を取りこぼす欠陥であり、**本Issueが塞ごうとしている事故そのもの**であるため`f13b97a9`で是正した。Minor 1と静的解析の1件はいずれもfalse-positiveと判定し、根拠を上に記した。うち1件は時点が読み取れない書き方であったため記述を是正した。判定 **approved（残存Medium 1件を#988へ分離、Low 2件を記録）**。

## 7. テスト結果

| 層・検査 | コマンド | 件数 | 判定 |
|---|---|---|---|
| 形式 | `npm run format:check`、`npm run docs:format`、`npm run test:format` | exit 0 | pass |
| 静的 | `npm run lint`、`npm run typecheck`、`npm run source:check` | exit 0 | pass |
| 契約 | `npm run project:quality`、`npm run trace:check`、`npm run architecture:check` | exit 0 | pass |
| 統合 | `npm test` | 940 scenario全通過、4985 step全通過 | pass |
| 適合 | `npm run conformance:check`、`npm run package:check` | exit 0 | pass |
| 既定branch比較 | `--root=候補 --trusted-root=既定branch` | `valid: true` | pass |

検査の変異試験。対象は`checkTrustedScriptPinning`とその合成箇所である。

| 変異 | 失敗scenario数 |
|---|---|
| token境界の照合を部分一致へ戻す | 1 |
| step構造の走査を全文検索へ戻す | 1 |
| 未固定の抽出結果を捨てる | 2 |
| 候補treeでの無効値差し替えを外す | 2 |
| 参照0件の拒否を外す | 1 |
| 追跡file列挙の失敗の拒否を外す | 1 |
| 引用符の対照合を片側任意へ戻す | 1 |
| 無効stepの除外を外す | 0 |
| `run-script`の認識を外す | 0 |
| 合成から呼び出しを外す | 0 |
| 変異なし | 0（7件全通過） |

**変異試験の前に作業treeをcommit済みにした上で実施し、各変異の後は退避した原本の複写で復元した。**`git checkout`を後始末に使っていない。復元後に`git status`が空であることを都度確認している。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `scripts/check_conformance.ts` | 入らない | repository局所の検査 |
| `docs/specs/**` | 入らない | 製品仕様 |
| `test/**` | 入らない | test資産 |

判断: 配布物を更新しない

根拠: `package.json`の`files`が指す配布境界は`dist/bin/`、`dist/src/`、`.agent-skill-chain/`配下、`README.md`、`AGENTS.md`である。本差分の7 pathはいずれもこの境界へ入らず、`npm run package:check`もexit 0である。`package.json`と`src/`を1行も変更していないため、consumerから観測できる挙動の変化は無い。

## 9. 独立reviewの成立

| 条件 | 充足 |
|---|---|
| reviewerが実装担当と別contextである | 充足。ラウンド1は別identity、ラウンド2は引き継ぎ後の別セッション、ラウンド3は自動review |
| reviewerが実装担当の判断を入力に持たない | 充足。差分と実測値だけを入力にした |
| 各ラウンドの判定と根拠が原文引用を伴う | 充足 |
| 有限ラウンドで終了する | 充足。3ラウンドの上限で打ち切り |

**ラウンド2で、仕様の主張とSCN証拠の不一致を検出した。**当時の静的検査12種はすべてexit 0であり、`npm test`も当時の全件である937 scenarioが全通過であった（SCN-005以降を追加する前の時点の実測値である）。**検査が緑であることは正しさの十分条件ではない**という運用ポリシーの命題が、そのまま観測された事例である。検出には検査の実行ではなく、仕様の原文とSCNの対応を突き合わせる読解と変異試験を要した。

## 10. 仕様整合性

`docs/specs/`の4 fileを更新した。REQ-SQ-021、AC-SQ-021、QLT-SCRIPTPIN-001を採番し、追跡表でSCN-INT-SCRIPTPIN-001〜006へ結び付けた。ラウンド2でQLT-SCRIPTPIN-001の引用を001、002から001〜006へ是正し、主張と証拠を一致させた。ラウンド3でSCN-007を加えて001〜007とした。

## 11. 総合判定と再開地点

**判定: approved**

- 未解決Critical: 0件
- 未解決High: 0件
- 未解決Medium: 1件（S70-M-02。兄弟3検査と同型のため#988へ分離）
- 記録したLow: 2件（S70-L-01、S70-L-03）
- false-positive: 2件（S70-FP-01、S70-FP-02）

再開地点: ステップ11（PR作成）
