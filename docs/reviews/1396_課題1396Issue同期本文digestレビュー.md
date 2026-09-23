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

**この5行だけで、何を見たreviewかが分かるように書く。** 各行は1〜3文。詳細は対応する節が持つ。

| 項目 | 内容 |
|---|---|
| 何が問題だったか | Issue同期本文の末尾空白をdigest計算前に除いており、認可した本文byte列と送信・read-back証拠が一致しなかった。GitHub CLIの表示用改行も本文と誤認していた。 |
| 何を解決しようとしたか | 末尾改行を含むUTF-8本文byte列を生成、認可、送信、read-back、復旧で同一に扱い、差異があれば同期成功にしない。 |
| 何を行ったか | 5箇所の`trimEnd()`を撤去し、GitHub本文をJSON envelopeから読み、送信fileとのbyte完全一致を検証した。回帰・反例testと仕様追跡を追加した。 |
| 何を確認したか | 修正前3 scenario失敗、修正後4 scenario・36 step成功、関連16 scenario・155 step成功、全配布gate、2 roundの独立reviewを確認した。 |
| 判定 | approved |

## 1. 入力証拠

PR番号、Actions run ID、immutable review IDはPR作成後にしか存在しないため**この文書へ書かない。** `review evidence`とdelivery stateがappend-onlyで保持する。reviewerの独立性は`merge.reviewIndependence`が決める。既定の`context-isolated`はimplementerと別session/context、exact HEAD固定、対象差分の非変更、肯定・敵対reviewとfinding記録を要求し、同一GitHub actorでも成立する。このときtracked artifactの`approved`と保存済みreview session・Step 10 bindingがformal approvalになる。`actor-independent`はPR authorおよび観測済み`H_impl` commit authorと別のstable actor IDによるprovider `APPROVED`を要求する。両modeともexact HEAD一致は必須とし、tracked文書へ自身のcommit SHAを書かず、**H_final後はartifactを更新しない。**

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | .agent-skill-chain/tmp/issues/20260923_085930_Issue同期本文digestを読み戻しと一致させる | AC-1396-01〜03、INV-01〜03 | tracker・staging |
| 差分 | `9eaa3c6bd2efa1dd198ef45a587bed6b31ed81c3`..`8d1d5efa0fb7223a37b811f80196a9ff82b2c0b4` | 15 path | 既存コード |
| テスト | H_impl | Issue #1396・隣接fixture 8 scenarios・74 steps成功、関連16 scenarios・155 steps成功、全配布gate合格 | テスト出力 |
| 仕様 | CLI/GitHub契約・追跡表・変更履歴 | updated | 既存文書 |
| commit前candidate | dist/src/adapters/github.js、dist/src/cli.js、dist/src/domain/issue.js、docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md、docs/specs/15_要件追跡/00_追跡表.md、docs/specs/15_要件追跡/01_変更履歴.md、src/adapters/github.ts、src/cli.ts、src/domain/issue.ts、test/features/e2e/workflow-step-enforcement-cli.feature、test/features/unit/issue-scaffolding.feature、test/steps/delivery-finalize.steps.ts、test/steps/issue-sync-body.steps.ts、test/steps/staging-lifecycle.steps.ts、test/steps/workflow-step-enforcement.steps.ts | H_impl 8d1d5efa0fb7223a37b811f80196a9ff82b2c0b4 | Git index |
| Phase A artifact | 本file | H_impl後のartifact-only commitで固定予定 | Git観測 |
| review session | .agent-skill-chain/tmp/issues/20260923_085930_Issue同期本文digestを読み戻しと一致させる | session `004ae36adcbb2373632da301e59c953b3146763fa9925d008f9c74866117dd94`、Round 3 digest `564c58c4df7c8d5319815a01e4eec833ab6e365a1901ff3a008a5103ec7c3649`、converged | 耐久session |

- dependency/authority/evidence graphはstaging→H_impl→review session→artifactの一方向で、cycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない。
- `H_impl`から`H_final`は本artifact 1件だけを追加し、commit後にauditで確認する。
- reviewerはimplementerと別contextでexact H_implを固定し、対象差分を変更せず肯定・敵対reviewを行った。
- 既定branch追随は行っていない。比較基点は着手時のorigin/mainで、個別監査表は`比較基点..H_impl`から生成した。

### 1.1 変更ファイル個別監査

基準SHAとの差分にある全ファイルを、生成物（`dist/`等）も含めて1ファイル1行で記録する。まとめ行、directory単位の一括承認、test成功だけの代替を認めない。`audit:check`の他の検査対象外となる生成物でも、各行へ生成元との対応確認方法と配布影響の確認方法を記録し、差分path集合と表のpath集合を一致させる。

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `dist/src/adapters/github.js` | M | package owner | 生成物 | `src/adapters/github.ts`のcompile出力。生成元との対応を再build後のclean差分で確認 | source → dist | AC-1396-02、SCN-INT-ISSUESYNC-027 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/cli.js` | M | package owner | 生成物 | `src/cli.ts`のcompile出力。生成元との対応を再build後のclean差分で確認 | source → dist | AC-1396-01/02、SCN-INT-ISSUESYNC-024/025 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `dist/src/domain/issue.js` | M | package owner | 生成物 | `src/domain/issue.ts`のcompile出力。生成元との対応を再build後のclean差分で確認 | source → dist | AC-1396-01/03、SCN-UNIT-ISSUESYNC-026 | §8の配布物影響表とpackage filesで確認。revert | pass |
| `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | M | spec owner | docs/specs | exact本文read-back契約 | spec → src | AC-1396-01/02 | 履歴保持・revert | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | trace owner | docs/specs | SCNと実装の追跡 | spec → src/test | 全AC・SCN | orphan 0・revert | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | trace owner | docs/specs | 変更理由と互換性 | spec → src | Issue #1396 | 履歴保持・revert | pass |
| `src/adapters/github.ts` | M | adapter owner | package | GitHub本文のexact JSON read-back | application → adapter | AC-1396-02、INV-02/03、SCN-INT-ISSUESYNC-027 | 不一致時fail-closed・revert | pass |
| `src/cli.ts` | M | application owner | package | preview・dispatch・復旧digest合成 | domain → adapter | AC-1396-01/02、SCN-INT-ISSUESYNC-024/025 | CAS・再送禁止維持・revert | pass |
| `src/domain/issue.ts` | M | domain owner | package | 生成本文exact digest | adapter非依存 | AC-1396-01/03、SCN-UNIT-ISSUESYNC-026 | 純粋関数・revert | pass |
| `test/features/e2e/workflow-step-enforcement-cli.feature` | M | test owner | test | 公開CLIの同期反例 | test → CLI | SCN-INT-ISSUESYNC-024/025/027 | fake provider・revert | pass |
| `test/features/unit/issue-scaffolding.feature` | M | test owner | test | LF境界値 | test → domain | SCN-UNIT-ISSUESYNC-026 | Git非依存・revert | pass |
| `test/steps/delivery-finalize.steps.ts` | M | test owner | test | GitHub issue read/sync provider fixture | feature → adapter | SCN-INT-GITHUB-001/017/018 | 外部writeなし・revert | pass |
| `test/steps/issue-sync-body.steps.ts` | M | test owner | test | exact digest fixture | feature → domain | SCN-UNIT-ISSUESYNC-026 | 固定expected SHA・revert | pass |
| `test/steps/staging-lifecycle.steps.ts` | M | test owner | test | promotion中Issue同期fixture | feature → CLI/adapter | SCN-INT-STAGING-006 | 外部writeなし・revert | pass |
| `test/steps/workflow-step-enforcement.steps.ts` | M | test owner | test | GitHub JSON・末尾変更fixture | feature → CLI/adapter | SCN-INT-ISSUESYNC-024/025/027 | 外部writeなし・revert | pass |

- 基準SHAとの差分15 pathと表のpath集合が完全一致する。
- package層へproject固有値、spec/evidence層へ実行authorityを混入しておらず、domain→application→adapterの依存方向を維持した。
- Round 2は`src/adapters/github.ts`、生成物、fixture、契約・追跡の固定差分だけを再監査した。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

発見IDは実装計画（fullは03、quick/pocは集約00）の`DISC-*`と同じ字面を使い、本文書内で別IDへ言い換えない。

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1396-01 | 5つのdigest経路が`trimEnd()`で本文を変形 | AC-1396-01〜03 | なし | raw UTF-8本文へ統一 | 修正前3 scenario失敗、修正後成功 | updated | pass |
| DISC-1396-02 | adapterの`trimEnd()`比較と`--jq`表示LFがexact read-backを破る | AC-1396-02、INV-02/03 | なし | JSON envelope読取とbyte完全一致 | SCN-INT-ISSUESYNC-027、Round 2 | updated | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1396-01 | SCN-INT-ISSUESYNC-024 | `src/cli.ts`、`src/domain/issue.ts` | pass | pass | preview・dispatch digest完全一致 |
| AC-1396-02 | SCN-INT-ISSUESYNC-025/027 | `src/cli.ts`、`src/adapters/github.ts` | pass | pass | JSON本文read-back、一時失敗復旧、末尾変更拒否 |
| AC-1396-03 | SCN-UNIT-ISSUESYNC-026 | `src/domain/issue.ts` | pass | pass | LF 0/1/2件の固定SHA-256 |

### 2.2 開発考慮事項の適用判定（必須）

00の判定・理由・証拠から差分が無ければ、表の代わりに`開発考慮事項の適用判定は00_要求定義.md §6.1と同じ`の1行を置ける（01〜03と同じ参照行）。差分がある行だけを表に残してよい。**`review validate`はこの§2.2の内容を検証しない**（01〜03の`issue validate`と異なり、review artifactのDC判定に対する機械検証は無い）。記述量を減らすための人・エージェント向けの案内であり、参照行を置いても4行の表を書いても合否は変わらない。

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | 認可digestと外部送信本文を扱う | CAS・authority・再送禁止を維持し、SCN-INT-ISSUESYNC-024/025/027で確認 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | digestが同期・復旧証拠になる | exact read-back、一時失敗復旧、journal非進行を確認 |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | 画面契約とa11y検証の対象を持たないNode CLI | CLI errorとJSON契約のみを回帰確認 |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 視覚component・layoutを持たない | projectKind=cli |

## 3. 肯定的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ（要件と観測結果の一致） | pass | exact byte列を全経路でhashし、差異を拒否する |
| 価値（利用者・運用上の目的） | pass | 同期した本文と認可・復旧証拠の食い違いを防ぐ |
| 実現可能性（環境・依存・権限） | pass | 既存GitHub CLIのJSON出力と既存CASを再利用した |
| 整合性（設計・コード・テスト・仕様） | pass | source・dist・contract・trace・SCNが一致した |
| 保守性（責務・命名・変更容易性） | pass | GitHub本文読取をadapter helperへ一元化した |

## 4. 敵対的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 反例（要件を破る入力・状態） | pass | providerが末尾LFを落とす反例を拒否した |
| 失敗経路（外部失敗・部分失敗） | pass | read-back一時失敗からの復旧と不一致時journal非進行を確認した |
| 境界値（空、最大、最小、重複、Unicode） | pass | LF 0/1/2件とUTF-8本文を変形しない |
| 悪用（注入、経路脱出、権限外） | pass | bodyをshellへ展開せずfileとJSON parserで扱う |
| 安全性（認証、承認、秘密情報、Zero Trust） | pass | authority、expected digest、CASを維持した |
| データ損失（上書き、削除、部分公開、履歴消失） | pass | 不一致は失敗し、journalを進めない |
| ロールバック（復旧参照、状態保持、再開可能性） | pass | commit revert可能、既存復旧state machineを維持した |
| 範囲漏れ（呼び出し元、利用側、配布物、文書） | pass | source・dist・CLI契約・trace・testを監査した |

## 5. 指摘

指摘なしの場合は「指摘なし」と明記する。

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| REV-1396-01 | High | adapterの末尾trim比較で変更済み本文を成功扱い | Round 1、`src/adapters/github.ts` | 同期後read-back | byte完全一致とSCN-INT-ISSUESYNC-027を追加 | resolved | なし |
| REV-1396-02 | High | `--jq`表示LFを本文byte列と誤認 | Round 1、`src/adapters/github.ts` | read・復旧・alreadyPublished | JSON envelopeの`body`を正本化 | resolved | なし |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: 肯定・敵対観点、15 path、exact digest経路。
- 指摘を確定した: REV-1396-01、REV-1396-02をHighとしてblock-current。
- 次ラウンド対象のCritical/High: 上記2件。

### ラウンド2

- 未解決Critical/High: 0件。
- 修正差分と、触れた隣接範囲: GitHub adapter、生成物、fake provider、契約・追跡。
- 既承認・未変更範囲を再走査していない: はい。fixedDiffとCLIの隣接hash経路だけを確認した。

### ラウンド3

- 全指摘の最終分類: Round 2で2件ともresolved。Round 3はfixture追随2 pathを確認し新規findingなし。
- 危険範囲を除外・既定無効・ロールバック可能へ縮小した結果: 不一致はfail-closed、fixtureは実provider JSON契約へ一致、commit revert可能。
- 同じ範囲の予算を自動更新していない: はい。収束後の取り直し1回を使用した。

## 7. テスト結果

- 実行したcommandの一覧: Issue #1396 targeted Cucumber、関連Issue同期suite、`npm run verify:distribution`。
- 対象確認: Issue #1396と隣接fixture 8 scenarios / 74 steps成功、関連16 scenarios / 155 steps成功、失敗0。
- runner・Gherkin方言: Cucumber.js、en。unit・integration・E2Eを対象にした。

## 8. 配布物影響

packageとして配布する場合だけ記入する。配布境界はpackage manifestの配布file指定を正本とし、compileされて配布される`source`も含める。

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| dist/src/ | 入る | exact digest・GitHub JSON read-back runtime |
| docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md | 入らない | なし |
| docs/specs/15_要件追跡/00_追跡表.md | 入らない | なし |
| docs/specs/15_要件追跡/01_変更履歴.md | 入らない | なし |
| src/adapters/github.ts | 入る | GitHub本文のJSON read-back・完全一致検証 |
| src/cli.ts | 入る | preview・dispatch・復旧digest |
| src/domain/issue.ts | 入る | 生成本文digest |
| test/features/e2e/workflow-step-enforcement-cli.feature | 入らない | なし |
| test/features/unit/issue-scaffolding.feature | 入らない | なし |
| test/steps/delivery-finalize.steps.ts | 入らない | GitHub JSON fixtureのみ |
| test/steps/issue-sync-body.steps.ts | 入らない | なし |
| test/steps/staging-lifecycle.steps.ts | 入らない | GitHub JSON fixtureのみ |
| test/steps/workflow-step-enforcement.steps.ts | 入らない | なし |

判断: 配布物を更新した

根拠: sourceから`dist/src/`を再生成し、runtimeとpackage内容を同期した。

## 9. 独立reviewの成立

PR作成前に観測できるものだけを書く。immutable review IDやapproval件数は書かない。

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated |
| その要求を満たすこと | はい |
| reviewerとimplementerのidentity・context比較 | `/root`と`/root/review_1396_sol`、`/root/review_1396_round2_sol`は別context |
| reviewerが対象差分を変更していないこと | はい（reviewer変更path 0件） |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: CLI/GitHub契約、要件追跡表、変更履歴。
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: TERM-ASC-007を参照し、意味変更はない。
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: trace・docs gateで確認した。
- 要件・変更・SCN・テストの追跡: REQ-WF-015/020→AC-1396-01〜03→SCN-024〜027を追跡した。
- `no-spec-impact`の場合の限定的根拠: 該当なし。
- UI・トークンの判断: CLIで画面・視覚componentを持たないためnot-applicable。

## 11. 総合判定と再開地点

- 未解決Critical/High: なし
- Medium/Lowの記録: なし
- 判定: approved
- 新しい権限が必要な事項: PR作成まではstanding authorization済み。mergeは未承認。
- 残存リスク: GitHub本文を取得不能またはJSON不正の場合は安全側停止する。
- 次に許可される操作: artifact-only H_final commit、Step 10、audit/package、push、PR作成。
- 次回の再開地点: PRのCI・外部review観測。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | Issue #1396 Issue同期本文digest実装 |
| ラウンド | 1〜3 |
| 対象SHA・文書ダイジェスト | `8d1d5efa0fb7223a37b811f80196a9ff82b2c0b4` |
| 比較基点 | `9eaa3c6bd2efa1dd198ef45a587bed6b31ed81c3` |
| H_impl | `8d1d5efa0fb7223a37b811f80196a9ff82b2c0b4` |
| 対象差分 | dist/src/adapters/github.js、dist/src/cli.js、dist/src/domain/issue.js、docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md、docs/specs/15_要件追跡/00_追跡表.md、docs/specs/15_要件追跡/01_変更履歴.md、src/adapters/github.ts、src/cli.ts、src/domain/issue.ts、test/features/e2e/workflow-step-enforcement-cli.feature、test/features/unit/issue-scaffolding.feature、test/steps/delivery-finalize.steps.ts、test/steps/issue-sync-body.steps.ts、test/steps/staging-lifecycle.steps.ts、test/steps/workflow-step-enforcement.steps.ts |
| 対象外 | 比較基点に存在し変更されていない範囲 |
| 残り予算 | 0ラウンド |
| ラウンド数 | 3 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260923_085930_Issue同期本文digestを読み戻しと一致させる |
| 仕様の所有箇所 | `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md`、REQ-WF-015/020 |
| 成果物行数 | 15 path。閾値判定には使用しない |
| 縮小の先行評価 | 既存digest・CAS・journal・復旧機構を再利用し、文字列変形の撤去とadapter読取helperだけを追加した |
| 実施者・日時 | implementerと別contextのreviewer、2026-09-23T10:15:00+09:00 |

`比較基点`と`H_impl`の値は40桁の小文字hexをbacktickで囲んだものだけにする。注記・branch名・短縮SHAを同じcellへ書かない。由来は別行へ書く。

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定・敵対review、finding分類 | critical | context-isolated Codex | gpt-6-sol high | 未解決Highで停止 | 別context 3 session、exact H_impl、変更path 0件 |
