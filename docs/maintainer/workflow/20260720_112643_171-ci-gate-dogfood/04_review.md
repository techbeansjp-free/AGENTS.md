---
branch: "process/171-ci-gate-dogfood"
github_issue: "#171"
---

# 04_review: #171 CI/gate運用の本番導入とE2Eフロー実地一周

**レビュー種別**: verify-and-close（実装完了後レビュー・実行者自身による実地確認。独立検証者は別途必要かは進行役判断）
**レビュー日**: 2026年07月20日
**対象**: `.github/`一式の`init`導入 + `.agent-skill-chain/config/agent-skill-chain.yaml`の`review.adapter`変更
**対象ブランチ**: `process/171-ci-gate-dogfood`

> 本レビューは conformance（立証）と falsification（反証）の両観点で記載する。`npm test`は実測結果をそのまま記載し、fail が出た事実を隠さない。

---

## 1. レビュー結論（サマリ）

**判定: 条件付き完了（CONDITIONAL）**

Issue #171 の目的1・2（`init`実行による`.github/`一式導入、`review.adapter`のhumanへの変更）、および目的3の前段（branch-name検証）は実機実行で立証され、すべて意図どおりに動作した。

一方、Issue本文が明記する成功基準「既存322件超のテストを破壊しない」は**未達**である。`npm test`実測結果は **314/322 pass、8 fail**。falsification観点で調査した結果、8件全ての失敗原因を特定した——いずれも本Issueが要求する2つの変更（`init`実行・`review.adapter`変更）そのものが引き起こす、テスト側の暗黙の前提条件違反であり、原因不明のflakyな失敗ではない（詳細は§3）。本ドキュメントはこれを事実として記録し、対応方針（テスト側修正 or 許容）の判断は進行役に委ねる。

---

## 2. conformance（立証）: 実行手順ごとの実測結果

| 手順 | コマンド | 実測結果 | 判定 |
| --- | --- | --- | --- |
| `npm ci` | `npm ci` | `prepare`スクリプト経由で`tsc`成功、12 packages追加、脆弱性0件 | ✓ |
| init dry-run | `node bin/agents-md.js init --dry-run` | 既存96ファイルが`planned unchanged`、`.github/`配下18ファイルが`planned created` | ✓ |
| init実行 | `node bin/agents-md.js init` | dry-runと完全一致するファイル一覧が`created`、終了コード0。作成内訳: `CODEOWNERS`、`ISSUE_TEMPLATE/{bugfix,config,docs,feature,hotfix,process,refactor}.yml`（7種）、`SECURITY.md`、`dependabot.yml`、`pull_request_template.md`、`workflows/agent-skill-chain-{ci,gate,reconcile,risk}.yml`（4種）。加えて`.agent-skill-chain/.installed_version`（バージョンマーカー、既存挙動）が新規作成された | ✓ |
| config変更 | `.agent-skill-chain/config/agent-skill-chain.yaml`の`review.adapter`を編集 | `adapter: claude` → `adapter: human`に変更済みであることを`grep`実測確認。`.agent-skill-chain/schemas/config.schema.yaml`の`adapter: {type: string, enum: [claude, codex, human]}`が既に`human`を許容しており、schema側の変更は不要だった | ✓ |
| branch-name検証 | `node bin/agents-md.js verify branch-name process/171-ci-gate-dogfood`（引数明示・省略時の現branchでの実行の両方） | いずれも終了コード0 | ✓ |
| `npm test` | `npm test` | `# tests 322 / # pass 314 / # fail 8 / # cancelled 0 / # skipped 0 / # todo 0`（duration ≈ 96.1s） | ✗（§3参照） |

---

## 3. falsification（反証）: 8件のtest fail の根本原因

8件の失敗を実際に1件ずつスタックトレース・該当テストコードを読解して原因特定した。**原因は2種類のみ**であり、いずれも「本Issueが要求した変更を実際に実行したことで、テストコードが暗黙に置いていた前提が崩れた」という構造で説明がつく。

### 原因A（6件）: `review.adapter`のデフォルト値変更に依存するテスト

`test/helpers/tmp-repo.ts`の`createTmpRepo()`は、テスト用一時リポジトリの`.agent-skill-chain/`を**本リポジトリ（`packageRoot`）の`.agent-skill-chain/`から`fs.cpSync`でそのまま複製**する実装になっている。つまり本リポジトリの`config/agent-skill-chain.yaml`が事実上「テストが依拠するデフォルト設定」を兼ねている。今回`review.adapter`を`claude`から`human`へ変更したことで、以下のテストが影響を受けた。

- `not ok 32` `claude launch_gate_reviewer: read-only レビュアの verdict を gate-report へ結線し exit 0（final=approved）`: このテストは`setAdapter()`を呼ばず**デフォルトが`claude`であることに暗黙に依存**している。デフォルトが`human`になったため、実際にはhumanアダプタの経路（`human_required`、exit 3）が実行され、期待値`exit 0`と一致せず失敗（`3 !== 0`）。
- `not ok 33` `認証未設定は安全側（human_required）へ倒し exit が 0 でも 3 でもない`: 同様にデフォルト`claude`前提のテストだが、期待するのは「claudeアダプタが認証未設定時にhuman_requiredへ倒れ、かつexit 3ではないこと（3は human アダプタ固有の値であるべきという設計意図）」。デフォルトが既に`human`のため、returnされるexit 3は「claudeのfail-safe」ではなく「human本来の正常応答」であり、`notStrictEqual(actual, 3)`のアサーションに反した（`3`同士で一致してしまい失敗）。
- `not ok 34` `レビュア起動失敗は human_required へ倒す（silent pass しない）`: 同上の理由で失敗。
- `not ok 39` `gate-launch-reviewer.sh: 完了(0)/deferred(3)/error(≠0,≠3) の終了コードをそのまま伝播する`: 内部の「completed: claude + pass/pass stub → 0」ケースが`setAdapter()`を呼ばずデフォルト`claude`に依存しており、上記と同じ理由で失敗。
- `not ok 49` `gate reviewer-context: adapter/backend/issue_number/base_dir を出力する（既定 adapter=claude）`: テスト名自体に「既定 adapter=claude」と明記されており、デフォルト値が変わったことで直接的に不一致。

- `not ok 35` `human launch_gate_reviewer (local): マーカーを生成し final=human_required・exit 3 を返す`、`not ok 36` `human launch_gate_reviewer (github): ...`: この2件は逆に`setAdapter(repo.dir, 'human')`を明示的に呼んでいるが、`setAdapter()`の実装（`test/integration/gate-adapters.test.ts:53-58`）は`text.replace(/adapter: \w+/, 'adapter: human')`の実行結果が**元のテキストと異なること**を`assert.notEqual`で強制している。デフォルトが既に`human`であるため、置換前後で文字列が変化せず、置換処理自体を検証するためのこのアサーションが「置換に失敗した」と誤判定して即座に失敗する（実際にはconfigの値は正しく`human`であり、gate判定ロジック自体に問題はない）。

### 原因B（1件）: `init`が新設した`.installed_version`がテストfixtureへ伝播

- `not ok 23` `doctor: initを実行していないtarget_dirでも、他の必須チェックがOKなら終了コードは0のままで、init未導入が情報表示される`: 期待値は`情報  init 導入済み: NG（未導入）`だが、実際には`情報  init 導入済み: OK (0.1.51)`。原因は原因Aと同じく`createTmpRepo()`が本リポジトリの`.agent-skill-chain/`をそのまま複製する実装であること。本Issueの手順どおり`init`を本リポジトリで実行した結果、`.agent-skill-chain/.installed_version`が本リポジトリに実在するようになり、「initを実行していないtarget_dir」を模擬するはずのテストfixtureにこのマーカーファイルが意図せず複製され、テストの前提（「未導入状態」）が成立しなくなった。

### 評価

- 8件とも**安全側原則（AGENTS.md I8）や実際のCLI挙動の欠陥ではない**。gate判定・doctorコマンド自体は設定どおり正しく動作している。失敗はテスト側の「本リポジトリの`.agent-skill-chain/`は常にinit未実行かつadapter=claudeのpristine状態である」という暗黙の前提が、本Issueの目的（このリポジトリ自身でinitを実行しhumanアダプタで運用する＝ドッグフーディング）と構造的に両立しないことに起因する。
- 言い換えると、**本Issueの目的（実際にこのリポジトリへ導入する）と、既存テストスイートの設計（このリポジトリを「まだ導入されていない配布元テンプレート」として扱う）が矛盾している**。この矛盾はドッグフーディングを実際に行って初めて表面化したものであり、Issue背景が指摘する「実績が一度もない」ことの直接的な帰結と言える。
- 対応方針の候補（いずれも本レビューでは実施せず、判断のみ進行役へ委ねる。理由: 本Issueのスコープは「config変更とinit実行のみ」であり、`test/`配下の改修は範囲外と整理していたため）:
  1. `test/helpers/tmp-repo.ts`の`createTmpRepo()`が`.agent-skill-chain/`を複製する際に`.installed_version`を除外する。
  2. T2系テスト（32,33,34,39,49）がデフォルト値に暗黙依存せず、必要なadapterを`setAdapter()`で明示的に設定してから実行するよう修正する。
  3. `setAdapter()`のassert.notEqualを「置換後の値が期待どおりであること」の直接検証に変更する（現状の「テキストが変化したこと」という間接検証をやめる）。

---

## 4. 受け入れ基準の確認（01_要件定義 AC単位）

| AC | 結果 |
| --- | --- |
| AC1-1（`.github/`18ファイル作成、既存は`unchanged`） | ✓ 実測確認 |
| AC1-2（dry-runと実行結果の一致） | ✓ 実測確認 |
| AC2-1（`review.adapter: human`への変更） | ✓ 実測確認 |
| AC2-2（schemaが`human`を許容） | ✓ 確認済み（変更不要だった） |
| AC3-1（`verify branch-name`がexit 0） | ✓ 実測確認 |
| AC3-2（既存322件がpass） | ✗ **314/322 pass、8 fail**（§3に原因を全件特定済み） |

---

## 5. 参照

- GitHub Issue #171（techbeansjp-free/AGENTS.md）。
- `00_要求定義.md` / `01_要件定義.md` / `02_設計.md` / `03_実装計画.md`（本ディレクトリ）。
- `test/helpers/tmp-repo.ts`（`createTmpRepo()`実装）、`test/integration/gate-adapters.test.ts`（`setAdapter()`実装、T2/T3/T4/T5テスト本体）、`test/integration/doctor.test.ts`（test 23本体）、`test/integration/gate-judgment.test.ts`（test 49本体）。
- `.agent-skill-chain/schemas/config.schema.yaml`（`review.adapter`のenum定義）。
