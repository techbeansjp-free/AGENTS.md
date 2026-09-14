# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 2 |
| 対象SHA・文書ダイジェスト | `54fbbda2566496eee2d07cd5634048535f3c631d`、diff SHA-256 `de68bcc1e93ad38100321e0e36e751a6ed10edc0f96a7643ff8b642ddc1b30d4` |
| 比較基点 | `b4eaa5ad2c7c0c29ea32e63c312b7d4c2e996a91` |
| H_impl | `54fbbda2566496eee2d07cd5634048535f3c631d` |
| 対象差分 | 比較基点からH_implまでの12 path |
| 対象外 | 比較基点に存在し変更されていない範囲 |
| 残り予算 | counted round 4、収束後のHEAD移動に対する取り直し1 |
| ラウンド数 | 2 |
| Step chain | 経由: `.agent-skill-chain/tmp/issues/20260914_205725_parallel-progress-markerのplaceholder誤検知を後継PRで修正する` |
| 仕様の所有箇所 | REQ-SQ-008、REQ-WF-021、CLI契約、要件追跡表、変更履歴 |
| 成果物行数 | 製品source・dist 154追加2削除、test 327追加1削除、仕様16追加5削除 |
| 縮小の先行評価 | 既存`unresolvedPlaceholders`の単一入口を流用し、codeとcommentだけを同一の決定論的走査へ統合した。marker allowlistやMarkdown parser依存は追加していない |
| 実施者・日時 | reviewer: Claude Opus 5 / effort high / read-only、2026-09-14T12:57Zまで。coordinatorはrepo rootでbase・diff digest・CodeRabbit指摘・実行Evidenceを照合 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定5観点、敵対8観点、finding分類 | critical | Claude上限 | Opus 5、effort high | reviewer不成立または未解決Critical/Highなら停止 | implementerはCodex routing launchの別context。Claudeはtoolsなしread-onlyでexact H_impl、同一tree証拠、既知反例を確認。変更path 0件 |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #1370、staging 00〜03 | AC-SQ-008、AC-WF-021、INV-1370-01〜04 | 既存文書 |
| 差分 | `b4eaa5ad2c7c0c29ea32e63c312b7d4c2e996a91`..`54fbbda2566496eee2d07cd5634048535f3c631d` | 12 path、diff digest `de68bcc1e93ad38100321e0e36e751a6ed10edc0f96a7643ff8b642ddc1b30d4` | Git観測 |
| テスト | targeted Cucumber、実装・仕様完全gate | targeted 38 scenarios / 216 steps合格。全体2031 scenarios、失敗0。artifact監査以外の全配布gate合格 | coordinator実行のテスト出力 |
| 仕様 | `docs/specs/02_要件/`、`06_外部インターフェース/`、`15_要件追跡/` | updated | 既存文書 |
| commit前candidate | 12 path manifest | H_impl `54fbbda2566496eee2d07cd5634048535f3c631d` | Git観測 |
| Phase A artifact | 本file | 新H_impl後に本fileだけを更新commitして新H_finalとする | Git観測 |
| review session | 後継staging、round 2、digest `d471b295ee3a047555b0a6866c3899d232121d907e58edb5a78af55aebdf1d02` | exact H_impl、AC・INV・実Git diff digestへbinding | Git観測 |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: はい。
- `H_impl`から`H_final`への差分は本artifact 1 fileだけにする: はい。
- reviewerの独立性は`context-isolated`を満たす: はい。
- Phase BのPR・CI証拠は本artifactへ書かず、PR作成後の`review evidence`へ委譲する: はい。

### 1.1 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `docs/reviews/218_課題1370parallel-progress-marker-placeholder誤検知レビュー.md` | A | evidence | review | 前Roundの独立レビュー証拠 | H_impl後のartifact更新で前向き固定 | Round 1・2 | artifact commitをrevert | pass |
| `docs/specs/02_要件/01_ワークフロー要件.md` | M | spec | spec | markerとprogressの所有契約 | 要件から実装へ一方向 | AC-WF-021 | 文書と実装を同時revert | pass |
| `docs/specs/02_要件/04_仕様・品質管理要件.md` | M | spec | spec | placeholder境界の所有契約 | 要件から実装へ一方向 | AC-SQ-008 | 文書と実装を同時revert | pass |
| `docs/specs/06_外部インターフェース/01_コマンド・GitHub契約.md` | M | spec | spec | CLI外部契約 | 要件を参照 | AC-SQ-008、AC-WF-021 | 同上 | pass |
| `docs/specs/15_要件追跡/00_追跡表.md` | M | spec | spec | AC・SCN・実装の対応 | cycleなし | 全ISSUECOMMENT SCN | 行の前進修正 | pass |
| `docs/specs/15_要件追跡/01_変更履歴.md` | M | spec | spec | 変更理由と互換性 | cycleなし | Issue #1370 | 行の前進修正 | pass |
| `src/domain/issue.ts` | M | package | package | 共有placeholder検出 | Issue/PRから単方向呼出 | AC-SQ-008、INV-1370-01〜04 | 関数変更をrevert | pass |
| `test/features/e2e/issue-placeholder-cli.feature` | A | test | project | 配布CLIの実process確認 | CLIへ単方向 | SCN-E2E-ISSUECOMMENT-001 | test追加のrevert | pass |
| `test/features/integration/issue-template-contract.feature` | M | test | project | validationとreview初期化の結合確認 | adapterへ単方向 | SCN-INT-ISSUECOMMENT-001 | test追加のrevert | pass |
| `test/features/unit/issue-template-contract.feature` | M | test | project | comment境界の例示 | domainへ単方向 | SCN-UNIT-ISSUECOMMENT-001〜004 | test追加のrevert | pass |
| `test/steps/issue-template-contract.steps.ts` | M | test | project | 上記SCNの実行step | domain/adapterへ単方向 | 全ISSUECOMMENT SCN | 一時fixtureのみ | pass |

- 基準SHAとの差分から生成済み配布物`dist/`を除いた個別監査対象と表のpath集合が完全一致する: はい、11件。`dist/src/domain/issue.js`は配布物影響を8節で別途監査する。
- package層へproject固有値、spec/evidence層へ実行authorityを混入していない: はい。
- 個別findingはRound 1とRound 2へ分類し、CodeRabbitのHigh 2件だけを修正、Medium/Lowは一次資料でfalse-positiveまたは範囲外へ確定した。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

03にDISC-1370-001を追記した。旧PR #1394のCodeRabbit指摘で、inline codeまたはfenced code内の`<!--`が実commentとして先に解釈され、後続のcomment外placeholderを隠す反例が確認された。後継PR #1395では、comment除去後に同一行のGherkinが行頭化する反例と、未終端comment内のcodeが候補を隠す反例が確認された。ASCのpost-PR intakeで原文の行位置と未終端状態を保持し、3回帰例と仕様を前向き更新した。要求・scope・security境界・不可逆操作は変更していない。

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-SQ-008 | SCN-UNIT-ISSUECOMMENT-001〜004 | `src/domain/issue.ts` | 36実行ケース合格 | pass。CodeRabbit High 2件とF-R1-01はresolved、Claude Round 2の不確実性3件はfalse-positive | Cucumber全体結果とClaude read-only反例 |
| AC-WF-021 | SCN-INT-ISSUECOMMENT-001 | `src/domain/issue.ts`、`src/domain/review-progress.ts`、`src/adapters/review-session.ts` | 1ケース合格 | pass | 同じ03 bytesのinventory bindingと非永続preview |
| AC-SQ-008、AC-WF-021 | SCN-E2E-ISSUECOMMENT-001 | `dist/bin/agent-skill-chain.js` | 1ケース合格 | pass | 配布CLI exit 0、valid true、marker保持 |

### 2.2 開発考慮事項の適用判定

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | validatorの除外境界は品質gateの盲点になり得る | 未終端・Unicode・comment外・件数上限・code/comment交差SCN、F-R1-01〜05 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | placeholder診断を運用判断に使う | 原文全体を追加保存せず候補5件と残数を維持 |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | Node CLIのvalidator変更で、画面・操作順・支援技術向けUIを所有しない | package.jsonのbin、CLI契約、UI sourceなし |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | 視覚component、theme、breakpoint、layoutを所有しない | projectKind=cli、UI sourceなし |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | 正規markerと完全commentを除外し、code内openerと未終端commentを可視のまま保持 | pass | 追加SCNとClaudeのexact H_impl reviewでF-01の反例解消を確認 |
| 価値 | 配布templateとvalidatorの自己矛盾を解消 | pass | marker付きfull stagingがvalidになる |
| 実現可能性 | 新依存・I/O・権限なし | pass | 文字列変換のみを追加し、SCN-UNIT-ISSUECOMMENT-001〜004で検証 |
| 整合性 | 要求・設計・source・dist・SCN・仕様 | pass | trace/conformance/build合格 |
| 保守性 | 共有入口1箇所の状態走査 | pass | Issue/PRの2 callerが同じ関数を利用 |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | commentとcode/Gherkinの交差 | pass | CodeRabbit High 2件とF-R1-01をRound 2で解消 |
| 失敗経路 | 未終端、comment外、PR見出し | pass | SCN-UNIT-ISSUECOMMENT-003/004 |
| 境界値 | 空、複数行、隣接、Unicode、最大件数、backtick/tilde fence | pass | 36 unit実行ケースとClaude反例レビュー |
| 悪用 | code内openerで後続placeholderを隠す入力 | pass | F-01を解消し回帰SCN化 |
| 安全性 | 認証・authority・秘密情報への影響 | pass | 外部状態を扱わない文字列変換であり、SCN-UNIT-ISSUECOMMENT-001〜004で検証 |
| データ損失 | 入力fileを変更しない | pass | validation後の03 bytes一致 |
| ロールバック | source・dist・仕様を前進revert可能 | pass | 永続形式・migrationなし |
| 範囲漏れ | Issue/PR caller、progress、dist、仕様、review artifact | pass | 11 non-dist path監査、Round 2指摘を分類済み |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| F-01 | Medium | round 1でcode内`<!--`が実commentを開始し、後続placeholderを隠す反例を検出 | 旧H_implの`src/domain/issue.ts`とPR inline review | Issue/PR本文 | code/comment統合走査と回帰SCNを独立implementerが追加 | valid / resolved | 追加反例は全て合格 |
| F-02 | Low | round 1でGherkin step末尾comment後のbrace tokenが既存除外から外れる挙動差を検出 | `Given 前提 <!-- c --> {outside}` | Gherkinを含むIssue/PR本文 | 意図したcomment外placeholder拒否と一致するため再分類 | false-positive | 受理集合は狭まるが現行契約に適合 |
| F-R1-01 | Medium | commentを最低1改行に置換すると、同一行の後続`Given <name>`が行頭化し、context非依存のGherkin除外でcomment外placeholderを隠し得る | `例: <!-- 補足 --> Given <name>`と`withoutGherkin` | Issue/PR本文 | post-PR High指摘を契機に原文同一行をsentinelで保持し回帰例を追加 | valid / resolved | 対象反例は合格 |
| F-R1-02 | Low | 追加SCNは行頭fence判定と最低1改行置換のmutationを直接killしない | 追加Examplesと走査分岐 | unit test | 記録 | valid / improvement | 将来の内部refactorで分岐意図を失う可能性 |
| F-R1-03 | Low | commentが行中にあり後続行がfenceの場合、旧pipelineと振る舞いが異なる | comment置換後のfence状態遷移 | 特殊Markdown | 記録 | valid / safe-behavior-change | 現行契約に反する到達例なし |
| F-R1-04 | Low | 既存Markdown解釈に、異なるfence markerのcloseやinline code端の扱いに限界がある | 既存parser境界 | Issue/PR本文 | Issue #1370のscope外として記録 | valid / out-of-scope | 将来のMarkdown契約強化候補 |
| F-R1-05 | Low | 走査内のnullish fallbackは先行条件から実行不能で、意図を散らす | `opening[0] ?? "`"`、`text[cursor] ?? ""` | `src/domain/issue.ts` | 記録 | valid / maintainability | 挙動影響なし |
| CR-1395-01 | High | comment終端後の同一行Gherkinがcomment外placeholderを隠す | CodeRabbit `discussion_r4005278471` | Issue/PR本文 | sentinelで原文の非行頭性を保持し回帰例を追加 | valid / resolved | なし |
| CR-1395-02 | High | 未終端comment内のinline/fence codeがplaceholderを隠す | CodeRabbit `discussion_r4005278483` | Issue/PR本文 | 未終端確定後のcode開始を禁止し2回帰例を追加 | valid / resolved | なし |
| CLAUDE-R2-01〜03 | Medium | 密着候補、fence内opener、複数行comment後の走査継続が不確実 | Claude Opus Round 2 read-only反例 | `src/domain/issue.ts` | 左境界なしregex、行単位fence消費、内側breakと既存回帰例を一次確認 | false-positive | なし |
| CLAUDE-R2-04 | Low | abrupt-closing comment、CRLF座標、未終端opener自身の候補化 | Claude Opus Round 2 | 現行ASCII exact契約外・位置診断なし | 範囲外として記録 | valid / out-of-scope | 将来のMarkdown契約強化候補 |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい。肯定5観点、敵対8観点、生成済み配布物を除く個別監査対象10 pathを確認。配布物1 pathは8節で確認。
- repo rootで先行review済みH_implとの製品tree一致、共通base `b4eaa5ad2`、exact diff digestを実測した。
- 指摘を確定した: F-R1-01 Medium、F-R1-02〜05 Low。いずれもrecord-only。
- 未解決Critical/High: なし。round 1で収束。

### ラウンド2

- PR #1395のCodeRabbit High 2件を実コードと反例でvalidと確認し、同じPRのpost-PR intakeとして修正した。
- exact H_impl `54fbbda2566496eee2d07cd5634048535f3c631d`へ対象38 scenarios・216 stepsと全2031 scenariosを実行した。
- Claude Opus 5 / effort high / toolsなしread-onlyで修正差分を再レビューし、2件は論理的に解消、未解決Critical/Highなしと判定した。
- Claudeの追加Medium 3件は一次資料と既存反例からfalse-positive、Low 1件は現行契約外として記録した。
- Round 2 digest: `d471b295ee3a047555b0a6866c3899d232121d907e58edb5a78af55aebdf1d02`。未解決Critical/Highなしで再収束。

## 7. テスト結果

- 実行したcommand: 対象SCN filter付きCucumber、`npm run project:quality`から`npm run conformance:check`までの実装・仕様完全gate。
- targeted結果: 38 scenarios、216 steps、失敗0。
- 全layerの合計: 2031 scenarios、2015成功、失敗0、16 skip。10660 steps、10610成功、失敗0、50 skip。
- skipがある層: project選択3層を含む全体で16 scenario・50 step。既存条件付きskipであり本変更の失敗ではない。
- runner・方言: cucumber-js、`en`。説明は日本語。
- Claude reviewerはsuiteを再実行せず、coordinatorの出力整合とsource/distをread-onlyで確認した。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `src/domain/issue.ts` | 入る | IssueとPR本文の完全HTML comment内placeholderを除外する |
| `dist/src/domain/issue.js` | 入る | 上記sourceの配布生成物 |

判断: 配布物を更新した

根拠: source、対応dist、CLI外部契約、要件、追跡を同じH_implで更新した。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | context-isolated |
| その要求を満たすこと | はい |
| reviewerとimplementerのidentity・context比較 | implementerはCodex routing launchの別context、reviewerはClaude Opus 5のread-only非永続context |
| reviewerが対象差分を変更していないこと | はい（Round 2 target diff SHA-256は`de68bcc1e93ad38100321e0e36e751a6ed10edc0f96a7643ff8b642ddc1b30d4`、reviewerの変更path 0件） |

## 10. 仕様整合性

- 判定: updated
- 更新した仕様: REQ-WF-021、REQ-SQ-008、CLI契約、要件追跡表、変更履歴。
- ドメイン用語台帳: TERM-ASC-107を既存意味のまま参照し、新語・意味変更なし。
- 未定義語、重複定義、根拠なしの意味変更、置換先なしの廃止: なし。
- 要件・変更・SCN・テストの追跡: trace check合格。4 unit SCN・36実行ケース、1 integration、1 E2Eと表が一致。
- `no-spec-impact`の場合の限定的根拠: 非該当。
- UI・トークンの判断: いずれもnot-applicableで、CLI/非UIの根拠あり。

## 11. 総合判定と再開地点

- 未解決Critical/High: なし
- Medium/Lowの記録: F-R1-01はresolved。F-R1-02〜05とCLAUDE-R2-04はrecord-only、CLAUDE-R2-01〜03とF-02はfalse-positive。CodeRabbit High 2件はresolved。
- 判定: approved
- 新しい権限が必要な事項: なし。repository ownerから自走mergeまで承認済み。
- 残存リスク: 現行契約外のabrupt-closing commentなどLowのMarkdown意味論と保守性論点。受け入れ条件を阻害する既知反例はない。
- 次に許可される操作: 本artifactだけをcommitして新H_finalを固定し、Step 10 post-PR intake記録、PR再固定、CI、mergeへ進む。
- 次回の再開地点: Round 2 digest、H_impl `54fbbda2566496eee2d07cd5634048535f3c631d`、新H_final、PR #1395、Project #8の#1370=`In review`。
