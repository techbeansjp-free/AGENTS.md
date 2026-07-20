---
document_id: "f1a2b3c4-5d6e-47f8-9a0b-1c2d3e4f5a6b"
---

# 04_review: #169 CLIライフサイクルコマンド（init/upgrade/uninstall/enforce）

**レビュー種別**: verify-and-close（実装完了後レビュー・独立検証）
**レビュー日**: 2026年07月20日
**対象commit**: `e92aeb7`（feat(169): T8 doctor拡張 + T9 package.json files フィールド + T10 AGENTS.md/README.md追記）。実装全体は `4a013ca`〜`e92aeb7` の3コミット。
**対象ブランチ**: `feature/169-cli-lifecycle-commands`
**レビュア**: 実装担当者とは別の独立検証者（本レビュー担当）

> 本レビューは **conformance（立証）** と **falsification（反証）** の両観点を必須で記載する。実装者の自己申告（テスト320件pass等）は鵜呑みにせず、本レビュアが独自に再実行・再現して確認した。

---

## 1. レビュー結論（サマリ）

**判定: 条件付き合格（CONDITIONAL PASS）**

Issue #169 が要求する `init`/`upgrade`/`uninstall`/`enforce` の4コマンドは実際に実装され、CLIとして動作することを実機実行で確認した。`npm test` は実測 **320/320 pass**（実装者報告と一致）。`npm pack --dry-run` は実測 **128ファイル**（実装者報告と一致）で `src/`・`test/`・`tsconfig*` を含まない。2026-07-15型ロックアウト事故の再発防止（ADR-2: `tool_name=="Bash"` 限定matcher）は、`Agent`/`Task` 等の非Bashツール名を模した入力で実際にhookスクリプトを実行し、構造的に評価対象外であることを直接確認した。`uninstall`の安全確認（未commit差分・残存worktree）も実際に壊れた状態を作って拒否されることを確認した。

一方、falsification観点の能動的探索により **F1（材料的・中程度）**: `init`が既存ファイルとの内容衝突を検出した際、設計・実装計画が明記する「他のファイルへの書込みも行わない（部分適用しない）」という保証が実際には守られていないことを実機実行で発見した。また **F2（軽微）**: `uninstall`が`.agent-skill-chain/.installed_version`を削除対象に含めておらず、完全撤去後も`doctor`が「init 導入済み: OK」と誤表示することを発見した。いずれも既存テストスイートでは検出されない（アサーションが該当観点をカバーしていない）。

いずれもデータ消失・安全側原則（AGENTS.md I8）の毀損には至らないため**ブロッキングではない**と判断するが、02_設計・03_実装計画が明記した契約からの逸脱であり、実装完了として扱う前に認識しておくべき事項として記載する。マージ判断は進行役に委ねる。

---

## 2. テスト再実行結果（実測・証跡）

- コマンド: `npm test`（本レビュアが独立して再実行、実装者の報告を検証する目的）
- 結果: **`# tests 320 / # pass 320 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`**（duration ≈ 102.0s）
- 実装者が報告した「320件」と完全一致。口頭報告への依存を排し、実測で確認した。
- 新規テストファイル（`git diff --stat 76afcf9 e92aeb7`で実測確認）: `test/integration/{init,upgrade,uninstall,enforce,claude-pretooluse,doctor,package-files}.test.ts`、`test/unit/{fs-copy,claude-settings,version-marker}.test.ts`。

---

## 3. 実装内容の確認（T1〜T10 conformance／立証）

`git diff --stat 76afcf9 e92aeb7` で実差分ファイル一覧を実測し、03_実装計画のT1〜T10それぞれに対応する実ファイルが存在することを確認した。

| タスク | 実装計画の約束 | 実ファイル（存在確認済み） | 立証手段 | 判定 |
| --- | --- | --- | --- | --- |
| T1 共有基盤 | 定数共有・fs-copyのdry-run対応・version-marker新設 | `src/lib/asset-manifest.ts`（新設）、`src/lib/fs-copy.ts`（`dryRun`オプション追加）、`src/lib/version-marker.ts`（新設）+ `test/unit/{fs-copy,version-marker}.test.ts` | コード読解 + 単体テスト実行（320件中に含まれ全pass） | ✓ 一致 |
| T2 init | `src/commands/init.ts`新設、CLIルーティング登録、`init.sh`ラッパー | 全て存在。CLIルーティング(`src/agents-md.ts`)に`init`登録確認済み | 実CLI実行（`node bin/agents-md.js init <tmpdir>`実測、dry-run/実行/衝突検知いずれも動作） | ✓ 一致（ただし§7 F1参照） |
| T3 upgrade | `src/commands/upgrade.ts`新設、`.installed_version`前提チェック、project/不可侵 | 存在確認済み | 実CLI実行（旧版→現行版ミラー更新・project/RULES.md不変を実測確認） | ✓ 一致 |
| T4 uninstall | `src/commands/uninstall.ts`新設、安全確認2種、`--force`非提供 | 存在確認済み、`--force`引数はUSAGE文言にも実装にも無し | 実CLI実行（未commit差分・残存worktree双方で実際に拒否されることを実測） | ✓ 一致（ただし§7 F2参照） |
| T5 enforce+claude-settings | `src/lib/claude-settings.ts`・`src/commands/enforce.ts`新設 | 存在確認済み、`enforce on/off`がCLIルーティングに2トークンハンドラとして登録済み | 実CLI実行（`.claude/settings.json`実際のJSON内容を確認、idempotency・他フィールド保持を実測） | ✓ 一致 |
| T6 hook本体 | `.agent-skill-chain/hooks/claude-pretooluse.sh`新設 | 存在確認済み（実行可能） | 実行スクリプトへ直接JSON入力を与えて6パターン実測（§4参照） | ✓ 一致 |
| T7 setup非推奨警告 | bare`setup`実行時にstderr警告 | `src/commands/setup.ts`に警告追加確認済み | 実CLI実行（stderr/stdoutを分離して実測、警告文言を確認） | ✓ 一致 |
| T8 doctor拡張 | `.installed_version`存在・enforce配線状態の情報表示 | `src/commands/doctor.ts`に該当チェック追加確認済み | 実CLI実行（未導入時/導入後/enforce on後の3状態で出力を確認） | ✓ 一致（ただし§7 F2により撤去後の表示が不正確） |
| T9 package.json files | `files`フィールド追加、`npm pack --dry-run`実測 | `package.json`に`files: ["bin/", ".agent-skill-chain/", "AGENTS.md", "CLAUDE.md", "docs/GLOSSARY.md"]`確認済み | `npm pack --dry-run`実行（128ファイル、src/test/tsconfig 0件を実測） | ✓ 一致 |
| T10 AGENTS.md/README追記 | `hooks/`エントリ追記、README追記 | `AGENTS.md`（144行、150行以内）・`README.md`双方に反映確認済み | `grep`実測 + `verify doc-length`実行（exit 0） | ✓ 一致 |

**総合**: T1〜T10は全てファイル単位で存在し、対応する挙動が実機動作で確認できた。設計が明記したADR-1〜5（`setup`吸収方針・hookのfail-open構造・hookスクリプト新設・緊急解除の非実装・lint対象現状維持）もコード上で一致することを確認した。

---

## 4. enforce hookのfalsification（2026-07-15型事故の再発防止・重点確認）

Issue #169の核心的安全要件（2026-07-15の「enforce onがAgentツール名未対応で進行役を完全ロックアウトした事故」の再発防止）について、本レビュアが実際にhookスクリプトへJSON入力を与えて反証を試みた。

```
$ echo '{"tool_name":"Agent","tool_input":{"prompt":"git worktree remove .worktrees/foo"}}' | claude-pretooluse.sh; echo $?
0   # 非Bashツール(Agent)は危険な内容を含んでいても常に通過（fail-open、ADR-2の核心）

$ echo '{"tool_name":"Task","tool_input":{"command":"git worktree remove .worktrees/foo"}}' | claude-pretooluse.sh; echo $?
0   # Task（他の想定外ツール名）も同様に通過

$ echo '{"tool_name":"Bash","tool_input":{"command":"git worktree remove .worktrees/foo"}}' | claude-pretooluse.sh; echo $?
拒否: git worktree remove の直接実行は禁止されています。... / exit 2

$ echo '{"tool_name":"Bash","tool_input":{"command":"agent-skill-chain cleanup ISSUE-1"}}' | claude-pretooluse.sh; echo $?
0   # cleanup経由は許可

$ echo '{"tool_name":"Bash","tool_input":{"command":"git checkout -b bad-name"}}' | claude-pretooluse.sh; echo $?
拒否: ブランチ名が命名規約...に違反しています / exit 2

$ echo '{"tool_name":"Bash","tool_input":{"command":"agent-skill-chain enforce off"}}' | claude-pretooluse.sh; echo $?
0   # ADR-4: 緊急解除コマンド自体は拒否パターンと非交差
```

6パターン全てが設計（ADR-2・ADR-4）どおりの挙動を示した。`tool_name`をチェックする箇所（`if [[ "$TOOL_NAME" != "Bash" ]]; then exit 0; fi`）はツール名の網羅列挙を要求しない構造であり、将来新しいツール名（例: 独自のオーケストレータツール）が追加されても、それが`"Bash"`という文字列と一致しない限り自動的に安全側（通過）に倒れる。**2026-07-15と同型の「新ツール名の追随漏れ」というバグクラス自体が構造的に発生し得ないことを実機で確認した。**

`enforce on`実行後の`.claude/settings.json`実測内容:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": ".agent-skill-chain/hooks/claude-pretooluse.sh" }] }
    ]
  }
}
```

`matcher`が`"Bash"`のみであることを実測確認した（要求定義§3.2・設計ADR-2が要求する内容と一致）。また、既存の無関係なフィールド（`permissions.deny`等）を`.claude/settings.json`へ手動で追加した状態で`enforce on`→`enforce off`を実行しても当該フィールドが変更されないことを実測確認した（idempotency・非破壊性の両方）。

---

## 5. uninstallの安全側動作（falsification・意図的に壊した状態での実測）

01_要件定義ストーリー3・02_設計§3.3が要求する安全確認を、実際に「壊れた状態」を作って拒否されることを確認した。

- **未commit差分がある状態**: `init`実行直後（git add/commit前）に`uninstall`（dry-run・実行の両方）を実行 → 両方とも `未commitの変更が .agent-skill-chain/ 配下等に存在するため削除できません` で **exit 1**、ファイルは1つも削除されなかった（`ls`で実測）。
- **残存worktreeがある状態**: `.worktrees/`配下にダミーworktreeを`git worktree add`で作成した状態で`uninstall`を実行 → `cleanup.sh未実行の残存worktreeが存在するため削除できません` で **exit 1**、削除は実行されなかった。
- **正常系（安全確認通過後）**: worktree削除・commit後に`uninstall`を実行 → 実際に`.agent-skill-chain/{standards,templates,schemas,config,adapters,scripts,ci,hooks}`・`.github`・ROOT_LEVEL_ENTRIESが削除され、**`.agent-skill-chain/project/RULES.md`（事前に配置したダミーカスタマイズ）は削除されず残存**することを実測確認した（`cat`で内容も無傷であることを確認）。

`--force`相当のオプションはUSAGE文言・実装のいずれにも存在せず、設計が明記する「安全確認の迂回経路を持たない」方針どおりであることを確認した。

---

## 6. 受け入れ基準の確認（01_要件定義 AC単位）

| ユーザーストーリー/AC | 確認結果 |
| --- | --- |
| ストーリー1 init（3 AC） | 3件とも実測確認。dry-runで書込みなし・実行後の標準構成生成・既存docs資産衝突時の非破壊停止（ただし§7 F1で「他ファイル未作成」の部分が不成立） |
| ストーリー2 upgrade（3 AC） | 3件とも実測確認。正本アセット更新・project/不可侵（ダミーファイル内容不変を実測）・バージョン差分表示（同一版のため`0.1.51 -> 0.1.51`表示を確認） |
| ストーリー3 uninstall（3 AC） | 3件とも実測確認。撤去対象提示・project/明示・未commit差分での安全停止・dry-run（ただし§7 F2で撤去後もversion markerが残る点は将来の再導入判定に影響しうる） |
| ストーリー4 enforce（4 AC） | 4件とも実測確認。配線・解除・非Bashツール網羅性（構造的）・緊急解除手段（Claude Code外シェルからの直接実行、ADR-4文書化） |
| ストーリー5 npm pack files（2 AC） | 2件とも実測確認。`files`フィールド追加・128ファイルでsrc/test/tsconfig非含有 |
| ストーリー6 lint対象判断（3 AC） | 設計フェーズでの判断記載を確認（ADR-5: 現状維持、根拠明記）。`src/lib/scan.ts`が本Issueで無変更であることを`git diff`で確認、ADRの帰結と一致 |

00_要求定義§6成功基準の4項目（4コマンド実装+テストpass、既存237件超無破壊、npm pack実測、lint対象判断反映）は全て満たされている。

---

## 7. falsification（反証・能動的探索で発見した逸脱）

### F1（中程度・非ブロッキング）: `init`の衝突検知は「部分適用しない」という設計保証を満たさない

- **設計の約束**: 02_設計.md§3.1.4「エラーハンドリング: 既存ファイルと内容が異なる場合... は日本語理由付きで停止し、他のファイルへの書込みも行わない（部分適用しない。dry-runで事前確認可能にすることで回避を促す）」。03_実装計画.md T2.2.3「既存ファイルと内容衝突時、エラーで停止し他ファイルも未作成（部分適用しない）」。
- **実機再現**: 空のgitリポジトリに`docs/GLOSSARY.md`（本パッケージ生成物と異なる内容）のみを事前配置した状態で`agent-skill-chain init .`を実行したところ、期待どおり`exit 1`・衝突エラーメッセージが出たが、**`AGENTS.md`・`CLAUDE.md`は実際にディスクへ作成されていた**（`ls`で実測）。`docs/GLOSSARY.md`自体は上書きされず内容も保持されていた。
- **原因（コード読解）**: `src/commands/init.ts`は`ROOT_LEVEL_ENTRIES = ['AGENTS.md', 'CLAUDE.md', path.join('docs', 'GLOSSARY.md')]`（`src/lib/asset-manifest.ts`）を`for`ループで1エントリずつ`copyTreeFailOnConflict`に渡しており、`src/lib/fs-copy.ts`の`copyTreeFailOnConflict`は`walk()`内で衝突を検出した時点で例外を投げるが、その前段のエントリ（`AGENTS.md`・`CLAUDE.md`）は既に`fs.copyFileSync`で書込み済みである。事前の衝突有無を全件チェックしてから書き込む2パスの実装にはなっていない。
- **既存テストでの検出可否**: `test/integration/init.test.ts`の「既存docs資産と衝突する場合は非破壊で停止し、終了コードが0以外になる」テストは`status===1`と`stderr`のメッセージ一致のみをアサートしており、他ファイルが作成されていないことは検証していない。したがって本逸脱はCIでは検出されない。
- **影響評価**: データ消失は起きない（新規ファイルの作成のみ、上書きなし）。再実行時は`AGENTS.md`/`CLAUDE.md`が既に同一内容で存在するため`unchanged`として idempotent に進む設計だが、ユーザーが衝突解消を諦めて別の対応を取った場合、リポジトリに「一部だけ`.agent-skill-chain`導入前段のルートファイルが増えている」中途半端な状態が残る。**setup系の既存動作（`copyTreeFailOnConflict`自体は`setup.ts`が既に使用している既存関数）から新規に生じた退行ではなく、既存の制約が新設`init`にもそのまま持ち込まれた**という位置づけであり、Issue #169固有の新規バグではなく設計文書の記述と実装の間の不整合（ドキュメントが実際の実装より強い保証を謳っている）と評価する。
- **判定**: 非ブロッキング（安全側は破られていない）だが、02_設計・03_実装計画の記述を実装に合わせて修正するか、真に部分適用しないよう2パス化するかのいずれかの対応を推奨する。

### F2（軽微・非ブロッキング）: `uninstall`が`.agent-skill-chain/.installed_version`を削除対象に含めない

- **実機再現**: `init`→commit→`uninstall`を正常系で実行した後、`.agent-skill-chain/`配下を確認したところ`project/`（保持対象、意図通り）に加えて`.installed_version`ファイルが削除されずに残っていた（`.installed_version`は`ROOT_LEVEL_ENTRIES`にも`NAMESPACED_ENTRIES`にも含まれないため、`src/commands/uninstall.ts`の`managedRelativePaths()`が算出する削除対象に入らない）。
- **影響**: 完全撤去後に`doctor`を実行すると「情報 init 導入済み: OK (0.1.51)」と表示され続け、実際には`.agent-skill-chain/config`等の資産一式が既に存在しないにもかかわらず「導入済み」という情報が誤って提示される。01_要件定義ストーリー3の目的（「撤去漏れ・意図しない削除事故を機械的に防ぐ」）からすると、これは撤去コマンド自身による軽微な「撤去漏れ」である。
- **既存テストでの検出可否**: `test/integration/uninstall.test.ts`・`doctor.test.ts`のいずれにも`.installed_version`の削除有無を検証するアサーションは無い（`grep`で確認済み、0件）。
- **判定**: 非ブロッキング（安全側原則への影響なし、データ消失なし）。`.installed_version`を`uninstall`の削除対象へ追加するか、`doctor`が`.agent-skill-chain/config`等の実体有無も合わせて判定するよう改修することを推奨する。

### 反証の非発見（安全側の確認）

- 「非Bashツール名を模倣すれば危険操作が通る」という2026-07-15型の経路を`Agent`/`Task`の両方で試したが、いずれも構造的に評価対象外であり発見されなかった。
- 「`enforce`のJSONマージが既存の`permissions.deny`等を破壊する」経路を実データで試したが、`on`→`off`を通じて無関係フィールドは一切変更されなかった。
- 「`uninstall`が未commit差分・残存worktreeいずれかの状態で実削除してしまう」経路を両パターンで試したが、いずれも`exit 1`でファイルは1つも削除されなかった。
- 「`upgrade`が`project/`配下を巻き込む」経路を実データ（ダミーカスタマイズファイル）で試したが、`upgrade`実行後も内容は不変だった。

---

## 8. 規模比例・非該当セクション

- §データ設計/新規スキーマ: **非該当**（`.installed_version`はプレーンテキスト1行、新規`.schema.yaml`は追加なし。設計どおり）。
- §パフォーマンス: **非該当**（ファイルシステム操作・JSON読み書きのみ、既存`setup`/`cleanup`と同等の実行時間であることを体感時間で確認、特筆すべき遅延なし）。
- §デプロイ: **非該当**（配布テンプレート変更なし。npm pack実測は§6・§3で対応済み）。
- §docs/system-spec継続追随ゲート: **不発動**（AGENTS.mdにより`docs/system-spec/`実体は別Issueで構築予定・未整備）。

---

## 9. 残課題・follow-up提案（独断起票はしない）

進行役の判断・Go出しを前提に、以下を提案する。

1. **F1（init部分適用）**: 02_設計・03_実装計画の記述を実装の実態（衝突検出は逐次・部分書込みが起こりうる）に合わせて修正するか、`copyTreeFailOnConflict`を「全件先読みで衝突を検査してから書き込む」2パス方式へ改修するか、いずれかを次Issueで判断する。既存の`setup`コマンドも同じ関数を使っており同様の制約を持つため、修正する場合は影響範囲が`init`単体に留まらない点に留意。
2. **F2（uninstallの.installed_version残存）**: `uninstall`の削除対象へ`.agent-skill-chain/.installed_version`を追加するか、`doctor`の「init導入済み」判定を実体（例: `.agent-skill-chain/config/agent-skill-chain.yaml`存在）ベースに変更するか判断する。
3. （軽微）`test/integration/init.test.ts`の衝突検知テストへ「他ファイルが作成されていないこと」のアサーションを追加し、F1の回帰を今後検出できるようにする。

---

## 10. 参照

- `docs/maintainer/workflow/20260720_090158_169-cli-lifecycle-commands/00_要求定義.md` / `01_要件定義.md` / `02_設計.md`（ADR-1〜5） / `03_実装計画.md`（T1〜T10）。
- 対象commit `4a013ca`・`8ac05e7`・`e92aeb7`（35ファイル変更、3124行追加・41行削除、`git diff --stat 76afcf9 e92aeb7`で実測）。
- GitHub Issue #169（techbeansjp-free/AGENTS.md）。
- AGENTS.md（§不変条件 I8・§役割権限・§GitHub配布マルチAI対応）。
- 検証環境: `/tmp`配下の隔離した一時gitリポジトリ4つ（本レビュー完了後に削除済み、既存リポジトリへの影響なし）。
