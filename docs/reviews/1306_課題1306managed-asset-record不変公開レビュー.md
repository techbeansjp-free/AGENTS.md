# 04 レビュー

## 要約

| 項目 | 内容 |
|---|---|
| 何が問題だったか | 既存JSONへのrename更新は検査後のsymlinkを置換し得る。単一pathの更新ではno-replaceを保証できない。 |
| 何を解決しようとしたか | 不変anchorと親digestで連鎖するsnapshotをno-replace公開し、途中失敗と並行applyを安全に拒否する。 |
| 何を行ったか | record専用書込み、連鎖reader、排他lock、実公開先probe、doctor診断、配布案内を追加した。 |
| 何を確認したか | 再現、64 lifecycleシナリオ、host全件、11静的gate、conformance、独立Codex Solの差分reviewを確認した。 |
| 判定 | approved |

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 1（最終H_implのformal round。事前諮問は別） |
| 対象SHA・文書ダイジェスト | fd9efd174e1850ab75686a2215b304a81c5370c2 |
| 比較基点 | `241990d6562fb7fb04279d5a9ce0d674a1f31aaf` |
| H_impl | `fd9efd174e1850ab75686a2215b304a81c5370c2` |
| 対象差分 | 比較基点から16 path |
| 対象外 | 祖先directory差し替えはIssue #1309。任意の同一UID攻撃者によるproject file直接変更は権限境界外 |
| 残り予算 | formal round後3 |
| ラウンド数 | 1（事前独立諮問はformal roundへ数えない） |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260923_113525_managed-asset-record-immutable-publish |
| 仕様の所有箇所 | `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md` REQ-LC-001。apply時だけpackage所有資産を変更し、symlinkと変更済み資産を保持する |
| 成果物行数 | `git diff --numstat 241990d6562fb7fb04279d5a9ce0d674a1f31aaf..fd9efd174e1850ab75686a2215b304a81c5370c2`: src +465/-90、dist +364/-80、支援層 +546/-13 |
| 縮小の先行評価 | 汎用atomic writerと単一JSONの更新案を評価した。既存pathのno-replace更新は不可能なため、record専用不変snapshotへ範囲を限定した |
| 実施者・日時 | implementer: Codex本session。独立reviewer: Codex Sol別context。2026-09-23 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | exact-head差分、肯定・敵対評価、finding検証 | high | Codex Sol、local Ollama補助 | Codex Sol別context、qwen3.8:27b | local degraded時もCodex Solをformal reviewerに維持 | 子sessionは読取専用。`git status`はartifact以外clean |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #1306、AC-1306-01〜07 | Step 8同期本文SHA 823aa75f2d60d53014677dad78daff1f96e824c35b8eece0fe725b99b25f0aa5 | 一次資料 |
| 差分 | `241990d6562fb7fb04279d5a9ce0d674a1f31aaf`..`fd9efd174e1850ab75686a2215b304a81c5370c2` | 16 path | Git観測 |
| テスト | `npm test`、64 lifecycle scenarios | §7に最終結果を記録 | テスト出力 |
| 仕様 | REQ-LC-001、管理データ、用語・追跡 | updated | 既存文書 |
| commit前candidate | `git diff --name-status 241990d6562fb7fb04279d5a9ce0d674a1f31aaf..fd9efd174e1850ab75686a2215b304a81c5370c2` | 下表16 pathと一致 | Git観測 |
| Phase A artifact | 本fileのみ | H_implの後に別commitで追加 | Git観測 |
| review session | `.agent-skill-chain/tmp/issues/20260923_113525_managed-asset-record-immutable-publish` | Step 10で固定する | Git観測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: 確認。source → dist、anchor → snapshot、test → 実装の一方向。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: 本fileのみを別commitにする。commit後のgateで照合する。
- reviewerの独立性が要求水準を満たす: Codex Solは別contextでread-only。Qwenは補助に限る。
- ローカル補助レビュー: `fd9efd174e1850ab75686a2215b304a81c5370c2`の標準収集は対象を安全に収集できずdegraded（出力SHA-256 `33d8a660cbce3db90e570bebd1a093872a4b245317778a61806d0cddf874f863`）。先行head `ffd5d476410fee383ed53229d057f514fae6ed76`の全diffも4,096 token上限でdegraded。同headの製品source 2 fileだけをloopbackの`qwen3.8:27b`へ送り、思考出力を抑えて2候補を得た（出力SHA-256 `ec9b1096d614b4ad40688f111ef96e6f61b380500a03dd468f20d648e180bb21`、入力digestは保存していない）。製品sourceは最終H_implまで不変であり、両候補を最終codeとSCN-047に照合して§5で誤検知と分類した。部分差分の補助結果を正式承認へ算入しない。Opusへのexact-head外部送信は自動承認レビューが拒否したため再試行していない。
- 既定branch追随を行った場合: 追随なし。着手時のmainを比較基点に固定。

### 1.1 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/00_利用案内.md` | M | package owner | 仕様・案内 | record永続化と復旧契約の追跡 | 仕様 → 実装。循環なし | REQ-LC-001、AC-1306-01〜07 | 契約変更はrelease時に周知し、旧CLI交互運用を避ける | pass |
| `.gitignore` | M | package owner | 開発設定 | 生成recordとlockのGit除外 | runtime生成物の追跡を防止 | REQ-LC-001 | 履歴assetは変更せずGit管理外に保持 | pass |
| `dist/src/domain/lifecycle.js` | M | package build | 配布build | 生成元`src/domain/lifecycle.ts`を`npm run compile`で再生成し、`git diff`で一致を確認 | src → dist。循環なし | AC-1306-01〜07、SCN-045〜057 | 配布buildをpackage:checkで確認し、旧版へはrecordと資産を組で戻す | pass |
| `dist/src/lib/atomic.js` | M | package build | 配布build | 生成元`src/lib/atomic.ts`を`npm run compile`で再生成し、`git diff`で一致を確認 | src → dist。循環なし | AC-1306-01〜07、SCN-045〜057 | 配布buildをpackage:checkで確認し、旧版へはrecordと資産を組で戻す | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | package owner | 仕様・案内 | record永続化と復旧契約の追跡 | 仕様 → 実装。循環なし | REQ-LC-001、AC-1306-01〜07 | 契約変更はrelease時に周知し、旧CLI交互運用を避ける | pass |
| `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md` | M | package owner | 仕様・案内 | record永続化と復旧契約の追跡 | 仕様 → 実装。循環なし | REQ-LC-001、AC-1306-01〜07 | 契約変更はrelease時に周知し、旧CLI交互運用を避ける | pass |
| `docs/specs/07_データ/00_データ一覧.md` | M | package owner | 仕様・案内 | record永続化と復旧契約の追跡 | 仕様 → 実装。循環なし | REQ-LC-001、AC-1306-01〜07 | 契約変更はrelease時に周知し、旧CLI交互運用を避ける | pass |
| `docs/specs/07_データ/01_管理データ.md` | M | package owner | 仕様・案内 | record永続化と復旧契約の追跡 | 仕様 → 実装。循環なし | REQ-LC-001、AC-1306-01〜07 | 契約変更はrelease時に周知し、旧CLI交互運用を避ける | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package owner | 仕様・案内 | record永続化と復旧契約の追跡 | 仕様 → 実装。循環なし | REQ-LC-001、AC-1306-01〜07 | 契約変更はrelease時に周知し、旧CLI交互運用を避ける | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package owner | 仕様・案内 | record永続化と復旧契約の追跡 | 仕様 → 実装。循環なし | REQ-LC-001、AC-1306-01〜07 | 契約変更はrelease時に周知し、旧CLI交互運用を避ける | pass |
| `src/domain/lifecycle.ts` | M | package owner | domain | snapshot連鎖とapply排他 | CLI → lifecycle → atomic。循環なし | AC-1306-03〜07、SCN-047〜057 | dirty lock保持、doctor診断、backupから組で復旧 | pass |
| `src/lib/atomic.ts` | M | package owner | lib | 完全write後のno-replace公開 | lifecycle → atomic。逆依存なし | AC-1306-01、02、SCN-045、046 | 既存entry不変。失敗時はtempのみ掃除 | pass |
| `test/features/integration/managed-record-snapshots.feature` | A | test owner | test | 故障注入と旧動作の回帰確認 | test → src。逆依存なし | SCN-INT-LIFECYCLE-001〜057 | 隔離fixtureだけを変更 | pass |
| `test/steps/host-skill-adapter.steps.ts` | M | test owner | test | snapshot形式へ移行したhost adapter fixtureの読取 | test → src。逆依存なし | SCN-INT-HOST-SKILL-002、既存回帰 | 隔離fixtureだけを変更 | pass |
| `test/steps/lifecycle-isolation.steps.ts` | M | test owner | test | 故障注入と旧動作の回帰確認 | test → src。逆依存なし | SCN-INT-LIFECYCLE-001〜057 | 隔離fixtureだけを変更 | pass |
| `test/steps/managed-record-snapshots.steps.ts` | A | test owner | test | 故障注入と旧動作の回帰確認 | test → src。逆依存なし | SCN-INT-LIFECYCLE-001〜057 | 隔離fixtureだけを変更 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: 16 pathを1行ずつ照合。
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: 確認。
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: Solの3回の指摘を検証し、atomic、lifecycle、test、配布buildと仕様を再監査。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1306-01 | 単一JSON pathのrenameでは競合先を置換する | INV-01 | 不変snapshot連鎖 | no-replace link | 旧実装再現とSCN-045 | updated | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1306-01 | SCN-045、050 | atomic / lifecycle | pass | pass | symlinkと参照先を保持 |
| AC-1306-02 | SCN-046 | atomic | pass | pass | partial writeを公開しない |
| AC-1306-03 | SCN-047 | ライフサイクル | 合格 | 合格 | 更新記録2件、診断と撤去が成立 |
| AC-1306-04 | SCN-048、049、051、052、057 | lifecycle | pass | pass | 不正chainと非対応filesystemを資産変更前に拒否 |
| AC-1306-05 | SCN-053 | lifecycle | pass | pass | 中断probeの公開fileと一時fileを除外 |
| AC-1306-06 | SCN-054 | lifecycle | pass | pass | 並行applyの後着拒否 |
| AC-1306-07 | SCN-055、056 | lifecycle | pass | pass | 競合entry保持とdirty lock |

### 2.2 開発考慮事項の適用判定

開発考慮事項の適用判定は00_要求定義.md §6.1と同じ。

## 3. 肯定的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ | pass | no-replace公開と連鎖検証をSCN-045〜057で確認 |
| 価値 | pass | 競合で管理recordやsymlinkを失わない |
| 実現可能性 | pass | macOSでhardlink実測、非対応は公開前に停止 |
| 整合性 | pass | source、dist、仕様、13新規SCNを追跡 |
| 保守性 | pass | atomic primitiveとlifecycle readerを分離 |

## 4. 敵対的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 反例 | pass | symlink、孤立entry、anchor欠落、並行apply |
| 失敗経路 | pass | partial write、snapshot directoryだけのhardlink失敗、dirty lock |
| 境界値 | pass | 初回record、2連続snapshot、中断probe residue |
| 悪用 | pass | 既存entryはlinkで置換せず、同一UIDの任意書換えは境界外 |
| 安全性 | pass | 不正chainを空recordへ降格しない |
| データ損失 | pass | 競合entryと旧anchorを保持し、dirty failureはlockを残す |
| ロールバック | pass | anchorとsnapshotを組でバックアップから復元する |
| 範囲漏れ | pass | install/update/delete/doctorと配布build、仕様を監査 |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| SOL-01 | High | apply観測前に並行操作を直列化しない | 初回Sol諮問 | lifecycle | 排他lock、SCN-054/056 | resolved | なし |
| SOL-02 | High | probe競合entryを誤削除 | 初回Sol諮問 | lifecycle | no-replace primitiveをprobeへ利用、SCN-055 | resolved | なし |
| SOL-03 | High | 公開先と異なるdirectoryをprobe | 2回目Sol諮問 | lifecycle | 配置先probe、SCN-057 | resolved | なし |
| SOL-04 | High | 中断probeを孤立snapshotと誤判定 | 3回目Sol諮問 | lifecycle | 狭い残存名除外、SCN-053 | resolved | なし |
| SOL-05 | Medium | Linux descriptor pathを試験が見逃す | 3回目Sol諮問 | test | basename判定へ修正、SCN-057 | resolved | なし |
| SOL-06 | Low | 任意の同一UID攻撃者が一時file名を差し替える | src/lib/atomic.tsのlstatとlinkの間 | filesystem | 同一UID任意書換えは本契約の権限境界外 | out-of-scope | 同一UIDの直接書換えは防がない |
| QW-01 | Medium | 古いsnapshotの資産をuninstallが除去しない | qwen3.8の短い製品差分review、`lifecycle.ts:993` | delete | 最新recordが過去資産のkeyを引き継ぐこととSCN-047の2更新後delete成功を確認 | false-positive | なし |
| QW-02 | Medium | snapshot列挙中にentryが増減すると完全性検査を迂回する | qwen3.8の短い製品差分review、`lifecycle.ts:423` | reader | ASC apply同士はlockで直列化し、読取失敗は例外で止まる。新entryが列挙後に増えれば当該読取の後に成立した状態であり、静的集合の`remaining`に入らない | false-positive | 読取直後の更新は一般的な陳腐化として残る |

| 候補 | 出典・成立条件・経路 | 支持根拠の照合 | 反証・検証方法と実測 | 結論 |
|---|---|---|---|---|
| QW-01 | `ffd5d476`の`src/domain/lifecycle.ts:993`。2回以上更新してから`uninstall --apply` | `uninstall`は最新recordの`assets`を使う点は正しい | `upgrade`が`files: { ...old.files }`を継承する。SCN-047で2回更新後にdoctorとdeleteが成功 | 古い資産keyは最新recordに含まれるため不成立 |
| QW-02 | `ffd5d476`の`src/domain/lifecycle.ts:423`。列挙と読取の間に別processがsnapshotを追加・削除 | `snapshotEntries`が一度列挙する点は正しい | ASCの書込は排他lock。削除されたfileの`openSync`は失敗し、検証を通過しない。新規entryが後からできた場合は読取時点の先端であり、候補文の「remainingに入って拒否」と矛盾 | 指摘された完全性迂回は不成立 |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: 13観点と個別path。
- 指摘を確定した: 事前Sol諮問をすべてresolvedまたはout-of-scopeへ分類。
- 次ラウンド対象のCritical/High: なし。

### ラウンド2

- 未解決Critical/High: なし。
- 修正差分と、触れた隣接範囲: 事前諮問でatomic、lifecycle、testを再確認。
- 既承認・未変更範囲を再走査していない: formal round後の再走査は不要。

### ラウンド3

- 全指摘の最終分類: SOL-01〜05 resolved、SOL-06 out-of-scope、QW-01/02 false-positive。
- 危険範囲を除外・既定無効・ロールバック可能へ縮小した結果: 中断時はlockを保持し、doctorが不健全を報告。
- 同じ範囲の予算を自動更新していない: 事前諮問をformal roundとして数えない。

## 7. テスト結果

- 実行したcommandの一覧: `npm test`、`npm run conformance:check`、lint、format:check、typecheck、source:check、docs:format、test:format、trace:check、architecture:check、package:check、project:quality。
- 全layerの合計: `npm test`で2,311シナリオ中2,284成功、27スキップ、失敗0。21,380ステップ中21,279成功、101スキップ。対象64シナリオ・586ステップ、および直前に失敗した10シナリオ・91ステップも成功。
- runnerとGherkin方言: Cucumber JS、日本語。
- 隔離変異: 旧`renameSync`へ戻すとSCN-045が失敗。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `.agent-skill-chain/00_利用案内.md` | 入る | lock残存時と旧CLI交互運用の案内 |
| `dist/src/` | 入る | lifecycleとatomicの実行コード |
| `src/domain/lifecycle.ts`、`src/lib/atomic.ts` | 入る | sourceを配布するpackage契約 |
| 仕様、test、`.gitignore` | 入らない | なし |

判断: 配布物を更新した

根拠: `package.json`のfilesにsrc、dist、配布利用案内が含まれる。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated |
| その要求を満たすこと | はい（別contextのCodex Solがexact H_implを読取専用で確認） |
| reviewerとimplementerのidentity・context比較 | implementerは本Codex session。reviewerは別のCodex Sol subagent contextで、対象headは`fd9efd174e1850ab75686a2215b304a81c5370c2`。local qwen3.8は部分差分で2候補を出し、いずれも誤検知。独立承認へ算入しない |
| reviewerが対象差分を変更していないこと | はい（reviewerはread-only、作業treeは本artifact以外clean） |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: REQ-LC-001、DATA-006、管理データ、用語台帳、追跡表、変更履歴、利用案内。
- ドメイン用語台帳: TERM-LC-1306-01をIssue由来で追跡。
- 要件・変更・SCN・testの追跡: AC-1306-01〜07をSCN-045〜057へ対応。
- UI・トークン: CLI内部recordのため対象なし。

## 11. 総合判定と再開地点

- 未解決Critical/High: なし
- Medium/Lowの記録: Linux試験pathは修正。任意の同一UID攻撃者は範囲外として明示。
- 判定: approved
- 新しい権限が必要な事項: mergeは本タスクで行わない。
- 残存リスク: 旧CLIとの交互運用は不可。任意同一UIDによる直接file改変は防がない。
- 次に許可される操作: artifact単独commit、PR作成、CI確認。
- 次回の再開地点: PR CIとCodeRabbitの指摘を検証する。
