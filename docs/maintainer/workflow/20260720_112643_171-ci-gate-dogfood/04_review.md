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

---

## 6. 追記: PR #172 実地実行での `gate-review (spec)` 失敗と対応

**発生**: 本Issueの成果を実際にPR #172として本番導入した後、GitHub Actions上の実地実行（run 29713314233、job 88261048289）で`gate-review (spec)`が下記エラーで失敗した。

```
ISSUE-171 の worktree が見つかりません
##[error]Process completed with exit code 1.
```

### 根本原因

`src/lib/worktree.ts`の`findIssueWorktree()`は、`git worktree list --porcelain`の実体（`.worktrees/<timestamp>-<type>-<issue>-<slug>/`パターンに一致するエントリ）にのみ依存していた。ローカル開発機では`git worktree add`済みの実物worktreeが存在するため機能するが、GitHub Actionsの`actions/checkout`は単一の通常チェックアウトを行うだけで`git worktree add`を一切使わない。そのため`git worktree list --porcelain`はチェックアウト先（リポジトリルートそのもの）1件のみを返し、`.worktrees/...`パターンには一致せず、常に`undefined`が返っていた。この関数は`src/commands/gate.ts`・`src/commands/verify.ts`・`src/commands/reconcile.ts`から呼ばれ、いずれもCI workflow（`.github/workflows/agent-skill-chain-{gate,ci,reconcile}.yml`）経由で実行されうる。

### 対応

`findIssueWorktree()`に、既存の`.worktrees/`型レイアウト照合が空振りした場合のフォールバックを追加した：リポジトリルートの現在のHEADブランチ名を取得し、そのブランチ名が対象issueの`branch.pattern`（`{type}/{issue_id}-{slug}`）に一致するなら、リポジトリルート自体をそのissueの作業対象とみなし`{ path: root, head: <HEAD SHA>, branch: <currentBranch> }`を返す。一致しなければ従来通り`undefined`を返す。

この設計は「GitHub Actionsの単一チェックアウトでは`.worktrees/`型レイアウトを作らないため、現在のチェックアウト自体をそのissueの作業対象とみなす」という判断であり、単一チェックアウト＝そのブランチの作業状態そのものであるためAGENTS.md I4（分離）不変条件と矛盾しない。`cleanup.ts`等ローカル専用コマンド（CI workflowからは呼ばれない）がこのフォールバックを誤って踏んだ場合でも、`git worktree remove`はgit自身がmain working treeの削除を`fatal: '<path>' is a main working tree`として拒否するため、危険な副作用は生じないことを実機（`/tmp`の使い捨てリポジトリ）で確認済み。

### 追加したテスト

- `test/unit/worktree.test.ts`
  - `findIssueWorktree: .worktrees型レイアウトが無い単一checkout状態でも、現在のブランチがissue_idに一致すればrootをentryとして返す（CI actions/checkoutフォールバック）`
  - `findIssueWorktree: 単一checkout状態で現在のブランチがissue_idに一致しない場合はundefinedのまま`
- `test/integration/issue-lifecycle.test.ts`
  - `gate review (CI単一checkout): .worktrees/ レイアウト無しでも、現在のブランチがissue_idに一致すればrootを対象に動作する`（`.worktrees/`を経由せず、CI相当の単一checkoutから`gate review`コマンドが実際に成功することを確認）

### 検証結果

`npm test`実測：`# tests 325 / # pass 325 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`（既存322件全pass + 新規3件全pass）。§3で報告した8件のtest fail（`review.adapter`デフォルト値変更・`.installed_version`混入起因）は、本追記時点では別途解消済みであり本追記のスコープ外。

---

## 7. 追記（2回目）: PR #172 実地実行で§6の修正後も再度失敗（detached HEAD）

**発生**: §6の修正（commit `edd5990`）をpushし、PR #172の実GitHub Actions上で再実行したところ（run 29713661947）、`gate-review (spec/design/implementation/validation)`が全滅し、`verify`も失敗した。

```
gate-review (spec)	Run actions/checkout@v4	Note: switching to 'refs/remotes/pull/172/merge'.
gate-review (spec)	Run actions/checkout@v4	You are in 'detached HEAD' state.
...
gate-review (spec)	Run gate review (spec)	ISSUE-171 の worktree が見つかりません
```

### 根本原因（§6の修正が機能しなかった理由）

`actions/checkout@v4`は`pull_request`イベントに対し、PRのマージref（`refs/remotes/pull/172/merge`）を**detached HEAD**でチェックアウトする。この状態で`git rev-parse --abbrev-ref HEAD`を実行すると、実際のブランチ名ではなく文字列`"HEAD"`が返る。§6で追加したフォールバックは`git rev-parse --abbrev-ref HEAD`の戻り値を直接`branch.pattern`と照合していたため、`"HEAD"`という文字列がどのissueの`branch.pattern`にも一致せず、常に`undefined`を返していた。§6のローカルテスト（`git checkout -b <branch>`による通常チェックアウトの再現）はdetached HEADという実環境特有の状態を再現しておらず、この欠陥を検出できなかった。

### 対応

`findIssueWorktree()`のフォールバックを以下の2段構えに拡張した。

1. **`GITHUB_HEAD_REF`環境変数を代替ブランチ名ソースとして使用**: `git rev-parse --abbrev-ref HEAD`が`"HEAD"`（detached）を返した場合、GitHub Actionsが`pull_request`イベントで設定する`GITHUB_HEAD_REF`（PRのheadブランチ名。例: `process/171-ci-gate-dogfood`）を代替のブランチ名候補とし、これを`branch.pattern`と照合する。一致すればrootをそのissueの対象として返す。
2. **単一checkoutエントリへの最終フォールバック**: 上記1でもブランチ名が一切得られない場合（detached HEADかつ`GITHUB_HEAD_REF`未設定）に限り、`git worktree list --porcelain`のエントリがちょうど1件（linked worktreeが存在しない＝CI相当の単一checkout環境）であれば、ブランチ名照合を諦め、呼び出し元が渡した`issueNumber`自体を信頼してrootを返す。ブランチ名が判明していて単に対象issueと一致しない場合（issueNumberの取り違え等）はこの分岐を発火させず、従来通り`undefined`を返す——無条件にブランチ名照合をスキップすると誤爆の危険があるため、「ブランチ名が完全に不明」な場合のみに限定した。

いずれもAGENTS.md I4（分離）不変条件と矛盾しない。単一チェックアウト状態＝そのブランチ（PR head）の作業状態そのものであるため。

### 追加・修正したテスト

`test/unit/worktree.test.ts`に、`git checkout --detach <sha>`で実際にdetached HEAD状態を作った上で検証するテストを3件追加した（§6で追加した2件は通常チェックアウトのみを再現しており維持、detached HEADは別途新設）。

- `findIssueWorktree: detached HEAD状態でもGITHUB_HEAD_REFがissue_idに一致すればrootをentryとして返す`: `git checkout --detach`後に`git rev-parse --abbrev-ref HEAD`が実際に`"HEAD"`を返すことをテスト内でassertした上で、`process.env.GITHUB_HEAD_REF`を設定し、`findIssueWorktree`が`branch`・`detached: true`付きでrootを返すことを確認。
- `findIssueWorktree: detached HEAD状態でGITHUB_HEAD_REFが対象issueと一致しない場合はundefinedのまま`: `GITHUB_HEAD_REF`が判明していても要求issue番号と不一致なら誤爆せず`undefined`を返すことを確認（単一checkoutフォールバックが暴走しないことの検証）。
- `findIssueWorktree: detached HEADかつGITHUB_HEAD_REF未設定でも単一checkoutエントリならissueNumberを信頼してrootを返す`: `GITHUB_HEAD_REF`を明示的に未設定にした状態でも、`git worktree list --porcelain`が単一エントリであることをテスト内でassertした上で、`findIssueWorktree`が`branch: undefined`・`detached: true`でrootを返すことを確認。

### 検証結果

`npm test`実測：`# tests 328 / # pass 328 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`（既存325件全pass + 新規detached HEADテスト3件全pass）。

### 教訓

§6時点の「ローカルで動くはず」というテストは、CI固有の環境特性（`actions/checkout`のdetached HEAD化）を再現していなかったため、実地で再度失敗した。今後この関数を変更する際は、必ず`git checkout --detach`で実際にdetached HEAD状態を作った上でテストすること。

---

## 8. 追記（3回目）: PR #172 実地実行で§7の修正後、`gate-review`成功も後続の`GITHUB_OUTPUT`書き込みで失敗

**発生**: §7の修正（commit `7182636`）をpushし、PR #172の実GitHub Actions上で再実行したところ（run 29714055077、job 88263414379）、`findIssueWorktree`のdetached HEAD対応は正しく機能し`gate review` CLIコマンド自体は成功した。しかし新たに以下のエラーで`gate-review (spec)`ステップが失敗した。

```
gate-review (spec)	Run gate review (spec)	##[error]Unable to process file command 'output' successfully.
gate-review (spec)	Run gate review (spec)	##[error]Invalid format 'reviewer_count: 2'
```

### 根本原因

`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-gate.yml`の「Run gate review」ステップは、`gate-review.sh`（`src/commands/gate.ts`の`review()`）の標準出力全体をそのまま単一の変数`REPORT_PATH`へ代入し、`echo "report_path=$REPORT_PATH" >> "$GITHUB_OUTPUT"`していた。しかし`review()`は成功時に`gate_report_path: <path>\nreviewer_count: <n>`という**2行**を標準出力へ返す実装（`src/commands/gate.ts:205`）であるため、`$GITHUB_OUTPUT`ファイルの中身が

```
report_path=gate_report_path: /path/to/report.yaml
reviewer_count: 2
```

という2行になり、2行目`reviewer_count: 2`が`key=value`形式（`=`を含まない）でないためGitHub Actionsの`$GITHUB_OUTPUT`パーサーが`Invalid format`エラーで停止した。後続ステップ（judgment・verify・publish）は`steps.review.outputs.report_path`のみを参照しており、`reviewer_count`はワークフロー側で使用されていなかった。

### 対応

`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-gate.yml`の「Run gate review」ステップを、`gate-review.sh`の標準出力をいったん`REVIEW_OUTPUT`へ保持したうえで、`sed -n 's/^gate_report_path: //p'`で`gate_report_path:`行のみを抽出し`REPORT_PATH`とする実装へ修正した。

```yaml
      - name: Run gate review (${{ matrix.gate }})
        id: review
        run: |
          REVIEW_OUTPUT="$(./.agent-skill-chain/scripts/gate-review.sh "${{ steps.ctx.outputs.issue_id }}" "${{ matrix.gate }}" "${{ steps.ctx.outputs.profile }}")"
          REPORT_PATH="$(echo "$REVIEW_OUTPUT" | sed -n 's/^gate_report_path: //p')"
          echo "report_path=$REPORT_PATH" >> "$GITHUB_OUTPUT"
```

`.github/workflows/agent-skill-chain-gate.yml`（展開結果）は`node bin/agents-md.js sync templates .`で再生成し、テンプレートと一致させた。`node bin/agents-md.js verify template-sync .`実行で終了コード0（同期済み）を確認した。

他の3つのworkflow（`agent-skill-chain-ci.yml`・`agent-skill-chain-reconcile.yml`・`agent-skill-chain-risk.yml`）の`$GITHUB_OUTPUT`書き込み箇所を全て確認したが、いずれも単一行の値（`issue_id`・`target_sha`・`profile`・`upgrade`等、bashの単純な文字列処理の結果）のみを書き込んでおり、複数行出力をそのまま1変数へ代入する同種のパターンは存在しなかった。

### 検証結果

`npm test`実測：`# tests 328 / # pass 328 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`（workflow YAMLのみの変更のため既存328件への影響は無く、全件pass）。

### 教訓

CLIコマンドの標準出力を人間可読な複数行フォーマット（`key: value`形式の複数行）で設計する場合、それをそのままシェル変数へ代入して`$GITHUB_OUTPUT`へ書き込む呼び出し側コードは、行数が変わった時点で静かに壊れる。呼び出し側では必ず対象の1行だけを明示的に抽出するか、CLI側で機械可読な単一値の出力モードを別途用意すべきである。

---

## 9. 追記（4回目）: PR #172 実地実行で§8の修正後、`GH_TOKEN`未設定により`gh`コマンドが失敗

**発生**: §8の修正をpushし、PR #172の実GitHub Actions上で再実行したところ（run 29714290913、job 88264151197）、`Run gate reviewer judgment`ステップと`Publish gate report`ステップの双方で`gh`コマンドの失敗が観測された。

```
gate-review (design)	Run gate reviewer judgment (design)	launch_gate_reviewer: gh issue comment に失敗しました（通知未達）。silent pass せず human_required のまま deferred します
gate-review (design)	Publish gate report	Check Run 発行に失敗しました: gh: To use GitHub CLI in a GitHub Actions workflow, set the GH_TOKEN environment variable. Example:
  env:
    GH_TOKEN: ${{ github.token }}
##[error]Process completed with exit code 1.
```

### 根本原因

`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-gate.yml`の「Run gate reviewer judgment」「Publish gate report」の両ステップは、内部で`gh`コマンドを呼ぶにもかかわらず`GH_TOKEN`環境変数を設定していなかった。

- 「Run gate reviewer judgment」ステップ: `gate-launch-reviewer.sh`が`review.adapter=human`（`.agent-skill-chain/adapters/human.sh`の`launch_gate_reviewer`）を起動し、`gh label create`・`gh issue edit`・`gh issue comment`を呼ぶ（`.agent-skill-chain/adapters/human.sh:140-142`）。`gh issue comment`の失敗はこのアダプタ自身がfail-safeで検知し、`human_required`のまま`deferred`（exit 3）へ倒す設計であるため、**このステップ自体はI8の安全側原則どおり正しく機能した**（silent passしていない）。
- 「Publish gate report」ステップ: `gate-publish.sh` → CLI `gate publish`サブコマンド（`src/commands/gate.ts`の`publishCheckRun()`、`gh(['api', '-X', 'POST', 'repos/{owner}/{repo}/check-runs', ...])`、`src/lib/exec.ts`の`gh()`経由）がCheck Run発行のため`gh api`を呼ぶ。こちらは`gh`コマンド自体がfail-safe機構を持たず、認証エラーで即座に非ゼロ終了しjob全体が`##[error]Process completed with exit code 1`で失敗した。

いずれのステップも既存の`ANTHROPIC_API_KEY`等とは別に、GitHub CLI自体の認証（`GH_TOKEN`）が必要であり、これが抜けていたことが直接原因。

### 追加調査: reconcile.yml / risk.yml / ci.ymlの`gh`呼び出し有無

実行結果の見かけの「pass」を鵜呑みにせず、コード上`gh`呼び出しがあるかどうかで判断した。

- **`agent-skill-chain-reconcile.yml`（要修正・追加した）**: `gate-reconcile.sh` → CLI `gate reconcile`サブコマンド（`src/commands/gate.ts`の`reconcile()`、269行目以降）は、対象issueの4ゲート全てについて`reviews/<gate>.yaml`が存在する場合のみ`publishCheckRun()`（`gh api ... check-runs`）を呼ぶ。今回のCI実行でこのworkflowが「pass」したのは、実行時点で対象issueのgate-reportが1件も存在せず（`readYamlFile`が例外を投げ`continue`）、`gh`呼び出し自体が発生しなかったためであり、`GH_TOKEN`が不要だったことを意味しない。gate-reportが存在する状態でpushされれば同じ`GH_TOKEN`欠落エラーで失敗する。よって`GH_TOKEN`を追加した。
- **`agent-skill-chain-risk.yml`**: 呼び出すスクリプト（`git diff`・`grep`のみ）に`gh`呼び出しは無い。追加不要。
- **`agent-skill-chain-ci.yml`**: 呼び出す全スクリプト（`verify-branch-name.sh`・`verify-worktree-path.sh`・`verify-template-sync.sh`・`verify-artifacts.sh`・`verify-ac-coverage.sh`・`verify-adr.sh`・`lint-vocab.sh`・`lint-references.sh`・`adr-lint.sh`）を`grep`で確認したが`gh`呼び出しは無い。追加不要。
- リポジトリ全体で`gh`を呼ぶスクリプトは`.agent-skill-chain/scripts/setup-labels.sh`・`setup-ruleset.sh`（`init`系、CI workflowからは呼ばれない）と`.agent-skill-chain/adapters/human.sh`・`src/commands/gate.ts`（`gate publish`/`gate reconcile`経由、`gh api check-runs`）のみであることを`grep -rln "gh \|gh("`で確認済み。

### 対応

`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-gate.yml`の「Run gate reviewer judgment (${{ matrix.gate }})」ステップと「Publish gate report」ステップに`GH_TOKEN: ${{ github.token }}`を追加した（既存の`ANTHROPIC_API_KEY`等と併記）。あわせて`agent-skill-chain-reconcile.yml`の「Reconcile gates against pushed SHA」ステップにも同様に追加した。`.github/workflows/`（展開結果）は`node bin/agents-md.js sync templates .`で再生成し、`node bin/agents-md.js verify template-sync .`で終了コード0（同期済み）を確認した。

### 検証結果

`npm test`実測：`# tests 328 / # pass 328 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`（workflow YAMLのみの変更のため既存328件への影響は無く、全件pass）。

### 教訓

`gh`コマンドを内部で呼ぶステップは、`ANTHROPIC_API_KEY`等の外部サービス認証とは別に`GH_TOKEN`（GitHub CLI自身の認証）が必要であり、これを見落とすとjob自体の異常終了として現れる。また、あるworkflowステップがCI実行で「pass」した事実は、そのステップ内の`gh`呼び出しが実際に実行され成功したことを意味しない場合がある（今回のreconcile.ymlのように、条件分岐によって`gh`呼び出し自体がスキップされていただけの可能性がある）。true positiveのpassかどうかは、実行ログの分岐条件とコードパスを突き合わせて確認する必要がある。

---

## 10. 追記（5回目）: PR #172 実地実行で§9の修正後、`verify`ジョブの`verify branch-name`が同種のdetached HEADバグで失敗

**発生**: §9の修正をpushし、PR #172の実GitHub Actions上で再実行したところ（run 29714290922、job 88264151305）、`verify`ジョブが以下のエラーで失敗した。

```
verify	verify-branch-name	branch 'HEAD' は branch.pattern（{type}/{issue_id}-{slug}）に適合しません
##[error]Process completed with exit code 1.
```

### 根本原因

§7で`src/lib/worktree.ts`の`findIssueWorktree()`に施した「detached HEAD状態でのブランチ名解決」修正と**同種・別箇所のバグ**。`git grep -n "abbrev-ref" src/`で調査したところ、`git(['rev-parse', '--abbrev-ref', 'HEAD'], root)`を直接呼び、detached HEAD時に文字列`"HEAD"`が返ることを考慮していない箇所が他に2つ存在した。

- `src/commands/verify.ts:31`（`verify branch-name`コマンドで引数省略時に現在のHEADブランチを対象にする処理。今回実際にCIで踏んだ）
- `src/commands/checkpoint.ts:37`（`checkpoint`コマンド。現状CIからは直接呼ばれていないが、将来的にworkerが実行する可能性がある同種のコード）

同一ロジックを検証済みの`findIssueWorktree()`内にすでに実装していたにもかかわらず、それを他の呼び出し元と共有していなかったため、修正が1箇所にしか反映されず再発した。

### 対応

同じロジックを3箇所に別々に持つのではなく、`src/lib/worktree.ts`に共有ヘルパー`resolveCurrentBranchInfo(root): CurrentBranchInfo | undefined`（`{ branch: string | undefined; detached: boolean }`を返す）と、その薄いラッパー`resolveCurrentBranch(root): string | undefined`を新設し、1箇所に統一した。

- `findIssueWorktree()`内の既存のdetached HEAD対応ロジック（`git rev-parse --abbrev-ref HEAD`の直接呼び出し＋`"HEAD"`判定＋`GITHUB_HEAD_REF`フォールバック）を`resolveCurrentBranchInfo()`の呼び出しに置き換えた（挙動は変えていない）。
- `src/commands/verify.ts`の`branchName()`は`args[0] ?? git(['rev-parse', '--abbrev-ref', 'HEAD'], root).stdout.trim()`を`args[0] ?? resolveCurrentBranch(root)`に変更し、`resolveCurrentBranch`が`undefined`を返す場合（detached HEADかつ`GITHUB_HEAD_REF`未設定）は「現在のブランチ名を解決できません」という明確なエラーメッセージで終了コード1にした（従来は`undefined`が素通しで`target`に代入され、`target.trim()`相当の呼び出しで例外や無意味な文字列比較になっていた）。
- `src/commands/checkpoint.ts`の`run()`も同様に`resolveCurrentBranch(root)`を使うよう変更し、`undefined`の場合は「commitは成功済み」である旨を明示したエラーメッセージを返すようにした（`git add`→`git commit`が先に成功しているため、push直前でブランチ名解決に失敗しても手動pushで復旧できることを示す）。

### 副次的に発見・修正したバグ: `checkpoint`のpush refspecがdetached HEAD時に誤ったcommitをpushしうる

`checkpoint.ts`の修正過程で、既存の`git push -u origin ${branch}`という呼び出し自体に別の潜在バグがあることに気づいた。`<branch>`のみを指定するrefspecは「ローカルの同名branch refの内容」をpushするのであり、現在のHEADをpushするわけではない。通常のチェックアウト（HEADがそのbranchを指している）では両者が一致するため問題は顕在化しないが、detached HEAD状態で`resolveCurrentBranch`が`GITHUB_HEAD_REF`経由でブランチ名を解決した場合、ローカルにその名前のbranch ref自体が存在しない、または存在しても現在のHEAD（今しがたcommitした内容）より古い可能性があり、その場合は今回commitした変更ではなく古い内容がpushされる、もしくはpush自体が"src refspec does not match any"で失敗する。実機（使い捨てリポジトリ）で`git push -u origin HEAD:refs/heads/<branch>`なら通常時・detached HEAD時のいずれでも常に現在のHEADの内容が正しくpushされることを確認し、refspecを`HEAD:refs/heads/${branch}`に変更した。

### 追加したテスト

- `test/unit/worktree.test.ts`
  - `resolveCurrentBranch/resolveCurrentBranchInfo: 通常チェックアウトでは実ブランチ名を返しdetached=falseになる`
  - `resolveCurrentBranch/resolveCurrentBranchInfo: detached HEADかつGITHUB_HEAD_REF設定済みならそのブランチ名を返しdetached=trueになる`（`git checkout --detach`後に`git rev-parse --abbrev-ref HEAD`が実際に`"HEAD"`を返すことをテスト内でassert）
  - `resolveCurrentBranch/resolveCurrentBranchInfo: detached HEADかつGITHUB_HEAD_REF未設定ならbranchはundefinedのままdetached=trueになる`
- `test/integration/verify.test.ts`
  - `verify branch-name: 引数省略・detached HEAD状態でもGITHUB_HEAD_REFが設定されていればそのブランチ名で判定する`（`issue start`で作った実worktreeを`git checkout --detach`し、`GITHUB_HEAD_REF`環境変数経由で`verify branch-name`引数省略実行が成功することを確認）
  - `verify branch-name: 引数省略・detached HEAD状態でGITHUB_HEAD_REFが未設定なら解決不能として明確なエラーになる`
  - `checkpoint: detached HEAD状態でもGITHUB_HEAD_REFが設定されていればそのブランチへpushする`（`origin/feature/1-sample-feature`のSHAが実際にcheckpointの出力SHAと一致することまで確認し、refspec修正の効果を実地相当で検証）
  - `checkpoint: detached HEAD状態でGITHUB_HEAD_REFが未設定なら解決不能として明確なエラーになる`（commit自体は成功済みでpushのみ失敗することも確認）

### 横断確認

`git grep -n "abbrev-ref" src/`・`git grep -n "rev-parse.*HEAD" src/`で全リポジトリを再確認し、他に同種の「現在のブランチ/HEADへの暗黙依存」箇所が無いことを確認した。`src/commands/adr.ts`・`src/commands/gate.ts`の`git(['rev-parse', 'HEAD'], entry.path)`はいずれも対象worktreeのSHA取得のみでdetached HEADでも問題なく動作するため対象外。

### 検証結果

`npm test`実測：`# tests 335 / # pass 335 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`（既存328件全pass + 新規7件全pass）。

### 教訓

同一の「detached HEAD対応」ロジックを複数箇所に個別実装すると、1箇所を修正しても他の箇所は直らず、同じ障害が形を変えて再発する。CI実行で1つのバグを見つけて直したら、必ず同種のコードパターン（今回は`git rev-parse --abbrev-ref HEAD`の直接呼び出し）を`grep`で横断的に洗い出し、共有ヘルパーへ統一すべきである。また、ヘルパーを共有する過程で隣接コード（今回は`git push`のrefspec）まで併せて読むと、テストが通っていても実運用でのみ顕在化する別の潜在バグ（今回のpush refspec問題）を発見できることがある。

---

## 11. 追記（6回目）: PR #172 実地実行で`verify`ジョブが`segment 'spec' の必須成果物が欠落しています: SPEC.md`で失敗、正式成果物規約への対応

**発生**: §10の修正後、PR #172の実GitHub Actions上での再実行（run 29715272198）で`verify`ジョブが以下のエラーで失敗した。

```
segment 'spec' の必須成果物が欠落しています: SPEC.md
```

### 根本原因

`.agent-skill-chain/config/segments.yaml`が定める正式な成果物規約は、Issueのブランチ（worktree）の**リポジトリルート直下**に`SPEC.md`・`DESIGN.md`（+ ADR + `PLAN.md`）・`VALIDATION.md`を配置することである（`src/commands/verify.ts`の`artifacts()`・`checkOutputExists()`実装で確定）。しかし本Issue #171の作業は、requirement-discovery/design-feature等のcommand chainが慣習的に生成する`docs/maintainer/workflow/20260720_112643_171-ci-gate-dogfood/00_要求定義.md`〜`04_review.md`という別形式で進めてしまい、正式規約が要求するリポジトリルート直下のファイル自体を一度も作成していなかった。ローカルの`verify artifacts`・`verify ac-coverage`を一度も実行していなかったため、この不整合はローカルでは検出されず、CI上で初めて顕在化した。

### 対応

`.agent-skill-chain/templates/issue/{SPEC,DESIGN,PLAN,VALIDATION}.md`の正式テンプレートに沿って、リポジトリルート直下に`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`を新規作成した。内容は`docs/maintainer/workflow/20260720_112643_171-ci-gate-dogfood/00_要求定義.md`〜`03_実装計画.md`（および本ファイルの§1〜§10）の実質を保持しつつ、正式テンプレートが要求する構造（`SPEC.md`の`AC-N`形式受入条件、`DESIGN.md`の要件→設計要素対応表・関連ADR・障害/ロールバック考慮、`PLAN.md`の変更単位テーブル）に合わせて書き直した。

`docs/maintainer/workflow/20260720_112643_171-ci-gate-dogfood/00_要求定義.md`〜`04_review.md`（本ファイル）はそのまま残置する（削除・移行はしない）。ユーザーの判断により、既にマージ済みの旧issue（#164/#169）は遡及修正しないが、本Issue #171は本PR内で正式規約へ対応させることになった。旧ドキュメントは経緯・詳細調査記録として引き続き有効であり、`SPEC.md`等はそれらの実質を正式テンプレート構造で再構成した成果物という位置付けになる。

### 重要な発見: `VALIDATION.md`テンプレートと`verify ac-coverage`実装の不整合

`.agent-skill-chain/templates/issue/VALIDATION.md`のテンプレートは、Markdown見出し＋AC毎に分割した複数の`` ```yaml ``フェンスという構造である。一方`src/commands/verify.ts`の`acCoverage()`は、`VALIDATION.md`全体を`readYamlFile()`（`yaml`パッケージの`parse()`を生テキストへ直接適用）で1つのYAML文書として読み込む実装である。

実機で検証したところ、テンプレートそのままの構造（Markdown見出し＋HTMLコメント＋複数`` ```yaml ``フェンス）を`parse()`に通すと`Implicit keys need to be on a single line`でパースに失敗することを確認した。`ADR.md`・`SPEC.md`は正規表現によるフェンス抽出（`adr()`）またはAC-IDの正規表現走査（`acCoverage()`のSPEC.md側）のみでMarkdown構造を許容するが、`VALIDATION.md`だけは全文を直接YAMLとしてパースするため、テンプレートのMarkdown構造とCLI実装が非互換になっている。

このため本Issueの`VALIDATION.md`は、テンプレートの見出し構造をそのまま複製するのではなく、`.agent-skill-chain/schemas/validation-report.schema.yaml`が要求するフィールド（`schema_version`・`issue_id`・`target_sha`・`acceptance_criteria`・`regression`）のみを持つ単一YAML文書として記述し、見出し相当の情報はコメント（`#`）とキー名・配列構造で表現した。この既知の齟齬（テンプレートとCLI実装の不整合）は本Issueのスコープ外として実装修正は行わず、事実として記録するに留める。対応候補（判断は進行役へ委ねる）:

1. `.agent-skill-chain/templates/issue/VALIDATION.md`のテンプレート自体を、`ADR.md`と同様の「Markdown本文＋単一yamlフェンス」形式、または本Issueで採用した「純粋YAML＋コメント」形式へ書き換える。
2. `src/commands/verify.ts`の`acCoverage()`側に、`adr()`と同様のフェンス抽出処理を追加し、テンプレートのMarkdown＋複数フェンス構造をサポートする。

### 検証結果（実機実行）

- `node bin/agents-md.js verify artifacts ISSUE-171 spec` → 終了コード0
- `node bin/agents-md.js verify artifacts ISSUE-171 design` → 終了コード0
- `node bin/agents-md.js verify artifacts ISSUE-171 implementation` → 終了コード0
- `node bin/agents-md.js verify artifacts ISSUE-171 validation` → 終了コード0
- `node bin/agents-md.js verify ac-coverage ISSUE-171` → 終了コード0
- `npm test`実測: `# tests 335 / # pass 335 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`（`src/`配下は無変更のため既存335件と完全一致、影響なし）

### ADR作成要否の判断

本Issueは既存CLI・既存設定ファイルの値変更・既存ロジックの重複解消・CI workflowの記述修正・成果物ドキュメントの追加のみで完結し、`segments.yaml`が定めるセグメント構成自体（4区分・各segmentのoutputs定義）の追加・変更は行っていない。よって新規のアーキテクチャ決定を伴わずADR新設は不要と判断した（判断根拠は`DESIGN.md`の「関連ADR」節に記載）。なお`verify artifacts`のdesign segment・`ADR`成果物チェックは「`docs/adr/`配下に最低1件の`.md`が存在するか」のみを検査する実装であり、既存の`docs/adr/ADR-0001-docs-system-spec-construction.md`（本Issueとは無関係の別件）が既に存在するため、新規ADRを作成しなくても`verify artifacts design`は成功する。

### 教訓

command chain（requirement-discovery等）が生成する`docs/maintainer/workflow/`形式のドキュメントは、進行の記録としては有用だが、`.agent-skill-chain/config/segments.yaml`が定めるCI gateの検証対象（リポジトリルート直下の`SPEC.md`等）とは別物である。Issue着手時点で`verify artifacts`・`verify ac-coverage`をローカルで一度実行し、正式成果物規約への適合を早期に確認しておけば、CI上で初めて発覚するという手戻りを避けられた。

### 対応（テンプレート修正）

上記「重要な発見」の対応候補1を採用し、`.agent-skill-chain/templates/issue/VALIDATION.md`を「Markdown見出し＋AC毎に分割した複数の`` ```yaml ``フェンス」構造から、`.agent-skill-chain/schemas/validation-report.schema.yaml`（`agent-skill-chain/validation-report/v1`）に完全一致する**純粋なYAMLドキュメント**へ書き直した。実装（`src/commands/verify.ts`の`acCoverage()`）側は変更していない。見出し相当の情報（雛形であること・schema参照・複製単位の指示・パースが壊れる根本原因の注記）は`#`コメントで冒頭に記述し、`schema_version`・`issue_id`・`target_sha`・`acceptance_criteria`（`ac_id`/`verification`/`evidence`、複製単位はコメントで明示）・`regression`のみを本体に持つ構造にした。プレースホルダは`<...>`表記のまま残し、Issue #171で実際に作成した`VALIDATION.md`（`a9a9d60`）を参考にした。

**検証**:
- `node -e "yaml.parse(fs.readFileSync('.agent-skill-chain/templates/issue/VALIDATION.md','utf8'))"` → 例外なく成功（旧構造で発生していた`Implicit keys need to be on a single line`が解消したことを確認）。
- `node bin/agents-md.js verify doc-length` → 終了コード0（新テンプレートは43行で上限100行以内）。
- `node bin/agents-md.js verify template-sync .` → 終了コード0。ただし`.agent-skill-chain/templates/issue/`は`verify template-sync`の対象外（同コマンドは`.agent-skill-chain/templates/github/.github/`と`.github/`の同期のみを検査する実装であることを`src/commands/verify.ts`のtemplate-sync実装で確認済み）であり、本テンプレート変更は同コマンドの検査範囲そのものには影響しない。
- `grep -rn "VALIDATION.md" test/` → `test/integration/verify.test.ts`のみヒット。同ファイルの各テストは`fs.writeFileSync`でテスト用YAMLを直接インラインで生成しており、`.agent-skill-chain/templates/issue/VALIDATION.md`テンプレートの内容には依存していないため、既存テストへの影響は無い。
- `npm run build`（`tsc`）→ エラー無し。
- `npm test` → `# tests 335 / # pass 335 / # fail 0`（既存335件全件pass、テンプレート修正はsrc/を変更しないため回帰無し）。

---

## 12. 追記（7回目）: PR #172 実地実行で`verify-artifacts`が`defaultBranch()`のshallow checkout非対応で失敗

**発生**: §11までの修正後、PR #172の実GitHub Actions上での再実行（run 29717720242、job 88274146995）で`verify-artifacts`（対象PRで変更されたセグメントごと）が以下のエラーで失敗した。

```
verify-artifacts (対象PRで変更されたセグメントごと)	予期しないエラー: デフォルトブランチを特定できません（origin/HEAD 未設定・main/master 不在）
##[error]Process completed with exit code 1.
```

### 根本原因

`src/lib/worktree.ts`の`defaultBranch(repoRoot)`は「①`git symbolic-ref refs/remotes/origin/HEAD` → ②ダメなら`main`/`master`のローカルref存在確認」の順で解決していた。呼び出し元は`src/commands/verify.ts`の`artifacts()`（`base = defaultBranch(root)`として変更差分検査の基点に使う）。

しかし`actions/checkout@v4`は既定で`fetch-depth: 1`かつPRのマージrefのみをフェッチするため、origin/HEADのsymrefは設定されず、`main`ブランチのローカルrefも（フェッチ対象外のため）存在しない。§7〜§10で修正した`findIssueWorktree`・`resolveCurrentBranchInfo`（detached HEAD対応）とは異なる系統だが、根っこは同じ——「CI環境のgit状態はローカル開発機の前提（`origin/HEAD`設定済み・`main`ローカルref存在）と異なる」ことをこの関数だけが未対応だった。

### 対応

`defaultBranch()`に3番目のフォールバックとして、`pull_request`イベントでGitHub Actionsが設定する`GITHUB_BASE_REF`環境変数（PRのbaseブランチ名。例: `chore/162-agent-skill-chain-bootstrap`）を追加した。優先順位は①`origin/HEAD`のsymref → ②ローカルの`main`/`master` ref → ③`GITHUB_BASE_REF` → ④いずれも無ければ従来通りエラー。`resolveCurrentBranchInfo`の`GITHUB_HEAD_REF`フォールバックと同一パターンを踏襲した。

### 追加したテスト

`test/unit/worktree.test.ts`に2件追加した。`git branch -D main`でローカルの`main` refを実際に削除し、`origin/HEAD`のsymrefが未設定であること・ローカルの`main`/`master` refが存在しないことをテスト内で明示的に前提確認（`gitOk()`ヘルパー新設）した上で検証している。

- `defaultBranch: origin/HEAD未設定・main/masterのローカルref不在でもGITHUB_BASE_REFが設定済みならそれを返す`
- `defaultBranch: origin/HEAD未設定・main/masterのローカルref不在かつGITHUB_BASE_REFも未設定ならエラーになる`

### 横断確認

`git grep -n "defaultBranch" src/`で呼び出し元を確認したところ、`src/commands/issue.ts`・`src/commands/pr.ts`・`src/commands/verify.ts`の3箇所すべてが`defaultBranch()`経由であり、本修正は3箇所すべてに効く。`git grep -n "'main'" src/`・`git grep -n "rev-parse.*--verify" src/`で「main/masterのローカルref存在を前提にする」同種のコードを再確認したが、`src/commands/issue.ts:71`の`git(['rev-parse', '--verify', branch], root)`は新規作成しようとしているissueブランチ自体の重複チェックであり、defaultBranchと同種の前提（main/masterのローカルref存在）には依存していないため対象外。他に同種箇所は無かった。

### 検証結果

`npm test`実測：`# tests 337 / # pass 337 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`（既存335件全pass + 新規2件全pass）。

### 教訓

detached HEAD対応（§7〜§10）は「現在のブランチ名の解決」という1種類の問題だったが、今回の`defaultBranch()`は「デフォルトブランチ名の解決」という別種の問題であり、同じ「CI環境のgit状態はローカル前提と異なる」という根本原因が複数の異なる関数に個別に現れうることを示している。CI実行で1つの`git`状態依存バグを潰しても、関数ごとに前提が異なるため横断的な`grep`だけでは検出しきれない場合がある——実際にCIで一通り流し切るまで、同種の欠陥が別関数に潜んでいないと断言できない。

---

## 13. 追記（8回目）: PR #172 実地実行で§12の修正後も`verify-artifacts`が失敗（baseブランチ自体が未フェッチ）

**発生**: §12の修正（commit `e8abf4f`）をpushし、PR #172の実GitHub Actions上で再実行したところ（run 29717941752、job 88274757933）、`verify-artifacts`（対象PRで変更されたセグメントごと）が以下のエラーで失敗した。

```
verify-artifacts (対象PRで変更されたセグメントごと)	segment 'implementation' の必須成果物が欠落しています: code
##[error]Process completed with exit code 1.
```

### 根本原因

§12で`defaultBranch()`に`GITHUB_BASE_REF`環境変数へのフォールバックを追加した結果、「デフォルトブランチを特定できません」というエラー自体は解消したが、`src/commands/verify.ts`の`checkOutputExists()`の`case 'code':`が実行する`git diff --stat ${base}...HEAD`の`base`に、**ローカルで一切解決できないブランチ名文字列**（`GITHUB_BASE_REF`の値そのもの、例: `chore/162-agent-skill-chain-bootstrap`）がそのまま渡っていた。

`agent-skill-chain-ci.yml`の`actions/checkout@v4`ステップは`fetch-depth: 0`だが、これは「チェックアウト対象refの履歴を全て取得する」という意味であり、「他ブランチも含めて全ブランチをフェッチする」という意味ではない。実際にフェッチされるのはPRのマージref（チェックアウト対象）のみで、baseブランチ（`chore/162-agent-skill-chain-bootstrap`）自体はローカルにもリモート追跡ref（`origin/chore/162-agent-skill-chain-bootstrap`）としても一切存在しない。そのため`git diff base...HEAD`は`base`が解決不能で非ゼロ終了し（`diff.status !== 0`）、`checkOutputExists`は「成果物なし」と誤判定していた。

これは§12までの「detached HEAD」「main/masterローカルref不在」とは異なる、**baseブランチの実体そのものがローカルに一切存在しない**という別の欠落パターンであり、`defaultBranch()`側の対応（文字列としてのブランチ名を返すこと）だけでは解決できない——workflow側で当該refを明示的にフェッチする必要がある。

同一workflowファイル内の`verify-adr`ステップは既に`git fetch origin "$BASE_REF" --depth=1`を実行してから`origin/$BASE_REF`を参照しており、この問題を踏んでいなかった。`verify-artifacts`ステップはこのfetchより前に実行されるため、`origin/$BASE_REF`が未フェッチのまま`defaultBranch()`が呼ばれていた。

### 対応

1. `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml`に、`npm test`の直後・`verify-artifacts`より前段で`git fetch origin "$BASE_REF" --depth=1`を実行する「Fetch base branch for diff-based checks」ステップを追加した（`verify-adr`ステップと同一の呼び出しパターン）。actions/checkout@v4は`git remote add origin <url>`で標準の`+refs/heads/*:refs/remotes/origin/*`という`remote.origin.fetch`をそのまま設定するため、明示的な宛先refspecを書かなくても`git fetch origin <branch> --depth=1`だけで`refs/remotes/origin/<branch>`が作成されることを、実際のbare remote＋`git remote add`＋`git clone --branch`の3パターンで再現・比較して確認した（後述）。
2. `src/lib/worktree.ts`の`defaultBranch()`を、`GITHUB_BASE_REF`フォールバック内で`origin/<GITHUB_BASE_REF>`が解決可能ならそれを優先して返すよう変更した（解決できなければ従来通り素のブランチ名文字列へフォールバックし、既存のローカル開発機向けテスト・挙動は変えていない）。これにより`checkOutputExists('code', ...)`が使う`git diff --stat ${base}...HEAD`の`base`が、上記1のfetch後は常に解決可能な参照になる。

### 実機での検証（shallow checkout相当の状態を実際に作って確認）

以下を`/tmp`の使い捨てgitリポジトリ（bare remote＋作業repo）で実際に実行し、修正前後の挙動を確認した。

- `git remote add origin <bare>` → `git fetch --depth=1 origin +<branch>:refs/remotes/origin/<branch>`（actions/checkoutのPRマージref取得を模す）だけの状態では、`git fetch origin <base> --depth=1`（宛先refspec省略）だけで`refs/remotes/origin/<base>`が作成されることを確認（`remote.origin.fetch`の既定refspecがそのまま効くため）。
- `git clone --depth 1 --branch <feature>`（`--single-branch`相当）で作った場合は`remote.origin.fetch`が当該ブランチのみへ絞られ、`git fetch origin <base>`だけでは宛先refが作られない（`FETCH_HEAD`のみ更新）ことも確認した。actions/checkout@v4は前者のパターン（`git remote add`＋個別fetch）であり、既存の`verify-adr`ステップが実際に機能している事実と整合する。

### 追加したテスト

- `test/unit/worktree.test.ts`
  - `defaultBranch: GITHUB_BASE_REFのブランチが未フェッチのローカルrefでは解決不能でも、fetch後にorigin/<base>が解決可能になればそれを優先して返す（CI fetchステップ後を再現）`: 実際のbare remoteへbaseブランチ・feature branchをpushした上で、pushした側のリポジトリが自動作成する`origin/<base>`のremote-trackingrefを`git branch -rd`で明示的に削除しshallow checkout相当（未フェッチ）の状態を再現。この状態では`defaultBranch()`が素のブランチ名へフォールバックすること、`git fetch origin <base> --depth=1`実行後は`origin/<base>`を優先して返すこと、その値で実際に`git diff --stat`が解決・成功することまで検証した。
- `test/integration/verify.test.ts`
  - `verify artifacts: 単一checkout（CI相当）でbaseブランチ未フェッチだとcode判定が失敗し、base branch fetch後は成功する`: `.worktrees/`型レイアウトを使わない単一checkout（`findIssueWorktree`のCIフォールバック経路）で、`verify artifacts ISSUE-171 implementation`がbaseブランチ未フェッチ時に`欠落しています: code`で失敗し、`git fetch origin "$BASE_REF" --depth=1`相当の操作後は終了コード0になることをCLI経由（subprocess実行）で確認した。

### 検証結果

`npm test`実測: `# tests 339 / # pass 339 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`（既存337件全pass + 新規2件全pass）。

`node bin/agents-md.js sync templates .`でワークフロー変更を`.github/workflows/agent-skill-chain-ci.yml`へ反映し、`node bin/agents-md.js verify template-sync .`で終了コード0（同期済み）を確認した。`git diff --stat`で意図した5ファイル（テンプレート・展開結果・`src/lib/worktree.ts`・テスト2ファイル）のみが変更されていることを確認済み。

### 教訓

`fetch-depth: 0`は「対象refの全履歴を取得する」であって「全ブランチを取得する」ではない——このリポジトリの`agent-skill-chain-ci.yml`は既に`fetch-depth: 0`だったにもかかわらず本バグが発生した事実がそれを証明している。diffベースの検査（`git diff base...HEAD`）を新設・変更する際は、`base`側のrefが対象workflow内で実際にフェッチ済みかどうかを、`fetch-depth`の値だけで判断せず個別に確認する必要がある。同一workflowファイル内に既に動いている類似パターン（今回は`verify-adr`ステップ）がある場合は、それを流用・前段へ移動することが最も確実な再発防止策になる。

---

## 14. 追記（9回目）: PR #172 実地実行で`lint-vocab`が失敗（禁止語スキャナの識別子/パス非対応・AGENTS.md自身の用語不整合）

**発生**: §13までの修正後、PR #172の実GitHub Actions上での再実行（run 29718355217、job 88275922279）で`lint-vocab`が失敗した。抜粋:

```
.agent-skill-chain/ci/verify-doc-length.sh:4: 禁止語 'issue' が見つかりました（'成果物' を使用してください）
.agent-skill-chain/ci/verify-gate-report.sh:2: 禁止語 'フェーズ' が見つかりました（'セグメント' を使用してください）
.agent-skill-chain/ci/verify-worktree-path.sh:6: 禁止語 'issue' が見つかりました（'成果物' を使用してください）
```

実際にはこの3件は氷山の一角で、`node bin/agents-md.js lint vocab`（引数省略・デフォルト対象全体）を実測すると、この時点のデフォルト対象（`AGENTS.md`・`docs/GLOSSARY.md`・`.agent-skill-chain/{standards,templates,config,schemas,scripts,ci}`）全体で**120件**の違反が報告されていた。`.github/`（このリポジトリへのCI導入自体）が本Issue #171のスコープであり、`lint-vocab`ステップがこのリポジトリで実際に稼働したのは今回が初めてだったため、これまで一度も機械検査されたことのない既存の誤検出・不整合が一挙に露見した。

### 根本原因（2種類）

1. **`src/commands/lint.ts`の`vocab()`が単純な部分文字列一致（`line.includes(banned)`）だった**: `docs/GLOSSARY.md`の禁止同義語列にある注釈（例:「issue（小文字）」の「（小文字）」）は`src/lib/glossary.ts`の`stripAnnotation()`で除去され、素の`issue`という文字列が禁止語として登録される。この禁止語チェックがバッククォートのコードスパン・`<placeholder>`トークン・スラッシュ区切りのファイルパスリテラルを一切区別しなかったため、`.agent-skill-chain/templates/issue/{SPEC,DESIGN,PLAN,VALIDATION}.md`のような実在するディレクトリパス（`verify-doc-length.sh:4`）や`<issue-id>`のようなプレースホルダ構文（`verify-worktree-path.sh:6`）まで「散文中でissueを成果物の意味で誤用している」ものとして誤検出していた。
2. **AGENTS.md自身の用語不整合**: `.agent-skill-chain/ci/verify-gate-report.sh:2`のコメントは`AGENTS.md §不変条件I2（フェーズゲート）`を引用していたが、AGENTS.md本文の他の箇所（見出し「## 4 セグメント・4ゲート」等）は一貫して「セグメント」を使っているのに、不変条件表のI2行だけが「フェーズゲート」という表記になっていた（AGENTS.md自身がGLOSSARY.mdの禁止語「フェーズ」に違反していた）。

### 対応

1. **スキャナ側（`src/commands/lint.ts`）**: `hasProseViolation()`を新設し、行中の禁止語の全出現箇所それぞれについて、以下いずれかに完全に包含される場合は散文の誤用ではなく正当な技術的参照とみなし対象外にした。
   - バッククォートのコードスパン（`` `...` ``）
   - `<...>`形式のプレースホルダトークン
   - ASCIIのパス・識別子構成文字（英数字・`` _.-{},/ ``）のみからなり、かつ`/`を1つ以上含む連続run（ファイルパスリテラル。例: `.agent-skill-chain/templates/issue/{SPEC,DESIGN,PLAN,VALIDATION}.md`）

   ただし禁止語自体がパス形式の文字列である場合（`docs/GLOSSARY.md`で定義されている`.agent-skill-chain/source`。禁止されているのは旧ディレクトリパスへの言及そのもの）はこれら3種の除外を一切適用しないようにした。禁止語自体がパスなら「パスに見えるから誤検出」ではなく「禁止されているパス文字列そのもの」であり、除外すると禁止語が検査不能になってしまうため。日本語の助詞・句読点は上記いずれの除外対象文字集合にも含まれないため、散文中で禁止語が単独の語として使われている箇所（例:「issueの説明」）を誤って対象外にすることはない。
2. **AGENTS.md**: 不変条件表の「I2 フェーズゲート」を「I2 セグメントゲート」へ表記統一した（不変条件の内容・検査手段列は変更なし）。あわせて`.agent-skill-chain/ci/verify-gate-report.sh:2`のコメントも同じ表記へ追随修正した（AGENTS.mdの当該見出しを引用する側であるため）。`grep -n "フェーズ" AGENTS.md`で他に残存箇所が無いことを確認済み。`.agent-skill-chain/ci/verify-doc-length.sh`でAGENTS.mdが144行（上限150行）に収まっていることを確認した。

### 検証（修正前後の比較）

`node bin/agents-md.js lint vocab`（デフォルト対象全体）を修正前後で実行し、報告された`ファイル:行:禁止語`の集合を`comm`で突き合わせた。

- 件数: 120件 → 84件（36件減少、新規に出現した違反は0件）。
- 消えた36件は全て「issue（`.agent-skill-chain/templates/issue/...`等のパスリテラル、`<issue-id>`等のプレースホルダ、`` `issue start` ``等のバッククォート内コマンド名を含む）」または「フェーズ（AGENTS.md・verify-gate-report.shの2箇所）」であることを1件ずつ実際の該当行を`sed`で確認した。いずれも散文としての誤用ではなく、実在するパス・プレースホルダ・コード参照であることを確認済み（例: `roles.yaml`の`Closes #<issue-id>`、`GIT_CONVENTIONS.md`の`` `issue-start.sh` ``、`gate-report.schema.yaml`のサンプルパス`issues/123/SPEC.md`等）。
- 元々CIが報告していた3件（`verify-doc-length.sh:4`・`verify-gate-report.sh:2`・`verify-worktree-path.sh:6`）は全て解消を確認した。
- `.agent-skill-chain/schemas`,`config`,`scripts`,`standards`等に残る84件のうち大半は「issue」の識別子的用法（YAMLキー`issue:`・ドット区切り参照`issue.allowed_types`等、スラッシュを含まないためパスリテラル除外の対象外）で、既存の設計判断（本修正は「今回実際に踏んだ誤検出パターンの是正」であり、`src/`/`bin/`への対象拡大を検討したADR-5（`docs/maintainer/workflow/20260720_090158_169-cli-lifecycle-commands/02_設計.md`）とは別スコープ）どおり本Issueでは対応せず残置した。`docs/GLOSSARY.md`自体が用語定義の一環として禁止語の実例を列挙しているために生じる違反（既存`test/integration/lint.test.ts`が「正常な挙動」として明示的に許容している）も引き続き残る。したがって`lint vocab`全体の終了コードは本修正後も1のままである。
- 禁止語自体がパス形式の`.agent-skill-chain/source`（`docs/GLOSSARY.md:16`）は、パスリテラル除外の対象から明示的に除外しているため、修正後も引き続き検出されることを確認した（一度は汎用的なパス除外ルールに巻き込まれて検出漏れになりかけたため、`banned.includes('/')`によるガードを追加して是正した）。

### 追加したテスト

`test/integration/lint.test.ts`に2件追加した。

- `lint vocab: バッククォートのコードスパン・<placeholder>・スラッシュ区切りのパスリテラル内の禁止語は違反にならない（散文の誤用は引き続き検出される）`: 同一ファイル内にコードスパン・プレースホルダ・パスリテラルの3パターンと、実際の散文誤用（「このissueの内容を確認してください。」）を1行ずつ用意し、前者3行は違反にならず後者1行のみが違反として報告されることを検証。
- `lint vocab: 禁止語自体がパス形式の文字列（.agent-skill-chain/source）の場合は、バッククォートやパスリテラル文脈でも除外せず検出する`: バッククォート内・バッククォート無しパスリテラル文脈の両方で`.agent-skill-chain/source`を検出できることを検証。

### 検証結果

`npm test`実測: `# tests 341 / # pass 341 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`（既存339件全pass + 新規2件全pass）。

### 教訓

禁止語彙スキャナのような「文字列一致ベースの機械検査」は、対象コーパスが自然文だけでなく識別子・パス・プレースホルダ構文を含む技術文書の場合、部分文字列一致だけでは早晩誤検出を蓄積する。`.github/`導入によってこのリポジトリで`lint-vocab`が初めて実行された結果、120件もの既存誤検出・不整合が一度に露見したことは、「機械検査は追加した瞬間に一度は必ず実地で全量を洗い出す（サンプルの数件だけで判断しない）」ことの重要性を示している。また、禁止語自体がパス形式の文字列である場合（`.agent-skill-chain/source`）のように、誤検出除外ルールの適用対象外にすべき禁止語が存在しうるため、汎用的な除外ルールを足す際は「その禁止語自身の形状」を踏まえた例外条件を必ず検討する必要がある。

---

## 15. 追記（10回目）: PR #172 実地実行で`lint-vocab`が引き続き大量違反（84件規模）——デフォルトスキャン対象からtemplates/config/schemas/scriptsを一時除外

**発生**: §14の修正後もPR #172の実GitHub Actions上で`lint-vocab`が失敗し続けた。`node bin/agents-md.js lint vocab`（引数省略・デフォルト対象）を実測すると84件規模の違反が報告され、内訳を確認したところ大半が`.agent-skill-chain/{config,schemas,scripts,templates}`配下で"issue"という語がYAMLキー名（`issue.allowed_types`・`issue_id`等）・CLIサブコマンド名（`issue start`・`issue resume`等）として識別子的に正当利用されているものだった。§14で導入した「コード的参照除外」（バッククォート・プレースホルダ・スラッシュ区切りパスリテラル）ではこれらのYAMLキー名・サブコマンド名を検出しきれず、個別の言い換えで対応するには規模が大きすぎると判断した。

### 対応（今回のスコープ）

`src/lib/scan.ts`を次のように変更した。

- `defaultLiveFileRoots()`は変更せず維持した（`AGENTS.md`・`docs/GLOSSARY.md`・`.agent-skill-chain/{standards,templates,config,schemas,scripts,ci}`の元の8エントリ全て）。
- 新規に`defaultVocabFileRoots()`を追加し、`defaultLiveFileRoots()`の結果から`.agent-skill-chain/{templates,config,schemas,scripts}`の4ディレクトリのみを除外したもの（`AGENTS.md`・`docs/GLOSSARY.md`・`.agent-skill-chain/{standards,ci}`の4エントリ）を返すようにした。
- `src/commands/lint.ts`の`vocab()`はこの`defaultVocabFileRoots()`を使うよう変更し、`references()`は従来どおり`defaultLiveFileRoots()`（フル8エントリ）を使い続けるようにした（`resolveTargets()`にデフォルト取得関数を注入する形へ変更）。

**単一の`defaultLiveFileRoots()`をそのまま4エントリへ縮小する案からの変更理由**: 縮小した`defaultLiveFileRoots()`を`lint references`にもそのまま使うと、`.agent-skill-chain/templates/adr/ADR.md`の見出し「## related_adrs 参照ルール」が見出し収集対象から外れ、これを`§related_adrs参照ルール`で参照している`AGENTS.md:92`・`.agent-skill-chain/ci/verify-adr.sh:3`が新たに「見出しテキストで解決できないセクション番号参照」として違反判定されることを実測で確認した（`git stash`で変更前に戻し`lint references`が終了コード0であることを確認 → 変更適用後は終了コード1・2件の新規違反を確認）。これは既存の正当な参照を壊す回帰であり、`lint vocab`のみを対象ディレクトリ縮小の対象にすることで回避した。

除外理由はコメントで`src/lib/scan.ts`・`.agent-skill-chain/scripts/lint-vocab.sh`双方に明記し、「識別子・YAMLキー・CLIサブコマンド名を認識するスキャナ実装後、follow-up issueで対象復帰する」旨を記載した（issue番号は進行役が起票後に確定するため、本文には番号を書かず記述のみとした）。

### 検証結果（実測）

- `node bin/agents-md.js lint vocab`（デフォルト対象）: 除外後は**終了コード1・29件の違反**（除外前の84件規模から大幅減少したが0件には未到達）。内訳:
  - `docs/GLOSSARY.md`: 20件。全て「禁止同義語」列自体が禁止語を文字通り列挙していることに起因する自己言及であり、`test/integration/lint.test.ts`の既存テスト（§14で追加）が「デフォルト対象では終了コード1になり得ること自体は正常な挙動」と明示的に許容している構造的な自己言及であるため個別修正では解消しない。うち1件（`.agent-skill-chain/source`）はバッククォートで囲んでも`banned.includes('/')`ガードにより常に検出される設計（§14）であるため、`docs/GLOSSARY.md`をデフォルト対象に含める限り恒久的に解消不能。
  - `AGENTS.md`: 4件。うち2件（18行目「複数バックエンド間で」、76行目「添付ドキュメント参照」）は個別の言い換えで解消可能な素の用語不整合。1件（22行目 見出し「## コーディネーションバックエンド」）は日本語複合名詞内の部分文字列一致（スキャナが単語境界を認識しない）による誤検出。1件（144行目「issueとは呼ばない」）はGLOSSARY.mdと同様の自己言及（禁止語自体を例示して「呼ばない」と説明する構文）。
  - `.agent-skill-chain/standards/SECURITY_POLICY.md`: 3件。AGENTS.mdと同種（「バックエンド」の汎用語使用2件、「orchestrator」の英語併記1件）。
  - `.agent-skill-chain/ci/verify-branch-name.sh`: 2件（`issue.allowed_types`というYAMLキー名参照）。**今回`standards`・`ci`は「識別子問題が無い」という前提で対象に残したが、実際には`ci`配下にもtemplates/config/schemas/scriptsと同一の識別子起因の誤検出が残っていることが判明した**（今回の指示範囲外のためこのファイルは変更していない）。
  - 以上のうち、task説明にあった「AGENTS.md・docs/GLOSSARY.mdは既にクリーンであることを確認済み」という前提は、本実測により誤りであったことが判明した（実際にはAGENTS.md 4件・GLOSSARY.md 20件の違反が既に存在していた）。
- `node bin/agents-md.js lint references`（デフォルト対象）: **終了コード0・違反なし**。上記の回帰を`defaultVocabFileRoots()`の分離により解消済みであることを実測で確認した。
- `npm test`実測: `# tests 343 / # pass 343 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`（既存341件 + 本対応で追加した2件〔`defaultVocabFileRoots`のテスト〕全pass）。`test/unit/scan.test.ts`の`defaultLiveFileRoots`テストは元のフル8エントリ期待値を維持し、新規に`defaultVocabFileRoots`用のテスト2件を追加した。`test/integration/lint.test.ts`のコメントも新関数名に追随修正した。

### follow-up issueとして起票が必要な内容（判断材料。起票自体は進行役が行う）

1. **識別子・YAMLキー・CLIサブコマンド名認識スキャナの実装**: `hasProseViolation()`（`src/commands/lint.ts`）に、YAMLキー形式（`issue.allowed_types`・`issue_id`のようなドット/アンダースコア区切り識別子）・CLIサブコマンド文脈（`issue start`のような既知コマンド語の直後トークン）を認識する除外ルールを追加する。対象復帰させたいディレクトリは`.agent-skill-chain/{templates,config,schemas,scripts}`（本対応で除外）に加え、`.agent-skill-chain/ci/verify-branch-name.sh`のような、除外していない`ci`配下にも同種の誤検出が残っている点に留意（スキャナ修正後は`defaultVocabFileRoots()`を`defaultLiveFileRoots()`と統合して1関数に戻せる）。
2. **`docs/GLOSSARY.md`の自己言及問題**: GLOSSARY.md自体が「禁止同義語」列で禁止語を列挙する構造である以上、`lint vocab`をGLOSSARY.mdに対して実行すると原理的に違反が出続ける（`.agent-skill-chain/source`は`/`を含むため常時検出のガードが意図的にあり、バッククォート化でも回避不能）。GLOSSARY.mdをvocab検査対象から除外する、または`parseForbiddenTerms()`が読んだGLOSSARY.md自身の該当行だけをvocab検査からスキップするような自己言及除外ロジックが必要。これを解消しない限り、`lint-vocab.sh`をCIの必須ステップとして「終了コード0」を要求する現在の構成（`.github/workflows/agent-skill-chain-ci.yml`の`lint-vocab`ステップ、continue-on-error無し）は原理的に恒久green化しない。
3. **AGENTS.md・SECURITY_POLICY.mdの個別プロース修正**: 18・76行目（AGENTS.md）と3・34行目（SECURITY_POLICY.md）の「バックエンド」「ドキュメント」汎用語使用は言い換えで解消可能。22行目の見出し「コーディネーションバックエンド」はスキャナの単語境界認識（日本語複合名詞対応）が無いと根本解決しない（見出し名変更は`lint references`の§参照解決に波及するため、スキャナ修正と併せて検討する必要がある）。

本対応では上記3点はスコープ外として着手していない（`lint vocab`の終了コードは1のままである）。

---

## 16. 追記（11回目）: §15で残置した29件（follow-up 1〜3）を解消し、`lint vocab`終了コード0を達成

**発生**: §15で`node bin/agents-md.js lint vocab`（デフォルト対象）は29件の違反まで減少したが0件には未到達だった。内訳は`docs/GLOSSARY.md`20件・`AGENTS.md`4件・`.agent-skill-chain/standards/SECURITY_POLICY.md`3件・`.agent-skill-chain/ci/verify-branch-name.sh`2件。§15のfollow-up 1〜3として整理されていたこの残置分を、今回すべて解消した。

### 対応1: `docs/GLOSSARY.md`を`defaultVocabFileRoots()`から恒久除外（follow-up 2）

`src/lib/scan.ts`の`defaultVocabFileRoots()`に`docs/GLOSSARY.md`のパスを除外集合へ追加した（`defaultLiveFileRoots()`自体は変更せず、`lint references`の見出し解決には引き続きGLOSSARY.mdを含める）。GLOSSARY.md自体が「禁止同義語」列で禁止語を文字通り列挙する用語定義文書であり、構造上必然的に自分自身の禁止語検査に引っかかる（スペルチェッカーが自分の「既知の誤字一覧」ファイルを誤字として検出するのと同種の自己言及）ため、`.agent-skill-chain/{templates,config,schemas,scripts}`と同様の除外対象に加えた。除外理由は`src/lib/scan.ts`のdocコメントと`.agent-skill-chain/scripts/lint-vocab.sh`のコメント双方に明記した。

`test/unit/scan.test.ts`の`defaultVocabFileRoots`期待値テストを、GLOSSARY.mdを含まない3エントリ（`AGENTS.md`・`.agent-skill-chain/{standards,ci}`）へ更新した。`test/integration/lint.test.ts`の該当テストも、GLOSSARY.mdの自己言及により「終了コード0か1のいずれかもあり得る」としていた曖昧な期待値を、「終了コード0・stderr空」の厳密な期待値へ更新した（この除外により、実物のAGENTS.md・SECURITY_POLICY.mdが禁止語混入なしを維持する限り、デフォルト対象での`lint vocab`は決定的に終了コード0になるため）。

### 対応2: `AGENTS.md`4件（follow-up 3）

- **18行目**（実測後の行番号。§15時点の記述とも一致）「複数バックエンド間で同一 Issue の状態を同期しない」: 真の散文誤用と判断し、「複数の Coordination Backend 間で同一 Issue の状態を同期しない」へ言い換えた。
- **22行目** 見出し「## コーディネーションバックエンド」: AGENTS.md本文が他の全箇所（冒頭段落・I3・I6・README.md・各schema/scriptのコメント）で一貫して英語表記「Coordination Backend」を用いているのに対し、この見出しのみ日本語複合名詞（カタカナ）表記になっており文書内で不整合だった。見出し自体を`## Coordination Backend`へ変更し、本文中の用語表記を統一した（単なるスキャナの単語境界問題として除外ロジックで回避するのではなく、見出し自体の表記をドキュメント全体の慣行に合わせる根本対応を選んだ）。この見出しを`§コーディネーションバックエンド`として参照していた4箇所（`.agent-skill-chain/standards/SECURITY_POLICY.md:3`、`.agent-skill-chain/schemas/state.schema.yaml:1`、`.agent-skill-chain/scripts/doctor.sh:2`、`src/commands/gate.ts`）も`§Coordination Backend`へ追随修正し、`lint references`が新たに参照切れを報告しないことを実測確認した。
- **76行目**「対応表は`.agent-skill-chain/schemas/gate-report.schema.yaml`添付ドキュメント参照」: `gate-report.schema.yaml`内の実体を確認したところ、対応表はYAMLコメントとして書かれた表（`# 変更対象 | 無効化するゲート`）であり、Issueに紐づく成果物（SPEC/DESIGN/PLAN等）を指す語ではなかった。「ドキュメント」を「コメント」へ言い換え、「添付コメント参照」とした。
- **144行目**「SPEC/DESIGN/PLAN/検証結果は「Issue に紐づく成果物」であり issue とは呼ばない」: GLOSSARY.mdと同種の自己言及（禁止語自体を例示して用法を説明する構文）と判断した。GLOSSARY.mdと異なりAGENTS.mdはvocab検査対象から除外できない（本体の憲法文書のため）ため、`issue`をバッククォートで囲み`` `issue`（小文字）とは呼ばない``へ変更し、散文中の語ではなく引用された語形であることを明示した。

### 対応3: `SECURITY_POLICY.md`3件（follow-up 3）

- **3行目**（§コーディネーションバックエンドの参照）: 対応2の見出し変更に伴い`§Coordination Backend`へ追随修正。
- **23行目**「進行役（orchestrator）」: `roles.yaml`のロール識別子キー名`orchestrator`への参照であり、同一表内の他ロール行（`worker`・`gate_reviewer`・`adr_finalization_worker`）や同じ行内の`` `artifact_branch.commit` ``・`` `artifact.author` ``と同様、識別子はバッククォートで囲む既存の表内慣行に倣って`` 進行役（`orchestrator`）``へ変更した。
- **34行目**「複数バックエンド間で同一 Issue の状態を同期する設計は採用しない」: AGENTS.md18行目と同一パターンの真の散文誤用であり、「複数の Coordination Backend 間で同一 Issue の状態を同期する設計は採用しない」へ言い換えた。

### 対応4: `.agent-skill-chain/ci/verify-branch-name.sh`2件

3行目・6行目の`issue.allowed_types`は`.agent-skill-chain/config/agent-skill-chain.yaml`のYAMLキー名への技術的参照であり、他の`ci/*.sh`（`verify-worktree-path.sh`の`worktree.path_pattern`等）と同じコメント慣行だが、banned wordが偶然「issue」であるため誤検出していた。他ファイルの`worktree.*`・`branch.*`はbanned wordではないため影響を受けない。`issue.allowed_types`のみバッククォートで囲み、YAMLキーの技術的参照であることを明示することで解消した（`verify-worktree-path.sh`側は変更不要）。

### 検証結果（実測）

- `node bin/agents-md.js lint vocab`（デフォルト対象）: **終了コード0・違反0件**（29件 → 0件）。
- `node bin/agents-md.js lint references`（デフォルト対象）: **終了コード0・違反なし**（GLOSSARY.md除外・見出し名変更による副作用が無いことを確認）。
- `node bin/agents-md.js verify doc-length`: 終了コード0。AGENTS.mdは144行（上限150行以内）。
- `npm test`実測: `# tests 343 / # pass 343 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0`。`test/unit/scan.test.ts`の既存テスト1件を新しい除外仕様に合わせて更新、`test/integration/lint.test.ts`の既存テスト1件をより厳密な期待値（終了コード0固定）へ更新した（テスト件数の増減なし）。

### follow-up issueとして起票が必要な内容として残るもの

§15のfollow-up 1（識別子・YAMLキー・CLIサブコマンド名認識スキャナの実装、`.agent-skill-chain/{templates,config,schemas,scripts}`の対象復帰）は本対応のスコープ外であり、引き続きfollow-up issueとしての起票が必要（起票自体は進行役が行う）。今回の`verify-branch-name.sh`の対応は個別のバッククォート化による回避であり、このスキャナ改善が実現すれば`defaultVocabFileRoots()`と`defaultLiveFileRoots()`を1つに統合できる点は変わらない。

---

## 17. 追記（12回目）: PR #172 実地実行で`verify`ジョブのテストが実CIの環境変数漏れ込みで失敗（テスト側のenv隔離漏れ）

**発生**: §16までの修正後、PR #172の実GitHub Actions上の`verify`ジョブ内での`npm test`実行（run 29721948198）で、Issue #171の直前の対応（§10、`gate review`への`target_sha`明示指定対応）で追加したテストが失敗した。

```
not ok 60 - gate review: target_shaを明示指定した場合、entry.pathの実際のHEADと異なっていてもそれが採用されること（Issue #171: CIのdetached HEAD対応）
error: ISSUE-172 の worktree が見つかりません
```

### 根本原因

`test/integration/issue-lifecycle.test.ts`の該当テスト（`gate review: target_shaを明示指定した場合...`）は、`runCli(['gate', 'review', 'ISSUE-172', 'spec', 'strict', branchTipSha], { cwd: repo.dir })`を`env`オプション無しで呼んでいた。`test/helpers/cli.ts`の`runCli()`は`env: options.env ?? process.env`という実装であるため、`env`未指定時は**このテストプロセス自身の環境変数をそのまま子プロセスへ継承する**。

このテスト自体がGitHub Actions CIの`verify`ジョブの中で（`npm test`経由で）実行されるため、実際のPRブランチ（`process/171-ci-gate-dogfood`）に対して`actions/checkout@v4`が設定した本物の`GITHUB_HEAD_REF`環境変数が、そのままテストの子プロセスへ漏れ込んでいた。

このテストは一時repoでdetached HEAD状態を作り、「`GITHUB_HEAD_REF`が未設定かつ単一worktreeの状況で、issueNumber（172）を信頼してrootをentryとして返す」という`findIssueWorktree()`のフォールバック経路（§7で追加した「単一checkoutエントリへの最終フォールバック」）を検証する意図だった。しかし実際のCI環境では`GITHUB_HEAD_REF`が（テストの意図とは無関係な値`process/171-ci-gate-dogfood`で）既に設定されていたため、`findIssueWorktree`は「ブランチ名は`GITHUB_HEAD_REF`経由で解決できたが対象issue（172）とは不一致→安全側で`undefined`のまま」という別の分岐（§7で追加した「ブランチ名照合に失敗した場合は誤爆させない」ガード）に落ちてしまい、テストが本来検証したかった「単一worktreeエントリを信頼するフォールバック」に到達できなかった。

同種の対策は既に`test/integration/verify.test.ts`の他のテスト（`verify branch-name: ...GITHUB_HEAD_REFが未設定なら...`、`checkpoint: ...GITHUB_HEAD_REFが未設定なら...`）で`const env = { ...process.env }; delete (env as Record<string, string | undefined>).GITHUB_HEAD_REF;`という形で既に行われていたが、issue-lifecycle.test.tsの本テストにだけこのサニタイズが漏れていた。

### 対応

`test/integration/issue-lifecycle.test.ts`の該当テストの`runCli`呼び出しに、既存パターンと同じ`env`（`GITHUB_HEAD_REF`・`GITHUB_BASE_REF`の両方を明示的に`delete`したもの）を渡すよう修正した。

### 横断確認

同種の「`GITHUB_HEAD_REF`/`GITHUB_BASE_REF`が未設定であることに暗黙依存する`runCli`呼び出し」が他に無いか、`test/`配下の全`runCli`呼び出し箇所（217件）を確認した。`src/lib/worktree.ts`の`resolveCurrentBranchInfo()`は現在のHEADが真にdetached（`git rev-parse --abbrev-ref HEAD`が文字列`"HEAD"`を返す場合）のみ`GITHUB_HEAD_REF`を参照し、`defaultBranch()`も`origin/HEAD`・ローカル`main`/`master`のいずれも解決できない場合のみ`GITHUB_BASE_REF`を参照する実装であるため、`createTmpRepo()`＋通常チェックアウトのみを行う大多数のテストではこれらの分岐は構造的に実行されない。実際に`git checkout --detach`等でCI相当の状態を意図的に作っているテストは本件を含め4箇所のみであり、他の3箇所（`verify.test.ts`の`GITHUB_HEAD_REF`未設定系2件、`GITHUB_BASE_REF`設定系1件）は既に`env`を明示していることを確認した。他に同種の漏れは無い。

### 検証結果

- `GITHUB_HEAD_REF=process/171-ci-gate-dogfood npm test`（実際のCI環境の汚染を模した実行）: `# tests 344 / # pass 344 / # fail 0`。
- `npm test`（環境変数設定無しの通常実行）: `# tests 344 / # pass 344 / # fail 0`。

### 教訓

テストヘルパー`runCli()`は`env`未指定時に「テストプロセス自身の環境」をそのまま子プロセスへ継承する設計であるため、CI固有の環境変数（`GITHUB_HEAD_REF`・`GITHUB_BASE_REF`等）が「未設定であること」を前提にするテストは、テストコード自身がその環境変数を実行するCI環境の中で走る場合に限り、ローカルでは決して再現しない形で汚染される。この種のテストはローカル実行だけでは絶対に検出できず、実際にCIの`verify`ジョブとして走らせて初めて発覚する。今後、`GITHUB_HEAD_REF`/`GITHUB_BASE_REF`の「未設定であること」を前提とするテストを追加する際は、既存パターン（`env`をコピーして対象キーを`delete`）に必ず倣い、サニタイズを機械的に徹底する。
