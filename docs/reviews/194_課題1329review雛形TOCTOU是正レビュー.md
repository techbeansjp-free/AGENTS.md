# 04 レビュー

> すべてのラウンドで肯定・敵対の両観点を確認する。`成果物用語と責務境界`は`.agent-skill-chain/docs/01_開発ワークフロー.md`を正本とする。Medium/Lowだけを理由に自動修正・追加レビュー・ゲート停止を起こさない。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 1〜2 |
| 対象SHA・文書ダイジェスト | review session `3c5ace75ed4e665efa724a5a49e3bc18257fb2df3a191d99f39891a2fb78326b`、round 2 digest `0798e9e84af1a8de85d01a57fc897ed602b4bd2737dba49476edbb63047dfdfe` |
| 比較基点 | `56f66f2db75905277019954462080bcfb48403e7` |
| H_impl | `9a45a7499d61cee1b2e23839568b35c019a367ce` |
| 比較基点の由来 | PR #1338を取り込んだ`origin/main`のtip |
| 対象差分 | `56f66f2db75905277019954462080bcfb48403e7..9a45a7499d61cee1b2e23839568b35c019a367ce`の14 file |
| 対象外 | 新規Medium/Low findingの自動修正、merge、Issue終了、release、cleanup |
| 残り予算 | 1（通常予算3ラウンド中2ラウンド使用） |
| ラウンド数 | 2 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260911_125120_review-round-initのTOCTOU窓とbudget-exhausted時の雛形拒否ほかPR1328の外部指摘7件を是正する |
| 仕様の所有箇所 | `docs/specs/02_要件/01_ワークフロー要件.md` REQ-WF-009・REQ-WF-014 |
| 成果物行数 | 全体差分668追加・21削除。製品source、生成物、test、仕様、templateを含む |
| 縮小の先行評価 | 既存のatomic writerは上書き用で排他的作成と親identity固定を満たさないため、専用writer 1関数へ限定した。失敗時unlinkは末尾entry競合を安全に閉じられないため廃止した |
| 実施者・日時 | implementer: Codex primary、reviewer: 独立Codex context、2026-09-11T07:23:27Z |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類 | risk `path`のstandard以上 | Codex | selected/dispatched `gpt-6-astra`、effort high、adopted tier critical | 未解決Critical/Highなら停止 | implementer context `issue-1329-implementation`とreviewer context `issue-1329-review-round-2`を分離。tracked差分なし |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | https://github.com/techbeansjp-free/AGENTS.md/issues/1329 、AC-01〜05、INV-01〜03 | Step 8まで同一Issueへ同期済み。DISC-002で変更した契約は01〜03へ前向きに反映 | 耐久トラッカー・既存文書 |
| 差分 | base..H_impl | 14 file、tree `2088218b5755b3a2b4544858cd428ffdab47b50c` | Git観測 |
| テスト | `npm test`、`npm run conformance:check`、対象実行、静的gate | §7の全件が失敗0 | テスト出力 |
| 仕様 | REQ-WF-009・REQ-WF-014、追跡表、変更履歴 | updated | 既存文書 |
| commit前candidate | 本文書を除く14 file | H_impl author `tatsuru <info@ruaprom.jp>`、working treeは本文書追加前clean | Git観測 |
| Phase A artifact | `docs/reviews/194_課題1329review雛形TOCTOU是正レビュー.md` | H_impl直後に本fileだけを加える。H_impl..H_finalのpath照合はcommit後auditが実測する | Git観測 |
| review session | 同stagingの`review-session.json` | session ID `3c5ace75ed4e665efa724a5a49e3bc18257fb2df3a191d99f39891a2fb78326b`、round 2、converged | 実行観測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: ない。CLIからadapter/domain/libへの既存方向を維持した。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: 本artifactの単独commitと`audit:check`で確認する。
- reviewerの独立性が`merge.reviewIndependence`の要求水準を満たす: 既定`context-isolated`を満たす。別context、exact HEAD固定、対象差分の変更なし。
- Phase BのPR・CI・review一致: PR作成後に`review evidence`とdelivery stateが観測する。
- 既定branch追随: PR #1338のmerge commitをartifactより前に取り込み、比較基点へ固定済み。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/templates/issue/04_レビュー.md` | M | package | package | DC-UX根拠とDISC ID注記 | 実行依存なし | AC-05、DOCROW-002 | 差し戻し可能 | pass |
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | spec | spec | REQ-WF-009・014の成立契約 | 実行authorityなし | AC-WF-009・014 | 履歴から復旧 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | spec | spec | SCN-UNIT-REVINIT-018を追跡 | 実行authorityなし | REVINIT-001〜018 | 履歴から復旧 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | spec | spec | #1329の変更を記録 | 実行authorityなし | REQ-WF-009・014 | append位置を差し戻せる | pass |
| `src/adapters/review-session.ts` | M | package | package | budget拒否と無視通知 | adapterからdomainへの既存方向 | AC-02・03 | 状態変更前拒否 | pass |
| `src/cli.ts` | M | package | package | writer委譲と利用者診断 | CLIからlibへの依存 | AC-01・04 | 作成後失敗を成功扱いしない | pass |
| `src/domain/finalize.ts` | M | package | package | recovery文言だけを是正 | 追加依存なし | AC-04 | 判定不変 | pass |
| `src/lib/atomic.ts` | M | package | package | 親descriptor固定の排他的writer | Node fsだけに依存 | AC-01、INV-01 | pathname unlink禁止、作成fdを無害化 | pass |
| `test/features/unit/review-round-init.feature` | M | project | project | 受け入れ例を追加 | stepsへ一方向 | AC-01〜05 | 一時fixtureのみ | pass |
| `test/steps/review-round-init.steps.ts` | M | project | project | SCN-UNIT-REVINIT-011・015でGit/fs競合順序を注入 | product APIを観測 | 同feature | `/tmp` fixtureを後処理 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: 一致する。生成物4 pathは§8で監査し、その他10 pathを個別に記録した。
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: いない。
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: round 2は9 fileの修正差分とwriter成功経路、CLI診断、生成物を確認した。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-001 | Linuxのdescriptor相対path候補と失敗条件を実測 | AC-01 | interface | `/proc/self/fd`等を事前検証し、非対応環境は作成前拒否 | REVINIT-011・012、独立I/O反例 | updated | pass |
| DISC-002 | `lstat`と`unlink`は不可分でなく無関係entryを削除し得る | AC-01、INV-01 | domain-invariant、requirement、interface、design-responsibility | pathname unlinkを廃止し作成descriptorをtruncate・fsync、残存可能性を診断 | REVINIT-015・017・018、独立末尾差し替え反例 | updated | pass（説明残文はL01） |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-UNIT-REVINIT-011・012・015・017・018 | `writeFileExclusivePinned`、CLI診断 | 5/5合格 | pass（成功時競合はM03） | 対象実行、独立I/O反例 |
| AC-02 | SCN-UNIT-REVINIT-013・016 | budget判定を差分観測より先行 | 2/2合格 | pass | 対象実行 |
| AC-03 | SCN-UNIT-REVINIT-014 | session anchor採用時のnotes | 1/1合格 | pass | 対象実行 |
| AC-04 | SCN-UNIT-DIAGHINT-004 | finalize recovery文言 | 1/1合格 | pass | 対象実行 |
| AC-05 | SCN-UNIT-DOCROW-002 | template・要件の契約行 | 1/1合格 | pass | 対象実行、trace |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | filesystemのtrust boundary、既存entry保持、データ損失を扱う | INV-01、親・末尾entry差し替え、部分失敗、fd leak検証 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 無害化成否と残存可能性を利用者へ明示する | `ExclusivePinnedWriteError`、CLI診断、REVINIT-017・018 |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | GUI・画面契約・支援技術の操作対象がない。CLIのhelp/errorはREQ-WF-009・014で評価 | CLI error・notes・writtenの対象test |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 画面・theme・component・layoutを変更しない | 差分pathにUI資産なし |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 要件と観測結果が一致するか | pass（M03を記録） | round 1 blocker 3件を反例で解消、対象10/10合格 |
| 価値 | 利用者・運用上の目的を満たすか | pass | staging外出力の親差し替え、budget、診断の問題を一括是正 |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 依存追加なし。Linux実測、非対応環境はfail-closed |
| 整合性 | 設計、コード、テスト、仕様が一致するか | finding: L01 | 耐久仕様・追跡・生成物は一致。説明コメント1件をrecord-only |
| 保守性 | 責務、命名、変更容易性が妥当か | pass | I/O責務を専用writerへ集約 |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | finding: M03 | 成功直前の同名entry差し替えをrecord-only |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | fstat、partial write、cleanup hook、truncate/fsync/close失敗を確認 |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | 既存file・symlink・dangling symlink・不正leafを拒否 |
| 悪用 | 注入、経路脱出、権限外操作等 | finding: M03 | 失敗時は無関係entryを削除しない。成功時の観測退行のみ残る |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | pathname unlinkなし。新規authority・秘密・networkなし |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass | 無関係fileを保持し、作成fdだけを空にする |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | 自動削除せず残存確認を要求。差し戻し可能 |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | finding: L01 | source/dist、CLI、仕様、追跡は確認済み。説明残文のみ |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| R1329-H01 | High | cleanupのlstat/unlink間で無関係fileを削除する | round 1独立再現 | AC-01、INV-01 | pathname unlink廃止、SCN追加 | resolved / acceptance-violation | なし |
| R1329-M01 | Medium | cleanup失敗を隠して取消し完了と誤報する | round 1独立再現 | AC-01 | 後処理error集約と残存診断 | resolved / acceptance-violation | なし |
| R1329-M02 | Medium | identity取得前失敗で空fileを無通知で残す | round 1独立再現 | AC-01 | open直後にcreatedを記録し無害化 | resolved / acceptance-violation | なし |
| R1329-M03 | Medium | 成功前の末尾entry照合削除により、同名差し替え後も成功を返す | round 2独立再現、`src/lib/atomic.ts:179` | 成功時のwritten観測 | 有限review契約により自動修正せず記録 | valid / fix-regression / record-only | 最終照合時点の`--out` identityを保証しない |
| R1329-L01 | Low | test hookコメントにrollback削除の旧説明が残る | `src/lib/atomic.ts:32` | 保守説明 | 自動修正せず記録 | valid / improvement / record-only | 保守時の誤誘導 |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: base..`dd5f29ee`の14 fileを肯定・敵対の両面で確認した。
- 指摘を確定した: R1329-H01、R1329-M01、R1329-M02。
- 次ラウンド対象のCritical/High: R1329-H01。

### ラウンド2

- 未解決Critical/High: 0件。
- 修正差分: `dd5f29ee..9a45a749`の9 file。
- 修正で触れた隣接範囲: writer成功・失敗経路、CLI診断、生成物、仕様、追跡。
- 既承認・未変更範囲を再走査していない: budget、finalize、templateは固定差分照合のみ。writer周辺は再確認した。

### ラウンド3

- 全指摘の最終分類: 未実施。round 2で収束。
- 任意の危険範囲を除外・既定無効・ロールバック可能へ縮小した結果: pathname削除を廃止し作成fdだけを無害化した。
- 同じ範囲の予算を自動更新していない: 更新していない。
- AIによる最終裁定: round 2でapproved。未解決Critical/Highなし。

## 7. テスト結果

- runner: cucumber-js、`projectChoices.gherkinDialect=en`、unit・integration・e2e。
- 実行command: `npm test`、`npm run conformance:check`、対象Cucumber、`npm run build`、`npm run typecheck`、`npm run lint`、`npm run test:format`、`npm run trace:check`、`git diff --check`。
- 全layer合計: 1816 scenarios（1800 passed、16 skipped、0 failed）、9535 steps（9485 passed、50 skipped）。
- skipがある層: project既定のskip 16 scenarios・50 steps。今回追加の対象はskipなし。
- conformance: 87 scenarios・468 steps、全合格。
- 対象: 10 scenarios・51 steps、全合格。
- reviewer環境ではfixtureの`spawnSync git EPERM`により8件が製品assertion前に停止したため、その結果を回帰失敗とも独立全合格とも扱わない。reviewerは配布JSへの独立I/O反例、trace、source/dist一致を別に確認した。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.agent-skill-chain/templates/issue/04_レビュー.md` | 入る | DC-UX根拠とDISC ID注記を追加 |
| `src/lib/atomic.ts`、`src/cli.ts`、`src/adapters/review-session.ts`、`src/domain/finalize.ts` | 入る | compile後のCLI、review session、finalizeの挙動を変更 |
| `dist/src/lib/atomic.js`、`dist/src/cli.js`、`dist/src/adapters/review-session.js`、`dist/src/domain/finalize.js` | 入る | 上記runtimeの配布生成物 |
| `test/`、`docs/specs/`、`docs/reviews/` | 入らない | 開発証拠・仕様・review artifact |

判断: 配布物を更新した

根拠: `package.json`のfilesに`dist/`と配布templateが含まれ、sourceから生成したdistがbyte一致する。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated |
| その要求を満たすこと | はい |
| reviewerとimplementerのidentity・context比較 | implementer `codex-implementer` / `issue-1329-implementation`、reviewer `codex-independent-round-2` / `issue-1329-review-round-2` |
| reviewerが対象差分を変更していないこと | はい。reviewerのrepository書込みは無視対象の`review-round-2-result.md`だけで、tracked path集合は空 |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: REQ-WF-009・REQ-WF-014、追跡表、変更履歴、配布review template。
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: 既存TERM-ASC-100を参照し、新語は追加していない。
- 未定義語、重複定義、根拠なしの意味変更、置換先なしの廃止がない: ない。説明残文はR1329-L01へ記録した。
- 要件・変更・SCN・テストの追跡: REQ-WF-009・014 → AC-WF-009・014 → REVINIT-001〜018ほか → feature/steps。`trace:check`合格。
- `no-spec-impact`の場合の限定的根拠: 該当なし。
- UI・トークンの判断: GUI・画面・token変更なし。

## 11. 総合判定と再開地点

- 未解決Critical/High: 0件。
- Medium/Lowの記録: R1329-M03、R1329-L01はrecord-only。R1329-M01・M02はresolved。
- 判定: approved
- 新しい権限が必要な事項: PR作成のprovider write authorityのみ。
- 残存リスク: 成功直前の同名entry差し替えを成功として返すM03、説明残文L01、後処理不能時のentry残存。いずれも有限review契約上の非blocker。
- 次に許可される操作: 本artifactだけのcommit、audit、Step 10記録、push、PR作成。
- 次回の再開地点: Step 11 PR作成。
