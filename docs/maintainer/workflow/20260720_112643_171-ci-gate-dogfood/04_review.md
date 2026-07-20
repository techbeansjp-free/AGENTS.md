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
