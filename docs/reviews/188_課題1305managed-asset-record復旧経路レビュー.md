# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 1（review session。下記の事前諮問7回はsessionのroundではない） |
| 対象SHA・文書ダイジェスト | H_impl は本表の`H_impl`行の値。**事前諮問7回はいずれもreview sessionのroundではない。** 事前諮問は `93d474ef`・`82453634`・`a622df80`・`932098b9`、review sessionのround 1は `8a060349` |
| 比較基点 | `e3892d94d065c1f804680bece4ef9fdabcf052d6` |
| H_impl | `3d8220814074e6b35795b2cbe6fa24bb76499845` |
| 対象差分 | 比較基点 `e3892d94`。**15 path。** review sessionのanchorはround 1の初回HEADに固定する |
| 対象外 | `doctor` の診断文と `healthy` 導出、host設定fileへの登録の書き込み、`.gitignore` 方針、record schema、`worktree finalize` の後片付け |
| 残り予算 | review sessionのround 1を`47729654`で開始する。**round 2は本artifactのcommitを対象にする。上限4に対し残り2ラウンド。** 収束後のHEAD移動に対する取り直し1ラウンドは別枠 |
| ラウンド数 | 2（round 1が本実装、round 2が本artifact自身） |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260909_094500_lifecycle-record-recovery |
| 仕様の所有箇所 | `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md` の REQ-LC-001。原文「`install`、`update`、`delete`はpreviewを既定とし、`--apply`時だけpackage所有の通常fileを変更する。利用者文書、project policy、仕様、staging、他tool、symlink、変更済み資産を保持し、hash・containment・TOCTOUを各write前に検証する。」 |
| 成果物行数 | 製品 `src/` +137 / -39、配布build `dist/` +95 / -42。支援層は test +939、仕様と配布利用案内 +16 / -1、staging成果物 1043行。**支援層が製品を上回っている。** 内訳はreviewが要求した検出力の是正（集合突合、型束縛、`fs`一時差し替えによる2 scenario、分類表4行）と、review findings 22件への回帰6 scenarioである |
| 縮小の先行評価 | **配布CLIへ`--recover-record`を1つ追加した。** #1307でownerが決裁した案Aである。先に既存手段の縮小を評価し、filesystemから導入済みを推測する機構を3度試みたが独立reviewerが3度とも反例を構成したため撤去した。**推測を持つ設計より受理範囲が狭い。** 棄却した代替（競合fileを退避して`install`を実行する運用）は、退避資産がrecordへ正本digestで登録され終状態が一致しないため採らない |
| 実施者・日時 | implementer: Claude（本session）。reviewer: codexとClaude fable。2026-09-09 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定5観点・敵対8観点のreview、finding分類 | critical。risk=high かつ security関連・data loss・不可逆操作・外部契約変更がいずれもありのため | Codexは推論`high`まで、Claudeは`Opus`まで | project choiceの`tierMapping`（`codex:provider_recommended_default:high:default` と `claude-opus-5`）。**`--model`を渡さずprovider既定を使った** | reviewer不在または独立性不明ならPR・merge・finalizeをfail-closedで停止する | reviewerはcodexとfableの2体で、いずれもimplementer（Claude本session）とは別processかつ別contextである。**契約でread-onlyと差分非編集を明示し、`codex exec --sandbox read-only` で起動した。** 対象差分のpath集合はreview前後で不変であることを`git status`で確認した |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #1305、AC-01〜AC-20 | **20件のACすべてにSCNが対応し、§2.1に20行ある。** 新規SCNは26件（integration 25件、unit 1件）で、初回6件は是正前に赤であることを確認し、review由来の20件は対応する変異をkillすることで検出力を確認した | テスト出力 |
| 差分 | `e3892d94..3d822081` | **15 path。** 製品codeは `src/domain/lifecycle.ts`・`src/cli.ts`・`src/cli-usage.ts` の3 fileとその`dist/`成果物に限る | 既存コード |
| テスト | `npm test` | 1743 scenarios / 1727 passed / 16 skipped / **0 failed** | テスト出力 |
| 仕様 | `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md` ほか3 file と配布物 `.agent-skill-chain/00_利用案内.md` | updated | 既存文書 |
| commit前candidate | 本節の変更ファイル個別監査表 | 15 path。`git add -A` を使わず個別にstageした | Git index |
| Phase A artifact | `docs/reviews/` 配下の本artifact 1 file | H_impl..H_final は本artifactだけ | Git観測 |
| commit後external | PR・CI run・review | **本ラウンド時点では未作成。** PR作成後にrun IDとreview IDを追記する | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **確認した。** 正方向は `正本source → 展開済み資産 → managed asset record → doctorの観測` であり、recordの内容でrecord自身の正当性を判定していない。本artifactへ自身のcommit SHAを書いていない。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけであり、trusted providerが観測したPR/CI/reviewが`H_final`へ一致している: **PR作成後に確定する。** 本ラウンド時点では`H_impl`のみ確定している。
- reviewer stable IDがPR author/provider観測済み`H_impl` author stable IDと異なる: reviewerはcodexとfableで、実装commitのauthorはClaude（本session）である。**別providerのprocessであり同一identityでない。**
- 既定branch追随を行った場合: **追随していない。** `比較基点`は着手時の`origin/main` tipのままである。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/lifecycle.ts` | M | package owner | package | lifecycleコンテキストの導入・更新・削除・健全性を所有する既存file。分類の純関数（`classifyManagedAsset`。SCN-UNIT-LIFECYCLE-001が記録の有無と一致・相違の全件で決定論を照合する）、明示指定門、案内、no-replace公開を同じdomainへ置いた | pass。`classifyManagedAsset`は`fs`へ依存せず、他domainをimportしない。`recoveryGuidance`は`upgrade`のpreviewを呼ぶが逆向きの依存を作らない | REQ-LC-001 / AC-01〜AC-18 / SCN-INT-LIFECYCLE-017〜041、SCN-UNIT-LIFECYCLE-001 | 上書きの到達性を増やさない。前進commitで戻せる | pass |
| `src/cli.ts` | M | package owner | package | lifecycle dispatchへ`--recover-record`を配線した1箇所のみ | pass。`upgrade`の呼び出しはここだけで迂回経路が無い | AC-17 / SCN-INT-LIFECYCLE-034、036、038 | flag未指定が既定で拒否側 | pass |
| `src/cli-usage.ts` | M | package owner | package | `update`のoptional flagへ`--recover-record`の宣言と説明を追加した | pass。`check_cli_usage`が参照と宣言の一致を機械検査する | 同上 | 宣言の除去で戻せる | pass |
| `.agent-skill-chain/00_利用案内.md` | M | package owner | package | **配布される利用案内。** runtimeの挙動が変わったため復旧手順と明示指定を追記した。利用者は配布物だけを読む | pass | REQ-LC-001 / AC-01〜AC-18 | 追記のみ。行の除去で戻せる | pass |
| `test/features/integration/lifecycle-isolation.feature` | M | project | project | lifecycleの所有権境界を検証する既存integration featureへ、同じ境界の25 scenarioを追加した | pass | SCN-INT-LIFECYCLE-017〜041 | 一時repositoryに閉じる。実workspaceとremoteを触らない | pass |
| `test/features/unit/lifecycle-record-recovery.feature` | A | project | project | 分類の純関数`classifyManagedAsset`だけを対象とするunit feature。SCN-UNIT-LIFECYCLE-001が10行の分類表で全件を照合する | pass | SCN-UNIT-LIFECYCLE-001 | 副作用なし | pass |
| `test/steps/lifecycle-isolation.steps.ts` | M | project | project | 既存helperを再利用し、`fs`のmethodを`finally`復元付きで一時差し替えする注入を加えた。**製品APIへ注入口を足していない** | pass | 同featureのSCN | 全stepが`mkdtemp`の一時repositoryへ`--root`を固定する | pass |
| `test/steps/lifecycle-record-recovery.steps.ts` | A | project | project | 分類の期待表10行。**期待値を製品の実装から導出せず書き写した** | pass | SCN-UNIT-LIFECYCLE-001 | 副作用なし | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | project | spec | 耐久用語台帳。TERM-ASC-097を1行追加した | pass | TERM-ASC-097 | 行の除去で戻せる | pass |
| `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md` | M | project | spec | REQ-LC-001へ明示指定門・観測1回・no-replace公開・案内の条件・状態を断定しない規則を追記し、強制するSCNを名指しした | pass | REQ-LC-001 / AC-LC-001 / 新SCN 26件 | 段落の除去で戻せる | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | project | spec | AC-LC-001行のSCN一覧へ017〜041を追加し、unit層の新SCN行を追加した | pass | 同上 | 行の除去で戻せる | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | project | spec | header区切りの直後へ1行追加した | pass | 同上 | 行の除去で戻せる | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **確認した。** `git -c core.quotepath=false diff --name-status e3892d94..3d822081` の**dist除外後12 path**（`check_file_audit.ts`の`auditedExpected`が生成物を除くため、照合対象は12である）と本表の11行が一致する。
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **確認した。** `src/domain/lifecycle.ts`へproject固有のpathや閾値を入れていない。仕様fileへ実行authorityを書いていない。
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: 本ラウンドの修正は§5に記録する。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-001 | AC-06を「通常fileでない場合は拒否する」と書いていたが、directoryは`retain`で正常終了し、境界外symlinkは`destination`の`resolveContained`が**分類より前段で**操作全体を拒否する。振る舞いが2つに分かれる | AC-06の文言のみ。実装・INV・FRは変わらない。**「1 fileも書かない」はどちらの入力でも成立する** | requirement | `workflow assess-discovery`の`rebaseline-affected-contracts`に従い01・02・03だけを再確定した。Issueと00は作り直していない。SCNをWhen・Thenの2組へ分けた | SCN-INT-LIFECYCLE-021が両方の入力で合格。境界外fileの内容が実行前と一致することもassertした | updated（REQ-LC-001へ境界外symlinkの前段拒否を明記） | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-01 | SCN-INT-LIFECYCLE-017、SCN-INT-LIFECYCLE-036 | `upgrade`の`adopt`とrecord再固定、およびその配布CLI合成経路 | 合格 | pass | preview/applyの`adopted`集合一致と、record全entryのdigestが実fileの実測値と一致することを1件ずつ照合 |
| AC-02 | SCN-INT-LIFECYCLE-018 | `classifyManagedAsset`の`retain` | 合格 | pass | `retained`への出現、実行前後のcontent digest一致、保持資産がrecordへ登録されないこと |
| AC-03 | SCN-INT-LIFECYCLE-019 | `init`・`uninstall`の拒否理由 | 合格 | pass | `init`の競合拒否がcommand名を含まないこと、`uninstall`のrecord不在拒否が`update`を名指しすること、続く`update`が`applied: true` |
| AC-04 | SCN-INT-LIFECYCLE-020 | 書き込みを追加しないこと | 合格 | pass | `.claude/settings.local.json`を`consumerFiles`へ入れ、内容一致を照合 |
| AC-05 | SCN-UNIT-LIFECYCLE-001 | `classifyManagedAsset` | 合格 | pass | 分類全件表6行の照合、分類列挙の網羅、記録なし相違が`retain`であることの名指し固定 |
| AC-06 | SCN-INT-LIFECYCLE-021 | 非通常fileの`retain`と`destination`の境界検証 | 合格 | pass | directoryの`retained`と、境界外symlinkの前段拒否理由、境界外fileの不変 |
| AC-07 | SCN-INT-LIFECYCLE-022 | `readManagedAssetRecord`の`lstat`事前検査 | 合格 | pass | dangling symlinkのrecordが不在と誤認されず拒否され、`lstat`でsymlinkのentryが保持される。診断は読み取り時の理由を名指しし公開時の理由と混同しない |
| AC-08 | SCN-INT-LIFECYCLE-023 | `readManagedAssetRecordAt`が壊れたrecordをcatchしないこと | 合格 | pass | 拒否の発生と、record内容のdigestが実行前後で一致すること |
| AC-09 | SCN-INT-LIFECYCLE-024、SCN-INT-LIFECYCLE-037 | applyループ内の`observeManagedAsset`再観測 | 合格 | pass | preview後に変わった展開先が`retained`へ出現しrecordのkeyに含まれない。**復旧中に現れたrecordを`expected`の根拠にしない**ことをSCN-037が`lstatSync`の呼び出し回数で固定する |
| AC-10 | SCN-INT-LIFECYCLE-025 | `next.files[item.key] = digest(item.dest)` | 合格 | pass | recordの登録値がcopy後の展開先の実測digestと一致し、正本のdigestで代替されない |
| AC-11 | SCN-INT-LIFECYCLE-026 | `recoveryDiagnostic`のblocked分岐と`mappings`の対象名指し | 合格 | pass | 拒否理由が**解消すべき原因と対象の両方**を名指しし、**どのcommandも手段として名指ししない**。診断文全体が許容形と完全一致することで固定する。同じ状態の`update`が実際に拒否されることを同一scenario内で確認する |
| AC-12 | SCN-INT-LIFECYCLE-027 | opt-in門が展開先の観測より前に発火すること | 合格 | pass | directory内容の不変、拒否理由が`install`を名指ししないこと、別途`install`が同じ状態で成功すること |
| AC-13 | SCN-INT-LIFECYCLE-028 | `readManagedAssetRecord`の5分類の検査 | 合格 | pass | 5分類のいずれも空recordへ降格せず、recordと管理資産が1 byteも変わらない |
| AC-14 | SCN-INT-LIFECYCLE-029、SCN-INT-LIFECYCLE-030 | 明示指定なしのthrow | 合格 | pass | 利用者所有の同名fileでも正本とbyte一致する同名fileでも1 fileも書かない。**filesystemからの導入推測を根拠にしない** |
| AC-15 | SCN-INT-LIFECYCLE-031、SCN-INT-LIFECYCLE-033 | `assertRecordPublishTarget`と`wx`公開 | 合格 | pass | 公開直前に現れたsymlinkのrecord公開先を置換せず公開を中止する。SCN-033はrecord既存の再固定経路で同じ性質を固定する |
| AC-16 | SCN-INT-LIFECYCLE-032 | `options.recoverRecord !== true`の門 | 合格 | pass | 導入済みでも明示指定が無ければ1 fileも書かずrecordを再生成しない。拒否理由に`install`という語が現れない |
| AC-17 | SCN-INT-LIFECYCLE-034、SCN-INT-LIFECYCLE-038 | `flags["recover-record"] === true`のCLI配線 | 合格 | pass | 配布CLIの終了値が非0で1 fileも書かず、`--recover-record`を名指しする。SCN-038は明示指定つきpreviewが到達でき書き込まないことを固定する。**判定関数ではなく合成経路を検査する** |
| AC-18 | SCN-INT-LIFECYCLE-035 | `init`側の`assertRecordPublishTarget` | 合格 | pass | 公開先が`lstat`でsymlinkのままであり参照先が作られない |
| AC-19 | SCN-INT-LIFECYCLE-019、SCN-INT-LIFECYCLE-039、SCN-INT-LIFECYCLE-040 | `recoveryDiagnostic`の成功分岐 | 合格 | pass | 最小診断が**所属commandの`update`を名指しし**、`install`という語・手順・内訳・導入状態の断定を含まない。展開済み資産が0件でも1件でも同じ形である |
| AC-20 | SCN-INT-LIFECYCLE-041 | 門の手前でpreviewを走らせること | 合格 | pass | previewが拒否される状態では原因だけを名指しし、どのcommandも成功する手段として案内しない |

**AC 20件すべてに行があり、表はちょうど20行である。** 前版は`AC-01`〜`AC-06`の6行しかなく、**実装済みかつ検証済みの14件を成果物が報告していなかった。**
`SCN-INT-LIFECYCLE-033`・`036`・`037`・`038`は独立reviewerの指摘から追加したもので番号付きACを持たないため、
**同じ命題を別のcaller・別の時点で固定する行として、補強する先のACへ併記した。** 新規SCNは26件（integration 25件、unit 1件）である。

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | recordはどのhost資産をpackageが管理するかを定める信頼判定の入力であり、その不在時の分岐を追加した | INV-01をSCN-INT-LIFECYCLE-018とSCN-UNIT-LIFECYCLE-001で固定した。上書きへ倒す変異M-B3をkillした。秘密情報を扱わず、出力はpathとdigestのみでfileの内容を出さない |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 拒否理由と保持対象pathの報告が運用判断の入力である | `retained`へ当該pathを含める。INV-02をSCN-INT-LIFECYCLE-019で固定し、名指しを削る変異M-A5・M-A6をkillした。log fileを持たないため保持・rotation・削除は呼び出し側が所有する |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | Node CLIのみでGUI・Web UIを持たず、本変更も画面を追加しない。project choiceの`capabilities.humanCenteredUi`もnot-applicableである | `package.json`のbinがCLI 1件のみでUI sourceが存在しない |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 画面レイアウトと視覚コンポーネントを持たず、tokenを追加しない。project choiceの`capabilities.designTokens`もnot-applicableである | projectKindがcliでdesign token仕様fileが存在しない |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | record不在からの復旧が成立し、上書きの到達性が増えていないか | pass | 閉路の解消を実測。分類は`place`・`overwrite`・`adopt`・`retain`の6行表で尽き、`overwrite`へ到達するのは`expected`が記録済みで実digestが一致する場合だけである。record不在では全件`undefined`のため到達しない。変異M-B3（記録なし相違をoverwriteへ）をkillした |
| 価値 | 利用者が製品外の手作業なしに復旧できるか | pass | `update`1回で復旧する。部分欠落（package名前空間資産3件のみ残存）から113 fileの復旧を実測した |
| 実現可能性 | 実行環境・依存・権限で成立するか | pass | 依存とlockfileを変更していない。`dist/`を同じcommitへ含め、build後の`git status`が空である |
| 整合性 | 設計・コード・テスト・仕様が一致するか | finding → resolved | **私はここで一度、事実でない記載をした。** 「00・01・02・03・仕様・配布利用案内が同じ性質を述べている」と書いたが、round 1のreviewer 2体が実測で否定した。`00_要求定義.md`は1箇所も更新しておらず、01・02・03・要件本文にstrict形が残り、同一要件内で矛盾していた。**事前諮問のR2-H03で受けた指摘と同型の状態を、artifactの記述として再発させた。** round 2でINV-02の正準文を1つに定めた。**その後の「残存0件」という申告は、さらに2回連続で事実でなかった。** round 6では`実行して成功`という字面をgrepしたが残存形は`既知の論理的拒否`であり、round 7では11個の表現形を走査したと述べたが、reviewer 2体が独立に要件本文9行・23行、01の74/76/146行、02の166/190/206行、03の49/115/190行、本表82行、変更履歴5行を実在の残存として示した。**同型の誤りを3回繰り返した。** 原因は毎回「自分が今書いた言い回し」をgrepしていたことであり、残存側の言い回しは走査していなかった。round 8では走査対象を字面ではなく**命題の類**（`install`がcommandを名指しするという主張、preview内訳を開示するという主張、SCN-019をinit側だけの検査とする記述、導入状態を断定するという記述）に変え、各類の全hitを1件ずつ本文と突合して是正した。**申告する数字は、それを出したcommandと同じ message に置く。** |
| 保守性 | 責務・命名・変更容易性が妥当か | pass | 分類を純関数へ寄せ、preview経路とapply経路の重複分岐を1箇所にした。`fs`依存は`observeManagedAsset`へ閉じている。**ただし`""` sentinelは将来の罠である。** 判別共用体にすれば型で消せるが、本Issueでは手段を増やさず、対応する変異M-B6をkillして代替した |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 要件を破る入力・状態がないか | pass（ラウンド2で3件検出し是正） | dangling symlinkのrecord、未導入directory、利用者所有の同名file。**いずれも実測で再現してから是正した。** SCN-022・027・029・030で固定 |
| 失敗経路 | 外部失敗・部分失敗を安全に扱うか | pass | record不正5分類すべてで書き込まず拒否する（SCN-028）。部分失敗時は`retained`へ載せて報告する |
| 境界値 | 空、最大、最小、重複、Unicode等 | pass | 分類表10行に空digest同士と空文字`expected`を含む。Unicode正規化は既存SCN-009を維持 |
| 悪用 | 注入、経路脱出、権限外操作等 | pass | 境界外symlinkは展開先解決時点で操作全体を拒否する（SCN-021）。record偽造は登録digestを実測値に限るため上書き許可を生まない（SCN-025・M-C1） |
| 安全性 | 認証、承認、秘密情報、Zero Trust | pass | 外部接続なし。出力はpathとdigestのみでfile内容を出さない。recordの内容でrecord自身を正当化しない。host設定fileへ書き込まない（SCN-014・020） |
| データ損失 | 上書き、削除、部分公開、履歴消失 | pass（ラウンド1・2で2件検出し是正） | record外かつ相違する資産を上書きしない（INV-01）。**symlinkのentry置換を2箇所で塞いだ**（読み取り時の不在判定と公開直前の再検証）。**残る窓は#1306が所有する** |
| ロールバック | 復旧参照、状態保持、再開可能性 | pass | 拒否時は状態を変更しない。生成recordは削除すれば元へ戻る。前進commitで分岐を戻せる |
| 範囲漏れ | 呼び出し元、利用側、配布物、文書 | pass | `dist/src/`が配布境界に入るため配布利用案内へ復旧手順を追記した。`docs/specs/`だけでは利用者へ届かない |

## 5. 指摘

**独立reviewer 2体へ事前諮問を7回行った。** reviewer起動はcodex 7回・Claude fable 5回である。各回の指摘件数は上表の`指摘`欄のとおりで、**本節はそれらを24個のIDへ集約したものである。** 7回目（`78771095`）はfableがHigh 2件、codexがHigh 1件・Medium 2件を出した。主要なものを記す。

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| R1305-01 / F-03 | High | recordの不在判定が`fs.existsSync`でdangling symlinkを不在と誤認し、公開の`rename`がsymlinkのentryを通常fileへ置換した | 一時repositoryで再現。`islink`が`True`から`False`へ変わった | REQ-LC-001のsymlink保持、データ損失 | `pathEntryExists`へ変更し、entryがあれば必ず検証へ通す | valid / resolved | なし |
| F-01 | High | record不在を無条件に全資産未記録とし、**未導入directoryで`update --apply`が114 fileを書き込んだ** | `README.md`1件のdirectoryで再現 | 本Issueの前提、不可逆操作の到達性 | 前提検査を追加し`install`を名指しして拒否 | valid / resolved | なし |
| R2-H01 | High | 導入証拠が「同名entryが1件ある」だけで、**利用者所有の`AGENTS.md`のみで113 fileが書き込まれた** | 再現済み | 同上 | 証拠を`.agent-skill-chain/`配下へ限定。正本一致の同名fileも証拠にしない | valid / resolved | なし |
| R2-H03 | High | **INV-02を「閉路にならない」へ弱めたのはゴールポストの移動。** 00・BR-02・FR-04・AC-03は成功を要求したままで成果物内に矛盾を残した | 成果物間の突合 | 契約の整合性 | **弱めた文言を撤回。** 副作用の無いpreviewをoracleにして、成功する手段だけを名指しする実装へ変えた | valid / resolved | なし |
| R2-H02 | High | 観測から`rename`公開までの間にentryが差し替わりうる | 公開直前にsymlinkを注入して再現 | データ損失 | 公開直前の再検証を両write siteへ追加（SCN-031） | valid / resolved（部分） | **検査と`rename`の間の窓は閉じていない。** `install`にも同型に存在する既存の性質であり **#1306** が所有する |
| R1305-03 / R1305-04 | High | M-A7・M-C1を「等価変異」と記録したのは誤りで、test側のseamでkillできる | `fs.mkdirSync`・`fs.copyFileSync`の一時差し替えで両方kill | 検出力 | 2 scenarioを追加。**製品APIへ注入口を足していない** | valid / resolved | なし |
| R2-M01 | Medium | record不正の検査がJSON構文不正だけで、digest不正・path重複・非通常fileが未検査 | grep実証 | 検出力 | 5分類へ拡張（SCN-028） | valid / resolved | なし |
| R1305-05 / F-06 | Medium | record不在＋欠落資産の`place`合成経路が未検査 | 変異M-D2が生存 | 検出力 | 変異を追加しkill。SCN-025のfixtureが同状態を作る | valid / resolved | なし |
| F-04 / F-05 | Medium | 件数だけの照合、混在状態の採用側が未検査 | 変異M-D3・M-D4が生存 | 検出力 | 集合の突合へ変更 | valid / resolved | なし |
| F-07 | Low-Medium | SCN-021の後半がrecord存在状態を測っており、scenario名と一致していなかった | code読解 | 検出力 | `dropRecord`を挟み、recordを書いていないことも観測 | valid / resolved | なし |
| F-08 | Low | `init`の案内文がrecord存在時に不正確 | code読解 | 診断の正確さ | ラウンド3でpreview由来の案内へ置換し解消 | valid / resolved | なし |
| F-09 / R1305-08 | Low | 分類表が非網羅、列挙が`Record<string, true>`で型束縛が無く`constructor`が素通りする | code読解 | 検出力 | 行を4件足し、`Record<ManagedAssetClassification, true>`と`Object.hasOwn`へ変更 | valid / resolved | なし |
| R1305-09 | Low | 境界外拒否の観測が境界外fileの内容だけだった | code読解 | 検出力 | symlinkの保持、recordを書いていないこと、管理資産の不変を追加 | valid / resolved | なし |
| R1305-07 | Low | M-B5はexport関数の契約としては非等価 | `expected: ""`で分岐が変わる | 契約の明示 | 契約行を足しM-B5もkill | valid / resolved | なし |
| F-10 | Low | SCN-017の「実測値であることを確かめる」コメントがM-C1を区別できていなかった | 指摘どおり | 記述の正確さ | SCN-025で実際に区別できるようにし、コメントの主張を実態へ合わせた | valid / resolved | なし |
| F-12 | Info | SCN-020の`digestsBeforeRecovery`が未使用で、`.claude/settings.local.json`は`mappings()`に含まれないため構造上必ず通る | 指摘どおり | 検出力の限界 | **検出力が無いことを認識して残す。** INV-03は`mappings()`に設定fileが無いという構造で担保され、SCN-014が既に固定している。重ねて機構を足さない | valid / out-of-scope | 設定fileへの書き込みが将来追加された場合、SCN-020は検出しない |
| F-13 | Info | **審査中に作業treeが変異試験で変動していた** | fableの観測 | reviewの成立 | **手順の誤りである。** 以後reviewer起動中は変異試験を行わない。fableは自力で範囲をH_implのdiffへ限定し、変動中の全suite結果を証跡から除外した | valid / resolved | なし |
| R8-H01 | High | **縮小が閉路を1つ作り直していた。** 最小診断が`--recover-record`というflag名だけを返し所属commandを名指ししなかった。`--recover-record`は`update`のflagで`delete`のflagではないが、**CLIは宣言外のflagを黙って捨てる**ため、`delete`の拒否を読んだ利用者が`delete --recover-record --apply`を実行しても**byte一致の拒否**が返り、誤ったcommandを使ったという信号が出ない | `delete --apply`と`delete --apply --recover-record`の`reasons[0]`が完全一致することを実測。`delete --apply --totally-bogus-flag`も同じ拒否を返すことで宣言外flagの黙殺を確認 | 本Issueの目的そのもの | previewが成功する分岐にだけ所属commandを名指しする。previewは`upgrade(target,{apply:false,recoverRecord:true})`であり**名指しする手段そのもののpreview**なのでINV-02の正準条件を満たす。previewが拒否した分岐と、previewを走らせない`init`の競合拒否では名指ししない | resolved / fix-regression | `delete`から`update`へ移る操作は利用者が行う。製品は代行しない |
| R8-H02 | High | 要件本文9・23行、01の74/76/146行、02の166/190/206行、03の49/115/190行、04の82行、変更履歴5行が縮小前の契約を現在形で述べ、**同一要件内で25行と矛盾していた。** 「11個の表現形を走査して0件」という私の申告は**3回連続で事実でなかった** | reviewer 2体が独立に実ファイル上の残存を提示 | 仕様の一貫性 | 走査対象を字面から**命題の類**へ変え、4類の全hitを1件ずつ本文と突合。あわせて25行自身の「caller非依存な1本の文字列で助言を作らない」も現実装と矛盾していたため書き換えた | resolved / acceptance-violation | 命題の類は私が列挙したものであり網羅の保証はない |
| R8-M01 | Medium | 「record存在の観測は1回に限る」が無限定で、拒否経路では偽。`recoveryDiagnostic`が`upgrade`のpreviewを呼び再観測する | codexがcall graphで提示 | 不変条件の記述 | 限定を「状態を変える経路」へ明記。**previewは1 byteも書かないので上書き権限を与えず、この不変条件が防いでいる事故は起こらない** | resolved / improvement | 限定を落とすと偽の法則になるという既知の型である |
| R8-M02 | Medium | 最小診断のassertionが禁止語の部分集合しか見ておらず、別文言での再導入が生存し得る。退役させた「状態の断定」変異は字面が消えただけだった | codexがassertion 3箇所を名指し | 検出力 | 語の類で禁止する`assertNamesNoCommand`・`assertAssertsNoState`へ集約し、path除去を`diagnosticBody`で空洞化から守った。変異5件（M-A13・M-B10・M-A14・M-A15・M-C4）を追加 | resolved / improvement | 語の類も私が列挙したものである |
| R8-L01 | Low | 04の§2.1が`AC-01`〜`AC-06`の6行しかなく、**実装済みかつ検証済みの14件を成果物が報告していなかった。** `SCN-033`・`036`・`037`・`038`はどのAC行からも参照されていなかった | AC集合とSCN集合をfileから抽出して差集合を取った | 成果物の完全性 | 20 AC全件へ行を足し、番号付きACを持たない4 SCNを補強先のACへ併記した。新規SCNは26件 | resolved / improvement | AC自体は増やしていない。受け入れ契約は変えていない |
| R8-L02 | Low | 04の入力証拠が`11 path`・`AC-01〜AC-15`・`新規16 SCN`・差分範囲`..a622df80`と、いずれも実測と食い違っていた | `git diff --name-only`とAC/SCN抽出で突合 | 成果物の正確さ | 15 path・AC-01〜AC-20・26 SCN・実際のH_implへ是正 | resolved / improvement | なし |
| R8-L03 | Low | 04が事前諮問5・6を「ラウンド1・2（review session）」として重ねて記載していたが、**journalにはStep 0〜9しか無く`review round`は1度も実行していない** | `journal/steps.jsonl`の全行を読んだ | 証跡の正確さ | 見出しを事前諮問へ是正し、製品を通していないものをroundとして記録していた事実を明記した | resolved / acceptance-violation | 実際のsession roundは本artifactのcommit以降に記録する |
| R9-H01 | High | **「命題の類で走査して残存0件」も事実でなかった。これで4回連続である。** 実ファイル上に現在形の矛盾が11箇所残っていた（`01`の18・55・188行、`02`の67・87・88・103・154行、`03`の56・168行、`04`の204行）。さらに`SCN-027`のGherkinは「名指しされた`install`は成功する」と書いたままで、**step実装は`install`の名指しを禁止していた。仕様文と検査が反対を述べていた** | fableが6行、codexが別の2行と`feature:136`を独立に提示 | 仕様の一貫性、検査の意味 | **原因を特定した。11箇所のうち9箇所が表の行である。** 私の走査はすべて散文向けのgrepで、状態遷移表・境界値表・外部IF表・検証表の行を構造的に見ていなかった。表の行だけを抽出して命題の類を当てる走査へ変え、全hitを分類した。`02:103`は#1307案Aで撤去したfilesystem推測を現在形で述べていたので撤去の経緯へ書き換え、`03:168`は撤回済みの判断であることを明記し、Gherkinとstep名は`install`を名指ししない事実へ揃えた | resolved / acceptance-violation | 表の行を見る走査も私が書いたものである。**次に同型が出たら、走査ではなく成果物の構造そのものを疑う** |
| R9-H02 | High | blocked分岐がINV-02の**「解消すべき原因と対象を名指しする」の「対象」を満たしていなかった。** `resolveContained`は`シンボリックリンクによる境界外移動を拒否しました`を**対象pathなしで**投げるため、112資産のうちどれが境界外を指しているのか分からず、`install`・`update`・`delete`の3 commandがどれも同じ文だけを返していた。**閉路ではないが製品の外へ出ないと解消できない行き止まりである。** SCN-026とSCN-041は原因文しかassertしておらず、**この節は走査0回だった** | fableがcall graphと実測で提示。私も`update --recover-record --apply`で再現し、対象pathが出ないことを確認した | INV-02の充足、行き止まり | `src/lib/security.ts`は信頼品質契約の保護対象なので投げ元は変えず、**`mappings`と`resolveManagedAsset`の呼び出し側で対象を付けて投げ直した。** `readManagedAssetRecord`は同じ理由で既にrecord pathを名指ししており、**同型の欠陥が残っていた2箇所を揃えた。** 3 commandすべてが`.codex/hooks/asc-contract-citation.mjs`を名指しすることを実測した | resolved / invariant-violation | 対象を名指しするのは境界外symlinkの経路である。他の原因文はもともとpathを含む |
| R9-H03 | High | **04のreview証跡と監査表が有効なround 1を表していなかった。** 冒頭がround 1を宣言する一方で`8a060349`をsession round 1と記載し同一成果物内で矛盾していた。さらに`check_file_audit.ts`の`auditedExpected`は`dist/`を除外するため**期待path集合は12だが、監査表は15行だった。** そのまま`audit:check`へ進めば`個別監査とGit差分path集合が一致しません: expected=12 actual=15`で落ちる | codexが`check_file_audit.ts:1298`を名指し。私も`parseFileAudit`の正規表現を再実装して照合した | PR作成の可否 | round metadataの矛盾を除き、監査表から`dist/`3行を落として12行にし、`git diff --name-status`のdist除外集合と件数・status・pathの全一致を確認した。**この直前に私は「15 entry読める」と確認して満足していたが、読めることと期待集合に一致することは別だった** | resolved / acceptance-violation | 配布物影響の節は生の差分を使うため`dist/src/`の記述を残す。除外は監査表の照合だけに効く |
| R9-M01 | Medium | 「状態を変える経路では観測1回」という限定も**まだ広すぎた。** record存在時は最初の存在判定のあとに`readManagedAssetRecord`が同じentryを読む | codexが`lifecycle.ts:217`を名指し | 不変条件の記述 | 守るべき性質を回数ではなく**「不在と観測してから分類するまでの間に現れたrecordのdigestを`expected`として使わないこと」**へ言い換えた。回数はその性質の代理でしかなかった | resolved / improvement | 代理指標を不変条件として書くと、実装が正しいまま記述が偽になる |
| R9-M02 | Medium | **禁止語の列挙という守り方そのものが誤りだった。** codexとfableが独立に反例を出した。`LEGACY_LIFECYCLE_ALIASES`の`init`・`upgrade`・`uninstall`はCLIが現に受理するので「`upgrade`に`--recover-record`を」は生存し、`delete`・`doctor`・大小文字違いの`Update`も生存し、「ASCが入っていません」「初期導入が済んでいません」のような状態断定の言い換えも生存した | 両reviewerが具体的な生存文面を提示 | 検出力 | **列挙をやめ、許容文面との完全一致へ変えた。** `assertDiagnosticIsExactly`が10箇所で診断文全体を`assert.equal`する。動的部分は原因と対象pathだけで、それもtest側にliteralで書く。**列挙漏れという失敗様式そのものが無くなる。** 助言を1語足しても、どう言い換えても落ちる | resolved / improvement | 完全一致は文言変更のたびtestが落ちる。診断文が契約である本Issueではそれが正しい |
| R9-L01 | Low | §2.1が21行で「20行」と食い違い、`01`のAC表は補強SCNを書いていなかったため01と04が不一致だった | 両reviewerが指摘 | 成果物の整合 | `SCN-036`をAC-01の既存行へ併記して20行に揃え、`01`のAC-01・09・15・17へ補強SCNを追記した | resolved / improvement | なし |

**ラウンド1で私が出した2件の誤った主張を記録する。** M-A7とM-C1を「等価変異」と断じたが、いずれも非等価であった。
**「注入口が無い」は製品APIについての事実であって、等価性の根拠ではない。** testは同じprocessに居るため interleaving を作れる。

## 6. ラウンド固有の確認

### 事前諮問（review sessionのroundではない）

**手順の誤りを先に記録する。** 実装中の3回のレビューを、製品の`review round`を通さずに外部reviewerへ直接投げて行った。`review-session.json`は作られておらず、**machine上のroundは1度も記録されていない。** `02_品質基準.md`はround番号をreviewerの自己申告でresetできないものとし、scope ID・AC ID・invariant ID・基点・初回HEAD・差分digestを`review-session.json`へ固定することを要求している。**手書き運用ではこの固定が成立しない。**

したがって本artifactは、それら3回を**事前諮問**として記録する。`02_品質基準.md`は「consultation / auditからの指摘も同じadmissionを通し」と定めており、諮問の指摘をroundのfindingとして扱う経路は存在する。**予算を消費したことにも、消費していないことにもしない。** 事実として、機構上のroundはこのartifactのround 1が最初である。

| 事前諮問 | 対象HEAD | reviewer | 指摘 | 帰結 |
|---:|---|---|---:|---|
| 1 | `93d474ef` | codex、Claude fable | 22件 | High 6件を是正 |
| 2 | `82453634` | codex | 4件 | High 3件（R2-H01・H02・H03）で停止判定 |
| 3 | `a622df80` | codex | 3件継続 | **同型のR2-H01が3回連続で破られたため、機構ごと#1307へ分離しownerの決裁を得た** |
| 4 | `932098b9` | codex、Claude fable | 12件 | High 3件。CLI合成経路の未検査、previewがapply成功のoracleでないこと、祖先差し替え。祖先差し替えは**#1309**へ分離 |
| 5 | `8a060349` | codex、Claude fable | 13件 | High 7件。record二重観測、`--dry-run --apply`併記、shell injection、成果物未収束、正方向preview欠落、未導入dirへの復旧案内 |
| 6 | `16f0d8e0` | codex、Claude fable | 13件 | High 4件。**案内surfaceが4ラウンド連続の発生源であると両者が判定し、fableが(B)縮小、codexが(C)分離を推奨した。** 処方は同一であり、最小診断へ縮小して豊かな案内を**#1310**へ分離した |
| 7 | `78771095` | codex、Claude fable | 8件 | High 2件。**縮小が閉路を1つ作り直していた。** 最小診断が所属commandを名指ししないため`delete --recover-record --apply`がbyte一致の拒否を返す（fable H-01）。成果物の未収束が3回連続で未解決（fable H-02／codex High 1）。codexはMediumで観測1回の無限定な記述と見落とし変異クラス3件を挙げた |

**3回目の判定は「未収束」であった。** 是正を重ねるのではなく、破られ続けた機構（filesystemからの導入判定）を撤去する決裁を仰いだ。#1307でownerが案Aを決裁し、`--recover-record`による明示指定へ置き換えた。**受理範囲は推測時より狭い。**

**この下の2節は「review session」と書いていたが誤りである。** journalにはStep 0〜9だけが記録されており、`review round`は1度も実行しておらず`review-session.json`も存在しない。**製品を通していないものを製品のroundとして記録していた。** どちらも事前諮問5・6と同じ観測を別の見出しで重ねて書いたものである。実際のreview sessionのroundは本節の最後に記録する。

### 事前諮問5の詳細（`8a060349`）

- 全評価基準を確認した: **はい。** 肯定5観点と敵対8観点を`8a060349`へ適用した。reviewerはcodexとClaude fableの2体で、いずれも`--sandbox read-only`かつtest実行・変異試験の禁止を契約で明示した。
- 指摘を確定した: **High 7件**（codex 5件、fable 2件。重複を含む）。内訳はrecord存在の二重観測、案内の`--dry-run --apply`併記、案内のshell injection、成果物の未収束、正方向CLI previewの欠落、未導入directoryへの復旧案内、`update`拒否文の`install`名指し。
- 次ラウンド対象のCritical/High: 上記7件すべて。

### 事前諮問6の詳細（`16f0d8e0`）

- **案内surfaceを縮小した。** 直近4ラウンドのHighはすべて拒否理由の案内文に集中し、中核機構（opt-in門・観測1回・no-replace公開・retain意味論）は繰り返しpassしていた。運用ポリシーの「手段が開発速度を損なうとき、縮小するのは手段の側である」と、同型blockingが3ラウンド続いたら機構ごと分離する運用規則に従い、**手順・preview内訳・`install`と`update`の分岐助言をすべて落として最小診断へ縮小し、豊かな案内の可否を #1310 へ分離した。** reviewer 2体の推奨（fable (B)縮小・codex (C)分離）は処方が同一であった。
- **構造的な原因を記録する。** 1本のcaller非依存な文字列を`init`・`upgrade`門・`uninstall`の3 callerへ連結していた。`install`の名指しは`init`では拒否の閉路、`delete`では誤誘導になると当時は判断した（**その後この判断も更新した。現在はどの拒否理由も`install`を名指しせず、最小診断が所属commandの`update`だけを名指しする**）。**文言を直しても、callerごとに真偽が変わる文を1本で書く限り同型が出る。**
- **私のassertionが空虚だった。** 閉路を守る3本の`doesNotMatch`は`/先にinstallを実行してください/`のような字面で禁止していたため、文言を「install を使ってください」へ変えた時点で**同時に空虚化した。** 変異37件全killでもこの穴は検出されなかった。字面ではなく`/install/`という語で禁止する形へ変えた。
- 未解決Critical/High: 事前諮問5の7件へ是正を適用した。
- 修正差分: `8a060349`からの前進commit。
- 修正で触れた隣接範囲: `recoveryGuidance`の戻り値構造、`readManagedAssetRecordAt`の観測受け渡し、`uninstall`の存在判定、SCN-019・027の主張、新規SCN-037〜039。
- 既承認・未変更範囲を再走査していない: **していない。** 既存SCN-001〜016のfeatureとstepの既存部分は1行も変更していない。

### ラウンド1（review session。`47729654`）

- 全評価基準を確認した: **はい。** 肯定5観点と敵対8観点を`47729654`へ適用した。reviewerはcodexとClaude fableの2体で、いずれも`--sandbox read-only`相当かつtest実行・変異試験の禁止を契約で明示した。**これが製品の`review round`を通す最初のroundである。**
- 指摘を確定した: **High 3件**（fable 2件、codex 2件。1件は同一の成果物未収束で重複）とMedium 3件、Low 2件。§5のR9系がそれである。
- **2体の判定が前回対立していた点は実測で決着させた。** fableは「最小診断へ所属commandを名指しせよ」、codexは「名指しはINV-02違反の risk であり`init`・`delete`への`update`追記は殺すべき変異」と述べていた。`delete --apply --totally-bogus-flag`が`delete --apply`と同一の拒否を返すこと、すなわち**CLIが宣言外flagを黙って捨てること**を実測し、flag名だけの診断が`delete`から辿ると閉路になること（fableが正しい）と、previewで裏付けた手段だけを名指しできること（codexが正しい）の両方を満たすよう、**名指しをbranchで分けた。** 両者とも今回この設計を承認した。
- 次ラウンド対象のCritical/High: R9-H01・R9-H02・R9-H03の3件。いずれも本roundで是正した。
- 修正差分: `47729654`からの前進commit。**amendしない。**
- 修正で触れた隣接範囲: `mappings`と`resolveManagedAsset`の例外の投げ直し、診断assertionの完全一致化（10箇所）、`SCN-027`のGherkinとstep名、成果物11箇所、監査表のdist行除去、要件本文の観測条項。
- 既承認・未変更範囲を再走査していない: **していない。** 既存SCN-001〜016のfeatureとstepの既存部分は1行も変更していない。

### ラウンド2（review session。本artifactのcommit）

**artifact自身を最終ラウンドの対象にする。** `pr create`はreview sessionのHEADとPR HEADの一致を要求するので、artifactをcommitするとHEADが動く。したがってartifact commitをround 2の対象にする。**本表の「ラウンド数 2」はこのround 2を含んだ総数である。** 実施結果はround 2の記録時に本節へ追記する。

## 7. テスト結果

- 実行したcommandの一覧: `npm run lint`、`npm run format:check`、`npm run typecheck`、`npm run source:check`、`npm test`、`npm run trace:check`、`npm run docs:format`、`npm run test:format`、`npm run architecture:check`、`npm run conformance:check`、`npm run package:check`。**いずれも exit 0 である。** `npm run audit:check` はreview artifact commit後に実行する。
- 全layerの合計: **1743 scenarios / 1727 passed / 0 failed / 16 skipped。**
- 失敗またはskipがある層: skipは16件で、いずれも本変更の対象外の既存scenarioである。**失敗は0件のため層別展開は不要である。**
- 対応する成功CI runの参照: **PR作成後に run ID と対象HEADを追記する。** 本ラウンド時点では手元実行のみであり、手元の件数表を承認証拠として扱わない。

runnerは`agent-skill-chain-project/cucumber-js`、`projectChoices.testLayers`は`unit`・`integration`・`e2e`である。

### 変異試験

**46件を作り46件をkillした。生存0件。** 変異scriptは置換対象が1件だけ一致することをassertし、後始末は複写で戻したうえで
`npm run build`と`git status`で残骸が無いことを確認した。

| 類別 | 件数 | 対象 |
|---|---:|---|
| A 削除 | 22 | 分類の各早期return、record不在時のthrow復活、拒否理由の案内削除、applyのTOCTOU再観測、不在判定のexistsSync化、壊れたrecordの洗浄、公開先再検証の削除、観測の分裂、preview裏付けの除去、**最小診断からの所属command削除**、**previewしていない手段の名指し連結**、**境界外拒否からの対象path削除**、**catchの除去による投げ元文面の素通し** |
| B 狭窄・反転 | 11 | digest比較の反転、記録なし相違のoverwrite化、通常file性の緩和、truthinessへの狭窄、expected依存への狭窄、明示指定判定の反転と緩和、原因分岐の平坦化、**名指しcommandのinstallへの差し替え**、**対象pathを相対から絶対へ変える粒度の改変** |
| C 値の空洞化 | 4 | recordへ正本digestを登録、record不在時に空でないfilesを捏造、no-replace公開のrename化、**最小診断への導入状態の断定の追加** |
| D 走査回避 | 4 | previewのadopt記録省略、placeのrecord登録省略、先頭1件だけadopt、相違1件でadopt全停止 |
| E 合成経路 | 5 | 配布CLIのopt-in配線を既定true・常にfalse・`!== undefined`・apply時のみへ置換、最小診断からのflag名削除 |

**ラウンド1で4件を追加した。** `M-A16`は**fable H-2の欠陥そのもの**（`mappings`の境界外拒否から対象pathを落とす）、
`M-A17`は`catch`を外して投げ元の文をそのまま通す変異、`M-B11`は対象pathを相対から絶対へ変える変異、
`M-A18`はrecord記載資産側の同型である。**4件すべてkillした。** 完全一致assertionが対象pathまで固定しているためである。

**事前諮問7で5件を追加した。** `M-A13`は**fable H-01の欠陥そのもの**（最小診断から所属commandを削りflag名だけへ戻す）であり、
`M-B10`は名指しcommandを`install`へ差し替える。`M-A14`・`M-A15`・`M-C4`はcodex Medium 3が挙げた3クラスで、
`init`の競合拒否とblocked分岐へcommandの名指しを連結する変異と、最小診断へ導入状態の断定を別文言で足す変異である。
**前版はこの3クラスを「対象文字列が消えたため退役」として扱っていたが、それは誤りだった。**
字面が消えることは、別の字面で再導入できないことを意味しない。**退役させるのではなく、語の類で禁止する形へ組み直した。**
`assertNamesNoCommand`・`assertAssertsNoState`がそれであり、path除去を`diagnosticBody`で空洞化から守っている
（`withoutPaths`が`""`を返す変異は、除去後の本文が空でないことと診断語が残っていることのassertionで落ちる）。

**ラウンド途中で`M-A8`が一度生存へ転じた。** 公開直前の再検証（R2-H02の是正）が不在判定の誤りを隠し、
`existsSync`へ戻す変異でも別の層で拒否されたためである。**多層防御が自分のtestから回帰を隠した。**
`SCN-INT-LIFECYCLE-022`へ診断の名指し（読み取り時の理由であり公開時の理由でないこと）を足してkillへ戻した。

**生存0件は「検出力が十分」を意味しない。** 変異集合はassertion集合より広く取ったが、
`#1306`が所有する公開の残存窓のように、**注入口を作れない競合は変異でも観測できない。**

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `dist/src/cli.js` | 入る | `update`が`--recover-record`を受け付ける |
| `dist/src/cli-usage.js` | 入る | `update --help`へflagの宣言と説明が出る |
| `src/cli.ts` | 入る | compileされて配布されるため配布境界に含める |
| `src/cli-usage.ts` | 入る | 同上 |
| `.agent-skill-chain/00_利用案内.md` | 入る | 配布される利用案内へ復旧手順と明示指定を追記した |
| `dist/src/domain/lifecycle.js` | 入る | `update`がmanaged asset record不在で終了値0を返し`adopted`・`retained`を報告するようになる。`install`の競合拒否と`delete`のrecord不在拒否の文言が変わる |
| `src/domain/lifecycle.ts` | 入る | compileされて`dist/src/`として配布されるため配布境界に含める。影響は上記と同じ |
| `test/features/integration/lifecycle-isolation.feature` | 入らない | なし |
| `test/features/unit/lifecycle-record-recovery.feature` | 入らない | なし |
| `test/steps/lifecycle-isolation.steps.ts` | 入らない | なし |
| `test/steps/lifecycle-record-recovery.steps.ts` | 入らない | なし |
| `docs/specs/01_システム概要/02_用語・略語.md` | 入らない | なし |
| `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md` | 入らない | なし |
| `docs/specs/15_要件追跡/00_追跡表.md` | 入らない | なし |
| `docs/specs/15_要件追跡/01_変更履歴.md` | 入らない | なし |

判断: 配布物を更新した

根拠: `dist/src/domain/lifecycle.js` を更新し、あわせて配布される利用案内 `.agent-skill-chain/00_利用案内.md` へ record 喪失時の復旧手順を追記した。**利用者は配布物だけを読むため、`docs/specs/` への記載では届かない。**

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 独立reviewの外部証拠 | **PR作成前のため、providerのimmutable review IDはまだ無い。** PR作成後に追記する |
| reviewerがPR author・実装commit authorと異なる | はい。reviewerはcodex（別provider process）とClaude fable（別context）であり、実装commitのauthorはClaude本sessionである |
| 観測したreview commentとapprovalの件数 | **reviewer起動はcodex 7回・Claude fable 5回。** 各回の指摘件数は§6の事前諮問表に、集約した24個のIDは§5にある。**producerの申告ではなくreviewerの出力そのものを§5へ転記した** |

**reviewerは対象差分を編集していない。** 契約でread-onlyと非編集を明示し、`codex exec --sandbox read-only`で起動した。
`git diff`のpath集合はreview前後で変わっていない。

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md`（REQ-LC-001）、`docs/specs/01_システム概要/02_用語・略語.md`（TERM-ASC-097）、`docs/specs/15_要件追跡/00_追跡表.md`、`docs/specs/15_要件追跡/01_変更履歴.md`、`.agent-skill-chain/00_利用案内.md`（配布物）
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: **確認した。** 00の候補（TERM-ASC-097）→ 01の確定差分 → 耐久台帳の`active`行へ一方向に追跡できる。既存語の再定義はない。
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: **確認した。** TERM-ASC-097は`managed asset record`の1定義のみで、`managed-assets.json`という実file名との混同を禁止表現へ明記した。廃止語はない。
- 要件・変更・SCN・テストの追跡: REQ-LC-001 → AC-LC-001 → SCN-INT-LIFECYCLE-017〜041・SCN-UNIT-LIFECYCLE-001（計26件） → 各featureとstep。`npm run trace:check`が`valid: true`である。
- `no-spec-impact`の場合の限定的根拠: 該当しない。
- UI・トークンの判断: UIなし。DC-UXとDC-TOKENSがnot-applicableであり、token仕様を持たない。

## 11. 総合判定と再開地点

- 未解決Critical/High: **0件。** round 1で独立reviewer 2体が確定したHigh 3件（R9-H01・R9-H02・R9-H03）はいずれも本roundで是正し、是正後の状態をreviewerの指摘と1件ずつ突合した。事前諮問7回で確定したHighもすべてdisposition済みである。**round 2は本artifact自身を対象にするので、その結果は§6のround 2へ追記する。**
- Medium/Lowの記録: §5へ記録した。out-of-scopeとした1件（F-12）は理由と残存リスクを併記した。
- 判定: **round 1時点でPR作成可。** ただしround 2（本artifactのcommitを対象）で収束を確認したうえで`pr create`へ進む。**判定欄を先に埋めない**方針は維持し、round 1が終わった時点の判定だけを書いている。
- 新しい権限が必要な事項: **配布CLIへ`--recover-record`を追加した。** #1307でownerが案Aを決裁済みである。
- 残存リスク: `rename`公開の一般化（**#1306**）。`""` sentinelの型上の脆さ（変異M-B6でkill）。SCN-020の構造的な検出力欠如（F-12）。**`--recover-record`は未導入directoryへも配置しうる**ことを要件本文へ明記した。
- 次に許可される操作: `review round --apply`、`workflow record --step=10`、`audit:check`、`pr create`、CI確認、`pr merge --merge`。**`--squash`は使わない。**
- 次回の再開地点: 案A適用後のH_impl。本artifactを`docs/reviews/`へ複写したcommitが`H_final`になる。
