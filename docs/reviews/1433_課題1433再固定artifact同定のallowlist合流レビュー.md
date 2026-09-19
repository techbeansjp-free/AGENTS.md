# 04 レビュー

> 肯定と敵対の両観点を毎ラウンド確認する。指摘なしの承認は有効。Medium/Lowは記録するだけで、自動修正・追加ラウンド・ゲート停止を起こさない。用語と責務の境界は`成果物用語と責務境界`（`.agent-skill-chain/docs/01_開発ワークフロー.md`）を正本とする。
>
> 埋めた成果物は`docs/reviews/`または`.agent-skill-chain/reviews/`へ置き、実装commitの後にその1 fileだけをcommitする。

| 読者 | 読む節 |
|---|---|
| 発注・評価する人 | 要約 → §5 指摘 → §11 総合判定 |
| 実装・レビューする人 | 全節 |
| 運用する人 | 要約 → §8 配布物影響 → §10 仕様整合性 |

## 要約

**この5行だけで、何を見たreviewかが分かるように書く。** 各行は1〜2文。詳細は対応する節が持つ。

| 項目 | 内容 |
|---|---|
| 何が問題だったか | `pr reanchor`がreview artifactの同定にASC自repoの運用慣習を使っており、正本が許す配置と命名を選んだ利用projectでは`pr-bound`後の正当な是正の後に`pr merge`へ到達する手段が恒久的に失われていた。報告2件はいずれもASC外の`gh pr merge`へ迂回しており、delivery認可の強制点が無効化されていた |
| 何を解決しようとしたか | 再固定の3経路すべてが正本のevidence-only allowlistでreview artifactを同定し、file名の字面を受理条件にしない状態。他の受理条件は1つも弱めない |
| 何を行ったか | adapter固有の`REVIEW_ARTIFACT_PREFIX`と`REVIEW_ARTIFACT_NAME`を削除して`src/domain/review.ts`の`isEvidenceOnlyPath`へ合流させ、正本・要件・CLI契約・用語台帳・Step 11 skillから「正規命名」を除いてTERM-ASC-101参照にし、**round 2で新`H_final`のmode/type検証を既存の`evidenceOnlySuffix`の再利用として足した。** SCN-UNIT-REANCHOR-033〜040とSCN-INT-REANCHOR-016〜018を追加した |
| 何を確認したか | 実装前に新規11 scenario中7件が落ちること、実装後に`@evidence-reanchor` 80件と`npm test` 2179件が失敗0で通ること、変異6件がすべてkillされること、T01とT02の各commitが独立に逆適用できることを実測した。**round 2では外部reviewer2体へ独立にセルフレビューを委譲し、codexのHigh 1件を実測で裏付けて是正した** |
| 判定 | approved |
| round 3の追加 | round 2で自分が入れた誤記（`cli.ts:1454`を`pr create`のselectorと誤認）を訂正した。判定logicは不変。外部reviewerが別Issueと判定した2件はIssue #1436・#1437として分離した |

## 1. 入力証拠

PR番号、Actions run ID、immutable review IDはPR作成後にしか存在しないため**この文書へ書かない。** `review evidence`とdelivery stateがappend-onlyで保持する。reviewerの独立性は`merge.reviewIndependence`が決める。既定の`context-isolated`はimplementerと別session/context、exact HEAD固定、対象差分の非変更、肯定・敵対reviewとfinding記録を要求し、同一GitHub actorでも成立する。このときtracked artifactの`approved`と保存済みreview session・Step 10 bindingがformal approvalになる。`actor-independent`はPR authorおよび観測済み`H_impl` commit authorと別のstable actor IDによるprovider `APPROVED`を要求する。両modeともexact HEAD一致は必須とし、tracked文書へ自身のcommit SHAを書かず、**H_final後はartifactを更新しない。**

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | .agent-skill-chain/tmp/issues/20260919_232451_bugfix-pr-reanchorのreview-artifact同定が正本のevidence-only-allowlistと食い違う | staging digest 20cb46e24753e04982ce767ecf2cdff51066db2cd3197593f7de142bc9a53a16 | 既存コード |
| 差分 | `5f7f1c53c873f0c50d9b66f2ac30bfe47ec18b92`..`df5e898df5fce05c173f95bbc3457b2eb58df84b` | 18 path | 既存コード |
| テスト | §7のcommand一覧 | `npm test` 2174 scenarios（2158 passed・16 skipped・失敗0）。`@evidence-reanchor` 76件全pass。変異6件すべてkill・生存0件 | テスト出力 |
| 仕様 | `docs/specs/02_要件/01_ワークフロー要件.md`のREQ-WF-005、`06_外部インターフェース/01_コマンド・GitHub契約.md`、`01_システム概要/02_用語・略語.md`のTERM-ASC-084、`15_要件追跡/`の追跡表と変更履歴 | updated。`npm run trace:check`のorphanが3種とも0件 | 既存文書 |
| commit前candidate | .agent-skill-chain/docs/01_開発ワークフロー.md、.agent-skill-chain/skills/step-11-pr/SKILL.md、dist/src/adapters/evidence-reanchor.js、dist/src/adapters/review-diff.js、dist/src/adapters/review-session.js、docs/reviews/1433_課題1433再固定artifact同定のallowlist合流レビュー.md、docs/specs/01_システム概要/02_用語・略語.md、docs/specs/02_要件/01_ワークフロー要件.md、docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md、docs/specs/15_要件追跡/00_追跡表.md、docs/specs/15_要件追跡/01_変更履歴.md、src/adapters/evidence-reanchor.ts、src/adapters/review-diff.ts、src/adapters/review-session.ts、test/features/integration/evidence-reanchor.feature、test/features/unit/evidence-reanchor.feature、test/steps/evidence-reanchor.steps.ts、test/steps/review-progress.steps.ts | H_impl df5e898df5fce05c173f95bbc3457b2eb58df84b | Git index |
| Phase A artifact | 本fileをcommit後に観測 | 未作成 | Git観測 |
| review session | .agent-skill-chain/tmp/issues/20260919_232451_bugfix-pr-reanchorのreview-artifact同定が正本のevidence-only-allowlistと食い違う | 未開始 | Git観測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: はい。本変更が足す辺は`adapters/evidence-reanchor` → `domain/review`の1本だけで、`review-session.ts`と`review-record-layer.ts`が既に持つ向きと同じである。逆向きの辺を作らず`npm run architecture:check`が循環0件を返した。本文書へ自身のcommit SHAを書いていない
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: はい。`H_impl`は`d6f83ba51d5799cddfe686394c8e54e3b58cca15`で、`H_final`は本file 1件だけを加えたcommitである。`npm run audit:check`で検証する
- reviewerの独立性が要求水準を満たす: はい。§9に観測値を記録した
- 既定branch追随を行った場合、取り込みがartifact commitより前にあり、`比較基点`が取り込んだ既定branch tip、`H_impl`がartifact直前の最新commitを指し、個別監査表を`比較基点..H_impl`から再生成した: 該当なし。worktree作成後に既定branchは動いておらず、追随mergeを行っていない。`比較基点`はworktree作成時の`origin/main`と同一である

### 1.1 変更ファイル個別監査

基準SHAとの差分にある全ファイルを、生成物（`dist/`等）も含めて1ファイル1行で記録する。まとめ行、directory単位の一括承認、test成功だけの代替を認めない。`audit:check`の他の検査対象外となる生成物でも、各行へ生成元との対応確認方法と配布影響の確認方法を記録し、差分path集合と表のpath集合を一致させる。

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/docs/01_開発ワークフロー.md` | M | package owner | docs | 配布する規範文書。artifact-replacement条項の1行だけを変更し「正規命名」をevidence-only配置へ置き換えた | 文書。循環なし | FR-05 / AC-1433-09 | 1行の置換でrevert可能 | pass |
| `.agent-skill-chain/skills/step-11-pr/SKILL.md` | M | package owner | docs | 配布するStep 11 skill。規範文書と同じ条項の1行だけを揃えた。条件と手順の正本は規範文書であり複写しない | 文書。循環なし | FR-05 / AC-1433-09 | 1行の置換でrevert可能 | pass |
| `dist/src/adapters/evidence-reanchor.js` | M | package owner | 生成物 | `src/adapters/evidence-reanchor.ts`のbuild結果。`npm run build`後に`git status`がcleanであることで生成元との対応を確認した | 生成元 → 生成物 | FR-01〜FR-04 / SCN-UNIT-REANCHOR-033〜040 | §8の配布物影響表とpackage filesで確認。revert可能 | pass |
| `dist/src/adapters/review-diff.js` | M | package owner | 生成物 | `src/adapters/review-diff.ts`のbuild結果。`npm run build`後に`git status`がcleanであることで生成元との対応を確認した | 生成元 → 生成物 | AC-1433-12 / SCN-UNIT-REANCHOR-039・040 | §8の配布物影響表とpackage filesで確認。`npm run package:check`が違反0件。revert可能 | pass |
| `dist/src/adapters/review-session.js` | M | package owner | 生成物 | `src/adapters/review-session.ts`のbuild結果。`npm run build`後に`git status`がcleanであることで生成元との対応を確認した | 生成元 → 生成物 | AC-1433-12 / SCN-UNIT-REANCHOR-039・040 | §8の配布物影響表とpackage filesで確認。`npm run package:check`が違反0件。revert可能 | pass |
| `docs/reviews/1433_課題1433再固定artifact同定のallowlist合流レビュー.md` | A | package owner | evidence | **本file自身。** round 1の`H_final`がround 2の`比較基点..H_impl`へ入ったため監査対象になる。round 1時点の内容がここで追加として記録され、round 2の更新は`H_impl..H_final`のevidence-only suffixとして載る | evidence。循環なし。本文へ自身のcommit SHAを書いていない | 全AC / `npm run audit:check` | artifact 1 fileの追加であり実装へ影響しない。revert可能 | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | package owner | docs/specs | TERM-ASC-084の成立例から「正規名」を除きTERM-ASC-101参照にし、禁止表現欄へ3語を明記した。新規用語を追加していない | spec → src（許可された向き） | FR-05 / AC-1433-09 | 1行の置換でrevert可能 | pass |
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | package owner | docs/specs | REQ-WF-005から「正規命名」「非正規名」を除き、同定規則の段落を1つ足して強制SCNを名指しした。round 2でmode/type要求と述語共有範囲の訂正を同段落へ追記した | spec → src（許可された向き） | FR-01〜FR-05、AC-1433-12 / SCN-UNIT-REANCHOR-033〜040、SCN-INT-REANCHOR-016〜018 | 段落単位でrevert可能 | pass |
| `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | M | package owner | docs/specs | `pr reanchor`行の「正規命名artifact」をevidence-only allowlist配下へ直した。他のcommand行に触れていない | spec → src（許可された向き） | FR-05 / AC-1433-09 | 1行の置換でrevert可能 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | package owner | docs/specs | 新規SCNの追跡行2件を追加し、round 2でSCN-039・040とreview-diff.tsを同じ行へ足した。既存行を書き換えていない | spec → src（許可された向き） | 全AC / `npm run trace:check` | 2行の削除でrevert可能 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | package owner | docs/specs | header区切りの直後へ1行追加。末尾の8列移行表へ入れていない。過去の履歴行を書き換えていない。round 2で同じ行の互換性欄を狭まり3つの列挙へ直した | spec → src（許可された向き） | 全AC | 1行の削除でrevert可能 | pass |
| `src/adapters/evidence-reanchor.ts` | M | package owner | adapter | review artifact同定の1責務を`domain/review.ts`の`isEvidenceOnlyPath`へ委ね、adapter固有の定数2件を削除した。round 2で新head側のmode/type検証を`evidenceOnlySuffix`の再利用として足した | adapter → domain と adapter → adapter（葉）の既存の向きのみ。`architecture:check`で循環0件 | FR-01〜FR-04、AC-1433-12 / SCN-UNIT-REANCHOR-033〜040 | T01とT02が独立commitで、`git apply --check -R`により各々単独で逆適用可能 | pass |
| `src/adapters/review-diff.ts` | M | package owner | adapter | `evidenceOnlySuffix`の移設先。`node:crypto`と`lib/process`だけに依存する葉であり、`review-session.ts`と`evidence-reanchor.ts`の双方が既にimportしている。**定義は1つのまま循環を作らない** | `domain/review.js`への依存を1本追加。逆向きなし | AC-1433-12 / SCN-UNIT-REANCHOR-039・040 | 関数の移設であり判定logicを変えていない。revert可能 | pass |
| `src/adapters/review-session.ts` | M | package owner | adapter | `evidenceOnlySuffix`の移設元。未使用になった`isEvidenceOnlyPath`のimportを外し、`review-diff.js`から取り込む。**判定logicを変えていない** | 既存の向きのみ | AC-1433-12 | 同上 | pass |
| `test/features/integration/evidence-reanchor.feature` | M | package owner | test | SCN-INT-REANCHOR-016〜018を追加。既存scenarioのIDとassertionを変更していない。SCN-1377-01のGiven文言のみ禁止表現を除いた | test → 対象（許可された向き） | AC-1433-06〜08 | 追加行の削除でrevert可能 | pass |
| `test/features/unit/evidence-reanchor.feature` | M | package owner | test | SCN-UNIT-REANCHOR-033〜040を追加。既存32 scenarioを1件も変更していない | test → 対象（許可された向き） | AC-1433-01〜05、10〜12 | 追加行の削除でrevert可能 | pass |
| `test/steps/evidence-reanchor.steps.ts` | M | package owner | test | 配置variantの表とGiven 5件、Then 1件、mode不正fixture 1件を追加し、既存fixture 2件を配置引数でparameterizeした。既定引数により既存の呼び出し結果は変わらない | test → 対象（許可された向き） | AC-1433-01〜08、10〜12 | 追加行の削除と既定引数の除去でrevert可能 | pass |
| `test/steps/review-progress.steps.ts` | M | package owner | test | `evidenceOnlySuffix`のimport元を移設先の`review-diff.js`へ付け替えた1行のみ。**検証内容を変えていない** | test → 対象（許可された向き） | AC-1433-12 | 1行の置換でrevert可能 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: はい。`git diff --numstat 5f7f1c53..d6f83ba5`が返す12 pathと表の12行が一致する。まとめ行と「同上」を使っていない
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: はい。**本変更はその混入そのものを取り除くものである。** ASC自repoの命名慣習と`docs/reviews/`単独のdirectory集合という2つのproject固有値が、配布される`src/adapters/evidence-reanchor.ts`へ入り込んでいた。削除後、同定規則はpackage層の`domain/review.ts`だけが持つ
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: 個別findingは0件

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

発見IDは実装計画（fullは03、quick/pocは集約00）の`DISC-*`と同じ字面を使い、本文書内で別IDへ言い換えない。

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1433-01 | `verifiedImplementationBoundary`はpathだけを照合しmodeとtypeを検証しない。TERM-ASC-101はmode `100644`の通常fileを要求する | 到達可能な穴ではない。artifact本文は`git show <sha>:<path>`で読むため、symlinkはlink先文字列、gitlinkはsubmodule表示文字列が返り、構造検証とidentity anchorとapprovalのいずれも通過しない | なし | 本Issueの対象外とし03へ記録。多層防御の追加であり、強制点の追加はowner決裁事項 | `readBlobAtCommit`の実装読解と`validateReviewArtifactStructure`の要求項目 | no-spec-impact | pass |
| DISC-1433-02 | `issue sync`の`bodySha256`と`issue read`の`bodySha256`が一致しない。前者は末尾改行を除いたsha256、後者は本文そのもののsha256 | Step 4・8のevidenceへどちらを書くか一意に決まらない | なし | 本Issueの対象外。既にIssue #1396として起票済み。読み戻し値を採用し両方を記録した | 3通りのsha256を計測し、末尾改行を除いた値だけがpreview値と一致することを確認 | no-spec-impact | pass |
| DISC-1433-03 | 本変更は一方向の緩和ではない。gitは`docs/reviews/a\b.md`と制御文字入りpathを保持でき、旧実装のrebase経路はそれを受理していた | 01のINV-03と§11の互換性記述が事実に反していた | domain-invariant、interface | INV-05を追加しINV-03をallowlist内側へ限定。互換性記述を緩和と狭まりへ書き分け、AC-1433-10と反例Examplesを追加 | 一時repositoryで両pathをcommitし`git ls-files`で保持を確認。実装前のSCN-UNIT-REANCHOR-036が2件「拒否されていません」で落ちた | updated | pass |
| DISC-1433-04 | 削除した定数のコメントが参照する`AUDIT_DIRECTORY`は実在しない。2026-09-17のIssue #1416（`bf29f306`）で`AUDIT_DIRECTORIES`へ改名され値も2 prefixへ広げられていた | 00 §2.2の対象外理由が事実と異なっていた。同じ狭さがadapter側にだけ取り残されていた | なし | 00 §2.2を事実へ直した。`scripts/check_file_audit.ts`は変更不要 | `grep -n AUDIT_DIR scripts/check_file_audit.ts`と`git log -S`による改名commitの特定 | no-spec-impact | pass |
| DISC-1433-05 | 「層ごとの固定済みanchorを耐久stateから導出する。」のJSDocが`resolveAnchor`から500行以上離れて孤立している。本変更より前から孤立していた | 定数削除により差分上は本変更が孤立を作ったように見える。判定と振る舞いに影響しない | なし | 本Issueでは移動しない。由来が本変更でないことを記録する | `git show HEAD:src/adapters/evidence-reanchor.ts`の146〜155行と現行`resolveAnchor`の行番号の突合 | no-spec-impact | pass |
| DISC-1433-08 | 再固定が新`H_final`のmodeとtypeを検証しない。mode `100755`のMarkdownは通常fileなので本文が読め、全構造検査を通過する。DISC-1433-01の反例列挙が`100755`を落としていた | 再固定後は`assertConvergedReviewSession`のsuffix検査も素通りするため、再固定がこの形を確かめる唯一の地点。REQ-WF-005が要求する「監査合格済みevidence-only suffix」と実装が食い違う | requirement、interface | `evidenceOnlySuffix`を葉module`review-diff.ts`へ移し新head側だけへ適用。INV-07・AC-1433-12・SCN-039/040 | 検査を消す変異Dで実行権限2例が落ちること、`architecture:check`の循環0件、`npm test` 2179件失敗0 | updated | pass |
| DISC-1433-09 | `terminalArtifactPath`が`比較基点..head`の全域へ適用されるため、実装差分が`.agent-skill-chain/reviews/`配下を触るrepoでは候補2件となり拒否する | INV-05と変更履歴が第2の狭まりを記述していなかった。仕様とは整合しており製品の是正は不要 | なし | INV-06として明示し互換性欄を狭まり3つの列挙へ直した。**製品を変更しない** | `evidence-reanchor.ts`の296・297・472・473行と`observeReanchorDiff`の引数の読解 | updated | pass |
| DISC-1433-07 | 製品側で削除した`REVIEW_ARTIFACT_NAME`と同一のregexが`scripts/check_file_audit.ts:32`の`AUDIT_NAME_PATTERN`にもある。`docs/reviews/1425_レビュー.md`は命名規則違反として過去に削除されていた | 本reviewの成果物を製品既定出力名にしたところ`audit:check`が拒否した。製品側regexの出所が本repo運用scriptであることが確定した | なし | 運用scriptを変更せず、本fileを本repoの規約名へ改名しStep 10のartifact pathを再記録した。**製品側の是正内容は変えていない** | 改名後に`review validate`と`audit:check`がいずれも`valid: true`を返すこと。本文は1 byteも変えていない | no-spec-impact | pass |
| DISC-1433-06 | 変異B2（候補1件要求を`>= 1`へ緩める）が生存した。等価変異ではない。本Issueで要件へ書いた「候補が1件でない差分は同定できないものとして従来どおり拒否する」を、名指ししたSCNのどれも検証していなかった | 仕様が引用するSCNが主張を検証していない状態。全gate緑のまま通り変異試験でしか出ない | requirement | SCN-UNIT-REANCHOR-038とAC-1433-11を追加。製品コードは変更していない | 追加後に`@issue-1433`が12件全pass、B2再実行で1 failedとなりkillを確認 | updated | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1433-01 | SCN-UNIT-REANCHOR-033 | `observeReviewedForward` | pass | pass | `method=reviewed-forward`の受理と記録artifact pathの一致 |
| AC-1433-02 | SCN-UNIT-REANCHOR-034 | `observeArtifactReplacement` | pass | pass | `method=artifact-replacement`の受理と記録artifact pathの一致 |
| AC-1433-03 | SCN-UNIT-REANCHOR-035 | `terminalArtifactPath` | pass | pass | `.agent-skill-chain/reviews/`配下で通常rebaseが`artifact-not-unique`にならない |
| AC-1433-04 | SCN-UNIT-REANCHOR-036 | `terminalArtifactPath` | pass | pass | prefix延長とprefix短縮の2 Examplesが`artifact-not-unique`で拒否 |
| AC-1433-05 | SCN-UNIT-REANCHOR-037 | `terminalArtifactPath` | pass | pass | 自repo慣習名の受理が変更前後で同一 |
| AC-1433-06 | SCN-INT-REANCHOR-016 | `pr reanchor`とbinding検査の合成経路 | pass | pass | 製品既定出力名で再固定した新headが`pr merge`のbinding検査を通過 |
| AC-1433-07 | SCN-INT-REANCHOR-017 | 同上 | pass | pass | `.agent-skill-chain/reviews/`配下で同じ経路が成立 |
| AC-1433-08 | SCN-INT-REANCHOR-018 | 同上 | pass | pass | allowlist外のartifact pathをpreviewとapplyの双方が拒否し追記0件 |
| AC-1433-09 | 例IDなし | 規範文書、要件、CLI契約、用語台帳 | not-applicable | pass | 4文書への`grep`で「正規命名」「正規名」「非正規名」がfile名の意味で残っていないことを確認。TERM-ASC-084の禁止表現欄への明記だけが残る。**新しい文書検査gateを足していない** |
| AC-1433-10 | SCN-UNIT-REANCHOR-036 | `terminalArtifactPath` | pass | pass | backslashと制御文字の2 Examplesが拒否。実装前は2件とも「拒否されていません」で落ちていた |
| AC-1433-11 | SCN-UNIT-REANCHOR-038 | `terminalArtifactPath` | pass | pass | allowlist配下のartifactが2件ある差分が`artifact-not-unique`で拒否。変異B2をkillする |
| AC-1433-12 | SCN-UNIT-REANCHOR-039、SCN-UNIT-REANCHOR-040 | `observeReviewedForward`、`observeArtifactReplacement` | pass | pass | 実行権限付きartifactとsymlink artifactが両経路で拒否。検査を消す変異Dで実行権限の2例が落ちる |

### 2.2 開発考慮事項の適用判定（必須）

00の判定・理由・証拠から差分が無ければ、表の代わりに`開発考慮事項の適用判定は00_要求定義.md §6.1と同じ`の1行を置ける（01〜03と同じ参照行）。差分がある行だけを表に残してよい。**`review validate`はこの§2.2の内容を検証しない**（01〜03の`issue validate`と異なり、review artifactのDC判定に対する機械検証は無い）。記述量を減らすための人・エージェント向けの案内であり、参照行を置いても4行の表を書いても合否は変わらない。

開発考慮事項の適用判定は00_要求定義.md §6.1と同じ

## 3. 肯定的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ（要件と観測結果の一致） | pass | FR-01〜FR-05がAC-1433-01〜11へ写り、AC-1433-09以外はすべてSCNで観測している。実装前に新規11 scenario中7件が落ち、実装後に12件全passすることでbug-reproductionが成立した |
| 価値（利用者・運用上の目的） | pass | 製品自身が`review artifact --init`の既定で出力する名前が`pr reanchor`を通るようになった。**本reviewの成果物も当初は既定名`docs/reviews/1433_レビュー.md`で生成した。** 本repo運用scriptの命名規約に合わせて改名した経緯はDISC-1433-07に記録している。 正本が許すもう一方の配置`.agent-skill-chain/reviews/`も通る |
| 実現可能性（環境・依存・権限） | pass | 依存packageもlockfileも実行時の外部存在も変えない。新しいauthorityも承認経路も作らない。保護fileへ触れていない |
| 整合性（設計・コード・テスト・仕様） | pass | 同定規則が`pr create`・review session・record layer・再固定で`isEvidenceOnlyPath`に統一された。`pr create`は`assertConvergedReviewSession`から`evidenceOnlySuffix`を経て到達する。2 prefixの直書きは`pr merge`側の2箇所に残るが、束縛済みpathの後段再読であり合成経路から受理集合の差へ到達しない。正本・要件・CLI契約・用語台帳・配布skillの5文書が同じ意味へ揃い、`trace:check`のorphanが0件である |
| 保守性（責務・命名・変更容易性） | pass | 判定を足さず取り除いた。src差分は追加23行・削除19行だが、追加のうち17行はJSDocであり判定logicは正味で減っている。T01とT02が独立commitで各々単独に逆適用できる |

## 4. 敵対的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 反例（要件を破る入力・状態） | pass | 変異試験6件がすべてkillされ生存0件。round 2ではさらに**自分が足した検査を消す変異（D）**を実行し、SCN-039・040の実行権限2例が落ちることを確認した。symlinkの2例は`git show`がlink先文字列を返すため既存の構造検証で落ち、mode検査に依存しない。**両者を区別して記録する。** **うちA1〜A3は削除した定数と検査を`git diff`の`-`行から復元する変異であり、全killは新SCNが是正そのものを固定していることを示す。** B2は初回生存したため等価変異でないことを確認してSCN-UNIT-REANCHOR-038を追加しkillした |
| 失敗経路（外部失敗・部分失敗） | pass | Git観測の失敗を例外のまま外へ出さず拒否理由へ変換する既存経路を変えていない。previewとapplyが同じevaluatorを共有する境界も変えていない。既存のSCN-INT-REANCHOR-008〜015が回帰で通っている |
| 境界値（空、最大、最小、重複、Unicode） | pass | prefixの延長`docs/reviewsX/`と短縮`docs/review/`、区切り文字を跨ぐ前方一致、backslash、制御文字U+0001、候補0件、候補2件をSCN-UNIT-REANCHOR-036と038で観測した |
| 悪用（注入、経路脱出、権限外） | pass | `isEvidenceOnlyPath`は`..`とbackslashと制御文字を拒否するため、path判定は旧実装の単純前方一致より狭い。`..`はgitが差分pathを正規化するため合成経路から到達せず、到達不能な反例SCNを作っていない |
| 安全性（認証、承認、秘密情報、Zero Trust） | pass | **basenameはreview対象との一致を証明する情報を持たない。** pathを選べる者は`docs/reviews/999_課題999レビュー.md`のような適合名を選べるため、旧regexは悪意あるartifact本文、偽のanchor、未review実装、古いround、不正な監査表のいずれも防いでいない。それらを防ぐstrict ancestor、base不変、exact session・round・`H_impl` binding、`verifiedImplementationBoundary`、構造検証、context-isolated approval、個別監査pathの完全一致を1つも弱めていない。**round 1ではmode `100755`の到達可能性を見落としていた（REV-1433-08）。** 実行権限付きMarkdownは通常fileで本文が読めるため全構造検査を通過し、再固定後は`assertConvergedReviewSession`のsuffix検査も素通りする。round 2で`evidenceOnlySuffix`を新head側へ適用して塞いだ |
| データ損失（上書き、削除、部分公開、履歴消失） | pass | 再固定記録はappend-onlyのまま。schemaとfield構成を変えず既存記録の解釈も変えない。変更履歴は過去行を書き換えず1行追加した |
| ロールバック（復旧参照、状態保持、再開可能性） | pass | T01とT02の各commitが`git apply --check -R`で独立に逆適用できることを実測した。**初回のcommit分割では中間版の構築時に定数を別位置へ移したためBが単独逆適用できず、定数位置を保って組み直した** |
| 範囲漏れ（呼び出し元、利用側、配布物、文書） | pass | `grep`で「正規命名」「正規名」「非正規名」の全出現を走査し、規範文書・配布skill・要件・CLI契約・用語台帳の5箇所とtestのstep文言1箇所を是正した。残るのはTERM-ASC-084の禁止表現欄への明記と、書き換えない過去の変更履歴行だけである。配布物影響は§8で3 pathを個別に列挙した。**さらに自repoでの実地適用により、同一regexが本repo運用scriptにも存在することを発見した（REV-1433-07）。** 走査対象を製品コードと規範文書だけに限らず、運用scriptまで広げたことで出所が確定した。**round 2では外部reviewerが`terminalArtifactPath`の適用範囲が`比較基点..head`の全域であることを指摘し、第2の狭まり（INV-06）が記述から漏れていたことが判明した（REV-1433-10）** |

## 5. 指摘

指摘なしの場合は「指摘なし」と明記する。

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| REV-1433-01 | High | 本変更は一方向の緩和ではなく、`docs/reviews/`配下のbackslash・制御文字pathに対して受理範囲が狭まる。01のINV-03と互換性記述が事実に反していた | gitが両pathを保持できることを一時repositoryで実測。実装前のSCN-UNIT-REANCHOR-036が2件落ちた | 01 §2.3、01 §11、02 §5 | INV-05を追加しINV-03を限定、互換性記述を緩和と狭まりへ書き分け、AC-1433-10と反例を追加した | resolved | なし。実運用のreview artifact名にbackslashと制御文字は現れない |
| REV-1433-02 | High | 要件へ書いた「候補が1件でない差分は同定できないものとして従来どおり拒否する」を、名指ししたSCNのどれも検証していなかった | 変異B2が75 scenario全passで生存 | `docs/specs/02_要件/01_ワークフロー要件.md`、01 §9 | SCN-UNIT-REANCHOR-038とAC-1433-11を追加。製品コードは変更していない | resolved | なし |
| REV-1433-03 | Medium | 初回のcommit分割でT01だけを単独revertできなかった | `git apply --check -R`が`src/adapters/evidence-reanchor.ts:47`で失敗 | commit構造 | 中間版の定数位置を元のまま保ってB・Cを組み直し、両方の単独逆適用を確認した | resolved | なし |
| REV-1433-04 | Medium | 変異C1が置換の空振りで「生存」に見えかけた | 変異scriptのassertが置換対象0件を検出 | 変異試験 | 探索文字列を実測へ合わせて再実行しkillを確認した | resolved | なし。assertが無ければ誤った反例追加に1ラウンド費やしていた |
| REV-1433-07 | Medium | 製品側regexの出所が本repo運用scriptの`AUDIT_NAME_PATTERN`であることが、自repoでの実地適用で判明した。本reviewの成果物を製品既定出力名にすると`audit:check`が拒否する | `scripts/check_file_audit.ts:32`のregexと、commit `2155957b`による`1425_レビュー.md`の削除 | `scripts/check_file_audit.ts`、本fileのpath | 運用scriptは変更しない。本fileを規約名へ改名した。配布される製品がfile名を強制してはならないことと、利用側が自分の成果物へ規約を課してよいことは両立する | resolved | なし。本repoの命名規約は維持され、製品の受理範囲だけが正本へ揃う |
| REV-1433-08 | High | 再固定が新`H_final`のmodeとtypeを検証しない。mode `100755`のMarkdownは通常fileなので`git show`で本文が読め、構造検証・identity anchor・approval・個別監査表をすべて通過する。**DISC-1433-01の反例列挙が`100755`を落としていた** | 外部reviewer（codex）の指摘。`assertConvergedReviewSession`のsuffix検査は実効HEADとcurrent HEADが異なるときだけ走り、再固定後は一致するため素通りすることを実測で確認 | `src/adapters/evidence-reanchor.ts`の2経路 | `evidenceOnlySuffix`を葉module`review-diff.ts`へ移し、新head側だけへ適用。INV-07・AC-1433-12・SCN-UNIT-REANCHOR-039/040で固定 | resolved | なし。旧`H_final`側は過去の受理を遡らない |
| REV-1433-09 | Low | round 1の「`pr create`、delivery state、review sessionと同じ述語」という記述が不正確だった | 外部reviewer2体（codex・fable）が独立に同一指摘 | JSDoc、REQ-WF-005 | round 2で訂正したが**訂正内容自体が誤っていた**。round 3でREV-1433-12として再訂正した | resolved | なし |
| REV-1433-12 | Medium | **round 2の訂正が事実と逆だった。** 「`pr create`とdelivery stateは2 prefixを直書きで持つ」と書いたが、`pr create`に直書きは存在せず`assertConvergedReviewSession`から`evidenceOnlySuffix`を経て`isEvidenceOnlyPath`を共有している。`cli.ts:1454`を`pr create`のselectorと誤認していた | 外部reviewer（fable）の指摘。`awk`で`cli.ts:1454`の包含関数が`resolveImplementationCommitForMerge`（1419行）であること、呼び出し元が`observeMergeReviewEvidence`（1573行）経由の`inspectAuthorizedPullRequestMerge`と`readBackPreparedPullRequestMerge`の**merge側2箇所だけ**であることを確認した | JSDoc、REQ-WF-005、01と00のINV-02・BR-02・RQ-BR-02 | 5箇所を実測どおりへ訂正。直書きが残るのは`pr merge`側であり、本Issueが§2.2で自ら対象外と宣言した領域である | resolved | なし。merge側2箇所は束縛済みpathの後段再読で、合成経路から受理集合の差へ到達しない |
| REV-1433-10 | Low | `terminalArtifactPath`が`比較基点..head`の全域へ適用されるため、実装差分が`.agent-skill-chain/reviews/`配下を触るrepoでは候補2件となり拒否する。**INV-05と変更履歴がこの第2の狭まりを記述していなかった** | 外部reviewer（fable）の指摘。`evidence-reanchor.ts`の296・297・472・473行と`observeReanchorDiff`の引数を確認 | 01 §2.3、変更履歴 | INV-06として明示し互換性欄を狭まり3つの列挙へ直した。**製品は変更しない。** 候補1件要求はSCN-038が既に固定しており同型反例を増やしても検出力が増えない | resolved | なし |
| REV-1433-11 | Low | 本fileの自己言及が改名後に陳腐化し、§6と§11のfinding件数が§5表と食い違っていた | 外部reviewer（fable）の指摘。file内grepで確認 | 本file | 旧path参照2箇所を直し、件数をround 2の実数へ更新した | resolved | なし |
| REV-1433-05 | Low | `verifiedImplementationBoundary`がmode `100644`を検証しない | 実装読解 | `src/adapters/evidence-reanchor.ts` | **round 1では対象外としたがREV-1433-08で撤回した。** 当初の「到達可能な穴ではない」という根拠は`100755`を落としており誤りだった | resolved（REV-1433-08へ統合） | なし |
| REV-1433-06 | Low | `resolveAnchor`のJSDocが本体から500行以上離れて孤立している | `git show HEAD`で本変更より前からの孤立を確認 | `src/adapters/evidence-reanchor.ts` | 本Issueの対象外。DISC-1433-05として記録 | out-of-scope | 低。可読性のみ |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい。§3の肯定5観点と§4の敵対8観点をすべて判定した
- 指摘を確定した: はい。REV-1433-01からREV-1433-07の7件。High 2件、Medium 3件、Low 2件
- 次ラウンド対象のCritical/High: なし。High 2件（REV-1433-01、REV-1433-02）はいずれも本ラウンド内で是正し`resolved`にした。REV-1433-01は01・02の再確定とAC追加、REV-1433-02はSCN-UNIT-REANCHOR-038の追加で、**どちらも製品コードを変更していない**

### ラウンド2

- 未解決Critical/High: 0件。**外部reviewer2体（codex・fable）へ独立にセルフレビューを委譲し、codexがHigh 1件・Low 1件、fableがLow 5件を返した。** codexのHigh（REV-1433-08）は実測で裏が取れ、round 1で`out-of-scope`としたREV-1433-05の根拠が誤りだったことを示したため撤回して是正した。fableの総合判定はapprovedだった。新たに確定した指摘はREV-1433-08からREV-1433-11の4件で、High 1件・Low 3件。すべて本ラウンド内で`resolved`にした
- 修正差分と、触れた隣接範囲: `src/adapters/evidence-reanchor.ts`（mode/type検証の追加とJSDocの訂正）、`src/adapters/review-diff.ts`と`src/adapters/review-session.ts`（`evidenceOnlySuffix`の移設。判定logicは不変）、`test/steps/review-progress.steps.ts`（import元の付け替え1行）、`test/`のfeatureとsteps（SCN-039・040の追加）、`docs/specs/`の要件・追跡表・変更履歴。隣接範囲として`architecture:check`で循環0件、`npm test` 2179 scenariosで回帰0件を確認した
- 既承認・未変更範囲を再走査していない: round 1で`pass`とした観点のうち、REV-1433-08が覆した「安全性」と「範囲漏れ」だけを再評価した。それ以外の観点と既存32 scenarioへは触れていない

### ラウンド3

- 全指摘の最終分類: 全12件が確定した。Critical 0件、High 3件（すべて`resolved`）、Medium 4件（すべて`resolved`）、Low 5件（4件`resolved`、REV-1433-06だけ`out-of-scope`）。**未解決Critical/Highは0件。** round 3の対象はround 2で自分が入れた誤記の訂正（REV-1433-12）だけで、新しい外部指摘は無い
- 危険範囲を除外・既定無効・ロールバック可能へ縮小した結果: 該当なし。round 3はJSDocと仕様記述の訂正だけで判定logicを変えていない。`npm test` 2179 scenariosの結果がround 2と同一であることで確認した
- 同じ範囲の予算を自動更新していない: はい。counted roundは3で、同じ範囲へ追加の予算を与えていない。**外部reviewerが「別Issue」と判定した2件は本PRへ吸収せず、Issue #1436と#1437として分離した**

## 7. テスト結果

- 実行したcommandの一覧: `npm test`、`npm run test:unit`相当の`--tags @issue-1433`と`--tags @evidence-reanchor`、`npm run lint`、`npm run format:check`、`npm run typecheck`、`npm run source:check`、`npm run docs:format`、`npm run test:format`、`npm run directories:check`、`npm run architecture:check`、`npm run cli:check`、`npm run skills:check`、`npm run workflow:check`、`npm run trace:check`、`npm run conformance:check`、`npm run package:check`、`npm run project:quality`、`npm run build`、`npm run audit:check`
- 全layerの合計: round 3時点で`npm test`が2179 scenarios（2163 passed、16 skipped、失敗0）、17971 steps（17921 passed、50 skipped、失敗0）、8分25秒。round 3はJSDocと仕様記述の訂正だけなので件数はround 2と同一である。round 2時点も同じ2179 scenariosだった。`--tags @evidence-reanchor`が80 scenarios全pass。`--tags @issue-1433`が16 scenarios全pass。round 1時点は2174 scenarios（2158 passed、16 skipped、失敗0）だった。上記の静的・文書・配布検査はすべて違反0件
- runner・Gherkin方言: `cucumber-js`、`gherkinDialect=en`。`.agent-skill-chain/project/choices/development.json`の`testRunner`と`gherkinDialect`から確認した
- **変異試験**: round 1で6変異すべてkill、生存0件。round 2で追加した検査に対する変異D（`evidenceOnlySuffix`検査2箇所の削除）もkill（SCN-039・040の実行権限2例が失敗）。**symlinkの2例は既存の構造検証で落ちるためこの変異では死なない。検出の由来を区別して記録する。** round 1の内訳は次のとおり。A1旧prefix定数の復活がKILL（5 failed）、A2旧basename regex復活（reviewed-forward）がKILL（3 failed）、A3同（artifact-replacement）がKILL（1 failed）、B1 allowlist判定の恒真化がKILL（17 failed）、B2候補1件要求の緩和が初回生存→SCN-UNIT-REANCHOR-038追加後にKILL（1 failed）、C1走査回避がKILL（5 failed）。すべて`src/adapters/evidence-reanchor.ts`の内側へ閉じ、domain側の述語本体を差し替えていない
- **bug-reproduction**: 実装前に新規11 scenario中7件が落ちることを観測した。うちSCN-UNIT-REANCHOR-036のbackslashと制御文字の2件は「拒否されていません」で落ち、DISC-1433-03の狭まりを実測で裏付けた
- **rollback-validation**: `git show <T01> | git apply --check -R`と`git show <T02> | git apply --check -R`がいずれも成功し、2つの是正を独立にrevertできることを確認した

## 8. 配布物影響

packageとして配布する場合だけ記入する。配布境界はpackage manifestの配布file指定を正本とし、compileされて配布される`source`も含める。

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| .agent-skill-chain/docs/01_開発ワークフロー.md | 入る | artifact-replacement条項の1行。利用者が読む受理条件の記述がfile名から配置へ変わる |
| .agent-skill-chain/skills/step-11-pr/SKILL.md | 入る | 同条項の1行。規範文書と同じ意味へ揃える |
| dist/src/ | 入る | `pr reanchor`の受理範囲が変わる唯一のruntime差分。緩和1つと狭まり3つの内容は§4の安全性欄と変更履歴に記載 |
| docs/reviews/1433_課題1433再固定artifact同定のallowlist合流レビュー.md | 入らない | なし |
| docs/specs/01_システム概要/02_用語・略語.md | 入らない | なし |
| docs/specs/02_要件/01_ワークフロー要件.md | 入らない | なし |
| docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md | 入らない | なし |
| docs/specs/15_要件追跡/00_追跡表.md | 入らない | なし |
| docs/specs/15_要件追跡/01_変更履歴.md | 入らない | なし |
| src/adapters/evidence-reanchor.ts | 入る | `package.json`の`files`は`dist/`だけを列挙するため`src/`自体は配布されないが、compileされて配布される生成元であるため配布境界に入るものとして扱う |
| src/adapters/review-diff.ts | 入る | 同上。`evidenceOnlySuffix`の移設先であり判定logicは変えていない |
| src/adapters/review-session.ts | 入る | 同上。`evidenceOnlySuffix`の移設元であり判定logicは変えていない |
| test/features/integration/evidence-reanchor.feature | 入らない | なし |
| test/features/unit/evidence-reanchor.feature | 入らない | なし |
| test/steps/evidence-reanchor.steps.ts | 入らない | なし |
| test/steps/review-progress.steps.ts | 入らない | なし |

判断: 配布物を更新した

根拠: `dist/src/adapters/evidence-reanchor.js`、`dist/src/adapters/review-diff.js`、`dist/src/adapters/review-session.js`、`.agent-skill-chain/docs/01_開発ワークフロー.md`、`.agent-skill-chain/skills/step-11-pr/SKILL.md`の5 pathを更新した。`npm run build`の後に`git status`がcleanであること、および`npm run package:check`が違反0件であることを確認した。

## 9. 独立reviewの成立

PR作成前に観測できるものだけを書く。immutable review IDやapproval件数は書かない。

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated |
| その要求を満たすこと | はい |
| reviewerとimplementerのidentity・context比較 | project policyの`merge.reviewIndependence`は未宣言のため既定の`context-isolated`を適用した。exact HEADは`d6f83ba51d5799cddfe686394c8e54e3b58cca15`に固定されている。肯定5観点と敵対8観点を§3・§4に記録し、findingをREV-1433-01からREV-1433-06として分類した。設計段階では別providerのアドバイザーへ正本の原文を渡して4問を諮問し、着手可否・scope・用語の扱い・securityの4点について独立した判定を得ている |
| reviewerが対象差分を変更していないこと | はい（round 1は製品path変更0件。round 2は外部reviewer指摘REV-1433-08の是正として`src/`と`dist/`を変更したが、これはreviewerが自分の判断を通すための変更ではなく、正本が要求する条件を実装が満たしていないという指摘への是正である。新`H_impl` `9c04bfab8fa8b9ea3fcadcb5f2f58b51703a5616`に対して本roundがあらためて全観点を評価した） |

外部への不可逆な配布で外部証拠を要求され、かつ無い場合だけ次を記入する。承認元・承認者・承認日時・失効日時は正本を参照し複製しない。

| 項目 | 内容 |
|---|---|
| 適用する例外の識別子 | {正本fileのexceptionId} |
| 観測値 | {未実行と判定した根拠の実測値} |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: `docs/specs/02_要件/01_ワークフロー要件.md`のREQ-WF-005、`docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md`の`pr reanchor`行、`docs/specs/01_システム概要/02_用語・略語.md`のTERM-ASC-084、`docs/specs/15_要件追跡/00_追跡表.md`、`docs/specs/15_要件追跡/01_変更履歴.md`。配布する規範文書`.agent-skill-chain/docs/01_開発ワークフロー.md`と配布skill`step-11-pr/SKILL.md`も同じ意味へ揃えた
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: はい。00 §4.2がTERM-ASC-084をchange・TERM-ASC-101をreferenceとして候補に挙げ、01 §2.1が確定差分として同じ2件を持ち、`docs/specs/01_システム概要/02_用語・略語.md`が現在有効な定義を更新した。**新規用語を追加していない**
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: はい。**本変更はその欠陥の是正そのものである。** 「正規命名」「正規名」「非正規名」は正本・要件・CLI契約・用語台帳に現れながら定義を持たない未定義語だった。語ごと除去して既存のTERM-ASC-101参照へ置き換え、TERM-ASC-084の禁止表現欄へ3語を明記した。廃止した語の置換先は同欄が示す
- 要件・変更・SCN・テストの追跡: REQ-WF-005 → AC-WF-005（Issue #1433） → SCN-UNIT-REANCHOR-033〜038とSCN-INT-REANCHOR-016〜018 → `test/features/unit/evidence-reanchor.feature`と`test/features/integration/evidence-reanchor.feature`。`npm run trace:check`がorphanRequirements・orphanScenarios・orphanImplementationsをいずれも0件で返した。**新規SCNは要件本文からも到達する。** REQ-WF-005の同定規則段落が`SCN-UNIT-REANCHOR-033`から`SCN-UNIT-REANCHOR-038`と`SCN-INT-REANCHOR-016`から`SCN-INT-REANCHOR-018`を名指ししている
- `no-spec-impact`の場合の限定的根拠: 該当なし
- UI・トークンの判断: DC-UXとDC-TOKENSはいずれも`not-applicable`。現行製品はNode CLIでありGUIとWeb UIを提供せず、design/layout tokenの生成・同期先も持たない。`docs/specs/17_デザイン/`と`18_レイアウト/`に対象資産がない

## 11. 総合判定と再開地点

- 未解決Critical/High: なし
- Critical/Highの内訳: Criticalは0件。High 3件（REV-1433-01、REV-1433-02、REV-1433-08）はいずれもそれぞれのラウンド内で`resolved`にした
- Medium/Lowの記録: Medium 3件（REV-1433-03、REV-1433-04、REV-1433-07）はいずれも`resolved`。Low 5件のうちREV-1433-05はREV-1433-08へ統合して`resolved`、REV-1433-09・10・11も`resolved`、REV-1433-06だけが`out-of-scope`として残存リスクへ残る
- 判定: approved
- 新しい権限が必要な事項: なし。本変更は新しいauthorityも承認経路も作らず、保護fileへ触れていない
- 残存リスク: (1) REV-1433-06。`resolveAnchor`のJSDocが本体から離れて孤立している。本変更より前からの状態で、可読性のみに影響する。(2) `pr merge`側の2箇所（`resolveImplementationCommitForMerge`とdelivery stateのMergeIntent解析）が2 prefixを直書きで持つ点（REV-1433-09、REV-1433-12）。受理集合は同じで、束縛済みpathの後段再読であるため合成経路から受理集合の差へ到達しない。**`pr merge`の認可判定は§2.2で対象外と宣言済みであり、合流は別Issueとする。** (3) 未決事項2件。「正規命名」をTERM-ASC-101参照へ置き換える正本改定の可否と、Issue #1424のclose判断。いずれも決定権者はpackage ownerであり、本PRのmerge時に判断される。**mode検査の追加可否はownerがround 2で決裁済みである。** (4) round 3で分離した2件。`review validate`がapproval recordを検証しない件はIssue #1436、「force push禁止」と「複数commit拒否」が両立しない件はIssue #1437として起票した。**#1437にはPR作成後にforce pushを実行した逸脱の事実を明記し、owner決裁を求めている**
- 次に許可される操作: `workflow record --step=10 --post-pr-intake` → 本fileのcommit（新`H_final`）→ `pr reanchor --new-head=<新H_final> --new-base=<不変>`。`delivery.stopAt=pull_request`かつ`merge.mode=assisted`のためPR作成で停止し、mergeはowner承認を待つ。**mergeは`--merge`で行う。squashは2区間構造を壊し`audit:check`が落ちる**
- 次回の再開地点: `H_impl` `df5e898df5fce05c173f95bbc3457b2eb58df84b`、比較基点 `5f7f1c53c873f0c50d9b66f2ac30bfe47ec18b92`、branch `bugfix/1433-reanchor-artifact-allowlist`、worktree `.worktrees/20260919_234846-1433-reanchor-artifact-allowlist`、PR #1435（`pr-bound`）

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 1 |
| 対象SHA・文書ダイジェスト | df5e898df5fce05c173f95bbc3457b2eb58df84b |
| 比較基点 | `5f7f1c53c873f0c50d9b66f2ac30bfe47ec18b92` |
| H_impl | `df5e898df5fce05c173f95bbc3457b2eb58df84b` |
| 対象差分 | .agent-skill-chain/docs/01_開発ワークフロー.md、.agent-skill-chain/skills/step-11-pr/SKILL.md、dist/src/adapters/evidence-reanchor.js、dist/src/adapters/review-diff.js、dist/src/adapters/review-session.js、docs/reviews/1433_課題1433再固定artifact同定のallowlist合流レビュー.md、docs/specs/01_システム概要/02_用語・略語.md、docs/specs/02_要件/01_ワークフロー要件.md、docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md、docs/specs/15_要件追跡/00_追跡表.md、docs/specs/15_要件追跡/01_変更履歴.md、src/adapters/evidence-reanchor.ts、src/adapters/review-diff.ts、src/adapters/review-session.ts、test/features/integration/evidence-reanchor.feature、test/features/unit/evidence-reanchor.feature、test/steps/evidence-reanchor.steps.ts、test/steps/review-progress.steps.ts |
| 対象外 | 比較基点に存在し変更されていない範囲 |
| 残り予算 | 3ラウンド |
| ラウンド数 | 3 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260919_232451_bugfix-pr-reanchorのreview-artifact同定が正本のevidence-only-allowlistと食い違う |
| 仕様の所有箇所 | `docs/specs/02_要件/01_ワークフロー要件.md`のREQ-WF-005。reviewed-forward条項は「新`H_final`が監査合格済みevidence-only suffixである場合に限り、`reviewed-forward`としてappend-only記録する」と定め、file名条項を持たない |
| 成果物行数 | 製品: `src/adapters/evidence-reanchor.ts`が追加23行・削除19行。追加のうち17行はJSDocであり判定logicは正味で減っている。配布文書が3 pathで各1行。支援層: testが追加191行・削除5行、`docs/specs/`が追加9行・削除5行、staging成果物00〜03が1005行。**支援層が製品変更を大きく超えている。** fullは00〜03の個別管理を要求するためmode固有の固定費であり、閾値判定はしない |
| 縮小の先行評価 | 評価のうえ縮小側を採った。同定述語は新設せず既存の`isEvidenceOnlyPath`を再利用し、adapter固有の定数2件を削除した。02 §12で7案の採否を記録し、project policyへの命名設定項目の新設、`pr resync-head`相当の新command、文書乖離を監視する新gate、mode検査の同時追加をいずれも不採用とした。**足す修正ではなく消す修正で成立する** |
| 実施者・日時 | reviewer、2026-09-20T02:30:00+09:00 |

`比較基点`と`H_impl`の値は40桁の小文字hexをbacktickで囲んだものだけにする。注記・branch名・短縮SHAを同じcellへ書かない。由来は別行へ書く。

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定5観点と敵対8観点を§3・§4へ記録し、findingをREV-1433-01〜06として重大度と状態で分類した | critical。変更種別bug-fix、risk high、信頼境界と不可逆操作への到達性に触れるため | project choiceの解決結果に従う。本reviewでは`routing launch`を使わず、設計段階の諮問だけを別providerへ委ねた | project choiceの`modelMapping`を入力とし、固有のmodel slugを要求していない | 要求水準を独立性証拠欄で確認できない場合は承認せず停止する。本reviewでは§9の観測値で確認できた | §9に記録。exact HEADは`d6f83ba51d5799cddfe686394c8e54e3b58cca15`に固定。review中の製品path変更は0件 |
