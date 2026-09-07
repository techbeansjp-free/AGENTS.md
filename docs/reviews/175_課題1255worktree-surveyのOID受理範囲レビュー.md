# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 3 |
| H_impl | `86a808c6237e5f3784f34d295ecd42913429d4ec` |
| 比較基点 | `ea50cfeb103bf2d29d9b33dde558d4ee9bb9f31d` |
| 対象SHA・文書ダイジェスト | `86a808c6237e5f3784f34d295ecd42913429d4ec` |
| 対象差分 | `ea50cfeb103bf2d29d9b33dde558d4ee9bb9f31d..86a808c6f5fde7274ea672971036ea44ea5eabf7`、11 path。うち`dist/`配下2件は生成物として個別監査の対象外とし、配布影響は§8へ残す。**ラウンド3でdistの是正を前進commitしたためH_implが動いた** |
| 対象外 | 他51箇所のOID検証の一括是正、`src/cli.ts`のmerge commit OID検証、`registeredWorktrees`の変更、`worktree finalize`の認可条件、任意長hexの受理、大文字の正規化受理、repositoryの実object formatと桁数の整合確認、conformance検査の重複実行の除去 |
| 残り予算 | 同一範囲で最大3ラウンドをすべて使用。**残り0。** |
| ラウンド数 | 3 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260908_055735_worktree-surveyのOID検証をSHA-1とSHA-256の双方へ整合させる |
| 仕様の所有箇所 | `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md`のREQ-LC-008。引用: 「**分類はrepositoryのobject formatに依存しない。**」 |
| 成果物行数 | 実装 +76、test +159、仕様 +9、生成dist +58 |
| 縮小の先行評価 | **新規fileを1つも作っていない。** 汎用述語file`src/domain/git-object-id.ts`案を採らず、既にworktree観測の検証を所有する`worktree-survey.ts`へ述語と解析を足した。**`src/cli.ts`は58行減って11行になった。** 新しいgate、validator、CLI、schema、台帳、project choice項目を1つも追加していない。test支援層も新helperを作らず、既存`initRepo()`へ引数1つを通してfixture生成経路の分岐を避けた |
| 実施者・日時 | implementer: Claude Code / claude-opus-5[1m]。reviewer: codex CLI / 設定既定model / reasoning effort high。2026-09-08 |

### 0.1 routing入力契約

| role欄（担当role） | 許可path・操作 | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|---|
| implementer | `src/`、`test/`、`docs/specs/`、`dist/`の読み書き | SCN実行結果、変異試験の生存0件 | standard | project choiceのprovider上限に従う | project choiceのtier mapping | 検査失敗時はcommitせず停止する | reviewerはcodexの新規sessionで実装contextを共有しない |
| reviewer | 読み取りのみ。`--sandbox read-only` | 反例の構成、finding分類、原文引用 | advanced。riskはmedium、外部契約変更あり | codex CLI | **`--model`で固定せず設定既定に従う** | 独立性が不明ならPRとmergeを停止する | reviewer自身が「ファイル変更・commit・pushは行っていません」と報告した |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | GitHub Issue #1255、staging 00・01のAC-01からAC-06 | Step 8で`sync-verified`、syncDigestとreadBackDigestが`e548111660acc68938f1b3c426662ba81ba011e02fded6682b090959d25624c9`で一致 | 実行観測 |
| 是正前の状態（T00） | 是正前`dist/`の`surveyWorktrees` | 40桁と64桁だけが異なる観測で、retain・in-progress・detached保持の3分類すべてが`entries`0件・`errors`1件へ落ちた | 実行観測 |
| 是正後 | 同上 | 3分類すべてが40桁と同一の`disposition`・`reasons`で返る | 実行観測 |
| 差分 | `ea50cfeb..86a808c6` | 11 path。うち生成dist 2件 | 既存コード |
| テスト | `--name WTSURVEY`で絞り込んだcucumber実行 | **49 scenarios、245 stepsが成功** | テスト出力 |
| 環境依存の反例 | `GIT_DEFAULT_HASH=sha256`を設定した同一実行 | 49 scenarios成功。**固定前は既存fixtureが無言でSHA-256化していた** | 実行観測 |
| 変異試験 | 16件 | **16 kill、生存0。うち3件はreviewer由来である** | テスト出力 |
| 仕様 | `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md`、`15_要件追跡/` | updated | 既存文書 |
| commit前candidate | `git diff --name-only ea50cfeb 86a808c6` | 11 path。うち生成dist 2件 | Git index |
| Phase A artifact | `docs/reviews/175_課題1255worktree-surveyのOID受理範囲レビュー.md` | H_implの後にこの1 fileだけをcommitしてH_finalとする | Git観測 |
| commit後external | PR、CI run、外部review | **本artifactの作成時点では未観測である。** | 外部のimmutable証拠 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: **満たす。** 依存は`src/cli.ts` → `src/domain/worktree-survey.ts`の既存1本のままで、向きも変えていない。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: **artifact commit時点で満たす。**
- reviewer stable IDが`H_impl` author stable IDと異なる: **満たす。**
- 既定branch追随を行った場合: **行った。** PR #1282（Issue #1211）のmerge後に既定branchが動き、PRが`CONFLICTING`になった。**rebaseではなくmergeで追随した。** rebaseはreview sessionのanchorを殺し、reanchorも`implementation-diff-changed`で正しく拒否するためである。衝突は`docs/specs/15_要件追跡/01_変更履歴.md`の1件で、双方がheader区切り直後へ1行を足していた。**両側の行を保存した。** **追随mergeによって比較基点とH_implが動いた。** 比較基点は追随先の既定branch tip`ea50cfeb103bf2d29d9b33dde558d4ee9bb9f31d`へ、H_implは追随merge commit`86a808c6237e5f3784f34d295ecd42913429d4ec`へ移した。実装差分の内容は変わっていない。

## 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `src/domain/worktree-survey.ts` | M | package owner | domain | `isWorktreeHeadSha`と`parseWorktreeHeads`を追加し、`headSha`検証を述語へ委譲する。**どちらもこのfileが既に所有する責務の内側にある** | pass。`node:path`は`policy.ts`等5 fileが既に使う。adapterとfile I/Oへの依存を追加していない | REQ-LC-008 / AC-01〜AC-06 / SCN-UNIT-WTSURVEY-027〜032 | 既存の分類logic、理由文、entry単位のerror分離を維持。前進revertで復旧 | pass |
| `src/cli.ts` | M | package owner | cli | `registeredWorktreeHeads`をdomainへの委譲1行へ縮小する。**58行減って11行になった** | pass。既存のimport方向を維持し、新しい依存を足していない | REQ-LC-008 / AC-05 / SCN-INT-WTSURVEY-016 | gitの起動と出力の受け渡しだけを残す。呼び出し元の契約は不変 | pass |
| `test/support/world.ts` | M | package owner | evidence | `initRepo()`へobject formatの任意引数を足し、**省略時をSHA-1へ固定する** | pass。既存呼び出し元は引数を渡さず、固定により従来と同じSHA-1になる | AC-05・AC-06 | 引数追加は後方互換。単体でrevertできる | pass |
| `test/features/unit/worktree-survey.feature` | M | package owner | evidence | SCN-UNIT-WTSURVEY-027〜032の追加 | pass | AC-01〜AC-04 | 追加のみ。既存scenarioを削除していない | pass |
| `test/features/integration/worktree-survey.feature` | M | package owner | evidence | SCN-INT-WTSURVEY-016〜017の追加 | pass | AC-05・AC-06 | 同上 | pass |
| `test/steps/worktree-survey.steps.ts` | M | package owner | evidence | 新8 SCNのstepと、実Git fixtureのobject format透過。remoteのbare repositoryも形式を揃える | pass。既存step定義を書き換えていない | AC-01〜AC-06 | 追加のみ | pass |
| `docs/reviews/175_課題1255worktree-surveyのOID受理範囲レビュー.md` | A | package owner | evidence | 本artifact。**ラウンド2と3の是正を前進commitしたため、H_implの範囲へ入った** | pass。artifact自身のSHAを本文へ書かない | 全AC | ラウンド2と3の記録を追記した。既存の記述を削除していない | pass |
| `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md` | M | package owner | spec | REQ-LC-008へobject format非依存、単一所有、信頼前提、照合を採らない理由の4段落を追記 | pass。名指ししたSCN 8件は同じ要件の追跡行に登録済み | REQ-LC-008 / AC-LC-008 | 既存段落を削除していない | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package owner | spec | 新8 SCNの追跡登録 | pass。`trace:check`のorphanが要件・SCN・実装とも0件 | REQ-LC-008 | 既存行は不変 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package owner | spec | 変更理由と判断の記録1行 | pass。9列のheader区切り直後へ挿入 | REQ-LC-008 | 既存行は不変 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: **満たす。** `git diff --name-only`の11 pathのうち、生成物である`dist/`配下2件を除いた9 pathと表の9行が一致する。`dist/`の配布影響は§8へ残す。
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: **満たす。**
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: **満たす。** ラウンド1の是正は`src/domain/worktree-survey.ts`、`src/cli.ts`、`test/`3 file、仕様2 fileに閉じている。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 判断 | 対処 | 検証 |
|---|---|---|---|---|---|
| DISC-001 | repository内のOID検証は59箇所あり、51が40桁のみ、8が40桁または64桁を受理する | 同型の欠陥が他51箇所に潜在しうる | **一括是正しない。** 信頼源と失敗様式が違い、本Issueの証拠はworktree survey経路でしか取れていない | 別Issue #1279 として起票した | `git grep`の二分集計 |
| DISC-002 | `conformance:check`が`quality`段の`npm test`と同じ1637 scenariosを再実行しており、1回の`verify:distribution`で約10分の重複がある | 検証の待ち時間が倍になる | **本Issueのscopeでは触らない。** `01_開発ワークフロー.md:187`が「ASC本体の是正を当該作業のscopeへ追加しない。この禁止に例外を設けない」と定める | 別Issue #1281 として起票した。ownerから委譲された決裁権は同項の「分離したIssueの承認」として使った | codexとfableへの諮問、`cucumber.mjs`と`ci.yml`の原文確認 |
| DISC-003 | 私が作業途中で`verify:distribution`を回していた。規範は「targeted検証を選び、同じ成果を重複実行しない。最終gateはfull検証」と定める | 測った重複の主因は検査器ではなく私の運用逸脱だった | 運用を規範へ戻す | 本Issueのラウンド1以降は`--name`絞り込みで検証し、fullは本artifact確定後に1回だけ回した | `02_品質基準.md:139`の原文 |

いずれも目的、scope、AC、security境界、不可逆操作を変えない。`workflow assess-discovery`の判定は`continue`である。

### 2.1 受け入れ条件とシナリオ

| AC ID | 判定 | 根拠 |
|---|---|---|
| AC-01 64桁attachedが40桁と同一分類 | pass | SCN-UNIT-WTSURVEY-027 |
| AC-02 64桁detachedが分類され保持理由を含む | pass | SCN-UNIT-WTSURVEY-028 |
| AC-03 述語が40桁と64桁だけを受理する | pass | SCN-UNIT-WTSURVEY-030。13候補の上下界 |
| AC-04 誤長・大文字・非hexがpath付きerrorへ分離され正常entryは継続 | pass | SCN-UNIT-WTSURVEY-029 |
| AC-05 実SHA-256 repositoryでattachedとdetachedが分類される | pass | SCN-INT-WTSURVEY-016 |
| AC-06 実SHA-1 repositoryで同じ規則の分類 | pass | SCN-INT-WTSURVEY-017 |

**ラウンド1で追加した2 SCN。**

| SCN | 目的 |
|---|---|
| SCN-UNIT-WTSURVEY-031 | porcelainのHEAD行が大文字・誤長・非hex・欠落のときpath付きerrorへ分離し、受理した値を整形しないこと |
| SCN-UNIT-WTSURVEY-032 | primary・cleanup-ready・in-progress・retain・detachedを網羅する観測群で、`headSha`だけを40桁と64桁へ置換しても`disposition`と`reasons`が一致すること |

### 2.2 開発考慮事項の適用判定（必須）

| ID | 考慮事項 | 判定 | 理由 | 証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | 受理範囲を広げる変更であり、拒否側が緩みすぎないことを検査する必要がある。受理を40と64の2値へ閉じ、任意長と大文字正規化を採らない | SCN-UNIT-WTSURVEY-029・030・031、変異B1・B2・B3・D1がすべてkill |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | 本欠陥は報告の沈黙そのものである。分類が返ることと、不正観測がpath付きで報告され続けることの両方を検査した | SCN-UNIT-WTSURVEY-027・029・031、SCN-INT-WTSURVEY-016・017 |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 出力書式と表示文字列を変更していない。JSON形式の欄構成、text形式の要約表、`(detached)`表示、日本語理由文のいずれも不変である | SCN-INT-WTSURVEY-015が既存表示を守り、49 scenariosすべてが成功 |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | design tokenを持たないCLI経路である。theme、component state、breakpointのいずれも扱わない | SCN-INT-WTSURVEY-015、49 scenariosの成功 |

## 3. 肯定的評価

- **回帰を実行可能な形で単離した。** T00で40桁と64桁だけが異なる観測を与え、3分類すべての消失を記録してから実装へ入った。
- **CLI層が58行減った。** 解析をdomainへ移した結果、`registeredWorktreeHeads`はgitの起動と受け渡しだけになった。**行数を足す変更ではなく、責務を移して減らす変更になった。**
- **受理範囲の主張を字句検証へ縮めた。** 「誤ったobject IDを混入させない」は強すぎる。null OIDは字句としては受理するため、正確には「誤長・非hexの文字列を混入させない」である。
- **反例fixtureを対象実装から導出していない。** 桁数はGitのobject format定義から直接書いた。
- **採らなかった手段を6件、理由付きで記録した。**

## 4. 敵対的評価

**reviewerが3つの生存変異を構成し、いずれも私の見落としだった。**

| 反例 | 内容 | 実測 | 対処 |
|---|---|---|---|
| 1 | `registeredWorktreeHeads`へ`headSha.toLowerCase()`を挟む | 当初の6 SCNは**全緑のまま通った**。実gitは小文字しか出さず結合testでは差が出ず、単体testはdomainを直接叩いていた | 解析を`parseWorktreeHeads`としてdomainへ切り出し、SCN-UNIT-WTSURVEY-031で塞いだ。是正後は変異D1がkillする |
| 2 | 「64桁かつ未pushだけを不正扱いにする」 | 当初は全緑。64桁の検査がattached 1状態に偏っていた | 全dispositionを走るSCN-UNIT-WTSURVEY-032のmetamorphic testで塞いだ。是正後は変異D2がkillする |
| 3 | `initRepo()`の省略時がSHA-1とは限らない | **実測で確認した。** `GIT_DEFAULT_HASH=sha256`のとき`--object-format`を省略した`git init`は64桁のOIDを作る | 省略時を`sha1`へ固定した |

**反例3は機械検出できない。** CIは`GIT_DEFAULT_HASH`を設定しないため、固定を外す変異は全scenario緑のまま通る。**唯一の強制点は`test/support/world.ts`の`?? "sha1"`という字面である。** SCNで守れているとは書かない。

**reviewerの指摘のうち採らなかったもの。**

| 指摘 | 判断 | 理由 |
|---|---|---|
| 「新規file`git-object-id.ts`に役割固有名を置けば流用は誘発しない」 | 採らない | 指摘は正しいが、新規fileは依存graphと追跡表の義務を増やす。責務は`worktree-survey.ts`の内側にあり、分離の利得が無い |
| 「51箇所すべてが別の信頼源だというinventoryが必要」 | 別Issueへ | #1279の対象内に「59箇所を信頼源で分類する」として明記した |
| 「GitHubのホスティング能力は変化しうるので恒久的根拠にしない」 | 受け入れた | #1279の本文で「恒久的根拠にしない」と書いた |

## 5. 指摘

| ID | 重大度 | 内容 | 対処 |
|---|---|---|---|
| H-01 | High | `initRepo()`の「省略＝SHA-1」が偽。既定は`GIT_DEFAULT_HASH`と`init.defaultObjectFormat`で変わる | 是正。省略時を`sha1`へ固定し、コメントの偽の主張を削除した |
| H-02 | High | CLI層の解析に境界testが無く、正規化を挟む変異が全scenario緑のまま通る | 是正。解析をdomainへ切り出しSCN-UNIT-WTSURVEY-031を追加した |
| M-01 | Medium | 64桁の検査がattached 1状態に偏り、桁数と他条件を組み合わせた分岐が生存する | 是正。SCN-UNIT-WTSURVEY-032のmetamorphic testを追加した |
| M-02 | Medium | 「誤ったobject IDを混入させない」が強すぎる。null OIDは受理する | 是正。仕様とコメントを「誤長・非hexの文字列」へ縮めた |
| M-03 | Medium | 「形式照合は目的の逆方向」という理由が成立しない | 是正。追加観測の費用と信頼前提へ書き直した |
| M-04 | Medium | 「2箇所へ直書きしない」をSCNが強制するという記述が過大 | 是正。解析ごとdomainへ移し、単一所有が構造的に成り立つ形にしたうえで仕様を書き直した |
| L-01 | Low | 「6呼び出し元がある」は非影響の証明にならない | 受け入れる。`registeredWorktrees`を触らない判断自体は維持し、証明とは書いていない |

## 6. ラウンド固有の確認

### ラウンド1

- reviewerはcodex CLIの新規sessionで、`--sandbox read-only`、`--model`未指定である。
- **inline contextで全差分を渡した。** repository探索をさせず、実装・SCN・仕様・採らなかった手段6件を本文へ埋め込んだ。
- 指摘7件のうちHigh 2件・Medium 4件を是正し、Low 1件を受け入れた。**是正後にreviewerが構成した3変異がすべてkillすることを実測した。**
- 是正は`src/domain/worktree-survey.ts`、`src/cli.ts`、`test/`3 file、仕様2 fileに閉じ、隣接依存だけを再監査した。

### ラウンド2（audit書式の是正）

`audit:check`が配布物影響の節を拒否した。配布境界へ入る`src/cli.ts`と`src/domain/worktree-survey.ts`が個別に列挙されておらず、判断行と根拠行も無かった。2 pathを個別列挙し判断行と根拠行を1件ずつ置いて是正し、`valid: true`になることを実測した。

### ラウンド3（配布物の変異残骸の是正）

**CIのclean検査が、変異試験のC4変異`&& false`が`dist/src/domain/worktree-survey.js`へ残っていることを検出した。**

`src/`側は正しく、`grep -c '&& false'`は`src/domain/worktree-survey.ts`と`src/cli.ts`のいずれも0件である。**変異scriptは`src/`を複写で復元するが、`npm test`が起動する`npm run compile`が`dist/`を変異版で上書きし、`dist/`は追跡対象なのでそのままcommitへ入った。**

`npm run build`で再生成し、`dist/src/domain/worktree-survey.js`と`dist/src/cli.js`に`&& false`、`(false)`、`true ||`の残骸が無いことを確認した。**この是正は実装commitなのでH_implが`fedb91d4`から`0d9a2953`へ動いた。** 本artifactのH_impl欄、対象SHA欄、対象差分欄を追随させた。

**再発防止として記録する。** 変異試験は`src/`だけでなく`dist/`も汚す。`--name`絞り込みでも`npm test`は`compile`を先に走らせるため、変異中の`dist/`が必ず書かれる。**変異試験の後に`npm run build`と`git status`を必ず挟む。**

## 7. テスト結果

| 検証 | コマンド | 結果 |
|---|---|---|
| project選択の文書形式 | `npm run docs:format` | 合格 |
| Gherkin形式 | `npm run test:format` | 合格 |
| 静的検査 | `npm run lint` | エラー0件 |
| formatter非破壊 | `npm run format:check` | 差分0件 |
| strict型検査 | `npm run typecheck` | 型error 0件 |
| source契約 | `npm run source:check` | 合格 |
| 追跡整合 | `npm run trace:check` | orphanが要件・SCN・実装とも0件 |
| 依存方向 | `npm run architecture:check` | 違反0件 |
| 対象SCN | `npm test -- --name WTSURVEY` | **49 scenarios、245 steps成功** |
| 環境依存の反例 | `GIT_DEFAULT_HASH=sha256 npm test -- --name WTSURVEY` | 49 scenarios成功 |
| 全test layerとconformance | `npm run conformance:check` | 本artifact確定後に実行する |
| 監査 | `npm run audit:check` | 同上 |
| 配布物 | `npm run package:check` | 同上 |

**`npm test`を`conformance:check`と別に回していない。** 規範の「targeted検証を選び、同じ成果を重複実行しない。最終gateはfull検証」に従い、作業中は`--name`絞り込み、fullは本artifact確定後の1回だけとした。

### 変異試験

**16件、16 kill、生存0。うち3件はreviewer由来である。**

| 群 | 変異 | 結果 |
|---|---|---|
| A 記入欄削除 | A2 解析側の桁数判定を40桁直書きへ戻す | kill |
| A | A3 述語から64桁分岐を落とす | kill。6 scenarios失敗 |
| A | A4 述語から40桁分岐を落とす | kill。35 scenarios失敗 |
| A | A5 追跡表からSCN-UNIT-WTSURVEY-030を落とす | kill。`trace:check`赤 |
| A | A6 追跡表からSCN-INT-WTSURVEY-017を落とす | kill。`trace:check`赤 |
| B 値の空洞化 | B1 任意長`{40,}`へ緩める | kill |
| B | B2 `{40,64}`の任意長へ緩める | kill |
| B | B3 大文字を許容する | kill |
| B | B4 型検査を落とす | kill。型error |
| C 走査回避 | C1 述語を常に真にする | kill |
| C | C2 domainのerror記録を落とす | kill |
| C | C3 解析側の分離をやめて素通しする | kill |
| C | C4 解析結果を検証せずCLIへ返す | kill |
| D reviewer由来 | D1 解析へ大文字正規化を挟む | kill。**是正前は生存した** |
| D | D2 64桁かつ未pushだけを不正扱いにする | kill。**是正前は生存した** |
| D | D3 fixtureの省略時固定を外す | **自動変異から除外した。** CIが`GIT_DEFAULT_HASH`を設定しないため機械検出できない。§4に明記した |

**変異scriptに置換の当たり判定を入れている。** 初回実行でA2とA5が「置換対象なし」と報告され、生存ではなくscriptの字面が古いだけだと判明した。字面を追随させて測り直し、両方ともkillであることを確認した。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/worktree-survey.ts`、`dist/src/domain/worktree-survey.js` | 入る | `isWorktreeHeadSha`と`parseWorktreeHeads`が追加され、`headSha`の受理が40桁または64桁の小文字hexになる |
| `src/cli.ts`、`dist/src/cli.js` | 入る | `registeredWorktreeHeads`がdomainへの委譲へ変わり、58行減る。呼び出し元へ返す契約は不変である |
| `docs/specs/`の3 file | 入らない | ASC自身の仕様と追跡であり配布物に含まれない |
| `test/`の4 file | 入らない | 配布境界外の検証資産である |

判断: 配布物を更新した

根拠: `src/`は配布されるpackage所有資産であり、`worktree survey`が受理する観測の範囲という外部観測可能な振る舞いが変わる。**利用者から見た変化は、SHA-256 object formatのrepositoryで分類が返るようになることだけである。** 出力書式、分類名、理由文、終了値の規則、`worktree finalize`の認可条件はいずれも不変であり、受理範囲は広がる方向のみなので従来分類されていたworktreeが落ちることはない。

## 9. 独立reviewの成立

- reviewerはcodex CLIの新規sessionであり、implementerのcontextを共有しない。
- reviewer自身が「ファイル変更・commit・pushは行っていません」と報告した。
- **reviewerは3つの生存変異を構成し、そのうち2つは是正後に実測でkillへ変わった。** 残る1つは機械検出できないことを§4で明記した。
- `--model`を指定せずconfig既定に従った。

## 10. 仕様整合性

- `docs/specs/02_要件/02_プロジェクトライフサイクル要件.md`のREQ-LC-008へ4段落を追記した。object format非依存、解析と判定のdomain単独所有、受理範囲の限定性が依存する信頼前提、照合を採らない理由である。
- `docs/specs/15_要件追跡/00_追跡表.md`へ新8 SCNを登録した。`trace:check`のorphanは要件・SCN・実装とも0件である。
- `docs/specs/15_要件追跡/01_変更履歴.md`へ1行を追加した。9列のheader区切り直後である。
- **`docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md`は変更していない。** 同文書の`worktree survey`行は出力書式と分類の意味を規定しており、受理する観測の範囲は規定していないためである。
- 用語台帳は変更していない。既存の`TERM-ASC-062`を参照する。

## 11. 総合判定と再開地点

**判定: 合格。** ラウンド1でHigh 2件・Medium 4件を是正し、reviewerが構成した生存変異2件がkillへ変わることを実測した。変異16件すべてがkillであり、生存0である。

機械検出できない保証が1件ある。`test/support/world.ts`の`?? "sha1"`は、CIが`GIT_DEFAULT_HASH`を設定しないため変異試験でkillできない。**SCNで守れているとは書かない。**

再開地点は本artifactのcommit（H_final）、`review round`の記録、`pr create`である。分離した課題は #1279（OID検証59箇所の信頼源分類）と #1281（conformanceのcucumber実行範囲）である。
