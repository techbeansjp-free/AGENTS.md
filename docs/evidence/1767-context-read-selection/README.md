# Context読込み選択の不足の実測と採否（#1767）

開発時の検証資料であり、配布対象に含めない。記載のcommit・版に対する記録で、現行仕様の正本ではない。通常のASC実行時に読み込ませない。

## 結論

**読込み選択の追加機構は採用しない。C（決定論的な優先順位付け）とB（既存検索の手順を明示する最小改善）は、どちらも不採用とする。** BとCはowner承認済みの閾値を満たさず、Aより良いことも示せなかった（下記「採否」）。Aの読み方の規則（`implementation.md`）は変更しない。

ただし、現行Aも閾値（recall 100%）には届かなかった。K7（project固有規則）の3回目で、事前にcriticalと定めた品質規則`code-quality.json`を含む必須2fileを挙げなかった。改善の候補は、順位付けではなく既存機構の設定にある。このrepositoryには`.agent-skill-chain/project/context.json`が無い。そのため`start`の`context`はpath別の適用規則を列挙せず、noticeを出すだけになる。context.jsonを置けばこの規則が列挙されることは確認した。一方、それで読み落としが防げるかは測っていない（「Aの欠落と、既存機構による改善の候補」）。設定の追加はproject固有契約の変更でowner判断に当たるため、本PRでは行わず提案にとどめる。

Phase 0（下記）では「保留」とした。その後、ownerが閾値・反復数・費用上限を承認した（2026-11-23、本作業の依頼の中で。Issue・PRのコメントには記録していない）。これを受けてPhase 1の対照評価を行い、上の結論を得た。外部サービス（Jev等）への送信は無い。

## Phase 1：A/B/Cの対照評価

### 条件と固定したもの

| 項目 | 値 |
| --- | --- |
| fixture | ASC repository自体、commit `ace85c03a7f918400e7a5775ee4fc8601d827f37`（非機密。外部送信なし） |
| oracle | [cases.json](cases.json)（sha256 `35b71256ef4b6a75074e0bf08cee65143f3dd0ef757efd918eba6bad71f4a41d`）。実行前に固定し、評価Agentには見せていない |
| 代表ケース | K1小変更、K2複数fileの利用側、K3出力契約とdocs、K4認可、K5エラー文言の回帰、K6動的な配布在庫（manifest）、K7 project固有規則 |
| Host／model | Claude Code 2.1.323（3回目の時点）。評価Agentは`general-purpose`のsubagentで、modelは親sessionからの継承（3回目はOpus 5.5）。1・2回目は前任agentが同じ起動方法で記録したもので、Host版とmodelを別に記録していない |
| 反復 | A・Bとも各ケース3回（計42回）。起動順は1回目A→B、2回目B→A、3回目A→B。各回は7件を並列に起動した |
| 採点 | [score.mjs](score.mjs)（A・B）、[cscore.mjs](cscore.mjs)（C）。回答の原データは[runs.json](runs.json)（sha256 `ea820083a9aa4e4d205f8c0784025cb2cabc4a016889d9544b261bb3e21cae91`） |

oracleの各欄の意味は次のとおり。
- `required`：実装と検証に必須のfile。
- `optional`：読んでも余分に数えないfile。複数の妥当な経路がある場合はfileをここに置き、1つの経路を強制しない。
- `critical`：`required`のうち、欠落が1件でもあれば不採用とするfile。K4の`src/approval.mjs`（認可）とK6の`src/runtime-files.json`（配布在庫）はsecurity・配布の正否に関わる。K7の`code-quality.json`は品質gateの規則で、securityの規則ではないが、project固有規則の欠落を見るためcriticalに含めた。

採点はfile単位である。行単位の範囲や、読んだ内容の理解は評価していない。

評価Agentへの依頼文は次の共通部と、条件別の末尾からなる（`<fixture>`はfixtureの絶対path）。

> Read-only investigation of the git repository at `<fixture>` (use absolute paths; never edit or create any file; do not read docs/evidence/1767-context-read-selection). Change request (do not implement it): `<cases.jsonのreq>` Determine the evidence an engineer must read before implementing AND verifying this change safely: source code, existing tests, contracts/docs that describe the behavior, applicable project rules. Investigate for real; stop when you are confident the set is sufficient. Your final reply must be exactly two lines and nothing else: line 1 `FILES: ` followed by comma-separated repo-relative paths of the evidence; line 2 `ROOT: ` followed by true or false (whether you read the root AGENTS.md/CLAUDE.md).

- A（現行ASCの読み方。`implementation.md`の既存規則の要約）：`Working rules: avoid filling context with large tool output; search to locate positions, then read only the necessary ranges; use gh/git with narrowed output; do not dump whole diffs or logs.`
- B（既存検索の構成・順序の最小改善）：`Procedure: (1) rg the key identifiers/keywords from the request across the whole repo (src, test, bin, scripts, v05, skills, .agent-skill-chain) with rg -l first; (2) for each definition found, rg its callers, its tests (test/), docs/contracts that describe it, and file inventories/manifests/configs that enumerate it by name; (3) list .agent-skill-chain/project and its rules/ directory and read rules whose purpose touches the request; read root AGENTS.md/CLAUDE.md; (4) read only line ranges around hits; (5) if the cause or affected set is not pinned by the top hits, widen the search rather than stopping.`
- C（モデルを使わない決定論的な候補順位付け）：依頼文の語のTF-IDF、path名の一致、上位候補に対応するtestとimport元の加点。上位5件・10件に入るかで評価した。

Aは、ASC Skillの全文も`start --path`の出力も与えていない。`implementation.md`の読込み規則だけを再現した条件であり、実際の「Host＋ASC」の全経路ではない。

再現：`node score.mjs cases.json runs.json`、`node cscore.mjs <ASC repository> ace85c03 cases.json`（このdirectoryで実行）。scriptは読取りだけで、外部へ送信しない。

### 結果

| 指標 | A（21回） | B（21回） |
| --- | --- | --- |
| 必須fileを全て挙げた回 | 20/21 | 20/21 |
| 平均recall | 0.952 | 0.976 |
| critical欠落 | 1（K7 3回目） | 0 |
| 余分なfile（平均） | 7.0 | 8.1 |
| subagent_tokens（平均） | 50,700 | 52,516 |
| tool呼出し（平均） | 8.7 | 6.4 |
| 所要時間（平均、参考値） | 31.6秒 | 26.0秒 |

「余分なfile」には、root `AGENTS.md`・`CLAUDE.md`や`.agent-skill-chain/docs/*`のように、どのケースでも読むべき規約も含まれる（oracleの`optional`に入れていないため）。precisionの指標としては粗い。

反復別（平均token、完全取得）：

| 回 | A | B | BのA比token |
| --- | --- | --- | --- |
| 1回目（A→B） | 47,260、7/7 | 48,719、6/7 | +3.1% |
| 2回目（B→A） | 47,774、7/7 | 49,084、7/7 | +2.7% |
| 3回目（A→B） | 57,068、6/7 | 59,743、7/7 | +4.7% |

欠落の内訳（回答のFILES行から判断した。tool操作の記録は保存していない）：
- A K7 3回目：`.agent-skill-chain/project/rules/code-quality.json`（critical）と`scripts/check_source_quality.ts`を両方とも挙げず、代わりにrelease script・CI workflow・eslint設定を挙げた。project rules directoryのfileは1つも挙げていない。
- B K7 1回目：`scripts/check_source_quality.ts`を挙げなかった（criticalではない）。規則fileは挙げている。
- K1〜K6は、両条件の全42回で欠落が無い。

C（決定論のため1回で確定）：
- 上位10件で必須fileを全て含んだのは1/7ケース。
- 平均recallは上位5件で0.37、上位10件で0.55。
- K6とK7は上位10件でもcriticalが欠落した。K4は上位5件で欠落した。
- 値は前任agentのPython版scriptと一致した。ただしPython版はrepoに含めていない（Phase 0と同じ理由）。

token：B−Aの差（+2.7〜+4.7%）は3回とも同じ向きである。ただしこれは、評価Agent 1回あたり約40kの起動時の固定分の上に乗った差である。両条件とも3回目に約20%増えており、この回ごとの揺れより小さい。Bはtool呼出しが少ないが、tokenは減っていない。

### 採否

ownerが承認した閾値：
- 必須根拠のrecallは100%。
- security-criticalの欠落は1件でも不採用。
- 品質が現行以下なら不採用。
- 1ケース3回以上反復する。

| 案 | 判定 | 根拠 |
| --- | --- | --- |
| A：現行の読み方 | 変更しない（読込み選択の機構・規則を足さない） | 比較の基準。A自身も閾値（recall 100%）に届かないが、B・Cが改善を示さないため、読込み手順を足す根拠にならない |
| B：既存検索の手順明示 | 不採用 | recallが20/21で100%に届かない。完全取得はAと同じ20/21で、Aを上回る品質を示せない。critical欠落はAより1少ないが、1/21の差は反復の揺れを超えない。tokenはA以上 |
| C：優先順位付け（Jev等を含む） | 不採用 | 決定論版でcriticalが欠落し（K4・K6・K7）、完全取得は1/7。確率的selectorにはこの基準線を超える根拠が無い。外部送信も承認されていないため試していない |

### Aの欠落と、既存機構による改善の候補

`projectContext`は、`.agent-skill-chain/project/context.json`（`asc-project-context/v1`）の`rules[].appliesTo`を使い、変更pathごとに規則fileを列挙する。このrepositoryにはcontext.jsonが無い。K7の変更path（`scripts/format_release_notes.py`）で`projectContext`を直接実行すると、返ったのは次だけだった。
- 参照：`AGENTS.md`、`CLAUDE.md`、`project-policy.json`。
- notice：「legacyの`project-policy.json`はHostが解釈する」と、「rules directoryはあるがcontext.jsonが無いので、適用規則を特定せよ」。

実行はcommit `20a8a30c`で行った。fixtureとの差は`docs/evidence/1765-decision-reuse`だけである。

作業用に複写したtreeへ、`{"path":".agent-skill-chain/project/rules/code-quality.json","appliesTo":["src","bin","scripts","test"]}`を持つcontext.jsonを置いて試した。同じpathでは`code-quality.json`が列挙され、`v05/USAGE.md`のpathでは列挙されなかった。

評価のAは`start`の出力を受け取っていない。そのため、context.jsonが無いことがA K7 3回目の欠落の原因だとは言えない。言えるのは次の2点である。
- 規則の列挙は、順位付けを足さなくても既存機構の設定で決定論的にできる。
- それで実作業の読み落としが減るかは未測定である。

設定の追加はproject固有契約の変更であり、本Issueの範囲（評価と採否）を越えるため、ownerの判断を待つ。なお、Pythonのscriptを追加すると`source:check`（`check_source_quality.ts`）がCIで拒否する。そのためこの種の欠落はmerge前に機械的に止まり、残存欠陥ではなく手戻りになる。

### 欠測・失敗した試行・限界

- 欠測（費用）：API課金額と、cache read／write等のtoken内訳。tokenはsubagent完了通知の`subagent_tokens`の合計で、親sessionの調整・採点・レビューの消費は含まない。課金と同一視しない。
- 欠測（Issueの評価項目）：
  - root規則とnested規則の欠落の区別。依頼文で`ROOT:`行を求めたが、runs.jsonに保存していない。また、このrepositoryにnestedの`AGENTS.md`は無い。
  - 別HEAD・別worktreeとの混同。
  - 実装・テスト・レビューまで進めた場合の開発完了率と残存欠陥。
  - 保守負担。追加機構を採用しないため、評価の対象外とした。
- 費用（subagent_tokens）：
  - 採点した42回で2,167,535。
  - 最初の試行（回答をfileへ書き出させる方式）は、14件中7件が書き出されなかったため全件を破棄した。この14件で688,452を使った。
  - 合計は2,855,987。承認された上限は「代表ケース×A/B×3回程度」で、破棄した試行の分（14回）だけそれを超えた。
- 時間：各回7件を並列に起動したため、所要時間は相互の干渉を含む参考値である。3回目は両条件ともtokenが約20%増え、時間はAが約3倍、Bが約2.6倍になった。原因は特定していない（同時に動いた別作業等）。21回の合計には、modelを確認できない1・2回目が混ざる。A・Bの比較は同じ回の中で読む。
- fixture：評価に使った作業用worktreeは、3回目の終了後に削除されていた（採点を再実行した時に判明）。42回の回答に挙がったpathは、全てcommit `ace85c03`のtreeに存在する。Cの再計算は、そのcommitのGit objectから行った。
- 採点はfile名の一致だけである。読んだ範囲の妥当性は測っていない。Phase 0で欠測とした「読み落としによる手戻り」を、代表ケースの読取りに限って代わりに測ったものである。
- 標本：fixtureは1 repository（JavaScript／TypeScript、文書中心）で、DB migration、UIとbackendの連携、複数worktreeのケースは含まない。Codex等の別Hostは調べていない。
- oracleは、独立Reviewerではなく作業者（前任agent）が実コードから作成した。
- 独立レビュー：本資料は、別Contextのsubagentが数値の再計算と記述の照合を行い、その指摘を反映した（PRに記録する）。

## Phase 0（当初の判断：保留）

### 記録

| 項目 | 値 |
| --- | --- |
| main完全SHA | `98afe3500b5e1cbeedb396434f1f8f2e6ae5ba4f` |
| ASC版 | package.json `0.5.0`（v0.5。v0.4の結果は使っていない） |
| 実行経路 | 本調査は標準Skill経路の作業worktree上。ログ集計はClaude Codeのlocal session記録を読取りだけで数えた |
| 読んだ規則 | `src/project-context.mjs`、`skills/asc/SKILL.md`、`references/implementation.md`・`coordination.md`、ADR 0002・0003・0005（`work-coordination`は参照先の確認にとどめた） |

### 適用規則の選択と、コード・根拠の内容選択は別である

`projectContext`は、変更pathのprefixと祖先の`AGENTS.md`／`CLAUDE.md`から、規約ファイルのpath・SHA256・byte数を返す決定論的な処理で、本文もコード断片も返さない。コードやテストの関連度を順位付けする機構ではなく、`authority`欄も選択が意味的遵守を示さないと明記する。したがってコード・根拠の内容選択は、現状はHostの検索と`implementation.md`の規則が担う。この責務分担は評価の前提であって、不足の証拠ではない。

`implementation.md`は、検索で位置を絞ってから必要範囲だけ読む、`gh --json/-q`で項目を絞る、巨大出力を避けて全文をworktree外へ保存する、広い調査はsubagentへ渡し結論と参照だけを返させる、を既に要求している。SKILL.md原則1も再読込みの削減を挙げている。

### 既存Issueとの照合

- #1576（CLOSED, NOT_PLANNED）：旧系統の全工程計測。成果として再利用しない。
- #1614（CLOSED）／ADR 0003：派生グラフは効果確認まで保留。本件で作り直さない。
- #1737（CLOSED）：Context切替は不採用、Semantic Projectionは実証なしに採用しない。本件は会話の切替ではなく読込み選択だが、同じく実測先行とする。
- #1755（CLOSED）：compaction後はGit／Issue／PRを再確認する。順位を再開の正本にしない。
- #1765・#1766（OPEN）：別責務。#1766の評価基盤は使っていない。

### 既存ログの集計

方法：`~/.claude/projects`配下のjsonlを、subagentの記録（`<session>/subagents/`）を親sessionへ束ねて集計した。`agent-skill-chain`または`skills/asc`の語を含むのは**6 session**（本調査のsessionを含む。subagent記録を含め約30ファイル）。読取りだけのscriptで数え、本文・path・project名はこの資料に含めない。scriptはrepoに含めない（実装言語がTypeScriptに限られ、CI検査が対象外sourceを拒否するため。#1673と同じ扱い）。Phase 1の採点scriptは、#1765の`scan-usage.mjs`と同じく、CIのsource検査（`check_source_quality.ts`）が通す`.mjs`で本directoryに置いた。最初の版はファイル単位で数えて「30 session」と誤記し、検索の判定も広すぎたため、束ね直して数え直した。

| 指標（6 session合計） | 値 |
| --- | --- |
| Read呼出し | 203（範囲指定なし160、offset/limit指定43） |
| 同一session内（親とsubagentをまたぐ）で、同じpathを2回目以降にReadした回数 | 86（42%） |
| Bash呼出し | 2,617 |
| そのうち`rg`・`git grep`・`grep`を含む呼出し | 881（出力の絞込みのgrepを含むため、位置の特定に使った数ではない） |
| Grep/Glob tool | 別に集計していない（欠測） |

token（全モデル、message id単位で重複を除いた合計）：input 7,396、output 905,405、cache read 408,922,920、cache write 17,571,901。モデル別はfable-5-1、opus-5、sonnet-5、sonnet-5-5、haiku-4-5、opus-5-5。cache readが量の大半を占める。これは各turnで会話Contextが再送される量であり、fileの再読込みの量ではなく、cache読取りを課金額と同一視しない。API費用とwall-clockは集計していない（欠測。価格・割引は比較時点のHost情報で確認が要る）。

読取れること（観測）：
- 再読込みの割合は大きく見える。ただし、編集後の確認Read、subagentが親と別Contextで同じfileを読む正当な重複、委譲に伴う重複を区別していない。
- 全文Read（範囲指定なし）が79%。
- tokenの大半はcache readであり、Context全体の滞留量に由来する。file読込みの寄与は分離できていない。

**読取れないこと（欠測）**：
- 「結果的に必要だったfile」「読み落としによる手戻り」は、元要求・差分・テスト・独立レビューから独立に決める必要があり、ログだけでは判定できない。recall・miss率・手戻りは**欠測**で、0としない。
- 再読込みやtool結果が総token・総費用に占める割合は、分離できていない。
- 標本は6 sessionで、1台のlocalログに限られる。作業種類（認可・migration・UI連携・複数worktree等）を制御しておらず、結果を一般化しない。

### 追加機構なしの改善余地

観測された改善候補は、新機構ではなく既存規則の運用の範囲にとどまる。(1)範囲指定なしのReadのうち、大きなfileの全文読取り、(2)Bash出力の絞り込み（`--json/-q`、行範囲）。いずれも`implementation.md`に既にあり、規則の追加や変更が必要と示す測定は得ていない。規則の文面を増やすと通常実行の読込みが増えるため、実害の測定なしに足さない。

### Phase 0の時点の判断（履歴）

Phase 0では、必要情報のrecall・miss率がログから測れず、ADR 0002の「具体的な失敗」も示されていないため、Phase 1へ進まず保留とした。保留の際に示した閾値案（recall 100%、security-criticalの欠落は不採用、品質が現行以下なら不採用、1ケース3回以上）と費用上限をownerが承認し、Jev等の外部送信は不可とされたため、Phase 1を実施した。Phase 0の再読込み率（42%）の必要性の分類と、費用への寄与の分離は、引き続き欠測である。

## 再評価の条件

次の場合は新しいIssueで再評価する。代表ケースと採点scriptはこのdirectoryのものを再利用できる。
- `context.json`を設定した後も、project固有規則・認可・配布在庫の読み落としが実作業で独立に記録された。
- DB migration、UI連携、複数worktree等、今回含まないケースで取りこぼしが記録された。
- 読込みの量が総費用の目立つ割合を占めると、課金の実測で示された。

## 限界

- Phase 0のログは1台のlocal記録の6 sessionで、Phase 1は1 repository・7ケース・各3回である。結果を他の言語・規模へ一般化しない。
- 「代表ケースで欠落しなかった」ことは「欠落が無い」ことを意味しない。
