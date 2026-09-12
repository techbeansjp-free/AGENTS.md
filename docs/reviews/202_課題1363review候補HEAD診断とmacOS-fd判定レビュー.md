# 04 レビュー（PR #1363）

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | review候補HEADの取り違え防止とmacOS `/dev/fd` 判定の是正 |
| ラウンド | 独立レビュー3ラウンド |
| 対象SHA・文書ダイジェスト | `47d87143f028e3d9fa601a2f1a9992230a5b88ed` |
| 比較基点 | `83a4a895350a42a4c7b93e3220eb8060187572c0` |
| H_impl | `47d87143f028e3d9fa601a2f1a9992230a5b88ed` |
| 対象差分 | review session診断・round雛形、非収束理由、descriptor相対file作成、対応する仕様・テスト・dist |
| 対象外 | merge、release、macOSで安全性を下げてfile作成を成功させるfallback |
| ラウンド数 | 3（round 3で収束） |
| Step chain | 迂回: 利用側ownerの直接修正依頼であり、上流Issueとstagingを新規作成せず既存PR #1363へ記録 |
| 仕様の所有箇所 | `docs/specs/02_要件/01_ワークフロー要件.md`、`docs/specs/15_要件追跡/` |
| 成果物行数 | source +43/-9、生成dist +37/-6、仕様 +5/-1、test +87/-9 |
| 縮小の先行評価 | 新しいstatus値やnative依存を追加せず、既存notes・診断分岐・descriptor検査の最小変更で成立させた |
| 実施者・日時 | implementer Codex、独立reviewer別agent context、2026-09-12 |

### 0.1 routing入力契約

| role欄 | 必要証拠 | 独立性証拠・非変更証拠 |
|---|---|---|
| reviewer | 肯定・敵対review、finding分類、対象test | implementerと別agent context。reviewerは対象repositoryを変更していない |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 利用側報告 | review roundのHEAD取り違え、非収束理由、macOS `/dev/fd` | 再現条件と期待する診断を確認 | 要求 |
| 差分 | `83a4a895`..`47d87143` | source・dist・仕様・テストの13 path | Git |
| 対象テスト | review診断3件、Darwin判定1件 | 4 scenario、21 step成功 | Cucumber |
| conformance | `npm run conformance:check` | 87 scenario、468 step成功 | Cucumber |
| 静的検査 | build、lint、typecheck、format、source、docs、Gherkin、trace、architecture、package | 合格 | project scripts |

### 1.1 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | package | requirement | review・file作成契約 | 実装へ一方向 | REQ-WF-005・014 | 文書revert可能 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package | trace | 要件からSCNへの追跡 | 一方向 | SCN-UNIT-REVINIT | 文書revert可能 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package | history | 実装済み変更の記録 | 依存なし | REQ-WF-014 | append記録 | pass |
| `src/adapters/evidence-reanchor.ts` | M | package | adapter | 非収束診断の共有 | domainへ一方向 | 非収束診断 | revert可能 | pass |
| `src/adapters/review-session.ts` | M | package | adapter | candidate表示と復旧案内 | domainへ一方向 | review round AC | append-only契約維持 | pass |
| `src/domain/review-convergence.ts` | M | package | domain | status別診断 | fs・network依存なし | 非収束診断 | status集合不変 | pass |
| `src/lib/atomic.ts` | M | package | library | descriptor identity検査 | fsだけに依存 | REQ-WF-014 | CWE-367境界維持 | pass |
| `test/features/unit/review-round-init.feature` | M | package | unit test | 診断・platform回帰 | stepsから製品へ | SCN-UNIT-REVINIT | fixtureのみ | pass |
| `test/steps/review-round-init.steps.ts` | M | package | test support | 専用fixtureとassert | 製品APIを呼ぶ | SCN-UNIT-REVINIT | tmp fixtureのみ | pass |

生成物4 pathはsourceと一致することをbuildで確認し、個別監査の期待集合から規約どおり除外した。

## 2. 受け入れ条件の確認

| 条件 | 実装・検証 | 判定 |
|---|---|---|
| 空差分時にHEADを進めずsessionを確認できる | `candidateHeadSha`確認を診断へ追加 | pass |
| 記録対象commitを雛形から認識できる | 短縮SHA・subject・是正commit前の記録注意を追加 | pass |
| ownerが非収束理由を区別できる | `active`と`budget-exhausted`を別案内にした | pass |
| macOSの合成`st_dev`を実体不一致と誤診断しない | aliasを再openし`fstat`のdev・inoを比較 | pass |
| 安全でないmacOS fallbackを作らない | `/dev/fd/N/leaf`非対応をfile作成前に固有errorで拒否 | pass |

## 3. 肯定的評価

- review roundの利用者は、誤ったHEAD前進ではなくsessionの候補SHA確認へ誘導される。
- 非収束の記録不整合と既知finding受容を同じowner判断へ混同しない。
- Linuxのdescriptor相対作成は維持し、Darwinでは安全境界を緩和しない。

## 4. 敵対的評価

- Darwinで名前付き親pathへfallbackする初版にABA型TOCTOUを構成し、別directoryへの内容漏えいを確認した。
- fallbackを削除し、file作成前fail-closedへ変更した。
- 対応環境の内容書込み直前に親identity再検査を置き、hook後の差し替えを拒否することを確認した。
- 固定directory object内で既に開いたfile descriptorと、名前付きpathが指す別objectを区別して評価した。

## 5. 指摘

| ID | 重大度 | 内容 | 対応 | 状態 |
|---|---|---|---|---|
| REV-FD-01 | High | Darwinの名前付きpath fallbackにABA型TOCTOUがある | fallbackを削除し作成前fail-closedへ変更 | resolved |
| REV-FD-02 | High | 対応環境の内容書込み直前再検査が不足 | `writeFully`直前へ親identity検査を追加 | resolved |

## 6. ラウンド固有の確認

- ラウンド1: `a91e4f45`をreviewし、REV-FD-01を検出してreject。
- ラウンド2: `1e087742`をreviewし、REV-FD-01解消を確認。REV-FD-02を検出してreject。
- ラウンド3: `47d87143`をreviewし、両Highの解消を確認。新規findingなしでapproved。

## 7. テスト結果

- 対象回帰: 4 scenario、21 step、失敗0。
- conformance: 87 scenario、468 step、失敗0。
- full suite: 1912 scenario中1881成功、16 skip、15失敗。失敗はmacOSに存在しないLinux専用`bwrap`・`prlimit`、sandbox内tsx IPC制限、macOS固有file名挙動による環境差であり、対象回帰は成功。
- build、lint、typecheck、format、source、docs、Gherkin、trace、architecture、package検査: 合格。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/adapters/evidence-reanchor.ts` | 入る | status別の非収束診断を利用する |
| `src/adapters/review-session.ts` | 入る | round雛形と空差分診断を改善する |
| `src/domain/review-convergence.ts` | 入る | `active`と`budget-exhausted`の診断を分離する |
| `src/lib/atomic.ts` | 入る | descriptor alias identityとDarwin非対応理由を判定する |
| `dist/src/` | 入る | 上記sourceのcompile済み配布物 |
| `test/`・`docs/specs/` | 入らない | repository内の検証・耐久仕様 |

判断: 配布物を更新した

根拠: 配布CLIが参照するsourceとcompile済みdistを変更し、仕様・回帰testも追随した。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated |
| reviewerとimplementerのcontext | 別agent context |
| reviewerによる対象差分変更 | なし |
| exact HEAD | `47d87143f028e3d9fa601a2f1a9992230a5b88ed` |

## 10. 仕様整合性

- 判定: updated。
- review session診断、Darwinの実体判定とfail-closed境界、追跡表、変更履歴を更新した。

## 11. 総合判定と再開地点

- 未解決Critical/High: 0件。
- Medium/Low: 0件。
- 判定: approved、PR作成可。
- 次に許可される操作: 本review artifactだけをcommitし、監査とPR CIを再実行する。
