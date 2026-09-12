# 04 レビュー（macOS review雛形の実作成）

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | macOSでreview雛形を安全に実作成する |
| ラウンド | 独立レビュー2ラウンド |
| 対象SHA・文書ダイジェスト | `31285f74b86e09f0864bb253b96e34b61cd46092` |
| 比較基点 | `d5c2d861d5fc6e0df52b9d0d925487da4c4aea6a` |
| H_impl | `31285f74b86e09f0864bb253b96e34b61cd46092` |
| 対象差分 | Darwin openat helper、仕様・追跡・テスト・生成dist |
| 対象外 | merge、release、名前付き親pathへのfallback |
| ラウンド数 | 2（round 2で収束） |
| Step chain | 迂回: 利用側ownerからの上流ASC直接修正依頼。隔離cloneで実装・検証・独立reviewを実施 |
| 仕様の所有箇所 | `docs/specs/02_要件/01_ワークフロー要件.md`、`docs/specs/15_要件追跡/` |
| 成果物行数 | 製品source・仕様 +162/-5、test支援層 +90/-25、生成dist +114/-1 |
| 縮小の先行評価 | Node公開APIと`/dev/fd/N/leaf`だけでは成立しないため、既存PythonとPOSIX openatを最小adapterとして流用。名前付きpath fallbackは採用しない |
| 実施者・日時 | implementer Codex、独立reviewer別agent context、2026-09-12 |

### 0.1 routing入力契約

| role欄 | 必要証拠 | 独立性証拠・非変更証拠 |
|---|---|---|
| reviewer | 肯定・敵対review、finding分類、対象test | implementerと別agent context。reviewerは対象repositoryを変更していない |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 利用側要求 | macOSでfail-closedせず雛形作成を成功させる | 指定pathへの安全な実作成を要求 | 要求 |
| 差分 | `d5c2d861`..`31285f74` | source・dist・仕様・testの9 path | Git |
| macOS対象test | REVINIT全scenario | 25 scenario、128 step成功 | Cucumber |
| 静的検査 | build、lint、typecheck、format、source、docs、Gherkin、trace、architecture、package | 合格 | project scripts |

### 1.1 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | package | requirement | Darwin openat契約 | 実装へ一方向 | REQ-WF-014 | 文書revert可能 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package | trace | 要件からSCNへの追跡 | 一方向 | SCN-UNIT-REVINIT-024〜025 | 文書revert可能 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package | history | 実装済み変更の記録 | 依存なし | REQ-WF-014 | append記録 | pass |
| `src/cli.ts` | M | package | CLI | helper原因を利用者へ伝える | libへ一方向 | AC-WF-014 | path削除なし | pass |
| `src/lib/atomic.ts` | M | package | library | FD固定openat書込み | fs・child processだけに依存 | REQ-WF-014 | CWE-367境界維持 | pass |
| `test/features/unit/review-round-init.feature` | M | package | unit test | macOS正常・異常回帰 | stepsから製品へ | SCN-UNIT-REVINIT-012・024〜025 | fixtureのみ | pass |
| `test/steps/review-round-init.steps.ts` | M | package | test support | Darwin faultとassert | 製品APIを呼ぶ | SCN-UNIT-REVINIT | tmp fixtureのみ | pass |

## 2. 受け入れ条件の確認

| 条件 | 実装・検証 | 判定 |
|---|---|---|
| macOSで指定先へ雛形を作成できる | 固定directory FDをfd 3へ継承し`openat(dir_fd=3)`で排他的作成 | pass |
| 名前付き親pathへfallbackしない | `/usr/bin/python3 -I -S`へFDだけを継承 | pass |
| 既存fileを上書きしない | `O_EXCL`・`O_NOFOLLOW` | pass |
| 作成後失敗で内容を残さない | directory fsync完了まで作成FDを保持してtruncate・fsync | pass |
| helper異常終了を曖昧に成功扱いしない | signal名と未sanitizeを診断 | pass |
| macOS実機で回帰を検出する | 隔離clone上でREVINIT全25 scenarioを実行 | pass |

## 3. 肯定的評価

- Linuxの`/proc/self/fd`経路とCLI出力pathを変更せず、DarwinだけにPOSIX `openat`経路を追加した。
- shellを使わず、Python executableを絶対pathへ固定し、`-I -S`で環境・site packageを分離した。
- helperが結果を返せない場合も作成済みの可能性を保守的に扱う。

## 4. 敵対的評価

- directory fsync前に作成FDをcloseする初版へ失敗を注入し、sanitize不能になる反例を検出した。
- 作成FDをdirectory fsync成功後まで保持する順序へ変更し、失敗時に内容が空になることを実processで確認した。
- open直後にSIGKILLし、結果JSONが無い状態でも成功扱いせず、signalと未sanitizeを報告することを確認した。

## 5. 指摘

| ID | 重大度 | 内容 | 対応 | 状態 |
|---|---|---|---|---|
| REV-MACFD-H01 | High | directory fsync前に作成FDをcloseすると失敗時sanitize不能 | closeをdirectory fsync後へ移動しSCN-024追加 | resolved |
| REV-MACFD-M01 | Medium | helper固有のsanitize・kill経路とsignal診断が未検証 | fault injectionとSCN-024・025をmacOS実機で検証 | resolved |
| REV-MACFD-L01 | Low | trusted proposalなしではmacOS CIを常設できず、回帰検知は今回の隔離実機証跡に留まる | proposalを経る別変更での常設を推奨 | record-only |

## 6. ラウンド固有の確認

- ラウンド1: `ed025e65`をreviewし、High 1件・Medium 1件を検出してreject。
- ラウンド2: `31285f74`をreviewし、両findingの解消を確認。新規findingなしでapproved。

## 7. テスト結果

- macOS対象回帰: 25 scenario、128 step、失敗0。
- SCN-024・025: 2 scenario、10 step、失敗0。
- build、lint、typecheck、format、source、docs、Gherkin、trace、architecture、package検査: 合格。
- full unit/conformanceのmacOS既存失敗はsandbox内tsx IPC、macOS固有file名、`/var`と`/private/var`差およびnpm log権限による。対象回帰には失敗なし。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/cli.ts` | 入る | Darwin helper失敗原因をCLI診断へ含める |
| `src/lib/atomic.ts` | 入る | Darwinで固定FDを使う安全な雛形作成を提供する |
| `dist/src/` | 入る | 上記sourceのcompile済み配布物 |
| `test/`・`docs/specs/` | 入らない | repository内の検証・耐久仕様 |

判断: 配布物を更新した

根拠: 配布CLIが参照するsourceとcompile済みdistを変更し、macOSでの雛形作成動作が変わるため。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated |
| reviewerとimplementerのcontext | 別agent context |
| reviewerによる対象差分変更 | なし |
| exact HEAD | `31285f74b86e09f0864bb253b96e34b61cd46092` |

## 10. 仕様整合性

- 判定: updated。
- Darwin openat、失敗時sanitize、signal診断、追跡表、変更履歴を更新した。

## 11. 総合判定と再開地点

- 未解決Critical/High: 0件。
- Medium: 0件。Low: record-only 1件。
- 判定: approved、PR作成可。
- 次に許可される操作: 本review artifactだけをcommitし、監査とPR CIを実行する。
