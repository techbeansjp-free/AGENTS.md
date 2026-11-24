# context.jsonによる規則読み落としの削減の実測と採否（#1779）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。

## 結論

**不採用とする。`context.json`はこのrepositoryに追加しない。** 事前に固定した採否の規則（下記）のうち「Aで必須規則の欠落が1件以上」を満たさなかった。現行のA（`context.json`無し、`start`のnoticeだけ）は、8ケース×3回の24回（recallの対象はR1〜R6の18回、必須規則の枠は計33件）で必須規則を全て挙げ、critical欠落も0件だった。A+Cも同じく欠落0件で、改善の余地を示せない。

A+Cは、不要な規則fileの読込みをAより区別できる差で減らした（回ごとに10〜11件→1件）。一方で、列挙された規則（全pathに掛かる5規則を含む）を読むため、開いた規則fileは平均3.75→7.79件、tool呼出しは平均20.6→23.3回に増えた（tool呼出しの差は区別できる）。tokenとwall-clockの差は区別できない。いずれも採否の条件ではなく、判断に添える情報である。なお「不要な規則file」はgoldの`optional`・`repositoryWideOptional`に依存し、goldと`context.json`の案はどちらも同じ規則の`scope`から作ったため、A+Cが列挙どおりに読めば構造上「不要」に数えられない。この減少は案から独立した指標ではない。

外部サービスへの送信は無い。読取り役は、反例で合格を確かめた隔離設定（`--restricted`等）でだけ動かした。

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
- 回答にFILES行が無い、または終了codeが0でない試行は失敗とする。失敗した試行は件数と費用に計上し、同じケース・条件・回を1回だけやり直してrecallにはやり直しの結果を使う。やり直しは手動で行う：失敗した試行の生出力を`<key>.failed1.*`へ改名してから同じ引数で`run.mjs`を再実行する（`run.mjs`は同じprefixへ上書きするため）。`extract.mjs`は改名したfileも`.failed1`付きのkeyとして出力し、`score.mjs`はそれを失敗として数える。
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

測定は2026-11-24 08:08〜08:23（UTC）に、準備のcommit（`44e6def5`）をpushした後で行った。48回とも終了code 0で、回答にFILES行があり、失敗・破棄・やり直しは0件である。各試行の値は[runs.json](runs.json)（`extract.mjs`で生出力から抜き出した。fixtureの絶対pathはrepo相対へ直した）。再現：このdirectoryで`node score.mjs cases.json runs.json`。

全48回の起動記録（init）は、tools `Glob,Grep,Read`、MCP server 0件、Claude Code 2.1.323、permission mode `dontAsk`だった。tool入力の`file_path`・`path`がfixtureの外を指した件数は0件（Globの`pattern`やGrepの`glob`は数えていないため下限である。隔離の保証は上の反例による）。測定の前後で両fixtureの全fileのSHA-256（1,405／1,406 files）は変わらなかった。

### 条件別

| 指標 | A（24回） | A+C（24回） |
| --- | --- | --- |
| 必須規則の欠落（recall対象18回、必須規則の枠は計33件） | 0 | 0 |
| critical欠落 | 0 | 0 |
| 必須規則を挙げたが開かなかった件数 | 0 | 0 |
| 不要な規則fileを挙げた件数（合計） | 27 | 4 |
| 不要な規則fileを開いた件数（合計） | 32 | 3 |
| 開いた規則file（平均／回） | 3.75 | 7.79 |
| token（平均／回。cache read等を含む全model合計） | 190,318 | 200,225 |
| output token（平均／回） | 4,603 | 4,988 |
| Host表示の費用（平均／回、USD、list価格の推定） | 0.304 | 0.328 |
| tool呼出し（平均／回） | 20.6 | 23.3 |
| wall-clock（平均／回、秒、並列4本） | 59.6 | 76.6 |

### 回ごとの値と区別

| 指標 | A 1回目／2回目／3回目 | A+C 1回目／2回目／3回目 | 区別 |
| --- | --- | --- | --- |
| 欠落件数 | 0／0／0 | 0／0／0 | できない（同値） |
| 不要な規則fileを開いた件数 | 11／10／11 | 1／1／1 | できる（A+Cが少ない） |
| token平均 | 172,788／213,103／185,064 | 201,446／179,325／219,904 | できない |
| tool呼出し平均 | 19.9／20.8／21.3 | 23.8／22.4／23.6 | できる（A+Cが多い） |
| wall-clock平均（秒） | 76.4／47.7／54.9 | 76.6／74.6／78.6 | できない |

回の順序は1回目A→A+C、2回目A+C→A、3回目A→A+Cだった。wall-clockは並列4本の相互干渉を含む参考値である。

挙げた規則fileの数（ケースごと、1／2／3回目）：

| ケース | A | A+C |
| --- | --- | --- |
| R1 | 3／4／1 | 7／7／8 |
| R2 | 4／5／5 | 7／8／7 |
| R3 | 2／2／3 | 8／8／8 |
| R4 | 3／3／3 | 12／7／12 |
| R5 | 4／5／3 | 12／10／11 |
| R6 | 4／4／4 | 8／8／8 |
| R7 | 4／2／5 | 5／5／5 |
| R8 | 6／3／4 | 6／5／6 |

Aの不要な読込みは、主にR7・R8（規則が適用されないpath）で、`japanese-docs`・`canonical-source`・`docs`等を内容から推測して開いたものである。A+Cは`start`が列挙した規則を開き、列挙外はほとんど開かなかった。

### 採否

| 条件 | 結果 |
| --- | --- |
| A+Cで全ケース・全回の必須規則のrecallが100%（critical欠落0） | 満たす |
| Aで必須規則の欠落が1件以上 | **満たさない**（0件） |
| A+Cの欠落件数がAより少ない | 満たさない（0と0） |
| 判定 | **不採用** |

`score.mjs`の`verdict`は`{"acFullRecall":true,"aHasMiss":false,"acFewerThanA":false,"adopt":false}`である。

### #1767のK7との関係

#1767のAは`start`の出力を受け取らず、K7（本IssueのR1と同じ依頼）の3回中1回で`code-quality.json`を挙げなかった。本IssueのAには`start`の出力（「rules directoryはあるがcontext.jsonが無いので、適用規則を特定せよ」というnoticeを含む）を渡した。R1〜R3の品質規則の9回を含めて欠落は無かった。#1767と本Issueでは、Host版・依頼文の作業規則の文面・fixtureのcommit・読取り役の起動方法（subagentと`claude -p`）が違うため、両者を同じ条件の比較とはみなさない。言えるのは次の範囲である。

- 現行の`start`のnoticeを渡せば、今回の代表ケースでは規則の読み落としは観測されなかった。
- `context.json`は、読み落としの削減としては効果を示せなかった。不要な規則の読込みは減ったが、列挙が増えた分だけ開く規則とtool呼出しが増え、tokenは減っていない。
- `start`の出力を渡すこと自体の効果（#1767のAとの差）は、本Issueでは測っていない（参考条件を加えなかった理由は「比較する条件」）。

### 費用・欠測・失敗した試行

- 費用：48回でtoken合計9,373,040（output 230,182）、Host表示の費用は合計15.16 USD（list価格の推定値で、課金額ではない）。隔離の確認の2回（反例と対照）は合計約0.13 USD。失敗・破棄した試行は無い。上限「代表ケース×条件×3回程度」（8×2×3）を超えていない。
- 欠測：課金額（Host表示は推定値）。親session（進行役）の調整・採点・レビューの消費。読んだ範囲の妥当性と、実装・テスト・レビューまで進めた場合の手戻り。
- 標本：fixtureは1 repository・8ケース・各3回、Hostは1つ（Claude Code）・modelは1つ（Opus 5.5）。Codex等の別Hostは調べていない。
- goldは、独立Reviewerではなく技術担当が元の規則と変更pathから決めた。R7のように、規則の`scope`外でも内容から関連すると判断できる規則（`japanese-docs`等）を「不要」と数えている。
- Aへの手掛かりが強い条件である。Aの`start`出力が参照する`project-policy.json`は`ruleFiles`に21規則を全件列挙しており、依頼文も「applicable project rules」を挙げるよう求めている。このような規則の一覧が無いproject、または規則を挙げるよう明示しない依頼では、結果が変わりうる。
- 合成fixtureでの結果であり、実際の作業での効果は未確認である。

## 測定後の変更

測定の後で変えたのは、本READMEの「結論」「結果」「再評価の条件」の記入と、`runs.json`の追加だけである。gold・採点規則・`context.json`の案・起動設定は変えていない。独立レビューの指摘（Low）を受けて、READMEの記述（指標の独立性、やり直しの手順、fixture外判定の範囲、Aへの手掛かりの限界、欠落の分母の表記、`host-session`の発見の根拠）を補った。採点の論理と数値は変えていない。

## 再評価の条件

次の場合は新しいIssueで再評価する。代表ケースと採点scriptは本directoryのものを再利用できる。

- `start`のnoticeを受け取った後でも、project固有規則の読み落としが実作業で独立に記録された。
- `start`の出力を実装担当・Reviewerへ渡していない経路（Hostのsubagent等）で読み落としが記録された。この場合は、`context.json`より先に`start`の出力を渡す手順を確かめる。
- 規則の数や、pathによって適用が分かれる規則が増え、`start`のnoticeから規則を特定する負担が大きくなった。

## 関連する発見（本Issueの範囲外）

- `host-session claude`の既定の起動設定（`--tools Read,Glob,Grep --allowedTools Read,Glob,Grep --permission-mode dontAsk`）は`--restricted`を含まない。user設定がfixture外のReadを許可している端末では、読取り役が作業directory外のfileを読める（上の対照で確認）。独立レビューの読取り専用は書込みとtoolの種類についての保証であり、読取り範囲を作業directoryへ閉じる保証ではない（秘密を含む作業directory外のfileに届きうる）。根拠は`src/host-session.mjs`の起動引数（`--restricted`が無い）と、上の対照の結果である。本Issueの対象外（`src/`の改修を含むため）であり、起票と対応はownerの判断に回す。
