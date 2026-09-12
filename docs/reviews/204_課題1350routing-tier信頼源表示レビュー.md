# 04 レビュー（routing tier信頼源表示）

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | routing tierの未指定経路をtrustedと表示せずprovenanceを出力し仕様外のprovider値を拒否する |
| ラウンド数 | 4（引継ぎ済み2ラウンド + 既定branch追随後review + PR後指摘の取り直しreview） |
| 対象SHA・文書ダイジェスト | `5b92bfe8ffd2adc4bb1d28bed65b03e2b46b392d` |
| 比較基点 | `e0966d99bc23028dd6936ba28f33e399afb4d32d` |
| H_impl | `5b92bfe8ffd2adc4bb1d28bed65b03e2b46b392d` |
| 対象差分 | routing tierのprovider検証、provenance・usage出力、仕様・追跡・テスト・生成dist |
| 対象外 | policy loader本体・tier判定関数の変更、merge後処理 |
| Step chain | 迂回: Issue #1350のsealed stagingは引継ぎ元からdigest不一致のため、Git・GitHub・実差分・独立reviewで再構成 |
| 仕様の所有箇所 | `docs/specs/02_要件/01_ワークフロー要件.md`、`docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` |
| 成果物行数 | Git差分15 path。製品source・仕様、test支援層、生成dist、review artifactを変更 |
| 縮小の先行評価 | 既存loaderと判定関数を再利用し、CLIの検証・出力組立と既存E2E観測の拡張へ限定 |
| 実施者・日時 | implementer Codex、独立reviewer別agent context、2026-09-12 |

### 0.1 routing入力契約

| role欄 | 必要証拠 | 独立性証拠・非変更証拠 |
|---|---|---|
| reviewer | 肯定・敵対review、finding分類、対象test | implementerと別agent context。reviewerは対象repositoryを変更していない |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・要件 | Issue #1350、staging `00_要求定義.md`・`01_要件定義.md` | 仕様外provider拒否、未指定とcodex経路の信頼源・用途を機械可読化 | GitHub・staging |
| 差分 | `e0966d99`..`5b92bfe8` | source・dist・仕様・test・review artifactの15 path | Git |
| 追随merge完全性 | merge commit `73da9d54`の両親とtree | 変更履歴の候補側・main側の行をともに保持し、安定ID欠落なし | Git・独立review |
| 独立再レビュー | exact HEAD `5b92bfe8` | approved、Critical 0 / High 0 / Medium 0 / Low 0 | 別agent context |
| 対象test | routing-tier-provenance + codex-launch | 5 scenarios / 25 steps合格 | Cucumber |

### 1.1 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `docs/specs/02_要件/00_要件一覧.md` | M | package | requirement index | REQ-WF-007の索引 | 要件正本へ一方向 | REQ-WF-007 | 文書revert可能 | pass |
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | package | requirement | provenance・usage契約 | CLIへ一方向 | REQ-WF-007 | 文書revert可能 | pass |
| `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | M | package | interface | provider・出力契約 | CLIへ一方向 | AC-01〜05 | 文書revert可能 | pass |
| `docs/specs/10_セキュリティ/01_信頼境界.md` | M | package | security | compatibility-only境界 | CLIへ一方向 | AC-02〜03 | 文書revert可能 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package | trace | AC・SCN・実装追跡 | 一方向 | SCN-UNIT-TIERPROV-001〜004 | 文書revert可能 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package | history | 実装済み変更の記録 | 依存なし | REQ-WF-007 | append記録 | pass |
| `docs/reviews/204_課題1350routing-tier信頼源表示レビュー.md` | A | reviewer | review evidence | exact-head判定とpost-terminal intakeを保持 | 実装差分を参照 | AC-01〜05 | artifact-only前進 | pass |
| `src/cli-usage.ts` | M | package | CLI help | provider・出力説明 | CLIへ一方向 | AC-01〜05 | source revert可能 | pass |
| `src/cli.ts` | M | package | CLI | 入力検証と出力組立 | policy loaderを利用 | AC-01〜05 | 判定関数不変 | pass |
| `test/features/integration/codex-launch.feature` | M | package | integration test | candidate破損時のtrusted境界 | stepsから製品へ | SCN-INT-TIERPROV-005 | tmp fixtureのみ | pass |
| `test/features/unit/routing-tier-provenance.feature` | A | package | unit test | 受け入れ例 | stepsから製品へ | SCN-UNIT-TIERPROV-001〜004 | fixtureのみ | pass |
| `test/steps/codex-launch.steps.ts` | M | package | test support | codex経路の出力観測 | 製品CLIを呼ぶ | SCN-E2E-AM-001、SCN-INT-TIERPROV-005 | tmp fixtureのみ | pass |
| `test/steps/routing-tier-provenance.steps.ts` | A | package | test support | 新規4 scenarioの観測 | 製品CLIを呼ぶ | SCN-UNIT-TIERPROV-001〜004 | tmp fixtureのみ | pass |

## 2. 受け入れ条件の確認

| 条件 | 実装・検証 | 判定 |
|---|---|---|
| `codex`以外のprovider値を拒否する | policy読込み前に入力検証し構造化診断を返す | pass |
| 未指定成功はfilesystem provenanceとcompatibility-onlyを返す | loader観測値と参照pathをそのまま出力 | pass |
| 未指定失敗はtrustedを主張しない | provenanceを保持し、authority不要と案内 | pass |
| codex経路は信頼源と用途を追加して既存判定を保つ | trusted commitとcodex-adoptionを出力 | pass |
| loaderの5種類のsource値を恒等写しする | SCN-UNIT-TIERPROV-004で全値を検査 | pass |

## 3. 肯定的評価

- provider受理値を仕様へ戻し、入力検証前に架空のprovenanceを作らない。
- 未指定経路とcodex経路を`usage`で区別し、compatibility結果の認可利用を防ぐ。
- 判定関数とloaderを変更せず、出力adapterに変更を限定した。

## 4. 敵対的評価

- `claude`、空値、大文字、prefix値の拒否を確認した。
- provenance.sourceを固定値へ置換する変異がtestで検出されることを確認した。
- codex経路のprovenance削除変異を既存E2Eの観測追加で検出した。
- main追随mergeについて両親の変更履歴行と安定IDを照合し、情報損失がないことを確認した。

## 5. 指摘

| ID | 重大度 | 内容 | 対応 | 状態 |
|---|---|---|---|---|
| REV-01-R1 | Medium | provider入力検証拒否には信頼源が無いため、INV-01の「必ず含む」が過大 | INV-01をtier判定結果へ限定して再確定 | resolved |
| REV-01-R2 | Medium | loaderが返す`git-legacy`を`git`へ読み替えるとAC-04に反する | sourceを恒等写しし5値をSCN-004で検査 | resolved |
| REV-M-1358-01 | Medium | 引継ぎstagingの02・03には後から追加されたAC-05／SCN-004の追跡が反映されていない | 版管理下の要件・仕様・testは整合済み。Step 11後のsealed stagingは改変せず、本artifactへ制約を明記 | record-only |
| REV-L-1358-02 | Low | 追跡表が4 scenarioを列挙しつつ「3 scenarios」と記載し、feature末尾に余分な空行がある | `1931a060`で件数訂正と空行削除、再レビュー合格 | resolved |
| CR-1358-01 | Low | CLI usageがprovenance sourceを`git`・`filesystem`だけと断定し、loaderの5語彙より狭い | loader由来であることと5語彙を経路別に明記 | resolved |
| CR-1358-02 | High | Codex経路がtrusted policyより先にcandidate policyを読み、candidate欠落・破損で認可判定へ到達できない | candidate読込みを未指定互換経路へ移動し、破損candidateで成功するSCN-INT-TIERPROV-005を追加 | resolved |

## 6. ラウンド固有の確認

- 引継ぎround 1: `36109d44`をreviewし、INV-01の過大な字面を検出。契約を再確定した。
- 引継ぎround 2: `37b299b9`をreviewし、source語彙の正規化を検出。恒等写しとSCN-004を追加した。
- 追随後review: `73da9d54`をreviewし、機能要件とmerge完全性をapproved。追跡表件数とEOFを是正した。
- 是正後再review: `1931a060`をexact-headでreviewし、Critical 0 / High 0 / Medium 0 / Low 0でapproved。
- PR後指摘の取り直しreview: CodeRabbitの2件を有効と判定して前進commit `5b92bfe8`で是正。別agent contextがexact-headで再reviewし、Critical 0 / High 0 / Medium 0 / Low 0でapproved。

## 7. テスト結果

- routing tier対象回帰: 5 scenarios / 25 steps、失敗0。SCN-INT-TIERPROV-005は旧実装なら破損candidateの先読みにより失敗することをコード経路でも確認した。
- 変異試験: A〜Fをkill。provider受理、usage、source恒等写し、診断、codex provenanceの退行を検出。
- macOS full test: canonical TMPDIRで1,926 scenarios中1,894合格・16 skip・16失敗。失敗はLinux固定実行ファイル`/usr/bin/bwrap`・`/usr/bin/prlimit`の不在、sandbox内tsx IPC・npm log権限、macOSで作れない危険file名に限定され、対象5 scenariosは合格。非正規化`/var/...`での初回実行は既存のsymlink祖先拒否契約により失敗したため証拠に採用しない。
- build: 合格。
- conformance: canonical TMPDIRと隔離npm cacheで87 scenarios / 468 steps、失敗0。conformance検査合格。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/cli.ts`、`src/cli-usage.ts` | 入る | routing tierのprovider・出力・help契約を変更 |
| `dist/src/cli.js`、`dist/src/cli-usage.js` | 入る | 上記sourceのcompile済み配布物 |
| `test/`・`docs/specs/`・`docs/reviews/` | 入らない | repository内の検証・耐久仕様・review証拠 |

判断: 配布物を更新した

根拠: 配布CLIが参照するsourceとcompile済みdistを変更し、routing tierの公開出力契約が変わるため。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated |
| reviewerとimplementerのcontext | 別agent context |
| reviewerによる対象差分変更 | なし |
| exact HEAD | `5b92bfe8ffd2adc4bb1d28bed65b03e2b46b392d` |
| 判定 | approved、Critical 0 / High 0 / Medium 0 / Low 0 |

### 9.1 staging引継ぎ不整合の扱い

- handoff専用orphan branch `37bb4d1c`から展開した時点で、artifact一覧は一致したがstored digestと再計算digestが一致しなかった。展開漏れではなく引継ぎ元自体の状態である。
- Git commit/tree、GitHub Issue・PR、版管理下仕様、exact-head独立reviewを正本として再構成した。虚偽のdigest再固定やsealed stagingの編集は行っていない。
- `review-session.json`のappend-only履歴は保持した。追随後reviewは本artifactでexact HEADと所見を固定する。

## 10. 仕様整合性

- 判定: updated。
- REQ-WF-007、CLI契約、信頼境界、追跡表、変更履歴を更新した。

## 11. 総合判定と再開地点

- 未解決Critical/High: 0件。
- versioned productの未解決Medium/Low: 0件。
- record-only: sealed stagingの追跡記録不整合1件。本artifactで開示し、版管理下成果物には不整合なし。
- 判定: approved、PR更新可。
- 次に許可される操作: 本review artifactだけをcommitし、post-terminal intake記録、監査、PR CIを実行する。
