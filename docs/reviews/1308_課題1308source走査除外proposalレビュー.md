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
| 何が問題だったか | `source:check`がGit管理外の一時ライフサイクル領域を走査し、handoff等のPython fileによって同一commitの品質判定が失敗する。 |
| 何を解決しようとしたか | 既存path正本を使う完成差分を、protected変更の二段階手順で安全に適用できる状態にする。本PRはproposal登録までを扱う。 |
| 何を行ったか | version 12→13のproposalへprotected sourceの変更前後hashとpackage field hashを登録した。完成差分は隔離cloneのcommit `ca7b2409067bbde59feec4fd629660eaf7464153`で固定した。 |
| 何を確認したか | 別contextのCodex Solがexact H_implを肯定・敵対レビューし、既存15件の保持、全hash一致、自己承認拒否を確認した。全品質2,298シナリオと配布gateも合格した。 |
| 判定 | approved |

## 1. 入力証拠

PR番号、Actions run ID、immutable review IDはPR作成後にしか存在しないため**この文書へ書かない。** `review evidence`とdelivery stateがappend-onlyで保持する。reviewerの独立性は`merge.reviewIndependence`が決める。既定の`context-isolated`はimplementerと別session/context、exact HEAD固定、対象差分の非変更、肯定・敵対reviewとfinding記録を要求し、同一GitHub actorでも成立する。このときtracked artifactの`approved`と保存済みreview session・Step 10 bindingがformal approvalになる。`actor-independent`はPR authorおよび観測済み`H_impl` commit authorと別のstable actor IDによるprovider `APPROVED`を要求する。両modeともexact HEAD一致は必須とし、tracked文書へ自身のcommit SHAを書かず、**H_final後はartifactを更新しない。**

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | .agent-skill-chain/tmp/issues/20260923_085958_課題1308一時ライフサイクル領域のsource走査除外 | staging digest 8b449bf9a63cd3f3fae06ec8cf50ab5f9ffd106a10d10923f1b9d33a94127461 | 既存コード |
| 差分 | `241990d6562fb7fb04279d5a9ce0d674a1f31aaf`..`abf63f2b6d7ca3a264948eeb6697cfc60dd36c01` | 1 path | 既存コード |
| テスト | `npm run quality`ほか全品質gate | 2,298シナリオ、失敗0。build・文書・trace・architecture・conformance・packageも合格 | テスト出力 |
| 仕様 | `docs/specs/02_要件/04_仕様・品質管理要件.md` REQ-SQ-006・012 | proposal段階は既存の二段階契約を適用し、仕様変更なし | 既存文書 |
| commit前candidate | .github/trusted-quality-proposals.json | H_impl abf63f2b6d7ca3a264948eeb6697cfc60dd36c01 | Git index |
| Phase A artifact | `docs/reviews/1308_課題1308source走査除外proposalレビュー.md` | H_impl後にこの1 fileだけをcommitする | Git観測 |
| review session | .agent-skill-chain/tmp/issues/20260923_085958_課題1308一時ライフサイクル領域のsource走査除外 | session `6e123378030404f0585db65f47b028b24f05aec5764c0903b776ebb28982e70c`、round 1 digest `e588a8665ec6e5a59b67bcbd095aa90cad9365790f05c17b52cf3220ffdedfc3` | Git観測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: はい。proposalは将来の適用targetを固定するだけで、本commitのprotected変更を承認しない。
- `H_impl`が`H_final`のancestorで、その差分がreview artifactだけである: artifact-only commit後にGitで再確認する。H_implは固定済み。
- reviewerの独立性が要求水準を満たす: はい。実装contextと別のCodex Sol contextがexact H_implをread-onlyレビューした。
- 既定branch追随を行った場合、取り込みがartifact commitより前にあり、`比較基点`が取り込んだ既定branch tip、`H_impl`がartifact直前の最新commitを指し、個別監査表を`比較基点..H_impl`から再生成した: 追随なし。比較基点は着手時のorigin/mainで、H_implはその直接の子である。

### 1.1 変更ファイル個別監査

基準SHAとの差分にある全ファイルを、生成物（`dist/`等）も含めて1ファイル1行で記録する。まとめ行、directory単位の一括承認、test成功だけの代替を認めない。`audit:check`の他の検査対象外となる生成物でも、各行へ生成元との対応確認方法と配布影響の確認方法を記録し、差分path集合と表のpath集合を一致させる。

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `.github/trusted-quality-proposals.json` | M | repository maintainer | quality policy | append-only proposal registry。既存15件を保持し1件追加 | policyからvalidatorへの一方向参照、循環なし | AC-1308-03、SCN-UNIT-QUALITY-008・009 | 本体未適用。適用しなければ無効のまま保持 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: はい、1 path。
- package層へproject固有値、project層へ汎用機構、spec/evidence層へ実行authorityを混入していない: はい。packageが所有する品質proposalだけを追加した。
- 個別findingを修正した場合、そのファイルと隣接依存だけを再監査した: findingなし。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

発見IDは実装計画（fullは03、quick/pocは集約00）の`DISC-*`と同じ字面を使い、本文書内で別IDへ言い換えない。

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-1308-01 | mainに本件用12→13 proposalが無く、protected変更を同じPRへ含められない | AC-1308-03。本PRはproposal登録で停止 | なし | 完成差分を隔離cloneで固定し、proposal PRと適用PRを分離 | current file hash、完成候補hash、package field hashの一致 | no-spec-impact | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-1308-01 | SCN-UNIT-QUALITY-020 | 隔離完成候補 `ca7b2409` | 修正前失敗、修正後成功、mutationで再失敗 | pass | lifecycle内fileが非計上になることを固定 |
| AC-1308-02 | SCN-UNIT-QUALITY-005 | 同完成候補 | lifecycle外のPython sourceを従来どおり拒否 | pass | 既存反例を実行 |
| AC-1308-03 | SCN-UNIT-QUALITY-008・009 | `TQP-SOURCE-LIFECYCLE-SCAN-001` | hash完全一致、candidate自己承認guardを確認 | pass | project品質契約と独立review |

### 2.2 開発考慮事項の適用判定（必須）

00の判定・理由・証拠から差分が無ければ、表の代わりに`開発考慮事項の適用判定は00_要求定義.md §6.1と同じ`の1行を置ける（01〜03と同じ参照行）。差分がある行だけを表に残してよい。**`review validate`はこの§2.2の内容を検証しない**（01〜03の`issue validate`と異なり、review artifactのDC判定に対する機械検証は無い）。記述量を減らすための人・エージェント向けの案内であり、参照行を置いても4行の表を書いても合否は変わらない。

開発考慮事項の適用判定は00_要求定義.md §6.1と同じ。

## 3. 肯定的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 正しさ（要件と観測結果の一致） | pass | currentと完成候補から再計算した4 hashがproposal targetと一致する。 |
| 価値（利用者・運用上の目的） | pass | 一時状態による品質判定の偽陽性を解消する適用PRの安全な前提を作る。 |
| 実現可能性（環境・依存・権限） | pass | 既存のversioned proposal機構で12→13を扱える。 |
| 整合性（設計・コード・テスト・仕様） | pass | proposal-only差分で既存二段階契約と一致する。 |
| 保守性（責務・命名・変更容易性） | pass | 既存registryへappend-onlyで追加し、path正本の重複を予定していない。 |

## 4. 敵対的評価

| 観点 | 判定 | 根拠 |
|---|---|---|
| 反例（要件を破る入力・状態） | pass | lifecycle外の既存検出とcandidate自己承認拒否を確認した。 |
| 失敗経路（外部失敗・部分失敗） | pass | targetの一部適用やhash不一致はvalidatorが拒否する。 |
| 境界値（空、最大、最小、重複、Unicode） | pass | registry構造・version連続性と既存15 proposal保持をproject品質検査で確認した。 |
| 悪用（注入、経路脱出、権限外） | pass | protected source/versionを同じcommitへ含めず、candidate自己承認guardを維持した。 |
| 安全性（認証、承認、秘密情報、Zero Trust） | pass | base側proposalだけをauthorityにする二段階境界を維持した。秘密情報なし。 |
| データ損失（上書き、削除、部分公開、履歴消失） | pass | 既存15 proposalを変更・削除せず1件追加した。 |
| ロールバック（復旧参照、状態保持、再開可能性） | pass | 適用前はproposalを使わず保持でき、適用後は次version proposalで前進復旧する。 |
| 範囲漏れ（呼び出し元、利用側、配布物、文書） | pass | 完成候補のsource・test・spec・package差分と全hashを隔離cloneで確認した。 |

## 5. 指摘

指摘なしの場合は「指摘なし」と明記する。

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
指摘なし。

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい。proposal-only差分、hash、version、自己承認guard、既存entry保持を肯定・敵対の両面で確認した。
- 指摘を確定した: 指摘なし。
- 次ラウンド対象のCritical/High: なし。

### ラウンド2

- 未解決Critical/High: なし。ラウンド2は不要。
- 修正差分と、触れた隣接範囲: なし。
- 既承認・未変更範囲を再走査していない: 該当なし。

### ラウンド3

- 全指摘の最終分類: 指摘なし。ラウンド3は不要。
- 危険範囲を除外・既定無効・ロールバック可能へ縮小した結果: proposal-onlyで本体は未適用。
- 同じ範囲の予算を自動更新していない: はい。1 counted roundで収束した。

## 7. テスト結果

- 実行したcommandの一覧: `npm run project:quality`、`npm run quality`、`npm run build`、`npm run docs:format`、`npm run test:format`、`npm run trace:check`、`npm run architecture:check`、`npm run conformance:check`、`npm run package:check`、`git diff --check`。
- 全layerの合計（シナリオ数、成功、失敗、スキップ）と、失敗が0件であること: 2,298シナリオ中2,271成功・27 skip・失敗0。21,263ステップ中21,162成功・101 skip。
- 失敗またはskipがある層だけを`projectChoices.testLayers`の順に1層1行で展開: 既存skip 27シナリオ・101ステップ。失敗0。
- runnerと`projectChoices.gherkinDialect`: Cucumber、ja。

## 8. 配布物影響

packageとして配布する場合だけ記入する。配布境界はpackage manifestの配布file指定を正本とし、compileされて配布される`source`も含める。

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| .github/trusted-quality-proposals.json | 入らない | なし |

判断: 配布物を更新しない

根拠: proposal registryはpackageの`files`境界外で、runtime・配布sourceを変更しない。`package:check`も合格した。

## 9. 独立reviewの成立

PR作成前に観測できるものだけを書く。immutable review IDやapproval件数は書かない。

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated |
| その要求を満たすこと | はい |
| reviewerとimplementerのidentity・context比較 | implementer `/root/issue_1308` と reviewer Codex Sol は別context。review対象はexact H_impl `abf63f2b6d7ca3a264948eeb6697cfc60dd36c01`。 |
| reviewerが対象差分を変更していないこと | はい（read-only reviewで変更pathは0件） |

外部への不可逆な配布で外部証拠を要求され、かつ無い場合だけ次を記入する。承認元・承認者・承認日時・失効日時は正本を参照し複製しない。

外部への不可逆な配布ではなく、適用する例外はない。

## 10. 仕様整合性

- 判定: no-spec-impact
- 更新した仕様: なし。proposal段階はREQ-SQ-006・012の既存二段階契約を適用するだけである。
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: 新語なし。TERM-ASC-070を使用。
- 未定義語、同一コンテキスト内の重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: はい。
- 要件・変更・SCN・テストの追跡: stagingのFR/NFR/ACから完成候補のSCN-UNIT-QUALITY-020・005・008・009へ追跡可能。
- `no-spec-impact`の場合の限定的根拠: 本PRは将来差分のhash登録だけでsource品質のruntime契約を変更しない。適用PRで仕様を更新する。
- UI・トークンの判断: UI・design/layout tokenを持たない品質CLIの内部policy登録で非該当。

## 11. 総合判定と再開地点

- 未解決Critical/High: なし
- Medium/Lowの記録: なし。
- 判定: approved
- 新しい権限が必要な事項: なし。
- 残存リスク: proposal mergeまでは利用者向け不具合が継続する。protected本体変更は本PRへ含めない。
- 次に許可される操作: artifact-only commit、audit/package gate、push、proposal PR作成。
- 次回の再開地点: proposal PRがmainへmergeされた後、そのmainを基点に完成候補と完全一致する適用PRを新規Step chainで作る。

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 1 |
| 対象SHA・文書ダイジェスト | `abf63f2b6d7ca3a264948eeb6697cfc60dd36c01` / diff digest `8bed9c3a34e9b177e053569abb8d7cf44d6c408eab0a843e5c22c4b7b7df175c` |
| 比較基点 | `241990d6562fb7fb04279d5a9ce0d674a1f31aaf` |
| H_impl | `abf63f2b6d7ca3a264948eeb6697cfc60dd36c01` |
| 対象差分 | .github/trusted-quality-proposals.json |
| 対象外 | 比較基点に存在し変更されていない範囲 |
| 残り予算 | counted round 5、収束後取り直し2 |
| ラウンド数 | 1 |
| Step chain | 経由: .agent-skill-chain/tmp/issues/20260923_085958_課題1308一時ライフサイクル領域のsource走査除外 |
| 仕様の所有箇所 | `docs/specs/02_要件/04_仕様・品質管理要件.md` REQ-SQ-006・012 |
| 成果物行数 | proposal registry +23/-0、review artifactはevidence-only |
| 縮小の先行評価 | protected本体を同じPRへ含めず、既存proposal機構への1 entry追加へ縮小した。 |
| 実施者・日時 | reviewer Codex Sol（別context）、coordinator `/root/issue_1308`、2026-09-23T10:00:00+09:00 |

`比較基点`と`H_impl`の値は40桁の小文字hexをbacktickで囲んだものだけにする。注記・branch名・短縮SHAを同じcellへ書かない。由来は別行へ書く。

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | proposal-only差分、既存entry保持、4 hash、version、自己承認guardの肯定・敵対review。指摘なし | critical | codex | Codex Sol、独立context | 未解決Critical/Highまたはhash不一致なら停止 | implementerと別context、exact H_impl固定、read-onlyで変更path 0件 |
