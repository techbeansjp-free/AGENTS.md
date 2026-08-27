# 79 課題1009 trusted validatorのimport閉包保護 proposal登録レビュー

> 状態: `candidate-verified`（外部承認待ち）。`src/lib/entrypoint.ts`と`src/lib/security.ts`を`PROTECTED_FILES`へ加える品質契約proposalを登録する変更を、merge済みdefault branch headを比較基点として固定した内部監査証拠である。**`valid: true`は候補proposalが既定branchを基準に検証を通過したことを示すだけであり、既定branchへ登録済みであることを示さない。**独立reviewの承認は自己申告せず、CIとPR reviewの外部証拠で確定する。既定branchへの登録と適用PRの開始は、merge後の再検証を経てから行う。

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象Issue | #1009 |
| 比較基点 | `a9f8be0390389d5a40416da4d559bf59a375e023` |
| H_impl | `211f6f6af657fb19fd00c0fd6749af7b8f7e85d2` |
| reviewer | claude（旧validatorと新validatorのA/B実測で独立に確認） |
| 実施日 | 2026-08-27 |
| ラウンド数 | 1 |
| Step chain | 迂回: 手書き運用で進めており、workflow recordを経由していない |
| 仕様の所有箇所 | `.agent-skill-chain/docs/00_運用ポリシー.md`「fail-closed不変条件」と「権限」。**本変更はauthority分離を強める方向であり、同文書:17が縮小対象外とする手段を弱めない。**owner決裁は2026-08-27に取得済み（案A限定） |
| 成果物行数 | **総変更量で測る。製品23行**（registryへのproposal 1件）。支援層は本レビュー文書のみ |
| 縮小の先行評価 | 新しい機構を作らない。`PROTECTED_FILES`は既存の列挙で追加は2行、proposal登録の経路は#978・#1002の前例をそのまま使う。**import閉包のhash manifestをpinする案（案B）も評価したが、新機構でありowner承認範囲外のため採らなかった。**案Bは中期の本命としてIssue本文に残す |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| **保護機構が非保護moduleへ依存** | `scripts/check_project_quality.ts:218`、`:391-392`、`:415` | `stableJson`（非保護`src/lib/security.ts`）が保護snapshotのhash計算、proposal契約の照合、版targetの算出に使われる | 既存コード |
| 非保護実行面の規模 | `policy.ts` 1749行、`types.ts` 229行、`security.ts` 177行、`entrypoint.ts` 29行 | 計2184行が`PROTECTED_FILES`の外 | 実行観測 |
| **効果のA/B実測** | 同一の改竄候補（`security.ts`へ1行追記、版は据え置き） | **旧validator（保護10件）は`valid: true`、新validator（保護12件）は`valid: false`** | 実行観測 |
| before hash | 比較基点の`check_project_quality.ts` | `6fb0d9f9…` | 実行観測 |
| after hash | 変換後の`check_project_quality.ts` | `3f910b02…` | 実行観測 |
| 版targetのhash | `qualityContractVersion: 8` | `2c624232…` | 実行観測 |
| **適用側の事前検証** | PR-1適用後を模したtrusted rootへPR-2の内容を当てる | **`valid: true`** | 実行観測 |
| 登録側の検証 | `--root=候補 --trusted-root=既定branch` | `valid: true` | 実行観測 |
| 変更頻度（保護の費用） | 2026-07以降 | `entrypoint.ts` 1、`security.ts` 1 commit | 実行観測 |

### owner決裁の記録

保護境界の拡大は「誰がproposal無しに何を変更できるか」を決めるauthority boundaryの変更であり、
進行役が単独で決めない。2026-08-27に案Aを明示承認いただいた。

| 対象 | 2026-07以降の変更 | 判断 |
|---|---|---|
| `src/lib/security.ts` | 1 commit | **入れる。**保護機構自身のhash照合の正本 |
| `src/lib/entrypoint.ts` | 1 commit | **入れる。**依存はNode builtinのみ |
| `scripts/check_conformance.ts` | 21 commit | **入れない。**全編集が2PRサイクルになり運用ポリシーの速度条件に衝突 |
| `src/types.ts` | 12 commit | 入れない |
| `src/domain/policy.ts` | 14 commit | 入れない。推移依存が深く列挙では閉じない |

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/trusted-quality-proposals.json` | M | repository maintainer | 品質契約registry | `TQP-PROTECTED-CLOSURE-001`の登録 | 参照のみ | Issue #1009 | 本PRのrevertで戻る。**適用前なので実効はまだ無い** | pass |

## 2. 受け入れ条件の確認

| AC（Issue #1009 のうち本PR分） | 結果 | 証拠 |
|---|---|---|
| 既定branchへ`TQP-`proposalを登録する | 充足 | `--trusted-root`が`valid: true` |
| 対象は`check_project_quality.ts`と版field | 充足 | 実測hashを記載 |
| `PROTECTED_FILES`への2件追加（PR-2） | **本PRの対象外** | 事前検証済み |
| 保護が効くことの反例test（PR-2） | **本PRの対象外** | A/B実測は済み。testはPR-2で追加 |

### 2.1 開発考慮事項の適用判定（必須）

| ID | 判定 | 確認 |
|---|---|---|
| DC-PRIVACY | not-applicable | hashとversionだけを扱う |
| DC-OBSERVABILITY | not-applicable | logも計測も生成しない |
| DC-UX | not-applicable | UIを持たない |
| DC-TOKENS | not-applicable | UI要素を持たない |

## 3. 肯定的評価

- **効果をA/Bで実測した。** 同一の改竄候補に対し、旧validatorは`valid: true`、新validatorは`valid: false`。「保護した気になる」変更ではないことを推論ではなく観測で示した。
- **最も守る価値のあるfileを選んでいる。** `security.ts`の`stableJson`は保護snapshotのhash計算そのものに使われる。**これを細工されると保護機構自体が破れる。**
- **費用を実測して選別した。** 2026-07以降の変更頻度が1 commitの2件だけを入れ、21 commitの`check_conformance.ts`は外した。運用ポリシーの「手段が開発速度を損なうとき、縮小するのは手段の側」に沿う。
- **新しい機構を作っていない。** 列挙2行の追加と、#978・#1002と同じ登録経路である。
- **適用側を登録前に検証した。** 登録済みproposalは削除できず、hashを誤ると前進でしか直せない。

## 4. 敵対的評価

| 反例 | 結果 |
|---|---|
| 登録だけで保護が変わる | **不成立。**`status: staged`であり、適用PRが版を進めるまで実効は無い |
| hashが誤っていて適用PRが通らない | **不成立。**PR-1適用後を模したtrusted rootで事前検証済み |
| 既定branchが動くとbefore hashが陳腐化する | **成立しうる。**自動releaseは`package.json`と`package-lock.json`しか触らないため release bumpでは陳腐化しないが、`check_project_quality.ts`への別変更が入ると再登録になる。**PR-2を直後に出して窓を縮める** |
| **保護対象への追加と対象file本体の変更を同じPRで行うbootstrap** | **【訂正】成立する。**当初「不成立」と記載したが誤りであった。**実測で確認した。**base validatorは自分の`PROTECTED_FILES`（10件）でsnapshotを取るため、候補が追加した`security.ts`をそもそもhash照合の対象にしない。backdoorを追記した`security.ts`を適用PRへ同梱した候補は`valid: true`で通る。「適用PRは列挙追加だけを行う」は**規約であって機構ではなかった**。S79-H-01として記録し、本proposalへ拘束を追加した |
| 争いのあるpinを同梱して決裁を止める | **不成立。**`check_conformance.ts`は入れていない |
| これで閉包が閉じる | **不成立。**`policy.ts` 1749行は開いたままである。**案Aは第一歩であり終着ではない。**列挙への逐次追加はもぐら叩きになるため、案B（import閉包のhash manifest）をIssue本文に中期の本命として残す |

## 5. 指摘

| ID | 深刻度 | 内容 | 状態 |
|---|---|---|---|
| S79-H-01 | High | **bootstrap回避が規約であって機構でなかった。**保護対象へ加えるのと同じPRで対象fileを改竄でき、base validatorは`valid: true`を返す。**実測で確認した** | **是正した。**本proposalへ`validateProtectionBootstrap`を含め、新たに保護対象へ加えるfileがtrusted側と同一内容であることを要求する。**ただし本版の適用には窓が残る**（下記S79-M-02） |
| S79-M-01 | Medium | **案Aでは`src/domain/policy.ts`（1749行）が保護境界の外に残る。**列挙への逐次追加では閉包が閉じない | 未是正。**構造的。**Issue #1009 に案Bとして残す |
| S79-M-02 | Medium | **本版（7→8）の適用そのものには窓が残る。**拘束はbase側で走るため、効くのは次の版上げからである。保護追加の初回には必ず窓が開く | 未是正。**構造的で回避不能。**適用PRの差分を最小に保ち、2 fileのbase hashをPR本文へ公開して1コマンドで検証可能にする |
| S79-M-03 | Medium | `check_project_quality.ts`は`src/types.ts`にも直接依存しており、案Aでは閉じない | 未是正。S79-M-01と同根 |
| S79-L-01 | Low | rollbackは版の前進でしか行えない | 未是正。proposalの`rollback`欄へ手順を記載済み |
| S79-L-02 | Low | 適用PRまでのあいだにbefore hashが陳腐化する窓がある | 未是正。**構造的。**PR-2を直後に出して窓を縮める |

### ラウンド予算

ラウンド1で収束した。未解決のCritical/Highは0件。上限3ラウンドに対して2ラウンドの余裕を残している。

## 6. ラウンド固有の確認

### ラウンド1

全評価基準（肯定: 正しさ・価値・実現可能性・整合性・保守性／敵対: 反例・失敗経路・境界値・悪用・安全性・データ損失・rollback・範囲漏れ）を確認した。Medium 1、Low 2。新規Critical/High 0件。判定 **approved（自動reviewを待つ）**。

本Issueの問題設定自体が、#1002 のアドバイザー諮問2巡から得られたものである。1巡目でcodexが`entrypoint.ts`の無条件除外を指摘し、2巡目でfableが「問題は`entrypoint.ts`単体ではなくimport閉包全体であり、`security.ts`が最大の見落とし」と指摘した。**両方とも実測で確認してから本Issueへ反映している。**

## 7. テスト結果

| 層・検査 | コマンド | 件数 | 判定 |
|---|---|---|---|
| 形式 | `npm run format:check`、`npm run docs:format`、`npm run test:format` | exit 0 | pass |
| 静的 | `npm run lint`、`npm run typecheck`、`npm run source:check` | exit 0 | pass |
| 契約 | `npm run project:quality` ほか | exit 0 | pass |
| 統合 | `npm test` | 990 scenario全通過 | pass |
| 適合 | `npm run conformance:check`、`npm run package:check` | exit 0 | pass |
| 既定branch比較 | `--root=候補 --trusted-root=既定branch` | `valid: true` | pass |

保護の効果。同一の改竄候補（`src/lib/security.ts`へ1行追記、版は7のまま）を2つのvalidatorで判定した。

| validator | `PROTECTED_FILES` | 判定 |
|---|---|---|
| 比較基点のもの | 10件 | **`valid: true`（素通り）** |
| 本proposalの適用後 | 12件 | **`valid: false`（拒否）** |

適用側の事前検証。

| 判定 | 結果 |
|---|---|
| `--root=PR-2内容 --trusted-root=PR-1適用後` | **`valid: true`** |

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.github/trusted-quality-proposals.json` | 入らない | `package.json`の`files`は`dist/`、`.agent-skill-chain/`の一部、`README.md`、`AGENTS.md`だけを列挙する。`.github/`はrepository局所の設定である |

判断: 配布物を更新しない

根拠: 変更した1 pathは配布境界の外にある。`src/`を触っておらず`dist/`の内容は変わらない。consumerが観測できる挙動、CLI、公開API、schema、templateのいずれも変化しない。`status: staged`のため適用PRが版を進めるまで実効も生じない。

## 9. 独立reviewの成立

| 条件 | 充足 |
|---|---|
| reviewerが実装担当の判断を入力に持たない | 充足。旧・新validatorのA/B実測とhash突合だけを入力にした |
| 各ラウンドの判定と根拠が原文引用を伴う | 充足。`PROTECTED_FILES`と`stableJson`の使用箇所を引用 |
| 有限ラウンドで終了する | 充足。1ラウンドで収束 |
| 外部証拠 | PR作成後のCI結果と自動reviewで補う |

**保護の効果をA/Bで先に実測したことが、この変更で最も効いた判断である。** 保護対象を増やす変更は「増やした」だけで安心しやすい。旧validatorが同じ改竄を`valid: true`で通すことを観測して、初めて意味があると言える。

## 10. 仕様整合性

`docs/specs/`の更新は無い。本PRはregistryへstaged proposalを1件加えるだけで、振る舞いも構造も変えない。`no-spec-impact`の根拠は、`status: staged`のproposalが`qualityContractVersion`を進めるまで検査の判定へ影響しないことである。**振る舞いの変更はPR-2で生じ、仕様更新はそちらで行う。**

## 11. 総合判定と再開地点

**判定: candidate-verified（外部承認待ち）**

**`approved`とは記録しない。**外部承認と最新状態の検証が未完了のためである。

- 未解決Critical: 0件
- 未解決High: 0件（S79-H-01は本PRで是正した）
- 未解決Medium: 3件（S79-M-01とS79-M-03は構造的で案Bへ、S79-M-02は回避不能）
- 記録したLow: 2件

再開地点: ステップ11（PR作成）。**merge後に再検証してからPR-2（適用）へ進む。**

## 12. ラウンド2で見つかった欠陥

**自動reviewとアドバイザーが、私の断定の誤りを1件見つけた。**

codexが「適用PRへの保護対象file同梱変更を旧validatorが検出できない」をHighで指摘した。
実測すると成立した。backdoorを追記した`security.ts`を同梱した候補が`valid: true`で通る。
**私は敵対的評価でこれを「不成立」と書いていた。**根拠は「適用PRは列挙追加だけを行う」という
自分の運用規約であり、機構による強制ではなかった。**規約を機構と誤認した。**

owner決裁を経て、本proposalへ`validateProtectionBootstrap`を含めた（案B'）。
新たに保護対象へ加えるfileがtrusted側と同一内容であることをbase validatorが要求する。
変異試験3方向で確認した。

| 入力 | 期待 | 実測 |
|---|---|---|
| 保護追加＋同一PRで改竄 | 拒否 | `新たに保護対象へ加えるfileを同じPRで変更できません: src/types.ts` |
| 保護追加のみ（改竄なし） | 誤検出しない | 検出なし |
| `PROTECTED_FILES`を読めない形へ改変 | fail-closed | `候補のPROTECTED_FILESを読み取れません` |

CodeRabbitは「`valid: true`は既定branchへ登録済みであることを示さない。外部承認前に`approved`と
記録しない」をMajorで指摘した。妥当なので状態を`candidate-verified`へ改めた。
