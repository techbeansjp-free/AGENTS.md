# Issue #1601 配布物レビュー指摘の再確認

確認日: 2026-11-03。対象source: `60d68920d3f925ede528993c44bd4bd67fc795e6`。

## 判定

9指摘はいずれも現行sourceでは対応済みで、追加の製品修正は不要。主な修正commit `fe319abefd21add9a55b59355517454add3504b8` と、Issue #1601対応PR #1619のmerge `50b316509a08a1cdd18ef26260551d769a9c9929` が対象HEADの祖先であることを確認した。指摘されたv0.5.6 tarball自体の再現は行っていないため、下表は当時の配布物の合否ではなく、現在残る不具合の判定である。

| # | 現行の確認結果 | 実証・参照 |
|---|---|---|
| 1 | 対応済み。全体・個別helpのUSAGE pathは`fileURLToPath`で変換する。 | `bin/asc-v05.mjs`。`test/test_package.mjs`の実tarballを日本語・空白・`%`付きpathへoffline導入する試験が成功し、helpのnative path一致を確認。 |
| 2 | 対応済み。READMEはv0.5.4を公開最新版と固定せず、Latestと選択タグ・tarball・実際の`--version`確認を案内する。 | `README.md`を確認。固定表記がないことと`releases/latest`参照をassert。現在の公開最新版そのものは調査対象外。 |
| 3 | 対応済み。JS launcherは`@openai/codex` manifest確認後にrootを返す。native binaryは実体fileだけを返し、親directoryを許可しない。呼出側もsource/runtimeとの重なりを拒否してから権限tableを構築する。 | `src/codex-runtime.mjs`、`src/restricted-agent.mjs`。既存`Codex runtime roots reject an unrelated executable parent`が、manifest欠落・別package拒否、native file単体、正しいpackage rootを確認して成功。これは任意binaryの真正性を認証する機能ではない。 |
| 4 | 対応済み。通常snapshot検証の`ENOBUFS`は`ASC_VERIFICATION_OUTPUT_LIMIT`へ変換し、修復対象のテスト失敗として扱わない。 | `src/controller.mjs`、`src/workflow.mjs`。既存output overflow回帰が成功。`v05/USAGE.md`の出力上限の説明に通常経路のstdout/stderr合計、browser経路の各streamに1MiB、標準worktree経路にはこの上限なしと記載。 |
| 5 | 対応済み。保存済みunit、明示Goal、再利用proposalを検証してから`cloneSource`を呼ぶ。 | `src/goal-restart.mjs`。既存のmalformed restartとmissing Goal/malformed proposal回帰が成功。不正入力後にdestinationが作られず、訂正後の同じdestinationでの成功も確認する。 |
| 6 | 対応済み。native diagnosticとnetwork preflightの双方で`ECONNREFUSED`・`ENETDOWN`をdeniedに分類する。 | `src/native-probe.mjs`、`src/agent-network-preflight.mjs`を照合。native diagnosticの実コード文字列をVMで評価し、偽socketの両errorで`network: denied`となることをassert。実OS隔離の受入試験ではない。 |
| 7 | 対応済み。内部Git観測はすべて`GIT_*`を除外し、owner指定検証commandはHost環境を継承する。 | `src/worktree-execution.mjs`。foreign Git環境での対象repo/HEAD固定とowner commandへの環境維持、Host Git設定維持の既存2回帰が成功。任意のowner commandが対象repoだけを検査する保証とは区別されている。 |
| 8 | 対応済み。migration-inspect/prepare/stage/rollbackの4例が同梱入口を使い、導入済みworktreeルートから実行する前提も明記。 | `v05/MIGRATION_PLAN.md`。外部prefix例がないこと、`node .agent-skill-chain/bin/asc.mjs migration-`の4例をassert。 |
| 9 | 対応済み。`ls-tree -rlz`でsizeを取得し、`Controller.readBlobs`の`cat-file --batch`でまとめて読む。 | `migration_inspect.mjs`。既存batch inventory回帰が成功。80追加fileのfixtureでbatch 1回、fileごとの`cat-file -s`/`cat-file blob`が0回、unsupported pathの報告保持を確認。実project規模での速度改善率は測定していない。 |

補足要望も対応済み。`v05/USAGE.md`「利用側のCodeRabbitレビューから配布物を除外する」に、既存設定を保持して`reviews.path_filters`へ標準配置の`managed-runtime/**`と`v05/**`だけを任意除外する例がある。ASCは利用側設定を自動変更しない。本文と例の存在を確認し、利用側CodeRabbitサービスでの適用試験は行っていない。

## 今回の実検証

Node v24.22.0、上記専用worktreeで実行。既存テスト・製品source・品質設定は変更していない。

```sh
node --test --test-isolation=none --test-reporter=tap \
  --test-name-pattern='Codex runtime|Mac Node|native diagnostic|verification output overflow|foreign Git|preserves Host Git|malformed restart inputs|restart rejects missing Goal|migration inventory batches' \
  test/test_native_probe.mjs test/test_controller.mjs test/test_worktree_execution.mjs \
  test/test_goal_run.mjs test/test_migration.mjs
```

結果: 10 tests、10 pass、0 fail、0 skip（約0.85秒）。初回はsandbox内のGit子process起動が`spawnSync git EPERM`となり、6件が実行環境で失敗した。同一commandをHost権限で再実行して上記成功を得た。初回失敗を製品不具合や成功として扱っていない。

```sh
node --test --test-isolation=none --test-reporter=tap \
  --test-name-pattern='packed Node distribution runs' test/test_package.mjs
```

結果: 1 test、1 pass、0 fail、0 skip（約9.30秒、Host権限）。npmの実packとoffline installを行い、配布物単独の起動・help等を確認した。公開・push・releaseは行っていない。

加えて上表#2/#6/#8とCodeRabbit例をNodeのassertで確認し成功した。#6はsource内の固定diagnostic文字列を読み、`node:net`と`node:fs`をVM内の偽物へ置換してerror codeを注入した。

## セルフレビュー・配布物影響

変更は本Evidenceのみ。配布inventoryへ入るpathの変更は0件で、製品source・配布資料・package.json・workflow・保護契約・他Issueの成果を変更しない。既存の修正を重複実装する必要がないため、配布物更新は行わない。

今回の対象回帰成功を全品質gate・実native隔離E2E・現在のrelease済みtarballの合格へ読み替えない。独立レビューと統合後の品質確認は進行役へ引き継ぐ。
