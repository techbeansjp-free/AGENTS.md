# 04 レビュー

## 0. レビュー識別情報

| 項目 | 内容 |
|---|---|
| 対象 | 実装 |
| ラウンド | 2 |
| 対象SHA・文書ダイジェスト | `948a5755435f14f88a398df64f8219262186f28e`、diff SHA-256 `9b3bb36fdb03f6d102778c34b4efbcb758a99984897f3331510f4a71b2167fef` |
| 比較基点 | `dc479419982dbba973bc022fadff2adc718abe00` |
| H_impl | `948a5755435f14f88a398df64f8219262186f28e` |
| 対象差分 | `AGENTS.md`、`README.md`、`docs/PROJECT_MANAGEMENT.md`、先行版の本review artifactの4 path |
| 対象外 | 比較基点に存在し変更されていない製品source、test、spec、ASC本体 |
| 残り予算 | counted round 5、収束後のHEAD移動に対する取り直し1 |
| ラウンド数 | 2 |
| Step chain | 経由: `.agent-skill-chain/tmp/issues/20260914_165439_GitHub-Project-8をWBSと着手順序の正本にする` |
| 仕様の所有箇所 | repository固有運用は`docs/PROJECT_MANAGEMENT.md`、製品仕様はno-spec-impact |
| 成果物行数 | repository運用文書58追加0削除。支援層の追加なし |
| 縮小の先行評価 | 可変Issue一覧を複製せず、詳細正本1 fileと既存入口2 fileの最小linkだけに縮小した |
| 実施者・日時 | reviewer: Claude Opus 5 / effort high / toolsなしread-only、round 2は2026-09-15T03:16+09:00まで。CodeRabbit指摘とcoordinatorのGit・Project・test一次証拠を照合 |

### 0.1 routing入力契約

| role欄（担当role） | 必要証拠 | 必要model tier | provider欄 | model設定欄 | fallback欄 | 独立性証拠欄・非変更証拠 |
|---|---|---|---|---|---|---|
| reviewer | 肯定5観点、敵対8観点、finding分類、mutation 5件 | critical | Claude上限 | Opus 5、effort high、標準速度 | 利用不能・未解決Critical/Highなら停止しfallbackしない | implementerのCodex contextと別session。Claudeはtoolsなしで提示したexact diffだけをreviewし、変更path 0件 |

## 1. 入力証拠

| 証拠 | 参照先 | 観測結果 | 根拠種別 |
|---|---|---|---|
| 要求・受け入れ条件 | Issue #1393、staging 00〜03 | AC-PM-001〜008、INV-PM-01〜03 | 既存文書 |
| 差分 | `dc479419982dbba973bc022fadff2adc718abe00`..`948a5755435f14f88a398df64f8219262186f28e` | 実装3 pathと先行review artifact、diff digest `9b3bb36fdb03f6d102778c34b4efbcb758a99984897f3331510f4a71b2167fef` | Git観測 |
| テスト | `npm run verify:distribution`と`npm run package:check` | 2031 scenarios失敗0、conformance 87/87、artifact監査以外の全gate合格 | テスト出力 |
| 仕様 | `docs/specs/`の製品仕様 | no-spec-impact | Git差分と既存文書 |
| commit前candidate | 3実装pathと先行review artifact | H_impl `948a5755435f14f88a398df64f8219262186f28e` | Git観測 |
| Phase A artifact | 本file | H_impl後に本fileだけをcommitしてH_finalとする | Git観測 |
| review session | 上記staging | session `6c26f744adcff5f26a597328c003ed99559b95a4b09e5f874af56c962b3b214e`、round 2 digest `29254217ac3e15f812d905cc38453100c81b30cd432fd75c6f89bdbe852412e4` | ASC保存session |

- dependency/authority/evidence graphにcycle、self-loop、unknown node、candidate自己評価、tracked artifact自己SHAがない: はい。
- `H_impl`から`H_final`への差分は本artifact 1 fileだけにする: はい。
- reviewerの独立性は既定の`context-isolated`を満たす: はい。
- Phase BのPR・CI証拠は本artifactへ書かず、PR作成後の`review evidence`へ委譲する: はい。
- 既定branch追随はartifactより前のmerge commitで行い、比較基点を取り込んだ`origin/main` tipへ更新した: はい。

### 1.1 変更ファイル個別監査

| path | 変更種別 | owner | target layer | 単一責務・配置根拠 | 依存方向・循環 | 仕様・AC・SCN | 安全・rollback | 個別判定 |
|---|---|---|---|---|---|---|---|---|
| `AGENTS.md` | M | repository / package入口 | project | agent向けProject・詳細正本への入口だけを追加 | 一方向link、循環なし | AC-PM-001、SCN-PM-001 | 2行をrevert可能 | pass |
| `README.md` | M | repository / package入口 | project | 人向け正本一覧へ入口1行だけを追加 | 一方向link、循環なし | AC-PM-001、SCN-PM-001 | 1行をrevert可能 | pass |
| `docs/PROJECT_MANAGEMENT.md` | A | repository開発管理 | project | WBS、Status、順序、分解、完了を一箇所で所有 | Issueは作業契約、Projectは可変状態、本文は規則を所有 | AC-PM-002〜008、SCN-PM-002〜008 | 文書をrevertしProject状態をread-back可能 | pass |
| `docs/reviews/219_課題1393Project管理WBSレビュー.md` | A | repository review証拠 | evidence | round 1のexact-head判定を版管理下で保持し、round 2で前向き更新 | 実装に依存する終端証拠で逆依存・循環なし | Step 10、SCN-PM-001〜008 | review履歴を保持しPR再固定前ならcommitをrevert可能 | pass |

- 基準SHAとの差分path集合と表のpath集合が完全一致する: はい、4件。
- package層へproject固有の汎用機構、spec/evidence層へ実行authorityを混入していない: はい。入口2 fileは配布対象だが実行契約を変えない案内である。
- 個別findingを修正した場合、そのfileと隣接依存だけを再監査した: はい。`docs/PROJECT_MANAGEMENT.md`のStatus表と直後のfail-closed規則をround 2で再監査した。

## 2. 受け入れ条件の確認

### 2.0 実装中に発見した事実と前向きな対処

| 発見ID | 事実 | 影響 | 契約変更 | 対処 | Verification Evidence | 仕様反映 | 判定 |
|---|---|---|---|---|---|---|---|
| DISC-PM-001 | 旧validatorが03のparallel-progress markerをplaceholder扱いした | Step 7/8検証 | なし | #1370へ分離し、merge後にmainを本branchへ追随 | #1370 Done、main `dc479419982dbba973bc022fadff2adc718abe00`、全gate合格 | no-spec-impact | pass |

### 2.1 受け入れ条件とシナリオ

| AC ID | SCN ID | 実装 | テスト結果 | 判定 | 証拠 |
|---|---|---|---|---|---|
| AC-PM-001 | SCN-PM-001 | `AGENTS.md`、`README.md` | Project URLとlocal link実在 | pass | Git diff・link読取 |
| AC-PM-002 | SCN-PM-002 | 着手順序節 | #1393をReady先頭でread-back後In progressへ更新 | pass | Project item-list |
| AC-PM-003 | SCN-PM-003 | Status表・停止規則 | blocker理由・再開条件を記録してBacklogへ戻す実運用を確認 | pass | Issue comment 5668103902とProject read-back |
| AC-PM-004 | SCN-PM-004 | WBSとしての分解節 | 独立完成・review・merge・rollbackと親子責務を明記 | pass | 文書review、mutation kill |
| AC-PM-005 | SCN-PM-005 | 完了と整合確認節 | reviewのみのDoneを拒否 | pass | Claude mutation 2 kill |
| AC-PM-006 | SCN-PM-006 | 可変一覧を複製しない設計 | 全22 itemを確認。追加は#1393/#1396、#1370 Doneは独立merge、既存Ready相対順維持 | pass | Project read-back |
| AC-PM-007 | SCN-PM-007 | 専用worktree/branch | root main clean、candidate branchはIssue専用 | pass | Git status/worktree/head |
| AC-PM-008 | SCN-PM-008 | 外部状態更新規則 | 対象・権限・状態を事前確認し、不明時停止、更新後read-back | pass | gh auth・Project read-back・Claude送信安全停止/再開記録 |

### 2.2 開発考慮事項の適用判定

| ID | 考慮事項 | 判定 | 理由 | 実装・検証証拠 |
|---|---|---|---|---|
| DC-PRIVACY | Privacy/Security by Design | applicable | private Projectと認証済み外部操作を扱う | credential非保存、org/repo/project/item ID・authorityを前後確認。Claude送信は具体的承認後だけ実行 |
| DC-OBSERVABILITY | Secure Logging・Observability・運用可能性 | applicable | Status・順序・Issue・PRを運用判断へ用いる | Issue、item ID、Status、HEADで相関しProject/Gitをread-back。秘密は記録しない |
| DC-UX | Human-Centered UI/UX・アクセシビリティ | not-applicable | Markdownと既存GitHub UIの運用で新しいUIを実装しない | 変更3 pathにUI sourceなし |
| DC-TOKENS | Design System・Design/Layout Token | not-applicable | component、theme、breakpoint、layoutを変更しない | 変更3 pathはMarkdownのみ |

## 3. 肯定的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 正しさ | ACと観測結果が一致する | pass | Status表と各節が全ACへ対応しProject read-backも一致 |
| 価値 | 会話履歴なしで次作業を判断できる | pass | Project・Issue・運用文書の所有責務を分離 |
| 実現可能性 | 現行ProjectとMarkdownで運用できる | pass | 新依存なし、実際の状態遷移で確認 |
| 整合性 | 要求、設計、文書、Project、testが一致する | pass | net 3 path、全gate、Project説明/Status read-back |
| 保守性 | 可変一覧を複製せず入口と正本を分離する | pass | README/AGENTSはlinkだけ、詳細規則は1 file |

## 4. 敵対的評価

| 観点 | 確認内容 | 判定 | 根拠 |
|---|---|---|---|
| 反例 | 下位Ready、delivery前Done、時間分割、label正本化 | pass | Claude mutation 1〜4を本文が直接kill |
| 失敗経路 | blocker、不明状態、外部write失敗 | pass | 理由・再開条件付きBacklog、不明時停止、read-back |
| 境界値 | Ready空・複数、重い密結合作業 | pass | 推測選択禁止、最上位1件、時間だけの分割禁止 |
| 悪用 | priorityによる順序迂回、権限推定 | pass | 下位先取りと後続権限推定を明示拒否 |
| 安全性 | 認証、対象誤認、秘密、TOCTOU | pass | ASC authorityを維持し更新前後にread-back。F1/F2はrecord-only |
| データ損失 | 誤Status、履歴消失、文書削除 | pass | 0削除、判断不能時は移動せず停止、履歴保持 |
| ロールバック | 文書とProject状態を復旧できる | pass | commit revertと事前read-back値からの別authority復旧 |
| 範囲漏れ | 入口、Project説明、Status、分解、完了、配布 | pass | 3 path個別監査、全22 item、package files確認 |

## 5. 指摘

| ID | 重大度 | 内容 | 証拠 | 影響範囲 | 対応 | 状態・分類 | 残存リスク |
|---|---|---|---|---|---|---|---|
| CLAUDE-1393-F1 | Medium | view sort変更時の表示順を未明文化 | Ready表示順 | 着手順序 | view 1と現行説明を確認し記録のみ | valid / improvement | sort追加時に再確認 |
| CLAUDE-1393-F2 | Medium | 認証actor確認を本文へ重複していない | 外部更新前確認 | 外部更新 | ASC所有・実操作確認、記録のみ | valid / improvement | 手動運用の誤読余地 |
| CLAUDE-1393-F3 | Low | 子Issue化が「検討する」表現 | 分解節 | WBS分解 | 独立成果物1単位契約と過剰分割防止を優先 | valid / improvement | 運用差 |
| CLAUDE-1393-F4 | Low | close手順が権限付与に読める可能性 | 完了節 | authority | 直後の別操作・別権限規則が拒否 | false-positive | なし |
| CLAUDE-1393-F5 | Low | 誤Status後の具体的復元手順なし | 停止規則 | 復旧 | 将来改善として記録 | valid / improvement | 手動判断 |
| CLAUDE-1393-F6 | Low | In reviewからの差し戻し未記載 | Status表 | review | CodeRabbit指摘と一致しround 2で修正 | resolved / improvement | なし |
| CLAUDE-1393-F7 | Low | worktree規則が詳細文書にない | AGENTS/ASC | local | 所有正本の重複を回避 | false-positive | なし |
| CLAUDE-1393-F8 | Low | 増加itemがpromptで未特定 | Project read-back | AC-PM-006 | 全22件を再取得し#1393/#1396と特定 | false-positive | なし |
| CODERABBIT-1393-F1-R2 | Low | In review不合格時の遷移・理由・再review条件が未定義 | `docs/PROJECT_MANAGEMENT.md:21` | review | 3条件を同じStatus行へ追加 | resolved / improvement | なし |
| CLAUDE-1393-R2-F7 | Low | Backlog分岐で再開条件を同じ行に再掲していない | Backlog行・直後規則 | review | 同一文書の既存規則が常に要求するため記録 | valid / improvement | point-of-useの読解負荷 |
| CLAUDE-1393-R2-F8 | Low | 修正可能と再検証待ちの分岐が重なる余地 | Status表・停止規則 | review | 判断不能時は移動しないfail-closedを確認 | valid / improvement | 手動判断 |

## 6. ラウンド固有の確認

### ラウンド1

- 全評価基準を確認した: はい。肯定5、敵対8、個別監査3 path、mutation 5件を確認。
- 指摘を確定した: Medium 2、Low 6。全件record-only、3件は一次資料でfalse-positiveへ分類。
- 次ラウンド対象のCritical/High: なし。round 1で収束。

### ラウンド2

- 未解決Critical/High: なし。CodeRabbitのMinor 1件をresolved、Claudeの新規Low 2件をrecord-onlyとした。
- 修正差分: `docs/PROJECT_MANAGEMENT.md:21`で`In review`不合格時の遷移先、理由記録、再review条件を追加。
- 修正で触れた隣接範囲: Status表のBacklog・In progress・Done行と直後のfail-closed規則。
- 既承認・未変更範囲を再走査していない: はい。Project Status options、旧文言の重複、変更1行と隣接規則だけを再確認。

### ラウンド3

- 全指摘の最終分類: round 2で確定。未解決Critical/High/Mediumなし。
- 任意の危険範囲を除外・既定無効・ロールバック可能へ縮小した結果: 追加の危険範囲なし。
- 同じ範囲の予算を自動更新していない: はい。
- AIによる最終裁定: Claude Opusは元指摘resolved、Critical/High/Mediumなしで承認推奨。一次資料照合後も同じ判定。

## 7. テスト結果

- 実行command: `npm run verify:distribution`、`npm run package:check`、Git/Project read-back。sandbox内初回の隔離Git `EPERM`は証拠にせず、必要権限付きで再実行。
- 全layer合計: 2031 scenarios、2015 passed、0 failed、16 skipped。10660 steps、10610 passed、0 failed、50 skipped。
- skipがある層: unit・integration・e2eを含む全体で16 scenario・50 step。既存条件付きskipで本変更の失敗ではない。
- runner・Gherkin方言: cucumber-js、`en`。説明は日本語。
- conformance: 87 scenarios / 468 steps、失敗0。新H_implでbuild、docs/test format、trace、architecture合格。artifact監査とpackage検査は本fileのcommit後に再実行する。

## 8. 配布物影響

| 変更path | 配布境界に入るか | 影響 |
|---|---|---|
| `AGENTS.md` | 入る | agent向けにProject #8と詳細運用文書への入口を追加 |
| `README.md` | 入る | 利用者向け正本一覧へProject #8と詳細運用文書への入口を追加 |
| `docs/PROJECT_MANAGEMENT.md` | 入らない | repository内の詳細運用正本。package filesには含まれない |
| `docs/reviews/219_課題1393Project管理WBSレビュー.md` | 入らない | repository内の独立review証拠。package filesには含まれない |

判断: 配布物を更新した

根拠: `package.json#files`は`README.md`と`AGENTS.md`を含む。runtime、CLI、schema、template契約は不変。

## 9. 独立reviewの成立

| 項目 | 内容 |
|---|---|
| 適用した独立性モード | `context-isolated`（project policy未宣言時の既定） |
| その要求を満たすこと | はい |
| reviewerとimplementerのidentity・context比較 | implementerはCodex本作業context、reviewerはClaude Opus 5 / effort high / session非永続・toolsなしの別context |
| reviewerが対象差分を変更していないこと | はい。Claudeへwrite toolを与えず、review後の対象差分path変更0件 |

## 10. 仕様整合性

- 判定: no-spec-impact
- 更新した仕様: なし。repository固有運用は`docs/PROJECT_MANAGEMENT.md`が所有する。
- ドメイン用語台帳の候補・確定・現在有効な定義が一方向に追跡できる: 製品用語不変。WBS・着手順序は本運用文書内で定義。
- 未定義語、重複定義、根拠なしの意味変更、表記揺れ、置換先なしの廃止がない: はい。
- 要件・変更・SCN・testの追跡: AC-PM-001〜008、SCN-PM-001〜008を3 pathとGit/Project観測へ対応。
- `no-spec-impact`の限定的根拠: 製品CLI、API、data、runtime、security modelは不変で、repository開発管理文書と入口だけを変更。
- UI・tokenの判断: 既存GitHub UIを利用するだけでUI・design/layout token変更なし。

## 11. 総合判定と再開地点

- 未解決Critical/High: なし。
- Medium/Lowの記録: round 1のMedium 2件・Low 6件、round 2のLow 3件をsessionと本artifactへ記録。F6とCodeRabbit指摘はresolved。
- 判定: approved
- 新しい権限が必要な事項: PR作成・mergeはユーザーが常時許可済み。release、publish、cleanupは対象外。
- 残存リスク: view sort、認証actor明文化、誤Status復旧、分岐のpoint-of-use表現は将来改善候補。現行ACを妨げない。
- 次に許可される操作: 本artifactだけをcommitし、audit合格後にpost-PR Step 10を固定してPR #1397を再固定する。
- 次回の再開地点: session `6c26f744adcff5f26a597328c003ed99559b95a4b09e5f874af56c962b3b214e`、round `29254217ac3e15f812d905cc38453100c81b30cd432fd75c6f89bdbe852412e4`、H_impl `948a5755435f14f88a398df64f8219262186f28e`。
