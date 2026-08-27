# 69 課題978 前方互換validator有効化実装レビュー

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象Issue | #978 |
| 比較基点 | `7a559a3c371890723a4bc0292d572d2313b8cd4d` |
| H_impl | `357ff01e23e3be838ff432fa3b3f1e07d5b83c01` |
| reviewer | codex（実装担当と別identity、別context） |
| 実施日 | 2026-08-27 |
| ラウンド数 | 4（うち1ラウンドは自動review） |

### 0.1 routing入力契約

承認済みproposalの原文、保護対象の差分、追加した検査と反例testの全文、実測値だけを渡した。実装担当の判定は渡していない。反例の探索はreviewerが独自に行った。

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 承認済みproposal | 既定branchの`.github/trusted-quality-proposals.json` | `TQP-DISTRIBUTION-PREPARE-001`（5→6、target 2件） | 既存コード |
| 差分 | `7a559a3c`..`357ff01e` | 11 path | 既存コード |
| 保護対象の差分 | 同上 | **2件のみ。**proposalのtargetと完全一致 | 実行観測 |
| trusted-base相当 | `--root=候補 --trusted-root=既定branch` | `valid: true` | 実行観測 |
| 静的検査 | 12種 | すべてexit 0 | テスト出力 |
| テスト | `npm test` | 933 scenario全通過、4950 step全通過 | テスト出力 |
| validatorの受理検査 | 2形 | 現行形・新形の双方を受理 | 実行観測 |
| validatorの変異試験 | 5経路 | すべて拒否 | 実行観測 |
| 到達性検査の変異試験 | 5経路 | すべて対応scenarioが失敗 | 実行観測 |
| 未知の準備工程の拒否 | 2形 | `echo skip`と短絡を含む形をいずれも拒否 | 実行観測 |
| 到達性検査の変異試験（追加分） | 4経路 | 短絡除外、公開前後関係、未知形拒否、区間anchorのすべてが検出される | 実行観測 |

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `docs/specs/02_要件/00_要件一覧.md` | M | change owner | 仕様 | REQ-SQ-020の登録 | 参照のみ | REQ-SQ-020 | 行の除去で戻る | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | change owner | 仕様 | REQ-SQ-020の定義 | 参照のみ | REQ-SQ-020 | 節の除去で戻る | pass |
| `docs/specs/11_非機能/01_品質要件.md` | M | change owner | 仕様 | QLT-DISTSCRIPT-001〜003、QLT-DISTGATE-001〜003 | 参照のみ | REQ-SQ-020 | 行の除去で戻る | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | change owner | 仕様 | REQ-SQ-020の追跡2行 | 参照のみ | REQ-SQ-020 | 行の除去で戻る | pass |
| `package.json` | M | repository owner | 品質契約 | `qualityContractVersion` 5→6 | 参照のみ | REQ-SQ-010、REQ-SQ-012 | 逆向きproposalによる前進で戻す | pass |
| `scripts/check_conformance.ts` | M | package owner | gate script | 準備工程の形とrelease workflowの呼び出し先の一致検査 | `package.json`・`release.yml`を読む単方向 | REQ-SQ-020、SCN-INT-DISTGATE-001〜020 | 追加関数と合成箇所の除去で戻る | pass |
| `scripts/check_project_quality.ts` | M | repository owner | 保護済みvalidator | 配布準備工程の2形の受理とgate列の完全一致検査 | 依存追加なし | REQ-SQ-020、SCN-UNIT-DISTSCRIPT-001〜009 | proposalのbeforeSha256の内容へ戻す | pass |
| `test/features/integration/distribution-gate-reachability.feature` | A | package owner | test | 到達性の受け入れ例 | 実装へ単方向 | SCN-INT-DISTGATE-001〜020 | fileの削除で戻る | pass |
| `test/features/unit/distribution-scripts.feature` | A | package owner | test | 2形の受理と自己緩和の拒否 | 実装へ単方向 | SCN-UNIT-DISTSCRIPT-001〜009 | fileの削除で戻る | pass |
| `test/steps/distribution-gate-reachability.steps.ts` | A | package owner | test | step定義とworkflow fixture | 実装へ単方向 | SCN-INT-DISTGATE全件 | fileの削除で戻る | pass |
| `test/steps/distribution-scripts.steps.ts` | A | package owner | test | step定義とscripts fixture | 実装へ単方向 | SCN-UNIT-DISTSCRIPT全件 | fileの削除で戻る | pass |

### proposalとの照合

保護対象の差分は次の2件だけで、`TQP-DISTRIBUTION-PREPARE-001`の`targets`と完全一致する。

| 対象の種別 | 対象 | 変更前hash | 変更後hash |
|---|---|---|---|
| 保護file | `scripts/check_project_quality.ts` | `249d8d3f…` | `300f2e13…` |
| packageのfield | `agentSkillChain.qualityContractVersion` | `ef2d127d…`（値は5） | `e7f6c011…`（値は6） |

残る9 pathは保護対象外である。**`targets`との一致は「全Git差分」ではなく「保護差分」の意味である。**

## 2. 受け入れ条件の確認

| AC | 結果 | 証拠 |
|---|---|---|
| 現行形を受理し続ける | 充足 | SCN-UNIT-DISTSCRIPT-001。**固定fixtureで現行形を明示構築する** |
| 新形を受理する | 充足 | SCN-UNIT-DISTSCRIPT-002 |
| gate集合と順序を保持する | 充足 | SCN-UNIT-DISTSCRIPT-003、004、005、009 |
| 準備工程の対称性を要求する | 充足 | SCN-UNIT-DISTSCRIPT-006 |
| 自己緩和を拒否し続ける | 充足 | SCN-UNIT-DISTSCRIPT-007、008 |
| 形と呼び出し先の一致 | 充足 | SCN-INT-DISTGATE-001〜004、010 |
| 呼び出しの構造判定 | 充足 | SCN-INT-DISTGATE-007〜009、011〜014 |
| 判定不能を拒否する | 充足 | SCN-INT-DISTGATE-005、006 |
| proposalとの完全一致 | 充足 | trusted-base相当が`valid: true` |

### 2.1 開発考慮事項の適用判定（必須）

| ID | 判定 | 確認 |
|---|---|---|
| DC-PRIVACY | not-applicable | 個人データを扱わない |
| DC-OBSERVABILITY | not-applicable | logも計測も生成しない |
| DC-UX | not-applicable | UIを持たない |
| DC-TOKENS | not-applicable | UI要素を持たない |

## 3. 肯定的評価

- 保護対象の差分がproposalのtargetと完全一致し、trusted-base相当で検証済みである。
- `verify:distribution`が現行`prepack`の文字列と完全一致するため、gate集合と順序の保存が文字列比較で示せる。
- 到達性検査の全分岐が変異試験で検出される。到達不能な分岐を1件削除した。

## 4. 敵対的評価

| ラウンド | 反例 | 結果 |
|---|---|---|
| 1 | 新形を許すとrelease.ymlが`prepack`しか呼ばずgateが消える | **成立。**到達性検査を追加して是正 |
| 1 | SCN-UNIT-DISTSCRIPT-001が後続PRでvacuous化する | **成立。**固定fixture化して是正 |
| 1 | `src/domain/release.ts`の`prepack`依存3箇所 | 成立。**PR-3の対象**として記録 |
| 1 | version 6のまま旧形へ退行できる | 成立。**残存Medium**として記録 |
| 2 | **`qualityContractVersion`が5のまま。proposal照合が壊れている** | **成立。重大。**下記「自己起因の回帰」を参照 |
| 2 | 到達性検査がYAML全文の文字列検索で、comment・`echo`・`if: false`を誤判定する | **成立。**step構造の走査へ是正 |
| 2 | SCN-002が禁止分岐を検証していない | **成立。**SCN-007〜012を追加して是正 |
| 3 | `true \|\| npm run verify:distribution`が到達性検査を通る | **成立。**下記「残存risk」を参照。#980へ分離 |
| 3 | `>`のfoldedスカラーが未検証 | **成立。**SCN-013、014を追加して是正 |
| 3 | 到達性検査自体が候補側にあり削除できる | 成立。**構造的限界。**#980へ分離 |
| 4 | `prepack: "echo skip"`と`npm run prepack`の組が全gate形として合格する | **成立。**準備工程が既知の2形であることを要求して是正 |
| 4 | `npm run verify:distribution \|\| true`が失敗を握り潰す | **成立。是正した。**失敗が伝播する区間だけを数える |
| 4 | `true \|\| npm run verify:distribution`が実行されない | **成立。是正した。**同上と区間先頭のanchor |
| 4 | `npm publish`より後でしか検証しない構成を受理する | **成立。是正した。**前後関係を検査する |
| 4 | 呼び出し検出の正規表現を変数から構築している | 成立。静的patternの2択へ置換 |

### 自己起因の回帰とその検出

**ラウンド2で、実装担当が自ら入れた回帰が検出された。**

到達性検査の変異試験で`package.json`を書き換え、後始末に`git checkout -- package.json`を使った。同一fileにあった未commitの`qualityContractVersion` 5→6 も一緒に巻き戻り、**proposalとの完全一致が崩れた状態でラウンド2へ入っていた。**

この状態は次の理由でローカルの検査を素通りする。

- 静的検査12種はすべてexit 0のままである
- `npm run project:quality`は`--trusted-root`を伴わないため、既定branch側との version 差を見ない
- 唯一検出できるのは`--root=候補 --trusted-root=既定branch`の実行であり、これはCIの必須checkだがローカルの既定手順に入っていない

以後、**保護fileまたは契約versionを変更した回は、後始末のたびにtrusted-base相当を再実行する**運用へ改めた。ラウンド3の実測値はこの手順で取得している。

### 残存risk

**到達性検査はshellの意味を解釈しない。** 次はgateを1件も実行せずに通過する。

```yaml
- run: true || npm run verify:distribution
```

同様に、job単位の`if:`、`npm publish`との前後関係、`needs:`による到達可能性を見ていない。

**本PRの範囲では是正しない。**理由は3点である。

1. **退行ではない。**本PR以前は準備工程の形とrelease workflowの呼び出し先を結ぶ検査が**1件も存在しなかった。**追加であり、誤って乖離させる事故は本PRで検出できるようになる。
2. **候補側では原理的に閉じない。**`scripts/check_conformance.ts`は保護対象外であり、意図的な迂回者は検査自体を削除できる。shell意味解析を積んでも同じである。
3. **本PRは`scripts`を変更しない。**現時点の`prepack`は現行形のままで、乖離の余地が生じるのは移行完了後である。

構造的な是正（実行保証を候補側で削除できない位置へ置く）は **#980** へ分離した。

**version 6のまま旧形へ退行できる**点も残る。validatorは`afterSha256`で固定済みで、本PRで変更すればproposal照合が壊れる。PR-3で`check_conformance.ts`へ新形の固定検査を置く。ただし前項と同じ限界を負うため、恒久的な固定は#980の対象である。

## 5. 指摘

| ID | 深刻度 | 内容 | 状態 |
|---|---|---|---|
| S10-H-01 | High | `qualityContractVersion`が5へ巻き戻りproposal照合が壊れていた | 是正済み。trusted-base相当で確認 |
| S10-H-02 | High | 到達性検査がYAML全文の文字列検索 | 是正済み。step構造の走査へ変更 |
| S10-H-03 | High | 新形を許すとrelease.ymlの呼び出し先と乖離する | 是正済み。到達性検査を追加 |
| S10-M-01 | Medium | SCN-UNIT-DISTSCRIPT-001が後続PRでvacuous化する | 是正済み。固定fixture化 |
| S10-M-02 | Medium | 到達性検査の禁止分岐と誤判定経路が未検証 | 是正済み。SCN-007〜014を追加 |
| S10-M-03 | Medium | 到達不能なcomment除去分岐が存在した | 是正済み。分岐を削除し末尾comment除去へ一本化 |
| S10-M-04 | Medium | job単位の`if:`と`needs:`の到達可能性を検証していない | 未是正。**#980へ分離** |
| S10-M-08 | Medium | shell短絡による未実行と失敗の握り潰しを数えていた | 是正済み。SCN-017、018で確認 |
| S10-M-09 | Medium | `npm publish`より後の検証を受理していた | 是正済み。SCN-019、020で確認 |
| S10-M-07 | Medium | 未知の準備工程の形を全gate形として扱っていた | 是正済み。SCN-015、016で確認 |
| S10-L-01 | Low | 呼び出し検出の正規表現を変数から構築していた | 是正済み。静的patternへ置換 |
| S10-M-05 | Medium | version 6のまま旧形へ退行できる | 未是正。**PR-3と#980で扱う** |
| S10-M-06 | Medium | `src/domain/release.ts`の`prepack`依存3箇所 | 未是正。**PR-3の対象** |

### ラウンド予算による打ち切り

**ラウンド3で打ち切った。**ラウンド3の指摘のうち S10-M-04 と S10-M-05 は、いずれも「候補側の検査は候補が削除できる」という構造的限界に帰着する。同型の指摘が反復するため、機構ごと **#980** へ分離した。目的阻害・データ喪失・回帰のいずれにも該当しないことを個別に確認している。

## 6. ラウンド固有の確認

### ラウンド1

High 3、Medium 1。判定 **rejected**。

### ラウンド2

High 3（うち1件は自己起因の回帰）、Medium 1。判定 **rejected**。

### ラウンド3

High-3（proposal照合）は resolved と確認された。残る指摘は構造的限界に帰着するため分離。新規Critical 0件。

### ラウンド4（自動review）

Major 1、Minor 2。うち**未知の準備工程の形を全gate形として扱う**点は是正した。`prepack: "echo skip"`と`npm run prepack`の組が到達済みと判定されていた。保護済みvalidatorは同じ組を拒否するが、**本検査だけでも判定が閉じるよう**準備工程が既知の2形であることを要求した。**shell短絡（`true ||`、`|| true`）と公開との前後関係も是正した。**失敗が伝播する区間（`&&`・`;`・改行で区切り、`||`を含む区間を除く）の先頭にある呼び出しだけを数え、`npm publish`より前の有効なstepであることを要求する。

残るのはjob単位の`if:`と`needs:`による到達可能性で、これは#980。判定 **approved（残存Medium 3件、うち3件を後続へ分離）**。

## 7. テスト結果

| コマンド | 結果 |
|---|---|
| 静的検査12種 | すべてexit 0 |
| `npm test` | 933 scenario全通過、4950 step全通過 |
| trusted-base相当 | `valid: true` |

validatorの変異試験。

| 変異 | 結果 |
|---|---|
| `verify:distribution`へ`exit 0`を注入 | 拒否 |
| `verify:distribution`のgate順序を入れ替え | 拒否 |
| `verify:distribution`から`audit:check`を除去 | 拒否 |
| legacy形で`prepare`を`true`へ | 拒否 |
| `prepack`を任意commandへ | 拒否 |

到達性検査の変異試験。

| 変異 | 失敗scenario数 |
|---|---|
| 残存`prepack`の禁止分岐を外す | 1 |
| comment除去を外す | 1 |
| `if: false`判定を外す | 1 |
| command位置の制約を外す | 1 |
| 形の判定を固定する | 8 |
| 短絡区間の除外を外す | 1 |
| 公開との前後関係の検査を外す | 1 |
| 未知形の拒否を外す | 2 |
| 区間先頭のanchorを外す | 1 |
| 変異なし | 0（20件全通過） |

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `package.json` | 入る | `qualityContractVersion`のみ。runtime挙動に影響しない |
| `scripts/**` | 入らない | repository局所の検査 |
| `test/**` | 入らない | test資産 |
| `docs/specs/**` | 入らない | 製品仕様 |

判断: 配布物を更新しない

根拠: `npm run package:check`がexit 0である。`package.json`の変更は`agentSkillChain.qualityContractVersion`の1 fieldのみで、`scripts`・`dependencies`・`bin`・`files`のいずれも変更していない。**consumerから観測できる挙動の変化は無い。**配布経路そのものの是正は`scripts`を変更するPR-3で行う。

## 9. 独立reviewの成立

| 条件 | 充足 |
|---|---|
| reviewerが実装担当と別identityである | 充足。codex |
| reviewerが実装担当の判断を入力に持たない | 充足。差分と実測値だけを渡した |
| 各ラウンドの判定と根拠が原文引用を伴う | 充足 |
| 有限ラウンドで終了する | 充足。3ラウンドで打ち切り |

**ラウンド2で実装担当自身が入れた回帰を検出した。**ローカルの静的検査12種はすべてexit 0であり、独立reviewが無ければCIまで気付けなかった。

## 10. 仕様整合性

`docs/specs/`の4 fileを更新した。REQ-SQ-020、AC-SQ-020、QLT-DISTSCRIPT-001〜003、QLT-DISTGATE-001〜003を採番し、追跡表でSCN-UNIT-DISTSCRIPT-001〜009とSCN-INT-DISTGATE-001〜020へ結び付けた。

## 11. 総合判定と再開地点

**判定: approved**

- 未解決Critical: 0件
- 未解決High: 0件
- 未解決Medium: 3件（S10-M-04と一部のM-05は#980、M-06とM-05の残りはPR-3）

再開地点: ステップ11（PR作成）
