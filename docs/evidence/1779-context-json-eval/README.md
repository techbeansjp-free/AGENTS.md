# context.jsonによる規則読み落としの削減の実測と採否（#1779）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。

## 結論

（測定後に記入する。）

## 測定の準備（実行前に固定）

この節と、同じdirectoryの`cases.json`・`context.json`・`run.mjs`・`extract.mjs`・`score.mjs`・`start-outputs.json`は、測定の前にcommitした。測定後に変えた場合は、その理由を「測定後の変更」に記録する。

### 記録

| 項目 | 値 |
| --- | --- |
| 調査時のmain | `c45a8abcb1441a034f3d0b53db22644b77a9fc7f`（origin/main） |
| fixture | 上のcommitを`git archive`で展開した非Gitのtreeを2つ用意した。`docs/evidence/1767-context-read-selection`（前回のgold）は両方から除いた。条件A+Cのtreeにだけ`.agent-skill-chain/project/context.json`（本directoryの`context.json`と同一）を置いた。2つのtreeの差がこの1 fileだけであることを、全fileのSHA-256の比較で確かめた |
| Host | Claude Code 2.1.323。読取り役は`claude -p`の新規process（`run.mjs`の`CLAUDE_ARGS`）。modelは`opus`を指定し、記録上は`claude-opus-5-5`（Claude Codeが内部で使う`claude-haiku-5-5`の少量の呼出しを含む） |
| 実行経路 | 進行役（本Issueの技術担当）がHost上で`run.mjs measure`を起動する。`start`はfixture内の`bin/asc-v05.mjs`と同版のCLI（本worktreeの`bin/asc-v05.mjs`）で、fixtureに対して実行した |
| 入れ子のAGENTS.md/CLAUDE.md | このrepositoryにはrootの2 fileしか無い（`.worktrees/`等を除く）。このためケースに含めない（該当なし） |

### 比較する条件

依頼文は、#1767の共通部（変更依頼と、実装・検証に必要な根拠を挙げさせる指示、2行の回答形式）を元にし、条件による違いは`start`の出力だけにした（`run.mjs`の`buildPrompt`）。

- **A（現行）**：fixtureに`context.json`が無い。依頼文に、そのfixtureでの`start <fixture> --path <変更path>`の`context`欄（JSON）を含める。中身はroot `AGENTS.md`・`CLAUDE.md`・`project-policy.json`の参照と、「rules directoryはあるがcontext.jsonが無いので、適用規則を特定せよ」等のnoticeである。
- **A+C**：fixtureに`context.json`がある。同じ位置・同じ形式で、そのfixtureでの`start`の`context`欄を含める。変更pathに適用される規則fileが列挙される。

依頼文の中の位置：作業規則（`implementation.md`の読込み規則の要約）の直後、回答形式の直前。形式は「Output of the ASC command `start <repository> --path <intended changed paths>` for this change (its `context` field):」に続くJSONのcode block。各ケース・条件の実際の`context`欄は`start-outputs.json`にある。

Issueの「A：現行。`start`のnoticeだけが出る」は、実際のASCの経路では`start`の出力（noticeを含む）を受け取ることから、Aにも`start`の出力を渡すと解釈した。#1767のA（`start`の出力を渡さない）は参考条件として加えない。理由は、費用の上限が「代表ケース×条件×3回程度」で未決であること、採否はAとA+Cの比較で決まること、#1767にその条件の結果（K7で3回中1回の欠落）が既にあること。

### context.jsonの案

`.agent-skill-chain/project/rules/`の21規則それぞれに、`scope`のうちpathとして書かれたものを`appliesTo`へ対応させた（末尾の`/`は除いた）。pathでない`scope`は次のように扱った。

- `CI`は`.github/workflows/ci.yml`とした（code-quality、lockfile、quality-command）。
- `repository development`・`review`・`pull_request`・`ownership_local`等、repository全体の作業に掛かる規則（distribution-impact、dogfooding、ownership-local、ownership-pr、review-exception）は`appliesTo: []`とし、全pathで列挙される。
- lockfileは、依存の変更が`package.json`から始まるため`package.json`も加えた。
- `SKILL.md`・`README.md`（naming-exception）はrootのfileにしか一致しない。`appliesTo`はpath prefixであり、basenameの一致は表せない（`src/project-context.mjs`の仕様。改修は本Issueの対象外）。

### 代表ケースとgold

`cases.json`に固定した。`required`・`critical`は、技術担当が元の規則fileと変更pathから決めた。

| ケース | 種類 | 変更path | required（critical） |
| --- | --- | --- | --- |
| R1 | 品質規則（#1767のK7と同じ依頼） | `scripts/format_release_notes.py` | code-quality（critical） |
| R2 | 品質規則（`src/`へshell） | `src/cleanup-locks.sh`、`src/worktree-execution.mjs` | code-quality（critical） |
| R3 | 品質規則（`test/`でJSDocの型注記） | `test/test_project_context_symlink.mjs` | code-quality（critical） |
| R4 | 複数規則（CI） | `.github/workflows/ci.yml` | ci-permission（critical）、ci-trigger（critical）、runtime |
| R5 | 複数規則（package manager） | `package.json`、`pnpm-lock.yaml` | package-manager（critical）、lockfile、runtime |
| R6 | 複数規則（契約文書） | `.agent-skill-chain/docs/03_レビュー手順.md` | japanese-docs（critical）、canonical-source（critical） |
| R7 | 規則が適用されない | `v05/USAGE.md` | なし |
| R8 | 規則が適用されない | `skills/asc/references/review.md` | なし |

`optional`は読んでも不要と数えない規則file。`repositoryWideOptional`の5規則（上のrepository全体の規則）は全ケースで`optional`扱いとする。

### 採点規則

`score.mjs`に固定した。

- 「挙げた」は回答のFILES行にあるpath（#1767と同じ定義）。「開いた」はtool記録のReadの対象。recallと欠落は「挙げた」で数え、「開いた」は併記する。
- 欠落は「ケース×回×必須規則file」の単位で数える。R7・R8はrecallの対象にせず、不要な列挙と読込みにだけ使う。
- 不要な規則fileは、`.agent-skill-chain/project/rules/`配下で、そのケースの`required`・`optional`・`repositoryWideOptional`のどれでもないfile。
- token（input・output・cache read・cache creationの合計。Claude Codeの`modelUsage`の全model合計）、tool呼出し数、wall-clock（process起動から終了まで）、Host表示の費用（`costUSD`、list価格の推定値で課金額ではない）を記録する。取得できない値は欠測とする。
- 回答にFILES行が無い、または終了codeが0でない試行は失敗とする。失敗した試行は件数と費用に計上し、同じケース・条件・回を1回だけやり直してrecallにはやり直しの結果を使う。
- 差は、回ごとの値（全ケースの合計または平均）の範囲（最小〜最大）が条件間で重ならない場合だけ「区別できる」とする（Issueの既定どおり）。

### 採否の規則

Issueの条件（#1767でownerが承認した閾値）をそのまま使う。採用は次の全てを満たす場合だけである。

1. A+Cで、全ケース・全回の必須規則のrecallが100%（critical欠落0件）。
2. Aで必須規則の欠落が1件以上あり、A+Cの欠落件数がAより少ない。

Aで欠落が無ければ不採用とする。不要な規則fileの読込みと費用の増加は判断に添える。

### 反復と順序

各ケースを条件ごとに3回測る（8ケース×2条件×3回＝48回）。回ごとに条件の順序を交替する（1回目A→A+C、2回目A+C→A、3回目A→A+C）。同じ回の中では、先の条件の8ケースを並列4本で終えてから後の条件を起動する。

## 隔離の確認

測定の前に、測定と同じ起動設定（`run.mjs probe`）で反例を試した。fixtureの外（fixtureの親directoryの隣）に、無害な合成値を書いた目印のfileを置いた。

起動設定（`run.mjs`の`CLAUDE_ARGS`）：`claude -p --model opus --output-format stream-json --verbose --restricted --tools Read,Glob,Grep --allowedTools Read,Glob,Grep --permission-mode dontAsk --strict-mcp-config --settings '{"disableAllHooks":true}' --no-session-persistence`、cwdはfixture。環境変数は進行役のものから`GIT_*`を除いて渡す（名前の一覧は各試行の`*.launch.json`に保存し、値は保存しない）。mountは使っていない（Host上のprocess）。

| 合格条件 | 反例 | 結果 |
| --- | --- | --- |
| fixture外の目印fileを読めない | Readで目印fileを読む／Globで目印のdirectoryを列挙する／Grepでfixtureの親directoryを検索する／Readで本来のrepositoryのREADMEを読む | 4件とも拒否された（「is outside <fixture>; --restricted confines the file tools to the working directory」）。内容は返っていない |
| fixture外へ書き込めない | fixture外とfixture内に1 fileずつ作らせる | 書込みのtoolが無く（init記録のtoolsは`Glob`・`Grep`・`Read`だけ）、どちらのfileもできていないことをHost側で確かめた |
| 外部networkへ接続できない | `https://example.com`の取得を指示する | 取得できるtool（WebFetch・WebSearch・Bash）が無く、MCP serverも0件（init記録）。Host自身のmodelへのAPI通信だけが残る |

対照（検査の感度）：同じ依頼を`--restricted`を外して起動すると、目印fileの内容をそのまま読み、Glob・Grepもfixture外で成功した。この端末のuser設定が`/tmp`配下等のReadを許可しているためである。つまり、`--tools Read,Glob,Grep`と`dontAsk`だけでは読取り範囲はfixtureに閉じない。`host-session claude`の既定の起動設定も`--restricted`を含まないため、同じ理由でこの合格条件を満たさない（本Issueでは`host-session`を読取り役に使っていない）。

測定の各試行でも、tool入力のpathがfixtureの外を指した件数を`extract.mjs`で数える（`outsideToolInputs`）。あわせて、測定の前後でfixtureの全fileのSHA-256が変わらないことを確かめる。

## 結果

（測定後に記入する。）
