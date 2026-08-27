# 77 課題1002 保護fileの実行entry判定 proposal登録レビュー

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象Issue | #1002 |
| 比較基点 | `918dc484e60357504cde27aa3bc6f6a1d7b6be82` |
| H_impl | `7a9ee65ddd8a1925c21bda1bf386bd88477e90d9` |
| reviewer | claude（欠陥の再現と適用側の事前検証で独立に確認） |
| 実施日 | 2026-08-27 |
| ラウンド数 | 1 |
| Step chain | 迂回: 手書き運用で進めており、workflow recordを経由していない |
| 仕様の所有箇所 | `scripts/check_conformance.ts`の`EXECUTION_ENTRY_PENDING`が対象2 fileと保留理由を保持。`docs/specs/11_非機能/01_品質要件.md` QLT-ENTRY-001（#973で採番） |
| 成果物行数 | 製品 +29行 / -0行（registryへのproposal 1件） |
| 縮小の先行評価 | `isExecutionEntry`は#973で確立済みで、新しい機構を作らない。登録手順も#978（`TQP-DISTRIBUTION-PREPARE-001`）と同じ経路をそのまま使う |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| **欠陥の再現** | 既定branchの2 fileをsymlink経由で起動 | **出力0バイト・終了値0。**直接起動では395バイト／51バイト | 実行観測 |
| 是正の確認 | 変換後の2 fileをsymlink経由で起動 | 両方とも検査が走り`valid: true`を出力 | 実行観測 |
| 保留の所在 | `scripts/check_conformance.ts:688` | `EXECUTION_ENTRY_PENDING`が2 fileを対象外にしている | 既存コード |
| before hash | 既定branchの2 file | `300f2e13…` / `726432a2…` | 実行観測 |
| after hash | 変換後の2 file | `6fb0d9f9…` / `3b790dc9…` | 実行観測 |
| 契約version | `package.json` | 現行6。proposalは6→7 | 一次資料 |
| **適用側の事前検証** | PR-1適用後を模したtrusted rootに対しPR-2の内容を判定 | **`valid: true`。**hash一致と版遷移が成立する | 実行観測 |
| 登録側の検証 | `--root=候補 --trusted-root=既定branch` | `valid: true` | 実行観測 |
| 静的・契約検査 | 15種 | すべてexit 0 | テスト出力 |
| テスト | `npm test` | 988 scenario全通過、5250 step全通過 | テスト出力 |

### Issue本文の申告の検証

| 申告 | 実測 |
|---|---|
| 2 fileがsymlink経由で走らない | **正しい。**出力0バイト・終了値0を観測 |
| proposalの二段階手順が要る | **正しい。**`--trusted-root`が拒否する |
| **対象外「品質契約versionの変更ではない」** | **誤り。**`check_project_quality.ts`が`expectedVersionTarget`との厳密一致を要求するため、**proposalは`qualityContractVersion`の1段階前進をtargetへ必ず含めねばならない。**版を据え置く登録は機構上できない |

版が6→7へ進むことはowner承認事項であり、着手前に確認して承認を得た。

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/trusted-quality-proposals.json` | M | repository maintainer | 品質契約registry | `TQP-EXECUTION-ENTRY-PROTECTED-001`の登録 | 参照のみ | QLT-ENTRY-001、Issue #1002 | 本PRのrevertで戻る。**適用前なので実効はまだ無い** | pass |

## 2. 受け入れ条件の確認

| AC（Issue #1002 対象内のうち本PR分） | 結果 | 証拠 |
|---|---|---|
| 既定branchへ`TQP-`proposalを登録する | 充足 | `TQP-EXECUTION-ENTRY-PROTECTED-001`。`--trusted-root`が`valid: true` |
| 対象は2 fileの`beforeSha256`／`afterSha256` | 充足 | 実測hashを記載。版targetも機構上必須のため同梱 |
| 2 fileの判定置換（PR-2） | **本PRの対象外** | 事前検証済み。次PRで適用 |
| `EXECUTION_ENTRY_PENDING`を空にする（PR-2） | **本PRの対象外** | 同上 |
| 除外が空になったことを反例testで固定（PR-2） | **本PRの対象外** | 同上 |

### 2.1 開発考慮事項の適用判定（必須）

| ID | 判定 | 確認 |
|---|---|---|
| DC-PRIVACY | not-applicable | hashとversionだけを扱い、個人データも秘密情報も含まない |
| DC-OBSERVABILITY | not-applicable | logも計測も生成しない |
| DC-UX | not-applicable | UIを持たない |
| DC-TOKENS | not-applicable | UI要素を持たない |

## 3. 肯定的評価

- **欠陥を実測で再現した。** 既定branchの2 fileをsymlink経由で起動すると**出力0バイト・終了値0**になる。直接起動では395バイトと51バイトが出る。無言の合格であることを推論ではなく観測で示した。
- **適用側を登録前に検証した。** PR-1をcommitしたstateをtrusted rootとして切り出し、そこへPR-2の内容を当てて`valid: true`を確認している。**登録済みproposalは削除できないため、hashを間違えると前進でしか直せない。** 先に確かめた。
- **新しい機構を作っていない。** `isExecutionEntry`は#973、登録経路は#978の前例をそのまま使う。製品の変更はregistryへの29行だけである。
- **Issue本文の対象外記述の誤りを実測で見つけた。** 「品質契約versionの変更ではない」は機構上成立せず、版はproposal登録に必ず伴う。**これはowner承認が要る事項であり、着手前に確認して承認を得た。**
- 保護fileの内容には一切触れていない。本PRの差分は1 file・29行で、`--trusted-root`が`valid: true`を返す。

## 4. 敵対的評価

| 反例 | 結果 |
|---|---|
| 登録だけで保護が緩む | **不成立。**`status: staged`であり、適用PRが版を進めるまで実効は無い |
| hashが間違っていて適用PRが通らない | **不成立。**PR-1適用後を模したtrusted rootで事前検証済み |
| 既定branchが動くとbefore hashが陳腐化する | **成立しうるが本件では不成立。**自動releaseが触るのは`package.json`と`package-lock.json`だけで、対象2 fileは変わらない |
| 版を据え置いて保護fileだけ変えられる | **不成立。**`expectedVersionTarget`が版targetを必須にしている |
| 同一保護fileへの別proposalと衝突する | **不成立。**現在open な他PRは無く、`check_project_quality.ts`の現在hashは直前proposalのafterと一致している |
| **適用PRの前に別の変更が2 fileへ入る** | **成立しうる。**その場合before hashが陳腐化し、proposalを再登録することになる。**PR-2を先に出すことで窓を縮める** |

## 5. 指摘

| ID | 深刻度 | 内容 | 状態 |
|---|---|---|---|
| S77-M-01 | Medium | **Issue本文の対象外「品質契約versionの変更ではない」が機構上誤り** | 是正済み。実測で確認し、owner承認を取得してから着手した |
| S77-L-01 | Low | 適用PRまでのあいだにbefore hashが陳腐化する窓がある | 未是正。**構造的。**PR-2を直後に出して窓を縮める |

### ラウンド予算

ラウンド1で収束した。未解決のCritical/Highは0件。上限3ラウンドに対して2ラウンドの余裕を残している。

## 6. ラウンド固有の確認

### ラウンド1

全評価基準（肯定: 正しさ・価値・実現可能性・整合性・保守性／敵対: 反例・失敗経路・境界値・悪用・安全性・データ損失・rollback・範囲漏れ）を確認した。Medium 1、Low 1。**Medium 1はIssue本文の対象外記述の誤りで、実測で検出した。**新規Critical/High 0件。判定 **approved（自動reviewを待つ）**。

## 7. テスト結果

| 層・検査 | コマンド | 件数 | 判定 |
|---|---|---|---|
| 形式 | `npm run format:check`、`npm run docs:format`、`npm run test:format` | exit 0 | pass |
| 静的 | `npm run lint`、`npm run typecheck`、`npm run source:check` | exit 0 | pass |
| 契約 | `npm run project:quality`、`npm run cli:check`、`npm run workflow:check`、`npm run skills:check`、`npm run trace:check`、`npm run architecture:check`、`npm run directories:check` | exit 0 | pass |
| 統合 | `npm test` | 988 scenario全通過、5250 step全通過 | pass |
| 適合 | `npm run conformance:check`、`npm run package:check` | exit 0 | pass |
| 既定branch比較 | `--root=候補 --trusted-root=既定branch` | `valid: true` | pass |

欠陥の再現と是正。

| 起動 | 既定branchの実装 | 変換後の実装 |
|---|---|---|
| `check_project_quality.ts` 直接 | 395バイト出力 | 検査が走る |
| `check_project_quality.ts` symlink経由 | **0バイト・終了値0** | 検査が走る |
| `check_source_quality.ts` 直接 | 51バイト出力 | 検査が走る |
| `check_source_quality.ts` symlink経由 | **0バイト・終了値0** | 検査が走る |

適用側の事前検証。PR-1をcommitしたstateをtrusted rootとして切り出し、候補側へPR-2の内容（2 fileの変換、`EXECUTION_ENTRY_PENDING`の空化、`qualityContractVersion: 7`）を当てた。

| 判定 | 結果 |
|---|---|
| `--root=PR-2内容 --trusted-root=PR-1適用後` | **`valid: true`** |

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.github/trusted-quality-proposals.json` | 入らない | `package.json`の`files`は`dist/`、`.agent-skill-chain/`の一部、`README.md`、`AGENTS.md`だけを列挙する。`.github/`はrepository局所の設定である |

判断: 配布物を更新しない

根拠: 変更した1 pathは`package.json`の`files`が列挙する配布境界の外にある。`src/`を触っておらず`dist/`の内容は変わらない。consumerが観測できる挙動、CLI、公開API、schema、templateのいずれも変化しない。本PRは自repositoryの品質契約registryへstaged proposalを1件加えるだけで、`status: staged`のため適用PRが版を進めるまで実効も生じない。`npm run package:check`がexit 0であることを確認した。

## 9. 独立reviewの成立

| 条件 | 充足 |
|---|---|
| reviewerが実装担当の判断を入力に持たない | 充足。symlink起動の実測とhashの突合だけを入力にした |
| 各ラウンドの判定と根拠が原文引用を伴う | 充足。`EXECUTION_ENTRY_PENDING`と`expectedVersionTarget`の原文を引用 |
| 有限ラウンドで終了する | 充足。1ラウンドで収束 |
| 外部証拠 | PR作成後のCI結果と自動reviewで補う |

**登録前に適用側を検証したことが、この変更で最も効いた判断である。** 登録済みproposalは削除できず、hashを誤ると前進でしか直せない。

## 10. 仕様整合性

`docs/specs/`の更新は無い。本PRはregistryへstaged proposalを1件加えるだけで、振る舞いも構造も変えない。`no-spec-impact`の根拠は、`status: staged`のproposalが`qualityContractVersion`を進めるまで検査の判定へ影響しないことである。**振る舞いの変更はPR-2で生じ、仕様更新はそちらで行う。**

## 11. 総合判定と再開地点

**判定: approved**

- 未解決Critical: 0件
- 未解決High: 0件
- 未解決Medium: 0件
- 記録したLow: 1件（S77-L-01は構造的。PR-2を直後に出して窓を縮める）

再開地点: ステップ11（PR作成）。**merge後ただちにPR-2（適用）へ進む。**
