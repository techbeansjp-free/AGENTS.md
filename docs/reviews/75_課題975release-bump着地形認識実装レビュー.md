# 75 課題975 release bump除外の着地形認識 実装レビュー

## 0. レビュー識別情報

| 項目 | 値 |
|---|---|
| 対象Issue | #975 |
| 比較基点 | `72b1e0ba56ae3734a882b5a1b76e2f710d9bf376` |
| H_impl | `bd217771cfeea05a71a0592ca1aa99da8a164ad1` |
| reviewer | claude（変異試験と実履歴走査で独立に検証）＋CodeRabbit（exact-head review） |
| 実施日 | 2026-08-27 |
| ラウンド数 | 2（うち1ラウンドは自動review） |
| Step chain | 迂回: 手書き運用で進めており、workflow recordを経由していない |
| 仕様の所有箇所 | `docs/specs/11_非機能/01_品質要件.md:42` QLT-AUDIT-002「別親側の固有commitがすべて3条件を満たすrelease bump commitで」 |
| 成果物行数 | 製品 +18行 / -3行（net +15行） / 仕様 +2行 / -2行 / 支援層 +140行 / -21行 |
| 縮小の先行評価 | 新しい判定を書かず、既存の`isReleaseBumpTransition`へ委譲した。関数は1本増えて1本消え、概念は増えていない。test fixtureも既存のartifact生成を関数へ切り出して再利用した |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 仕様の欠落 | `docs/specs/11_非機能/01_品質要件.md:42` | QLT-AUDIT-002が「別親側の固有commit」を親1個のcommitに限定していた。**欠陥は実装ではなく仕様側にあった** | 一次資料 |
| 欠陥の再現 | 実履歴 `3aec66cc..7dd3554b` | 側は`7dd3554b`（親2個）と`16162d44`（親1個）。前者で`isDirectReleaseBump`が偽 | 実行観測 |
| **除外の成立実績** | 全履歴364 mergeの全量走査 | **45件で成立している。Issue本文の「一度も動いていない可能性」は誤り** | 実行観測 |
| **除外が破れる遷移** | 同上 | **6件。すべて「既定branch追随mergeが側にrelease PR mergeを含む」形** | 実行観測 |
| Issue本文の「実測」 | 実履歴 `24347540` | **#975の欠陥では説明できない。是正前後で出力14行が完全に同一。**#1004へ分離 | 実行観測 |
| 是正の確認 | SCN-INT-AUDITBUMP-003 | 是正なしで失敗、是正ありで合格 | テスト出力 |
| 静的・契約検査 | 13種 | すべてexit 0 | テスト出力 |
| テスト | `npm test` | 982 scenario全通過、5220 step全通過 | テスト出力 |
| 検査の変異試験 | 5変異 | 4変異を検出、1変異は非検出（下記） | 実行観測 |

### Issue本文の申告と実測の差

Issue #975 は3つの主張を含む。**全量走査で1つが誤り、1つが別欠陥であった。**

| 申告 | 実測 | 扱い |
|---|---|---|
| `isDirectReleaseBump`がmerge commitを弾く | **正しい。** 該当遷移6件 | 本PRで是正 |
| 「機構が一度も動いていない可能性がある」 | **誤り。** 45件で成立している | 是正不要。除外はrelease PR merge自身の遷移では最初から効いていた |
| 「実測: PR #970 の`24347540`で失敗した」 | **#975の欠陥では説明できない。** 是正前後で出力が同一 | 別欠陥として #1004 を起票 |

走査は全364 mergeの全親組へ「導入差分が`package.json`／`package-lock.json`だけか」「別親側が親1個のcommitだけで構成されるか」を適用して数えた。推定ではなく全量である。

## 変更ファイル個別監査

| path | status | owner | target layer | 責務・配置 | 依存・循環 | 仕様・追跡 | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `docs/specs/11_非機能/01_品質要件.md` | M | change owner | 仕様 | QLT-AUDIT-002が別親側のmerge commitを規定 | 参照のみ | QLT-AUDIT-002 | 行を戻す | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | change owner | 仕様 | SCN-INT-AUDITBUMP-003〜004の追跡 | 参照のみ | REQ-GH-005 | 行を戻す | pass |
| `scripts/check_file_audit.ts` | M | package owner | gate script | 側のcommit判定をmerge commitへ拡張 | 同file内の既存関数への相互再帰 | QLT-AUDIT-002、SCN-INT-AUDITBUMP-003〜004 | 関数を元の`isDirectReleaseBump`へ戻す | pass |
| `test/features/integration/audit-bump-exclusion.feature` | M | package owner | test | 受け入れ例2件を追加 | 実装へ単方向 | SCN-INT-AUDITBUMP-003〜004 | scenarioの除去で戻る | pass |
| `test/steps/audit-bump-exclusion.steps.ts` | M | package owner | test | 着地形fixtureと既存artifact生成の切り出し | 実装へ単方向 | SCN-INT-AUDITBUMP-003〜004 | 追加関数とGivenの除去で戻る | pass |

## 2. 受け入れ条件の確認

| AC（Issue #975 対象内） | 結果 | 証拠 |
|---|---|---|
| `isReleaseBumpSide`が、導入差分が`package.json`と`package-lock.json`だけであるmerge commitを受け付ける | 充足 | `isReleaseBumpCommit`。SCN-INT-AUDITBUMP-003 |
| 除外が実際に効いていることを、着地形を再現した反例testで固定する | 充足 | SCN-INT-AUDITBUMP-003。変異Aで失敗、是正で合格 |
| 除外が一度でも成立した実績があるかを履歴から確認する | 充足 | **45件で成立。**全364 mergeの全量走査 |
| 3条件（subject接頭辞・変更path限定・version限定）を維持する | 充足 | 葉の直接bump commitで維持。変異C・Eをテストが検出 |
| #962の追随手順を変えない | 充足 | `.agent-skill-chain/docs/`と手順文書は無変更 |

### 2.1 開発考慮事項の適用判定（必須）

| ID | 判定 | 確認 |
|---|---|---|
| DC-PRIVACY | not-applicable | commit構造とpathだけを読み、個人データも秘密情報も扱わない |
| DC-OBSERVABILITY | not-applicable | logも計測も生成しない。既存のJSON出力の形は不変 |
| DC-UX | not-applicable | UIを持たない |
| DC-TOKENS | not-applicable | UI要素を持たない |

## 3. 肯定的評価

- **仕様側を直した。** QLT-AUDIT-002 が「別親側の固有commit」を親1個に限定しており、実装の`parents.length !== 1`はその写しであった。仕様を直さずに実装だけを緩めると、次の変更で同じ制限が書き戻る。
- **新しい機構を足していない。** merge commitの判定は`isReleaseBumpTransition`が既に持っており、そこへ委譲しただけである。関数は`isDirectReleaseBump`が消えて`isReleaseBumpCommit`が生まれ、差し引き0本。製品はnet +15行。
- **3条件を緩めていない。** merge自身のsubjectは`Merge pull request …`だが、再帰の葉では接頭辞つきの直接bump commitを要求する。変異Eを既存scenarioが検出する。
- **Issue本文の申告を全量走査で検証した。** 364 mergeの全親組を数え、3つの申告のうち1つが誤り、1つが別欠陥であることを実測で示した。推定で「たぶん動いていない」と書いていない。
- **別欠陥を混ぜずに分離した。** `24347540`の失敗は`inferReviewBoundary`の`.at(-1)`が原因で、是正前後の出力が完全に同一であることを`diff`で確認したうえで #1004 を起票した。

## 4. 敵対的評価

| 反例 | 結果 |
|---|---|
| 除外機構は導入以来一度も動いていない | **不成立。** 45件で成立している |
| 是正がIssue本文の実測（`24347540`）を解消する | **不成立。** 是正前後の出力14行が完全に同一。別欠陥として分離 |
| merge commitを受け付けると任意のmergeが除外される | **不成立。** SCN-INT-AUDITBUMP-004。側の葉は依然として3条件を要求する |
| 相互再帰が停止しない | **不成立。** `isReleaseBumpTransition`→`isReleaseBumpSide`→`isReleaseBumpCommit`の各段で親へ降り、範囲は厳密に古い側へ縮む。`rev-list p..otherParent`は`commit`自身を含まない |
| 再帰でrev-listが指数的に増える | **成立するが実害なし。** 実履歴の側は常に2 commitである。下記「性能」を参照 |
| 悪意あるmerge（evil merge）を素通しする | **一部成立。** 下記「変異Bが非検出である理由」を参照 |
| 側にbump以外が混ざっても通る | **不成立。** SCN-INT-AUDITBUMP-002・004、変異C・Dをテストが検出 |
| **除外の緩和でbump以外のpathが監査を逃れる** | **不成立。**下記「除外が隠せるpathの上限」を実測で確認 |

### 除外が隠せるpathの上限

**この変更は除外を緩めるため、bump以外のpathが監査を逃れないかを実測で確かめた。**

`isReleaseBumpTransition`は`hasReleaseBumpChanges`を必ず要求する。これは遷移の導入path集合が
`package.json`と`package-lock.json`の部分集合であることを求めるため、release遷移として分類された
遷移が`releasePaths`へ入れられるpathはこの2件に限られる。`finalAuditPaths`はさらに
`regularPaths`に無い場合だけ除外するため、通常commitが触れたpathは除外されない。

隔離repositoryで、bumpと通常fileを1本のrelease PR mergeとして既定branchへ着地させ、
それを追随mergeで取り込んだ。

```
valid=false
H_impl..currentはreview artifactだけでなければなりません。余分なpath:
- escaped.txt
- package-lock.json
- package.json
```

**混入したpathは隠れず、そのまま報告される。** 除外が抑制できるのは`package.json`と
`package-lock.json`だけである。

### 変異Bが非検出である理由

`isReleaseBumpCommit`のmerge分岐を`return true`（merge commitを無条件に受け付ける）へ変異させても、8 scenarioすべてが通過する。**これは仕様どおりである。**

側の範囲`selectedParent..sideParent`には、そのmergeの固有祖先がすべて含まれ、個別に判定される。通常のmergeでは「mergeの導入差分＝側の各commitの導入差分の和」であるため、葉の判定が同じ結論を出す。両者が食い違うのは**evil merge**（親のどちらにも無い変更をmerge解決で導入したmerge）だけである。

さらに、それを検査へ到達させるには**入れ子のevil merge 2段**が要る。外側の追随mergeもevil でなければ、混入した変更が`hasReleaseBumpChanges`で先に弾かれる。

固定するには2段のevil mergeを組む必要があり、fixtureは現在の約1.5倍になる。**是正後のコードは変異Bより厳格な側であり、緩めていない。** 費用に見合わないと判断し、機構を足さずにこの限界を記録するに留めた。

### 性能

再帰は側にmerge commitがある場合だけ`rev-list`を1回追加する。実履歴の側は`{release PR merge, 直接bump commit}`の2件で固定である。`npm test`の所要は1分17秒で、是正前（1分16秒）と有意差がない。

### 支援層が製品の約9倍である件

製品 net +15行に対し支援層は +140行 / -21行で、比は約9倍である。**運用ポリシーの「支援層の所要時間が成果物構築の所要時間を上回らないこと」に照らして評価した。**

- 対象がgit topologyの述語であるため、**構成した履歴以外にoracleが存在しない。** 4 branch・3 mergeを実際に作らないと着地形を再現できない。
- 既存の`createAuditedRepository`からartifact生成を`writeAuditArtifact`へ切り出して再利用し、fixtureの重複を避けた。追加140行のうち約20行はこの再配置である。
- 追加scenarioは2件で、うち1件は否定側である。**scenarioを増やして網羅するのではなく、変異試験で1件ずつの検出力を確かめた。**
- 所要時間は8 scenarioで3.1秒である。支援層の**実行**時間は成果物構築時間を上回っていない。

行数比は超えているが、**時間比は超えていない**こと、および代替oracleが無いことを根拠に、この比率を受け入れた。

## 5. 指摘

| ID | 深刻度 | 内容 | 状態 |
|---|---|---|---|
| S75-H-01 | High | **Issue本文の「実測」が別欠陥の観測であった。** 是正しても解消しない | 是正済み。`diff`で同一性を確認し #1004 へ分離 |
| S75-M-01 | Medium | Issue本文の「機構が一度も動いていない可能性」が誤り。是正範囲を過大に見積もる恐れがあった | 是正済み。全量走査で45件の成立を確認し、対象を6件の遷移へ限定 |
| S75-M-02 | Medium | 実装だけを緩めると仕様との乖離が残る | 是正済み。QLT-AUDIT-002を先に直した |
| S75-L-01 | Low | evil mergeに対する変異Bを固定していない | 未是正。**構造的限界。**理由と費用を4章へ記録 |
| S75-L-02 | Low | 支援層が製品の約9倍 | 未是正。**時間比と代替oracleの不在を根拠に受け入れ。**4章へ記録 |
| S75-M-03 | Medium | **追跡表の結果欄が、追加scenarioを「基準commitで合格・本作業treeの全体実行は環境制約」と記録していた** | 是正済み。ラウンド2の指摘。実行実態に合わせ「合格・作業treeで対象実行済み」へ直した |

### ラウンド予算

ラウンド2で収束した。未解決のCritical/Highは0件。ラウンド2の指摘はMedium 1件で、是正済みである。残るLow 2件はいずれも根拠を記録済みで、上限3ラウンドに対して1ラウンドの余裕を残している。

## 6. ラウンド固有の確認

### ラウンド1

全評価基準（肯定: 正しさ・価値・実現可能性・整合性・保守性／敵対: 反例・失敗経路・境界値・悪用・安全性・データ損失・rollback・範囲漏れ）を確認した。High 1、Medium 2、Low 2。High 1とMedium 1は**全量走査がIssue本文の申告を否定したことで検出した**もので、コード読解では出ない。新規Critical 0件。判定 **approved（自動reviewを待つ）**。

### ラウンド2（自動review）

CodeRabbitがhead `697218a8` に対してexact-head reviewを実施し、Actionable 1件（Minor）を返した。**このheadは本PRの実装差分5 fileを完全に含む。** 以降のheadは本指摘への是正とこのartifactだけである。

指摘は`docs/specs/15_要件追跡/00_追跡表.md:37`で、**追加した`SCN-INT-AUDITBUMP-003`／`004`を、既存scenarioと同じ「基準commitで合格・本作業treeの全体実行は環境制約」の行へ入れていた**というものである。**実在である。** 同fileの3行目が「本Issue追加シナリオの結果は作業treeでの対象実行を示す」と規約を持っており、記録が実行実態と食い違っていた。

実態は、対象実行（`--tags @audit-bump-exclusion`で8 scenario）と全体実行（`npm test`で982 scenario）の双方が本作業treeで通過している。行を分割せず、結果欄を`合格・作業treeで対象実行済み`へ直した。**分割しなかったのは、同fileの1行目が「1行は1つのFeature完全pathとtest layer」を規定しているためである。** `npm run trace:check`がexit 0であることを確認した。

新規Critical/High 0件。判定 **approved**。

## 7. テスト結果

| 層・検査 | コマンド | 件数 | 判定 |
|---|---|---|---|
| 形式 | `npm run format:check`、`npm run docs:format`、`npm run test:format` | exit 0 | pass |
| 静的 | `npm run lint`、`npm run typecheck`、`npm run source:check` | exit 0 | pass |
| 契約 | `npm run project:quality`、`npm run cli:check`、`npm run workflow:check`、`npm run skills:check`、`npm run trace:check`、`npm run architecture:check`、`npm run directories:check` | exit 0 | pass |
| 統合 | `npm test` | 982 scenario全通過、5220 step全通過 | pass |
| 適合 | `npm run conformance:check`、`npm run package:check` | exit 0 | pass |

履歴の全量走査。

| 観測 | 値 |
|---|---|
| 全merge commit | 364件 |
| 導入差分が`package.json`／`package-lock.json`だけの親組 | 51件 |
| 別親側が親1個のcommitだけで構成される（是正前に除外が成立する） | **45件** |
| 別親側にmerge commitを含む（是正前に除外が破れる） | **6件** |

検査の変異試験。

| 変異 | 失敗scenario |
|---|---|
| A: merge commitを一切受け付けない（是正前の挙動） | SCN-INT-AUDITBUMP-003 |
| B: merge commitを無条件に受け付ける | **なし**（4章に理由を記録） |
| C: 側の全件要求を`some`へ緩める | SCN-INT-AUDITBUMP-002 |
| D: 側のcommitを一切検査しない | SCN-INT-AUDITBUMP-002、004 |
| E: subject接頭辞の要求を外す | SCN-INT-AUDITBUMP-002 |
| 変異なし | なし（8件全通過） |

**変異試験は実装をcommitした後に実施し、各変異の後は退避した原本の複写で復元した。**`git checkout`を使っていない。`npm test`と`conformance:check`は直列で実行している。

実main履歴に対する回帰確認。

| 対象 | 是正前 | 是正後 |
|---|---|---|
| 既定branch HEAD `72b1e0ba` | `valid: true`、`implementation: 8d2612e1`、0.95秒 | **同一。**`valid: true`、`implementation: 8d2612e1`、0.95秒 |
| 追随merge `24347540` | 診断14行 | **同一の14行。**#1004 の根拠 |

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `scripts/check_file_audit.ts` | 入らない | `package.json`の`files`は`dist/bin/`、`dist/src/`、`.agent-skill-chain/`の一部、`README.md`、`AGENTS.md`だけを列挙する。`scripts/`はrepository局所の検査である |
| `docs/specs/**` | 入らない | 製品仕様。配布対象外 |
| `test/**` | 入らない | test資産。配布対象外 |

判断: 配布物を更新しない

根拠: 変更した5 pathはいずれも`package.json`の`files`が列挙する配布境界の外にある。`src/`を触っておらず`dist/`の内容は変わらない。consumerが観測できる挙動、CLI、公開API、schema、templateのいずれも変化しない。`npm run package:check`がexit 0であることを確認した。

## 9. 独立reviewの成立

| 条件 | 充足 |
|---|---|
| reviewerが実装担当の判断を入力に持たない | 充足。差分と全量走査の実測値だけを入力にした |
| 各ラウンドの判定と根拠が原文引用を伴う | 充足。QLT-AUDIT-002の原文と実履歴のSHAを引用 |
| 有限ラウンドで終了する | 充足。1ラウンドで収束 |
| 外部証拠 | 充足。CodeRabbitがhead `697218a8` へexact-head reviewを実施し、inline comment 1件・review 1件を観測した。**checkの`pass`表示ではなく実件数を数えている。**`review-exceptions.json`の`RVX-REPORTED-SUCCESS-WITHOUT-REVIEW-001`は適用していない |

**High 1件は履歴の全量走査が検出した。**Issue本文を信頼してコードだけを読んでいれば、是正が観測を解消しないことに気付けなかった。

## 10. 仕様整合性

`docs/specs/`の2 fileを更新した。QLT-AUDIT-002の本文を、別親側がmerge commitを含む着地形まで規定する形へ直し、SCN-INT-AUDITBUMP-003〜004を追跡表のREQ-GH-005 / AC-GH-005へ結び付けた。新しいREQ・ACは採番していない。既存要件の充足条件が着地形を取りこぼしていた欠陥であり、要求は増えていない。

## 11. 総合判定と再開地点

**判定: approved**

- 未解決Critical: 0件
- 未解決High: 0件
- 未解決Medium: 0件
- 記録したLow: 2件（S75-L-01は構造的限界、S75-L-02は根拠付きで受け入れ）

再開地点: ステップ11（PR作成）
