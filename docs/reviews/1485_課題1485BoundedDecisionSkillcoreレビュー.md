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
| 何が問題だったか | DCAND-006/008/009/010の4件がBR-01（呼び出し元を名指しできない）を理由にDecision Contract（#1483）から除外され、prose判断のまま記録・検証できずsupport_msコストの主要因になっていた |
| 何を解決しようとしたか | Decision Skill（`agent-skill-chain decision invoke`）自身をBR-01が要求する呼び出し元として新設し、DCAND-001〜005を挙動不変で統合、DCAND-006/008/009/010を型付きauthorityMode付きCapabilityとして提供する。support_ms実測（T-05）とreview品質A/B比較（T-06）は本Issue単独では実タスク数不足のためfollow-upとする |
| 何を行ったか | Decision Type Registry・authorityMode判定・Decision Journal・`decision invoke`/`decision types` CLIを追加、Step 10 review roundへ`decisionRef`機械検証を追加、`resolveGitWorkspace`一般化と`loadJevProviderConfig`のworktree継承修正を実施した |
| 何を確認したか | round 1（self-review）後、PR #1497への独立review（coordinator）でCI format:check失敗とDCAND-009 constrained-choiceの信頼境界gapの2件が指摘され、round 2で前進commitで是正した。round 2のfixが`decision-invoke.ts`の行移動を生んだことでcallerAnchor行ずれと孤立SCNの2件のtest回帰を自己検出し、round 3で前進commitで是正した。是正後`npm test`・`npx tsc --noEmit`・`npm run lint`・`npm run format:check`・`npm run build`が全て成功することを確認した（§7に実測値） |
| 判定 | approved（round 3まで収束。round 1はself-review、round 2の指摘元は独立review（coordinator）、round 3は自己検証。§9参照） |

## 1. 入力証拠

PR番号、Actions run ID、immutable review IDはPR作成後にしか存在しないため**この文書へ書かない。** `review evidence`とdelivery stateがappend-onlyで保持する。reviewerの独立性は`merge.reviewIndependence`が決める。既定の`context-isolated`はimplementerと別session/context、exact HEAD固定、対象差分の非変更、肯定・敵対reviewとfinding記録を要求し、同一GitHub actorでも成立する。このときtracked artifactの`approved`と保存済みreview session・Step 10 bindingがformal approvalになる。`actor-independent`はPR authorおよび観測済み`H_impl` commit authorと別のstable actor IDによるprovider `APPROVED`を要求する。両modeともexact HEAD一致は必須とし、tracked文書へ自身のcommit SHAを書かず、**H_final後はartifactを更新しない。**

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | .agent-skill-chain/tmp/issues/20260926_111735_v0.4.2-Bounded-Decision-Skill-core | staging digest e76a179e68e395b802549b75012077fd5bf52035d7228de03eea1210a6a2d939 | 既存コード |
| 差分 | `eea59fbf467c534d8c5b578d818c03f0d9aa898f`..`d6b11ee6568346b1407945fd8281fa75544b91d0` | 61 path（round 1の60 pathに`docs/reviews/1485_レビュー.md`が加わった。round 2・3はこの61 path集合の内容だけを更新し集合自体は増減していない。file名是正commit（本commit自身）はこの`H_impl`より後の`H_final`側にあり、この差分には含まれない） | 既存コード |
| テスト | `npm test`（cucumber全体、round 3 fix後） | §7参照（実測値） | テスト出力 |
| 仕様 | `docs/specs/`6 file更新 | updated | 既存文書 |
| commit前candidate | .agent-skill-chain/00_利用案内.md、.agent-skill-chain/docs/01_開発ワークフロー.md、.agent-skill-chain/skills/step-10-review/SKILL.md、docs/reviews/1485_課題1485BoundedDecisionSkillcoreレビュー.md（round 1のH_final。round 2・3はこのfileの内容を更新する）、dist/src/adapters/decision-invoke.js、dist/src/adapters/decision-journal-store.js、dist/src/adapters/local-config-workspace.js、dist/src/adapters/review-session.js、dist/src/adapters/review-workspace.js、dist/src/cli-contract.js、dist/src/cli-usage.js、dist/src/cli.js、dist/src/domain/decision-authority.js、dist/src/domain/decision-contract.js、dist/src/domain/decision-journal.js、dist/src/domain/decision-resolvers.js、dist/src/domain/decision-types.js、dist/src/domain/jev-provider-config.js、dist/src/domain/local-config-resolution.js、dist/src/domain/policy.js、dist/src/domain/review-convergence.js、dist/src/domain/spec.js、docs/specs/01_システム概要/02_用語・略語.md、docs/specs/02_要件/00_要件一覧.md、docs/specs/02_要件/01_ワークフロー要件.md、docs/specs/10_セキュリティ/01_信頼境界.md、docs/specs/14_開発・品質/00_ディレクトリ構成.md、docs/specs/15_要件追跡/00_追跡表.md、docs/specs/15_要件追跡/01_変更履歴.md、src/adapters/decision-invoke.ts、src/adapters/decision-journal-store.ts、src/adapters/local-config-workspace.ts、src/adapters/review-session.ts、src/adapters/review-workspace.ts、src/cli-contract.ts、src/cli-usage.ts、src/cli.ts、src/domain/decision-authority.ts、src/domain/decision-contract.ts、src/domain/decision-journal.ts、src/domain/decision-resolvers.ts、src/domain/decision-types.ts、src/domain/jev-provider-config.ts、src/domain/local-config-resolution.ts、src/domain/policy.ts、src/domain/review-convergence.ts、src/domain/spec.ts、test/features/unit/decision-authority.feature、test/features/unit/decision-invoke.feature、test/features/unit/decision-ref-verification.feature、test/features/unit/jev-provider-config.feature、test/features/unit/local-config-workspace.feature、test/steps/decision-authority.steps.ts、test/steps/decision-contract.steps.ts、test/steps/decision-invoke.steps.ts、test/steps/decision-ref-verification.steps.ts、test/steps/evidence-reanchor.steps.ts、test/steps/jev-provider-config.steps.ts、test/steps/local-config-workspace.steps.ts、test/steps/review-convergence.steps.ts、test/steps/review-round-init.steps.ts | H_impl `d6b11ee6568346b1407945fd8281fa75544b91d0`（round 3までの内容確定commit。`checkFileAudit`は`git diff --no-renames`で1 fileだけの変更commitを遡ってH_implを導出するため、後続のrename commit（本commit自身）はrenameが`--no-renames`では2 pathに見えて遡りを打ち切り、H_implはここで確定する） | Git index |
| Phase A artifact | 本fileをcommit後に観測 | 未作成 | Git観測 |
| review session | .agent-skill-chain/tmp/issues/20260926_111735_v0.4.2-Bounded-Decision-Skill-core | 未開始 | Git観測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: 02 §2.3の依存表・decision journal自己SHA拒否ロジックで確認済み。無い
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: `H_impl`=`d6b11ee6568346b1407945fd8281fa75544b91d0`（round 3までの内容確定commit）。`H_final`=本commit自身（file名是正commit。`docs/reviews/1485_レビュー.md`が`scripts/check_file_audit.ts`のAUDIT_NAME_PATTERN「連番_課題番号…レビュー.md」に一致せずCIの`npm run audit:check`が失敗したため、`docs/reviews/1485_課題1485BoundedDecisionSkillcoreレビュー.md`へgit mvでrenameし内容は無変更）。`H_impl..H_final`の差分は`git diff`（rename検出あり）でreview artifact1 fileだけであることを`npm run audit:check`で確認済み（§7参照）。`H_impl`自体は`0a4b3f20`（round 1実装）→`23631566`（round 1のH_final、self-review）→`3e3d1359`（round 2、独立review2指摘の是正）→`6e0c893d`（round 3、round 2是正が誘発したtest回帰の是正）→`d6b11ee6`（round 2・3の内容をこのfileへ反映した、file名是正前のH_final。ここまでが`H_impl`側）の直列5commitのancestor chainである
- reviewerの独立性が要求水準を満たす: round 1は**満たさない**（self-review、§9参照）。round 2の2指摘（H-02・H-03）はPR #1497へのcoordinatorによる独立review（context-isolated、実装者と別session）が出所であり、この観点は満たす。round 3（test回帰の是正）は指摘の出所を持たない自己検証である（§9・§6で明示）
- 既定branch追随を行った場合、取り込みがartifact commitより前にあり、`比較基点`が取り込んだ既定branch tip、`H_impl`がartifact直前の最新commitを指し、個別監査表を`比較基点..H_impl`から再生成した: 該当なし（既定branch追随は行っていない。比較基点はworktree作成時のbase固定値）

### 1.1 変更ファイル個別監査

基準SHAとの差分にある全ファイルを、生成物（`dist/`等）も含めて1ファイル1行で記録する。まとめ行、directory単位の一括承認、test成功だけの代替を認めない。`audit:check`の他の検査対象外となる生成物でも、各行へ生成元との対応確認方法と配布影響の確認方法を記録し、差分path集合と表のpath集合を一致させる。

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.agent-skill-chain/00_利用案内.md` | M | reviewerが確認（領域: docs） | docs | 文書 | 文書。循環なし | REQ-WF-030・032（Jev provider設定/decision invoke案内） | 文書。revert | pass |
| `.agent-skill-chain/docs/01_開発ワークフロー.md` | M | reviewerが確認（領域: docs） | docs | 文書 | 文書。循環なし | REQ-WF-030（DCAND-008/009/010節のCLI化） | 文書。revert | pass |
| `.agent-skill-chain/skills/step-10-review/SKILL.md` | M | reviewerが確認（領域: docs） | docs | 文書 | 文書。循環なし | REQ-WF-030（DCAND-006/008/009節のCLI化）。round 2でDCAND-009段落をH-03是正・disclosed residual gapの開示に合わせて訂正 | 文書。revert | pass |
| `dist/src/adapters/decision-invoke.js` | A | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-030 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/adapters/decision-journal-store.js` | A | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-030・031 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/adapters/local-config-workspace.js` | A | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-032 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/adapters/review-session.js` | M | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-031 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/adapters/review-workspace.js` | M | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-032 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/cli-contract.js` | M | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-030 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/cli-usage.js` | M | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-030・031 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/cli.js` | M | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-030 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/domain/decision-authority.js` | A | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-030 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/domain/decision-contract.js` | M | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-029・030 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/domain/decision-journal.js` | A | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-030・031 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/domain/decision-resolvers.js` | A | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-030 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/domain/decision-types.js` | A | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-030 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/domain/jev-provider-config.js` | M | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-028・032 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/domain/local-config-resolution.js` | A | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-032 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/domain/policy.js` | M | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-030 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/domain/review-convergence.js` | M | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-031 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/domain/spec.js` | M | reviewerが確認（領域: 生成物） | 生成物 | 生成物。`npm run build`で対応するsrcから再生成し差分無し | 生成元 → 生成物 | REQ-WF-030 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `docs/reviews/1485_レビュー.md` | A | implementer（self-review。round 2の元指摘はcoordinatorの独立review） | docs | review artifact本体。本fileそのもの（`H_impl`時点でのfile名。この行は`base..H_impl`のgit diffと一致させる必要があるため旧名を使う。file名是正commit`H_final`で`docs/reviews/1485_課題1485BoundedDecisionSkillcoreレビュー.md`へgit mv renameされる。内容は無変更） | 対象実装 → review（許可された向き）。循環なし | REQ-WF-030〜032（本review artifact自身がAC-WF-030〜032を確認する証跡） | 文書。前進commitのみ・revert可 | pass |
| `docs/specs/01_システム概要/02_用語・略語.md` | M | reviewerが確認（領域: docs/specs） | docs/specs | システム仕様書 | spec → src（許可された向き） | TERM-ASC-1485-01〜03追加 | システム仕様書。revert | pass |
| `docs/specs/02_要件/00_要件一覧.md` | M | reviewerが確認（領域: docs/specs） | docs/specs | システム仕様書 | spec → src（許可された向き） | REQ-WF-030・031・032追加 | システム仕様書。revert | pass |
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | reviewerが確認（領域: docs/specs） | docs/specs | システム仕様書 | spec → src（許可された向き） | REQ-WF-030・031・032詳細。round 2でREQ-WF-030本文のconstrained-choice記述をH-03是正に合わせて訂正 | システム仕様書。revert | pass |
| `docs/specs/10_セキュリティ/01_信頼境界.md` | M | reviewerが確認（領域: docs/specs） | docs/specs | システム仕様書 | spec → src（許可された向き） | REQ-WF-030・031（Decision Skill信頼境界節追加）。round 2でconstrained-choice段落をH-03是正・disclosed residual gapの開示に合わせて訂正 | システム仕様書。revert | pass |
| `docs/specs/14_開発・品質/00_ディレクトリ構成.md` | M | reviewerが確認（領域: docs/specs） | docs/specs | システム仕様書 | spec → src（許可された向き） | REQ-WF-030（runtime/decisions領域予約と新規file一覧） | システム仕様書。revert | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | reviewerが確認（領域: docs/specs） | docs/specs | システム仕様書 | spec → src（許可された向き） | REQ-WF-030・031・032のSCN追跡行追加。round 3でREQ-WF-030行へSCN-UNIT-DECINV-008・009を追加（孤立SCN是正） | システム仕様書。revert | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | reviewerが確認（領域: docs/specs） | docs/specs | システム仕様書 | spec → src（許可された向き） | Issue #1485の変更行追加 | システム仕様書。revert | pass |
| `src/adapters/decision-invoke.ts` | A | implementer | adapters | decision invokeのorchestration。resolver/authority/journalを束ねる1責務 | domain各module・review-workspace・local-config-workspaceへ依存（許可された向き）。round 2で`src/domain/role.ts`の`PROVIDER_AUTONOMOUS_CEILINGS`（既存export）への依存を追加（許可された向き、循環無し） | REQ-WF-030、SCN-UNIT-DECINV-001〜009 | 自己申告candidateHeadSha拒否・journal read-back検証。round 2でDCAND-009のcandidateSetをPolicy Allowedと積集合化（H-03是正）。revert可（新規file） | pass |
| `src/adapters/decision-journal-store.ts` | A | implementer | adapters | journal file I/O（read/append/lock）1責務 | domain/decision-journal・domain/staging・lib/atomicへ依存（許可された向き） | REQ-WF-030・REQ-WF-031、SCN-UNIT-DECINV-004 | 既存metrics journalと同型のwriter lock・read-back検証。revert可（新規file） | pass |
| `src/adapters/local-config-workspace.ts` | A | implementer | adapters | ローカル設定のactive→primary fallback一般化1責務 | review-workspace・domain/jev-provider-configへ依存（許可された向き） | REQ-WF-032、SCN-UNIT-LCW-001〜005 | absent時だけfallbackする既存パターンを再利用。revert可（新規file） | pass |
| `src/adapters/review-session.ts` | M | implementer | adapters | `verifyReviewRoundDecisionRefs`をpreviewReviewRoundへ追加した最小差分 | decision-journal-store・decision-journal・review-workspaceへ新規依存を追加（許可された向き、循環無し） | REQ-WF-031、SCN-UNIT-DECREF-001〜004 | decisionRef=nullのfindingは既存挙動を維持しfindingAdmissionを緩めない。revert可（既存test群で回帰検出） | pass |
| `src/adapters/review-workspace.ts` | M | implementer | adapters | `resolveGitWorkspace`抽出＋`resolveReviewRoot`を薄いwrapper化 | 既存git境界検証ロジックの移動のみ（新規依存無し） | REQ-WF-032、SCN-UNIT-LCW-001〜005 | 検証ロジック自体は無変更（コピーではなく関数分割）。revert可（既存supplemental-review-launch.ts等の既存testで回帰検出） | pass |
| `src/cli-contract.ts` | M | implementer | adapters | CLI_USAGE banner文字列へ`decision`を追加した1行差分 | 依存無し | REQ-WF-030 | check_cli_contract.tsの既存検査対象外（`decision`は必須列挙外）。revert可 | pass |
| `src/cli-usage.ts` | M | implementer | adapters | `decision invoke`/`decision types`のCOMMAND_USAGE追加＋既存review round入力例へdecisionRef欄を追加。round 2で`decision invoke`のinputContract説明をH-03是正（role.ts交差）に合わせて訂正 | 既存パターンに追従（ROOT_FLAG/APPLY_MODE再利用） | REQ-WF-030・REQ-WF-031 | 既存commandのusageは変更しない（追加のみ）。revert可 | pass |
| `src/cli.ts` | M | implementer | adapters | `decision invoke`/`decision types`のcommand dispatch追加 | decision-invoke・decision-typesへ新規依存（既存if-chain規約に追従） | REQ-WF-030 | 既存command blockへの追加のみで既存分岐は無変更。revert可（既存CLI test群で回帰検出） | pass |
| `src/domain/decision-authority.ts` | A | implementer | domain | authorityMode→effectiveValue判定1責務（pure） | decision-types（型のみ） | REQ-WF-030、SCN-UNIT-DECAUTH-001〜008 | fs/git/processを参照しないpure関数。revert可（新規file） | pass |
| `src/domain/decision-contract.ts` | M | implementer | domain | DCAND-006/008/009/010のdisposition更新＋DCAND-003/005のfile:line修正。round 3でDCAND-006/008/009/010のcallerLineをround 2の行移動後の実際の行番号（241→273、153→180、258→290、273→324）へ再修正 | 既存DECISION_CANDIDATES配列の該当entryだけを更新 | REQ-WF-029（既存）・REQ-WF-030 | SCN-UNIT-DC-002/003が新しいfile:line・callerを実在確認済み（round 3の再修正後も再確認済み）。revert可 | pass |
| `src/domain/decision-journal.ts` | A | implementer | domain | DecisionJournalRecord型・digest計算・decisionRef検証1責務（pure） | lib/security（stableJsonのみ） | REQ-WF-030・REQ-WF-031、SCN-UNIT-DECREF-001〜004 | fs/git/processを参照しないpure関数。既存DecisionJournalField（decision-contract.ts）は削除せず残す。revert可（新規file） | pass |
| `src/domain/decision-resolvers.ts` | A | implementer | domain | DCAND-001〜005・008のresolver wrapper1責務 | mode/ci-delivery/spec/review-artifact/policyの既存exportを呼ぶだけ | REQ-WF-030、SCN-UNIT-DECINV-001〜003 | 既存関数をラップするだけでロジックを複製しない。revert可（新規file） | pass |
| `src/domain/decision-types.ts` | A | implementer | domain | Decision Type Registry（executor/authorityMode）静的定義1責務 | decision-contract（型のみ） | REQ-WF-030 | 静的定数のみでfs/git/processを参照しない。revert可（新規file） | pass |
| `src/domain/jev-provider-config.ts` | M | implementer | domain | `classifyJevProviderConfig`抽出＋`loadJevProviderConfig`を薄いwrapper化 | 既存fsのみ（git・model-mapping・project-policyへは触れない、INV-1484-04維持） | REQ-WF-028（既存）・REQ-WF-032、SCN-UNIT-JEVCFG-001〜013 | 既存8scenarioの外部から見た挙動は不変（既存test合格で確認）。revert可 | pass |
| `src/domain/local-config-resolution.ts` | A | implementer | domain | `LocalConfigResolution<T>`型定義1責務 | 依存無し（型定義のみ） | REQ-WF-032 | 静的型のみ。revert可（新規file） | pass |
| `src/domain/policy.ts` | M | implementer | domain | `hasConcreteDecisionText`へ`export`を追加した1語差分 | 依存変更無し | REQ-WF-030 | 既存呼び出し元（`validateApplicabilityDecision`、同一file内）の呼び出し方は無変更。revert可 | pass |
| `src/domain/review-convergence.ts` | M | implementer | domain | `ReviewRoundFinding.decisionRef`（nullable）追加＋parseFinding/parseReviewSessionStateのfield列更新 | 既存型・関数への追加のみ（新規依存無し） | REQ-WF-031、SCN-UNIT-DECREF-001〜004 | 既存必須field集合は維持し、decisionRefは既存findingAdmissionの判定ロジックを変更しない。revert可（既存review-convergence testで回帰検出） | pass |
| `src/domain/spec.ts` | M | implementer | domain | `requiresSpecUpdate`をinline式から関数抽出 | 依存変更無し | REQ-WF-030 | 正規表現・入力は無変更（DCAND-003のanchor更新で実在確認済み）。revert可（既存spec.ts testで回帰検出） | pass |
| `test/features/unit/decision-authority.feature` | A | reviewerが確認（領域: test） | test | test。SCN-UNIT-DECAUTH-001〜008を定義 | test → 対象（許可された向き） | REQ-WF-030、AC-WF-030 | test。revert | pass |
| `test/features/unit/decision-invoke.feature` | A | reviewerが確認（領域: test） | test | test。SCN-UNIT-DECINV-001〜007を定義。round 2でSCN-UNIT-DECINV-008・009を追加（H-03是正の回帰確認） | test → 対象（許可された向き） | REQ-WF-030、AC-WF-030 | test。revert | pass |
| `test/features/unit/decision-ref-verification.feature` | A | reviewerが確認（領域: test） | test | test。SCN-UNIT-DECREF-001〜004を定義 | test → 対象（許可された向き） | REQ-WF-031、AC-WF-031 | test。revert | pass |
| `test/features/unit/jev-provider-config.feature` | M | reviewerが確認（領域: test） | test | test。SCN-UNIT-JEVCFG-009〜013を既存8scenarioへ追加 | test → 対象（許可された向き） | REQ-WF-028・032、AC-WF-032 | test。revert | pass |
| `test/features/unit/local-config-workspace.feature` | A | reviewerが確認（領域: test） | test | test。SCN-UNIT-LCW-001〜005を定義 | test → 対象（許可された向き） | REQ-WF-032、AC-WF-032 | test。revert | pass |
| `test/steps/decision-authority.steps.ts` | A | reviewerが確認（領域: test） | test | test。decision-authority.featureのstep定義 | test → 対象（許可された向き） | REQ-WF-030 | test。revert | pass |
| `test/steps/decision-contract.steps.ts` | M | reviewerが確認（領域: test） | test | test。FILE_LINE_PATTERNへUnicode文字対応を追加（DCAND-008/010採用に伴う） | test → 対象（許可された向き） | REQ-WF-029（既存）・REQ-WF-030 | test。revert（既存SCN-UNIT-DC-*の合格を維持） | pass |
| `test/steps/decision-invoke.steps.ts` | A | reviewerが確認（領域: test） | test | test。decision-invoke.featureのstep定義。round 2でSCN-UNIT-DECINV-008・009のfixture（candidateSet=["gemini","mistral"]等）を追加、既存007のfixtureを実在するprovider名（"codex"・"claude"）へ更新 | test → 対象（許可された向き） | REQ-WF-030 | test。revert | pass |
| `test/steps/decision-ref-verification.steps.ts` | A | reviewerが確認（領域: test） | test | test。decision-ref-verification.featureのstep定義 | test → 対象（許可された向き） | REQ-WF-031 | test。revert | pass |
| `test/steps/evidence-reanchor.steps.ts` | M | reviewerが確認（領域: test） | test | test。既存finding fixtureへ`decisionRef: null`を追加（新規field対応） | test → 対象（許可された向き） | REQ-WF-031（既存test回帰防止） | test。revert | pass |
| `test/steps/jev-provider-config.steps.ts` | M | reviewerが確認（領域: test） | test | test。classifyJevProviderConfig用step追加（既存8scenarioのstepは無変更） | test → 対象（許可された向き） | REQ-WF-028・032 | test。revert | pass |
| `test/steps/local-config-workspace.steps.ts` | A | reviewerが確認（領域: test） | test | test。local-config-workspace.featureのstep定義 | test → 対象（許可された向き） | REQ-WF-032 | test。revert | pass |
| `test/steps/review-convergence.steps.ts` | M | reviewerが確認（領域: test） | test | test。既存finding fixtureへ`decisionRef: null`を追加（新規field対応） | test → 対象（許可された向き） | REQ-WF-031（既存test回帰防止） | test。revert | pass |
| `test/steps/review-round-init.steps.ts` | M | reviewerが確認（領域: test） | test | test。既存finding fixtureへ`decisionRef: null`を追加（新規field対応） | test → 対象（許可された向き） | REQ-WF-031（既存test回帰防止） | test。revert | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: round 1では`review artifact --init`が実git差分から自動導出した60 pathと表の行数が一致していた。round 2・3で`docs/reviews/`配下のreview artifact自身が差分に加わり61 pathとなったため、本round更新でその1行を追加した。`eea59fbf`..`d6b11ee6`（本節の`H_impl`）の61 pathと表の行数が一致することを確認した。file名是正commit（本commit自身、`H_final`）でfile名が変わった後も`git diff`のrename検出により同じ1行のまま61 pathを維持することを`npm run audit:check`で確認済み（§7参照）
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: 新規moduleはすべてsrc/domain・src/adaptersの既存層別配置規約に従う。project固有値やauthorityの混入は無い
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: round 2はH-02（14 file、prettier整形のみ）・H-03（`src/adapters/decision-invoke.ts`のDCAND-009候補集合、`role.ts`のPolicy Allowed定数への依存を新設）を、その変更fileと隣接依存（`src/domain/role.ts`のexport、関連test・SKILL.md・cli-usage.ts・spec文書の該当箇所）だけ再監査した。round 3は`src/domain/decision-contract.ts`のcallerLine 4件と`15_要件追跡/00_追跡表.md`のSCN追跡行1件という、round 2の差分が誘発した機械検査の不整合だけを再監査した（新規findingではない。§2.0 DISC欄には追加していない理由は§6参照）

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

発見IDは実装計画（fullは03、quick/pocは集約00）の`DISC-*`と同じ字面を使い、本文書内で別IDへ言い換えない。

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-001 | `decision-contract.ts`のDCAND-003/005のfile:line anchorが、`spec.ts`/`policy.ts`の抽出・export化に伴う行移動でずれた | AC-WF-029の既存test（SCN-UNIT-DC-002） | なし | decisionSiteLine/callerLineを実測し直し303→265・373→378・395→403へ修正 | `npm test`でSCN-UNIT-DC-002再合格を確認 | no-spec-impact | pass |
| DISC-002 | 新規SCN群（DECAUTH/DECINV/DECREF/JEVCFG-009〜013/LCW）が`15_要件追跡/00_追跡表.md`から未到達の「孤立SCN」としてSCN-INT-SPECNORM-001に検出された | AC-SQ関連の仕様整合性検査 | あり（新規requirement） | REQ-WF-030〜032を新設し追跡表・要件一覧・ワークフロー要件へ追加 | `npm test`でSCN-INT-SPECNORM-001再合格を確認 | updated | pass |
| DISC-003 | L-05（support_ms実測、実タスク最低3件）・L-06（review品質A/B比較、最低1件）は本Issue単独では自分自身の実装1件しかサンプルを提供できない | L-05・L-06の完了条件 | なし | T07として完了条件未達を明示し、Issue報告で後続実タスクでの継続実測が必要であることを伝える | 該当なし（未達を記録） | no-spec-impact | finding（Low、対象外ではなく未達として記録） |
| DISC-004 | `src/adapters/decision-invoke.ts`のconstrained-choice（DCAND-009）が呼び出し元宣言の`candidateSet`を無検証で信頼し、Policy Allowedとの独立算出を行っていなかった（PR #1497へのcoordinatorの独立reviewが指摘。§5のH-03と同一事象） | AC-WF-030（DCAND-009のconstrained-choiceが安全側の設計意図を満たすこと） | あり（candidateSetの算出方法を変更） | `PROVIDER_AUTONOMOUS_CEILINGS`（role.ts）から導出したPolicy Allowed集合と交差させてから`proposedValue`を検証するよう変更。Configured/Dispatchable・Independence Eligibleのnarrowingは未実装のdisclosed residual gapとして開示 | SCN-UNIT-DECINV-008・009 | updated（`docs/specs/10_セキュリティ/01_信頼境界.md`・`docs/specs/02_要件/01_ワークフロー要件.md`等） | pass（round 2で是正済み。残存gapはdisclosed。§5のH-03参照） |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-WF-030 | SCN-UNIT-DECAUTH-001〜008 | `src/domain/decision-authority.ts` | 8 scenarios合格 | pass | `npm test`該当feature |
| AC-WF-030 | SCN-UNIT-DECINV-001〜009 | `src/adapters/decision-invoke.ts`（round 2で既存`src/domain/role.ts`の`PROVIDER_AUTONOMOUS_CEILINGS`への新規依存を追加。`role.ts`自体は無変更） | 9 scenarios合格（008・009はround 2、H-03是正の回帰確認として追加） | pass | `npm test`該当feature |
| AC-WF-031 | SCN-UNIT-DECREF-001〜004 | `src/adapters/review-session.ts`、`src/domain/review-convergence.ts` | 4 scenarios合格 | pass | `npm test`該当feature |
| AC-WF-032 | SCN-UNIT-LCW-001〜005 | `src/adapters/local-config-workspace.ts` | 5 scenarios合格 | pass | `npm test`該当feature |
| AC-WF-032 | SCN-UNIT-JEVCFG-009〜013 | `src/domain/jev-provider-config.ts` | 5 scenarios合格（既存8scenarioも回帰なし） | pass | `npm test`該当feature |
| L-05・L-06（Issue本文） | 該当SCN無し（実測課題） | 未実施 | 未実施 | not-applicable | DISC-003参照。本Issue単独では完了条件を満たせない |

### 2.2 開発考慮事項の適用判定（必須）

00の判定・理由・証拠から差分が無ければ、表の代わりに`開発考慮事項の適用判定は00_要求定義.md §6.1と同じ`の1行を置ける（01〜03と同じ参照行）。差分がある行だけを表に残してよい。**`review validate`はこの§2.2の内容を検証しない**（01〜03の`issue validate`と異なり、review artifactのDC判定に対する機械検証は無い）。記述量を減らすための人・エージェント向けの案内であり、参照行を置いても4行の表を書いても合否は変わらない。

開発考慮事項の適用判定は00_要求定義.md §6.1と同じ

## 3. 肯定的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ（要件と観測結果の一致） | pass | FR-01〜FR-10（01 §4）が実装済みcodeと1:1対応し、SCN-UNIT-DECAUTH/DECINV/DECREF/LCW/JEVCFGの全24 scenario合格で観測を確認した |
| 価値（利用者・運用上の目的） | pass | DCAND-006/008/009/010が呼び出し元を持つCapabilityへ変わり、support_ms削減の足場（journal記録・authorityMode制御）が整った。実測（L-05/L-06）はDISC-003で未達を明示 |
| 実現可能性（環境・依存・権限） | pass | 新規外部依存を追加せず既存git/fs機構だけで実装した。`npm run build`・`npx tsc --noEmit`・`npm run lint`が全て成功する |
| 整合性（設計・コード・テスト・仕様） | pass | 02設計の11コンポーネントと実装moduleが1:1対応し、`docs/specs/`6fileへ反映済み（REQ-WF-030〜032） |
| 保守性（責務・命名・変更容易性） | pass | registry/resolvers/authority/journal/journal-store/invokeを単一責務moduleへ分離済み（02 §2.2）。DCAND番号を用語IDと一致させた命名 |

## 4. 敵対的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 反例（要件を破る入力・状態） | pass | 空文字列proposedValue/candidateHeadSha/subjectRefは`requiredString`が例外で拒否する（SCN-UNIT-DECINV-005で自己申告SHA不一致を確認）。constrained-choiceの候補集合外はrejectedとして拒否（SCN-UNIT-DECAUTH-008・SCN-UNIT-DECINV-007）。DCAND-009では呼び出し元が宣言する`candidateSet`自体もPolicy Allowedとの積集合が空ならエラーで拒否し、Policy Allowed外の値を`candidateSet`と`proposedValue`の両方に混入させても強制通過できない（SCN-UNIT-DECINV-008・009、round 2のH-03是正） |
| 失敗経路（外部失敗・部分失敗） | pass | Jev未dispatchはproviderNoteで明示し例外化しない。git呼び出し失敗は既存`git()`helperの例外がそのまま伝播し握り潰さない |
| 境界値（空、最大、最小、重複、Unicode） | pass | DCAND-008のobservations空配列→unknown（SCN-UNIT-DECINV-003）。decision-contract.stepsのFILE_LINE_PATTERNをUnicode文字（Kanji）対応へ拡張し既存ASCII pathの挙動を変えないことを確認 |
| 悪用（注入、経路脱出、権限外） | pass | journal directoryは`path.basename(id)`でtraversal防止（既存metrics journalと同型）。`--apply`なしでは副作用が発生しない |
| 安全性（認証、承認、秘密情報、Zero Trust） | pass | candidateHeadShaは実HEAD照合で自己申告拒否（Zero Trust）。authorityModeのfail-open防止ロジックはCLI入力で上書き不可能なpure関数に固定。Jev API key値は出力・journalに含めない（INV-04） |
| データ損失（上書き、削除、部分公開、履歴消失） | pass | journalはappend-onlyで既存recordを上書きしない。重複decisionRecordIdは拒否し既存recordを保護する |
| ロールバック（復旧参照、状態保持、再開可能性） | pass | `decision invoke`はopt-inで、呼ばなければ既存のprose判断へ即戻れる（01 §11ロールバック条件）。journal write失敗はread-back検証で検知し、書き込み前状態を保持する |
| 範囲漏れ（呼び出し元、利用側、配布物、文書） | pass | DCAND-001〜005の呼び出し元（issue.ts:1688、cli.ts:1740付近・7223、review-artifact.ts:654、policy.ts:403）自体は本Issueで1行も変更していない（grep実測。DCAND-002のcli.ts:1738記載は実際は1740で、既存repository側の既知のずれであり本Issueの変更ではない。SCN-UNIT-DC-002の±2行許容窓内で従来から合格していた）。decisionSiteFile側（spec.ts・policy.ts）は関数抽出・export追加のみで判定ロジック・入出力は不変（既存test群の無回帰で確認）。配布物（dist/）はビルド済みで§8に反映済み |

## 5. 指摘

round 1（self-review）が導入した差分にCritical/High/Mediumの指摘は無かった（1件のLow=L-01のみ）。round 2でPR #1497へのcoordinatorによる独立review（context-isolated）がMedium 1件・High 1件を新たに検出し、いずれも本round内で前進commitにより是正済みである（§6参照）。

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| L-01 | Low | `decision-contract.ts`のDCAND-002 callerLine記載が"1738"だが実際の呼び出し行は"1740"（既存repository側の既知のずれ。本Issueで新設・変更していない） | `sed -n '1740p' src/cli.ts`で`inspectCiDelivery({`を実測。SCN-UNIT-DC-002の±2行許容窓内で従来から合格 | 表示上の精度のみ。判定・機能への影響なし | 対象外（本Issueのscope外。ASC本体是正は別Issueとする） | out-of-scope | なし（±2行許容で機械検査は継続して合格する） |
| H-02 | Medium | CI check「日本語文書・Gherkin・型・配布物の品質検証」が`npm run format:check`で失敗した。prettierが14 file（decision-invoke.ts、decision-journal-store.ts、local-config-workspace.ts、cli-usage.ts、decision-authority.ts、decision-journal.ts、decision-resolvers.ts、decision-types.ts、review-convergence.ts、および5件の`*.steps.ts`）を検出 | PR #1497のCI run（coordinatorが報告）。`npx prettier --write`適用後の`npm run format:check`で"All matched files use Prettier code style!"を確認 | CI red。mergeが進められない状態だった | `npx prettier --write`を該当14 fileへ適用し、round 2のfix commit（`3e3d1359`）へ含めた | resolved | なし（format:checkが継続して合格することを本round・round 3・§7で再確認済み） |
| H-03 | High | `src/adapters/decision-invoke.ts`のconstrained-choice実装が`--input.payload.candidateSet`を無検証で信頼し、呼び出し元が`candidateSet`と一致する`proposedValue`を宣言するだけで任意の値を`effectiveValue`として通過させられた。DCAND-009のconstrained-choiceが要求する「候補集合はPolicy Allowed ∩ Configured/Dispatchable ∩ Independence Eligible（すべてcompiled codeが算出）」を満たさず、事実上authoritativeと同等になっていた（独立reviewの指摘。自身のself-reviewは`resolveAuthorityDecision`という純関数の判定だけを検証し、その入力である`candidateSet`の出所を検証していなかった） | 是正前の`src/adapters/decision-invoke.ts`（`3e3d1359`の親、round 2直前の状態）の該当箇所をcoordinatorが直接読み検出。是正後はSCN-UNIT-DECINV-008（Policy Allowed外だけの宣言はエラーで拒否）・SCN-UNIT-DECINV-009（Policy Allowed外を混入させても強制通過できない）で再現・回帰確認済み | DCAND-009のconstrained-choiceが安全側の設計意図を満たさない状態でPRに含まれていた（AC-WF-030違反） | `src/domain/role.ts`の`PROVIDER_AUTONOMOUS_CEILINGS`から`DCAND009_POLICY_ALLOWED_PROVIDERS`（ollama除外）を導出し、DCAND-009のときだけ呼び出し元宣言の`candidateSet`をこの集合と交差させてから`proposedValue`を検証するよう変更。積集合が空ならエラーで拒否する。Configured/Dispatchable・Independence Eligibleの narrowing は未実装であることをコード注釈・SKILL.md・cli-usage.ts・`docs/specs/10_セキュリティ/01_信頼境界.md`・`docs/specs/02_要件/01_ワークフロー要件.md`へ開示済み（disclosed residual gap） | resolved | **残存**: Policy Allowedとの積集合だけを強制し、Configured/Dispatchable（実際に呼び出し可能か）とIndependence Eligible（reviewerとimplementerの独立性）の narrowing はcompiled codeで算出していない。呼び出し元は「Policy Allowedだが現在Configured/Dispatchableでない」provider名を宣言に含められる。disclosed residual gapとして各文書へ明記済み（follow-up Issueでの拡張が必要） |

## 6. ラウンド固有の確認

review sessionのround番号（`review-session.json`の`rounds[].round`、1〜3）と、本節の見出しは同じ数字を指す。round 2・3はいずれもround 1のH_final（`23631566`）より後の前向き修正であり、H_impl/H_finalのamendは行っていない。

### ラウンド1

- 全評価基準を確認した: はい（§3・§4の全観点を確認済み）
- 指摘を確定した: L-01（Low、out-of-scope）のみ。Critical/High/Mediumは無し
- 次ラウンド対象のCritical/High: 無し
- reviewの出所: self-review（実装者本人。§9参照）

### ラウンド2

- 発生条件: round 1収束後、PR #1497へのcoordinatorによる独立review（context-isolated、実装者と別session、対象差分は非変更）が2件を検出した
- 指摘: H-02（Medium、CI format:check失敗。14 fileのprettier未整形）、H-03（High、DCAND-009 constrained-choiceの信頼境界gap。§5参照）
- 対応: 両指摘とも本round内の前進commit（`3e3d1359f9d5930c4bf9deaa41ba6d3d1244bc6a`）で是正し、review sessionは両findingを`status: resolved`・`admission: record-only`として記録した（`recordReviewRound`が非有効findingを履歴専用に振り分ける既定挙動どおり）
- 再監査した範囲: H-02はprettier整形のみなので機能差分は無し。H-03は`src/adapters/decision-invoke.ts`のconstrained-choice分岐と、新設した`src/domain/role.ts`への依存、および関連文書（SKILL.md、cli-usage.ts、`docs/specs/10_セキュリティ/01_信頼境界.md`、`docs/specs/02_要件/01_ワークフロー要件.md`）を再監査した
- 次ラウンド対象のCritical/High: 無し（両指摘とも本round内で解消）
- reviewの出所: 独立review（coordinator、PR #1497への直接検証）。是正と是正後の再確認自体は実装者本人が行った（fixとverificationの分離までは本sandbox環境で実現できていない。§9で明示）

### ラウンド3

- 発生条件: round 2のfix commit（`3e3d1359`）が`src/adapters/decision-invoke.ts`の行数を移動させ、`npm test`実行で2件の機械検査が新たに失敗した。これは独立reviewからの新規指摘ではなく、round 2のfixを実装者自身がpushする前に`npm test`で検出した回帰である
  1. `decision-contract.ts`のDCAND-006/008/009/010のcallerLineが実際の行番号（241→273、153→180、258→290、273→324）とずれ、SCN-UNIT-DC-002が失敗した
  2. round 2で追加したSCN-UNIT-DECINV-008/009が`15_要件追跡/00_追跡表.md`のREQ-WF-030行から未到達の「孤立SCN」としてSCN-INT-SPECNORM-001に検出された
- 対応: 両件とも本round内の前進commit（`6e0c893d58a9ded2a0cfb73c3a83237369c9ff22`）で是正した。callerLineを実測し直し、追跡表へSCN-UNIT-DECINV-008/009をREQ-WF-030行へ追加した。挙動・設計判断の変更は無い（機械検査の整合性回復のみ）
- 判定: findingとして記録しない（§2.0のDISC欄にも追加しない）。理由: round 2の設計判断そのものを変えるものではなく、round 2の差分がすでに存在した機械検査（callerAnchor近傍検査・SCN到達可能性検査）を後追いで満たし直しただけであり、新しい事実の発見（DISC-*の定義）でも新しいreview指摘（H-*の定義）でもない。これはround 2の同一fixを完成させるための後続修正として扱う
- 次ラウンド対象のCritical/High: 無し
- reviewの出所: 自己検証（`npm test`実行による機械検査。指摘の出所を持たない）

### file名是正（roundではない、機械検査の整合性回復）

- 発生条件: round 3の`H_final`をこのfileへcommitする直前に、CIの「日本語文書・Gherkin・型・配布物の品質検証」の`npm run audit:check`（`scripts/check_file_audit.ts`）を実測すると、`docs/reviews/1485_レビュー.md`が`AUDIT_NAME_PATTERN`（`^\d+_課題\d+.*レビュー\.md$`、連番_課題番号…レビュー.md）に一致せず失敗した。この命名規約はround 1のH_final（`23631566`）が最初に作成した時点から一度も満たしていなかった既存の欠陥であり、これまでCIの`audit:check`が実際に実行され結果を確認されたことが無かったために見逃されていた（`docs/reviews/`配下の他Issueのartifactは全て`<連番>_課題<Issue番号>…レビュー.md`の形を取っており、本fileだけが例外だった）
- 対応: `docs/reviews/1485_レビュー.md`を`docs/reviews/1485_課題1485BoundedDecisionSkillcoreレビュー.md`へ`git mv`でrenameし、file内の自己参照6箇所を追随させた前進commit（本commit自身（自己参照のため確定SHAはgit logで確認する））で是正した。内容の変更は無い（純粋なrename＋自己参照path文字列の追随）
- 構造上の影響: `checkFileAudit`は`git diff --no-renames`で1 fileだけが変わるcommitを遡って`H_impl`を導出するため、rename（`--no-renames`では旧file削除＋新file追加の2 pathに見える）はこの遡りをこのcommitの直前で打ち切る。そのため機械的に導出される`H_impl`は本round更新までの内容確定commit`d6b11ee6`（round 3の`6e0c893d`のさらに後、round 2・3の内容をこのfileへ反映したcommit）になり、file名是正commit本commit自身が新しい`H_final`になる（§0・§1で反映済み）。設計判断・受け入れ条件・findingの内容には一切影響しない
- 判定: findingとして記録しない。理由はround 3と同型（既存の機械検査を満たし直す後追い修正であり、新しい事実の発見でも新しいreview指摘でもない）
- reviewの出所: 自己検証（`npm run audit:check`実行による機械検査。指摘の出所を持たない）

## 7. テスト結果

- 実行したcommandの一覧: `npx tsc --noEmit -p .`、`npm run lint`、`npm run format:check`、`npm run build`、`npm run audit:check`、`npm test`（cucumber全体）
- round 3のfix commit（`6e0c893d`）後の最終実測: `npm test`が`2397 scenarios (2380 passed, 17 skipped, 0 failed)`、`26971 steps (26916 passed, 55 skipped, 0 failed)`、実行時間9m35.215s（EXIT:0）。同時に`npx tsc --noEmit -p .`・`npm run lint`・`npm run format:check`（"All matched files use Prettier code style!"）・`npm run build`が全て成功することを確認した
- file名是正commit（本commit自身）後の実測: `npm run audit:check`が`{"valid": true, "base": "eea59fbf467c534d8c5b578d818c03f0d9aa898f", "implementation": "d6b11ee6568346b1407945fd8281fa75544b91d0", "auditPath": "docs/reviews/1485_課題1485BoundedDecisionSkillcoreレビュー.md", "auditedFiles": 61}`で成功（`current`はcommit自身のSHAであり自己参照のため省略。本fileの§0 H_impl記載を`d6b11ee6`へ、§1.1の本fileの個別監査行を`H_impl`時点の旧名へ更新した後に実測）。同時に`npm run build`・`npm run lint`・`npm run format:check`・`npx tsc --noEmit -p .`・`review validate --artifact`が全て成功することを確認した（rename・自己参照path文字列の追随のみでcucumber対象のsrc/testに変更が無いため、`npm test`の再実行は必須ではないが、PR pushに伴うCIの完全実行で最終確認する）
- 途中経過（参考）: round 2のfix直後（`3e3d1359`、round 3是正前）の`npm test`は`2397 scenarios (2378 passed, 17 skipped, 2 failed)`で、SCN-UNIT-DC-002（callerAnchor行ずれ）とSCN-INT-SPECNORM-001（孤立SCN）の2件が失敗した。これがround 3の発生条件である（§6参照）。round 3是正後に上記の0 failedへ収束した。なお、途中の1回の実行でSCN-INT-CONSUMER-007が1件failedになったが、単独実行では即座にpassしたため full suite実行時だけの環境依存flakeと判断し、本Issueの変更に起因しないと結論した（再現しない一過性の観測のため表には残さない）
- scenario総数が旧round（2395）から2397へ増えているのは、round 2で追加したSCN-UNIT-DECINV-008・009の2件による
- 失敗またはskipがある層: skip 17件は既存の事前skip（本Issue以前から存在。今回の変更と無関係）。最終実測の失敗は0件
- runnerと`projectChoices.gherkinDialect`: `@cucumber/cucumber`、dialect既定`en`（`Feature:`/`Scenario:`/`Given`/`When`/`Then`）

## 8. 配布物影響

packageとして配布する場合だけ記入する。配布境界はpackage manifestの配布file指定を正本とし、compileされて配布される`source`も含める。

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| .agent-skill-chain/00_利用案内.md | 入る | reviewerが確認 |
| .agent-skill-chain/docs/01_開発ワークフロー.md | 入る | reviewerが確認 |
| .agent-skill-chain/skills/step-10-review/SKILL.md | 入る | reviewerが確認 |
| dist/src/ | 入る | reviewerが確認 |
| docs/reviews/1485_課題1485BoundedDecisionSkillcoreレビュー.md | 入らない | なし（review artifactはproject固有資産。package配布物に含まれない） |
| docs/specs/01_システム概要/02_用語・略語.md | 入らない | なし |
| docs/specs/02_要件/00_要件一覧.md | 入らない | なし |
| docs/specs/02_要件/01_ワークフロー要件.md | 入らない | なし |
| docs/specs/10_セキュリティ/01_信頼境界.md | 入らない | なし |
| docs/specs/14_開発・品質/00_ディレクトリ構成.md | 入らない | なし |
| docs/specs/15_要件追跡/00_追跡表.md | 入らない | なし |
| docs/specs/15_要件追跡/01_変更履歴.md | 入らない | なし |
| src/adapters/decision-invoke.ts | 入る | reviewerが確認 |
| src/adapters/decision-journal-store.ts | 入る | reviewerが確認 |
| src/adapters/local-config-workspace.ts | 入る | reviewerが確認 |
| src/adapters/review-session.ts | 入る | reviewerが確認 |
| src/adapters/review-workspace.ts | 入る | reviewerが確認 |
| src/cli-contract.ts | 入る | reviewerが確認 |
| src/cli-usage.ts | 入る | reviewerが確認 |
| src/cli.ts | 入る | reviewerが確認 |
| src/domain/decision-authority.ts | 入る | reviewerが確認 |
| src/domain/decision-contract.ts | 入る | reviewerが確認 |
| src/domain/decision-journal.ts | 入る | reviewerが確認 |
| src/domain/decision-resolvers.ts | 入る | reviewerが確認 |
| src/domain/decision-types.ts | 入る | reviewerが確認 |
| src/domain/jev-provider-config.ts | 入る | reviewerが確認 |
| src/domain/local-config-resolution.ts | 入る | reviewerが確認 |
| src/domain/policy.ts | 入る | reviewerが確認 |
| src/domain/review-convergence.ts | 入る | reviewerが確認 |
| src/domain/spec.ts | 入る | reviewerが確認 |
| test/features/unit/decision-authority.feature | 入らない | なし |
| test/features/unit/decision-invoke.feature | 入らない | なし |
| test/features/unit/decision-ref-verification.feature | 入らない | なし |
| test/features/unit/jev-provider-config.feature | 入らない | なし |
| test/features/unit/local-config-workspace.feature | 入らない | なし |
| test/steps/decision-authority.steps.ts | 入らない | なし |
| test/steps/decision-contract.steps.ts | 入らない | なし |
| test/steps/decision-invoke.steps.ts | 入らない | なし |
| test/steps/decision-ref-verification.steps.ts | 入らない | なし |
| test/steps/evidence-reanchor.steps.ts | 入らない | なし |
| test/steps/jev-provider-config.steps.ts | 入らない | なし |
| test/steps/local-config-workspace.steps.ts | 入らない | なし |
| test/steps/review-convergence.steps.ts | 入らない | なし |
| test/steps/review-round-init.steps.ts | 入らない | なし |

判断: 配布物を更新した

根拠: `dist/src/`配下8 fileを新規追加、11 fileを更新（`npm run build`でsrcから再生成し差分無しを確認済み。round 2・3で更新した`decision-invoke.ts`・`decision-contract.ts`の再生成分も含む）。`.agent-skill-chain/00_利用案内.md`・`.agent-skill-chain/docs/01_開発ワークフロー.md`・`.agent-skill-chain/skills/step-10-review/SKILL.md`はpackage配布物（`.agent-skill-chain/`配下）に含まれる。`docs/specs/`・`docs/reviews/`・`test/`はpackage配布物に含まれない（利用projectのrepository固有資産）

## 9. 独立reviewの成立

PR作成前に観測できるものだけを書く。immutable review IDやapproval件数は書かない。round 1〜3で状況が異なるため、round別に分けて記録する。

| 項目 | round 1 | round 2 | round 3 |
|---|---|---|---|
| 適用した独立性モード | 未適用（self-review） | 未適用（instruction上は`pr create`後のCI/独立reviewだが、実際にはPR #1497に対するcoordinatorの直接検証として発生した） | 未適用（自己検証。指摘の出所を持たない） |
| その要求を満たすこと | **いいえ。** 本sandbox環境にローカルLLM reviewer・Codex Sol・Opusのいずれも未設定で、実装者自身によるself-review | **findingの発見については、はい。** coordinatorはPR #1497のCI結果と`src/adapters/decision-invoke.ts`のコードを実装者と別session・別contextで直接検査し、実装者のself-reviewが見逃していたH-02・H-03を検出した。**是正の実施と是正後の再検証については、いいえ。** 指摘を受けて実際にfixを書き、テストを実行して確認したのは実装者自身であり、fix自体への独立reviewはこのartifact更新時点では未実施（PR再送後にcoordinatorが行う） | 該当なし。findingが無く（§6参照）、実装者自身の`npm test`実行が唯一の検証手段 |
| reviewerとimplementerのidentity・context比較 | 同一（self-reviewのため独立性要求を満たさない） | finding発見者（coordinator）と実装者は別。ただしfixの実施者とfix後の検証実施者は実装者自身で同一 | 同一（自己検証） |
| reviewerが対象差分を変更していないこと | 該当なし | 該当あり。coordinatorは指摘を出しただけで、`src/adapters/decision-invoke.ts`等の対象差分自体は変更していない（変更は実装者が行った） | 該当なし |

**この制約はcoordinatorへの報告で明示する。** round 2のH-02・H-03はcoordinatorという独立した観測者が実際に見つけたfindingであり、self-reviewの限界（§5・H-03の欄で述べた「純関数の判定だけを検証し入力の出所を検証しない」ギャップ）を補う実例になっている。ただし、その指摘に対する**fixの正しさ自体**は、このartifact更新時点でもなお実装者自身の自己検証（round 2・3内の`npm test`・`npx tsc --noEmit`・`npm run lint`・`npm run format:check`）にとどまり、fixを独立に再検証したformal independent approvalは成立していない。`pr create`（再push）後、coordinatorがCI・CodeRabbit（利用可能な場合）とPRの直接検査でこのfixを独立に再検証し、mergeの可否を判断する。本artifactの`approved`判定はformal independent approvalではなく、実装者自身の敵対的self-review（および、round 2についてはcoordinator発見のfindingへの対応）が§3・§4・§5の観点を満たしたことを示すに留まる。

外部への不可逆な配布で外部証拠を要求され、かつ無い場合だけ次を記入する。承認元・承認者・承認日時・失効日時は正本を参照し複製しない。

| 項目 | 内容 |
|---|---|
| 適用する例外の識別子 | {正本fileのexceptionId} |
| 観測値 | {未実行と判定した根拠の実測値} |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様（round 1）: `docs/specs/01_システム概要/02_用語・略語.md`（TERM-ASC-1485-01〜03）、`docs/specs/02_要件/00_要件一覧.md`・`01_ワークフロー要件.md`（REQ-WF-030〜032）、`docs/specs/10_セキュリティ/01_信頼境界.md`（Decision Skill信頼境界節）、`docs/specs/14_開発・品質/00_ディレクトリ構成.md`（runtime/decisions領域・新規file一覧）、`docs/specs/15_要件追跡/00_追跡表.md`・`01_変更履歴.md`
- 追加更新した仕様（round 2、H-03是正に伴う開示）: `docs/specs/10_セキュリティ/01_信頼境界.md`のconstrained-choice段落を、「`payload.candidateSet`を無検証で信頼する」旧記述から「Policy Allowedとの積集合へ絞り込んだ上で候補集合外を拒否する。Configured/Dispatchable・Independence Eligibleの narrowing は未実装のdisclosed residual gap」へ訂正。`docs/specs/02_要件/01_ワークフロー要件.md`のREQ-WF-030本文中の同旨の一文も同様に訂正。`.agent-skill-chain/skills/step-10-review/SKILL.md`のDCAND-009段落と`src/cli-usage.ts`の`decision invoke`説明も同旨で更新
- 追加更新した仕様（round 3、機械検査の整合性回復）: `docs/specs/15_要件追跡/00_追跡表.md`のREQ-WF-030行へSCN-UNIT-DECINV-008・009を追加し、追跡表とfeature fileのSCN集合を一致させた（設計判断の変更ではない）
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: はい。00の候補（§4.2）→01の確定（§2.1）→耐久用語台帳（`02_用語・略語.md`）の順で一方向に追跡できる
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: 確認済み。TERM-ASC-1485-01〜03は新規追加のみで既存語の廃止は無い。TERM-DC-001の成立例は追記であり意味変更ではない
- 要件・変更・SCN・テストの追跡: `15_要件追跡/00_追跡表.md`にREQ-WF-030〜032の3行を追加し、全SCN IDと対応feature file・実装fileを1:1で記録した
- `no-spec-impact`の場合の限定的根拠: 該当なし（updated）
- UI・トークンの判断: 対象外。本製品はCLIであり画面・トークンを持たない（DC-UX/DC-TOKENS=not-applicable、00 §6.1）

## 11. 総合判定と再開地点

- 未解決Critical/High: 無し（H-03はHighだったが本round内で是正済み・resolved。§5・§6参照）
- Medium/Lowの記録: L-01（Low、out-of-scope。既存repositoryのDCAND-002 callerLine表記精度、本Issue無関係）、H-02（Medium、resolved。CI format:check失敗、round 2で是正）、H-03（High、resolved。DCAND-009信頼境界gap、round 2で是正。残存リスクは次項参照）
- 判定: approved（round 3まで収束。round 1はself-review、round 2の指摘元はPR #1497へのcoordinatorの独立review、round 3は自己検証。§9参照）
- 新しい権限が必要な事項: PRのmerge権限（コーディネータが実施。本Issueの停止点）
- 残存リスク:
  1. 独立reviewer（Codex Sol/Opus/CodeRabbit）による今回のfix自体の再検証は未実施のため、coordinatorによる再検証が完了するまでformal approvalは成立していない
  2. T-05/T-06（support_ms実測・review品質A/B比較）は実タスク数不足のため未達（DISC-003、既存）
  3. H-03是正後もDCAND-009のconstrained-choiceはPolicy Allowedとの積集合だけを強制し、Configured/Dispatchable（実際に呼び出し可能か）とIndependence Eligible（reviewerとimplementerの独立性）のnarrowingはcompiled codeで算出していない（disclosed residual gap。§5のH-03欄・各仕様文書に開示済み）
- 次に許可される操作: 本file名是正commit（`H_final`=本commit自身（自己参照のため確定SHAはgit logで確認する）。`H_impl`=`d6b11ee6568346b1407945fd8281fa75544b91d0`）の内容を本編集で確定し、`workflow record --step=10 --post-terminal-intake`（Step 11記録後のStep 10再記録。外部reviewer指摘を同じPRで取り込むための既定経路）を実行してから、既存PR #1497へpushし、対象のreview threadへ返信・解決してcoordinatorへ再検証を依頼する
- 次回の再開地点: push後、CI・CodeRabbit・coordinatorの直接検証の結果を待ってcoordinatorがmerge判断する

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 3（review-session.jsonの`rounds[].round`。round 1=self-review、round 2=coordinator独立review指摘の是正、round 3=round 2が誘発したtest回帰の是正。§6参照。file名是正commitはround外の機械検査是正であり、review sessionのround数には数えない） |
| 対象SHA・文書ダイジェスト | d6b11ee6568346b1407945fd8281fa75544b91d0 |
| 比較基点 | `eea59fbf467c534d8c5b578d818c03f0d9aa898f` |
| H_impl | `d6b11ee6568346b1407945fd8281fa75544b91d0` |
| 対象差分 | .agent-skill-chain/00_利用案内.md、.agent-skill-chain/docs/01_開発ワークフロー.md、.agent-skill-chain/skills/step-10-review/SKILL.md、docs/reviews/1485_レビュー.md（`H_impl`時点でのfile名。file名是正commit（本commit自身）＝`H_final`で`docs/reviews/1485_課題1485BoundedDecisionSkillcoreレビュー.md`へrenameされる）、dist/src/adapters/decision-invoke.js、dist/src/adapters/decision-journal-store.js、dist/src/adapters/local-config-workspace.js、dist/src/adapters/review-session.js、dist/src/adapters/review-workspace.js、dist/src/cli-contract.js、dist/src/cli-usage.js、dist/src/cli.js、dist/src/domain/decision-authority.js、dist/src/domain/decision-contract.js、dist/src/domain/decision-journal.js、dist/src/domain/decision-resolvers.js、dist/src/domain/decision-types.js、dist/src/domain/jev-provider-config.js、dist/src/domain/local-config-resolution.js、dist/src/domain/policy.js、dist/src/domain/review-convergence.js、dist/src/domain/spec.js、docs/specs/01_システム概要/02_用語・略語.md、docs/specs/02_要件/00_要件一覧.md、docs/specs/02_要件/01_ワークフロー要件.md、docs/specs/10_セキュリティ/01_信頼境界.md、docs/specs/14_開発・品質/00_ディレクトリ構成.md、docs/specs/15_要件追跡/00_追跡表.md、docs/specs/15_要件追跡/01_変更履歴.md、src/adapters/decision-invoke.ts、src/adapters/decision-journal-store.ts、src/adapters/local-config-workspace.ts、src/adapters/review-session.ts、src/adapters/review-workspace.ts、src/cli-contract.ts、src/cli-usage.ts、src/cli.ts、src/domain/decision-authority.ts、src/domain/decision-contract.ts、src/domain/decision-journal.ts、src/domain/decision-resolvers.ts、src/domain/decision-types.ts、src/domain/jev-provider-config.ts、src/domain/local-config-resolution.ts、src/domain/policy.ts、src/domain/review-convergence.ts、src/domain/spec.ts、test/features/unit/decision-authority.feature、test/features/unit/decision-invoke.feature、test/features/unit/decision-ref-verification.feature、test/features/unit/jev-provider-config.feature、test/features/unit/local-config-workspace.feature、test/steps/decision-authority.steps.ts、test/steps/decision-contract.steps.ts、test/steps/decision-invoke.steps.ts、test/steps/decision-ref-verification.steps.ts、test/steps/evidence-reanchor.steps.ts、test/steps/jev-provider-config.steps.ts、test/steps/local-config-workspace.steps.ts、test/steps/review-convergence.steps.ts、test/steps/review-round-init.steps.ts |
| 対象外 | 比較基点に存在し変更されていない範囲 |
| 残り予算 | 3ラウンド（同一scope最大6 counted roundのうちround 1〜3の3件を消費。round 2・3はいずれも収束後のHEAD移動に対する取り直しroundで、`review round --init`実行時にツールが「取り直しroundは収束後のHEAD移動に対して1回だけ許される」と表示したことを各回で確認済み。8ラウンド上限のうち残り5） |
| ラウンド数 | 3（round 1=self-review・収束、round 2=coordinator独立review指摘2件の是正・収束、round 3=round 2が誘発したtest回帰の是正・収束。§6参照） |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260926_111735_v0.4.2-Bounded-Decision-Skill-core |
| 仕様の所有箇所 | `docs/specs/02_要件/00_要件一覧.md`・`01_ワークフロー要件.md`（REQ-WF-028〜029、既存Jev/Decision Contract仕様）、`docs/specs/14_開発・品質/00_ディレクトリ構成.md`（既存runtime領域予約規約） |
| 成果物行数 | 製品変更（src/・dist/）: 実装commitの`git diff --stat`で確認可能な行数。支援層（docs/specs/・00〜03 staging・本review artifact）: 別途行数閾値判定はしない（本節の対象外） |
| 縮小の先行評価 | 既存`resolveReviewRoot`・`loadWorkspaceConfig`・`appendMetricsEvent`・`withStagingMutationLock`を新規実装せず再利用した（02 §1.3・§2.2）。既存`DECISION_CANDIDATES`・`DecisionJournalField`は変更・複製せず新しい型へ委ねた（02 §12代替案） |
| 実施者・日時 | round 1: 実装者（進行役、self-review）、2026-09-26T04:00:00Z頃。round 2: finding発見者はcoordinator（PR #1497への独立review）、fix実施者は実装者、2026-09-26（worktree再作成後、当日）。round 3: 実装者（self、`npm test`実行による自己検出）、2026-09-26（round 2直後）。file名是正: 実装者（self、`npm run audit:check`実行による自己検出）、2026-09-26（round 3直後、push前） |

`比較基点`と`H_impl`の値は40桁の小文字hexをbacktickで囲んだものだけにする。注記・branch名・短縮SHAを同じcellへ書かない。由来は別行へ書く。

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 本artifactの§3・§4・§5（肯定・敵対review、finding分類） | standard | ローカルLLM未設定、Codex Sol/Opus未設定（本sandbox環境）。round 2はPR #1497へのcoordinatorの直接検証が実質的なreviewerとして機能した | 該当なし | 未解決時の停止・再開条件=CI/CodeRabbitでの独立検証をcoordinatorが実施するまでmergeしない | round 1・3: reviewer=implementer（同一）。round 2: finding発見者（coordinator）とimplementerは別だが、fixの実施・再検証はimplementer自身。§9で詳細を明示 |
