# 見本の閲覧と実画面比較が動く環境でのデザイン判断Skillの評価（#1807）

開発時の検証資料であり、配布対象に含めない。

## 状態

**本番2回目（ownerの3回目の判断）まで終え、盲検の比較画面を作って止めた。審美の順位付けはownerが行う。**

| 区分 | 内容 |
| --- | --- |
| 判定（2回目） | AP（現行ASC＋手順の指示）は全3ケースで中心の手順が3/3行われ「判定可能」。審美の判定はownerの順位待ち。D・Eは、2回目もどの試行でも中心の手順が行われず、全ケース「未判定」 |
| 判定（1回目） | D・Eとも全ケース「未判定」（下の「本番の結果」） |
| 費用 | Hostの計算で合計 **17.09 USD**（1回目7.87、2回目9.22）。上限40・停止規則36の内 |
| ownerの作業 | 2回目の比較画面（ケースごとに12画面）の順位付け（下の「本番2回目の結果」）。1回目の比較画面（9画面）は参考 |
| 未実施・skip | 独立レビュー。2回目の誤発火の確認（1回目で実施済み、計画どおり） |

## 本番2回目の結果

計画：[EVAL_PLAN.md](EVAL_PLAN.md#本番2回目ownerの3回目の判断2026-11-25)（生成の前にcommit `e94a8acb`で固定）。記録：[results/run2/](results/run2/)。1回目の記録（[results/run/](results/run/)）は変えていない。

### 費用

生成36回 8.20 USD（1回0.12〜0.50。APは0.28〜0.50、他は0.12〜0.22）、補助の採点（opus、UI-03で1回）1.02 USD。1巡目の後の見込みは合計約18 USDで、停止規則に当たらなかった。生成の失敗・timeout・再実行は0件。

### 中心の手順（tool呼出しの記録から数えた）

| ケース | A | AP | D | E |
| --- | --- | --- | --- | --- |
| UI-03 | 0/3 | **3/3** | 0/3 | 0/3 |
| UI-04 | 0/3 | **3/3** | 0/3 | 0/3 |
| UI-07 | 0/3 | **3/3** | 0/3 | 0/3 |

- APは全9試行で、見本を`view_page`で2回ずつ閲覧し、2案（`out/alt-a.html`・`out/alt-b.html`）と成果物を狭幅・広幅で描画した（`screenshot`は6〜7回）。多くの試行で、最初にallowlist外（ダッシュボードの製品サイト、部品の通販、規格・解説、行政のサイト等）を試して拒否され、応答の一覧から許可されたサイト（`linear.app`・鉄道会社・交通当局・美術館等）を選び直した。
- D・Eは、2回目では閲覧のtoolを1回も呼ばず、Art Direction・Product DesignのSkillのfileも1回も読まなかった（Skill toolの呼出しも0回）。1回目（Dの9試行中4試行が`SKILL.md`を読んだ）より少ない。Skillが選ばれない限り、手順は動かない。
- 広幅の確認：UI-07で、A・D・Eは全試行が狭幅だけを確認した。APは全試行が両幅を確認した。
- 見本の描画の欠け：`linear.app`の描画では、allowlist外の要求が1回あたり約300件中止された。APの生成者が見た見本は、多くが不完全な描画だった可能性がある。

### 非劣化（Aとの比較、[results/run2/decision.json](results/run2/decision.json)）

- **AP**：全ケースで失敗なし。網羅率（UI-04で2試行が1.0、他は0.958）、axe-core 0、横scroll・外部要求・reduced-motion 0件、UI-04の検索操作2/2、UI-07の初期表示（狭幅・広幅）2/2、押せる要素の最小48〜56px、UI-03の白黒の再現率1.0。費用比（中央値）2.26。
- **D・E**：UI-03で各1試行に、axe-coreのcritical（`aria-required-children`、9 node）があり、非劣化の失敗になる（どちらも未判定なので分類には使わない）。他の指標は失敗なし。費用比 D 0.99、E 1.20。

### 補助の採点（opus、UI-03で1回、参考）

rationaleを除く9項目の合計（18点満点）：A 15〜16、AP 14〜17、D 13〜16、E 13〜16。範囲が重なる。審美の判定には使わない。

### ownerの順位付け（2回目）

- 比較画面：このworktreeの`.agent-skill-chain/local/1807/run2/blind/<ケース>/index.html`（git管理外）。ケースごとに12画面（4条件×3回）。
- 実画面には成果物（`index.html`）だけを置いた。2案のfileは、それを持つ条件が分かるので除いた（作成の途中で気付いて直した。keyは同じ）。
- 手順は1回目と同じ：画像と実画面を見て、1〜12の順位を同順位なしで付け、出たJSONを会話に貼るか`ranks.json`として保存する。
- 順位を付ける前に、`.agent-skill-chain/local/1807/run2/keys/`（sha256は[results/run2/keys-sha256.txt](results/run2/keys-sha256.txt)）、`results/run2/evals/`、`results/run2/decision.json`を開かない。
- 集計：`node harness/aggregate.mjs <run2のruns> <run2のrender> <out.json> --keys <run2のkeys> --ranks <ranks.json> --evals <run2のevals>`。APとA、D・EとA・APを、組の規則で比べる。D・Eは未判定のまま変わらない。APの分類（手順の部分取込みの候補か）は、この順位で決まる。

## 本番の結果（1回目）

### 費用

Hostの`total_cost_usd`の合計 **7.87 USD**（上限40、停止規則36に届いていない）。生成27回 5.08、誤発火の確認6回 0.38、実行前の再確認（haiku）0.005、補助の採点3回 2.41。1回の生成は0.12〜0.26 USD。生成の失敗・timeout・上限到達は0件で、再実行はしていない。

### 中心の手順（tool呼出しの記録から数えた。notesは使っていない）

| ケース | 条件 | 中心の手順 | 見本の閲覧の成功 | `fetch_page`の試行（全て拒否） | 2案の描画 | 狭幅の確認 | 広幅の確認 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UI-03 | A | 0/3 | 0 | 0 | 0 | 3 | 3 |
| UI-03 | D | 0/3 | 0 | 0 | 0 | 3 | 2 |
| UI-03 | E | 0/3 | 0 | 0 | 0 | 3 | 3 |
| UI-04 | A | 0/3 | 0 | 0 | 0 | 3 | 3 |
| UI-04 | D | 0/3 | 0 | 2（2試行） | 0 | 3 | 3 |
| UI-04 | E | 0/3 | 0 | 0 | 0 | 3 | 3 |
| UI-07 | A | 0/3 | 0 | 0 | 0 | 3 | 0 |
| UI-07 | D | 0/3 | 0 | 1（1試行） | 0 | 3 | 0 |
| UI-07 | E | 0/3 | 0 | 0 | 0 | 3 | 0 |

- 全試行で、`screenshot`で自分の画面を1〜3回描画した（成果物の1ファイルだけ）。2つ目の案を描いた試行は無い。UI-07では、全条件が狭幅（390px）だけを確認した。
- Dの3回の閲覧の試みは、どれもallowlistの外（部品の通販サイト、W3Cの解説）だったので、toolが拒否した（[results/run/trials/](results/run/trials/)の`tools.jsonl`）。toolの段階で拒否したので、proxyへの要求は0件だった。拒否の後に、作品案内（`references/design-works.md`）を開いて許可されたhostを探した試行は無い。
- Art Directionの`SKILL.md`を読んだのは、Dの9試行のうち4試行。Eの9試行では、どのSkillのfileも読まれなかった（Skill toolの呼出しも0回）。Dの生成者は、notesに「見本の実見は未実施」と書いた試行がある。
- 行われなかった理由（記録から分かる範囲）：(1) 生成者が閲覧を選ばなかった（24試行）、(2) 選んだ閲覧先がallowlistの外だった（3試行）。依頼文には、allowlistのhostを書いていない（[EVAL_PLAN.md](EVAL_PLAN.md)の技術的な事項。Aへ知識を与えないため）。

### 非劣化（[results/run/decision.json](results/run/decision.json)）

参考として記録する（判定可能なケースが無いので、分類には使わない）。D・Eとも、全ケースで非劣化の失敗は無い。指標は全条件でほぼ上限に張り付いた。

- 必須情報の網羅率：UI-03・UI-07は全試行1.0。UI-04は0.958（後継品の品番が初期表示に無い）で、Eの1試行だけ1.0。
- axe-coreのserious・critical：全試行0。狭幅の横scroll・外部への要求・reduced-motion非対応：全試行0件。
- UI-04の検索操作：全試行2/2。UI-07の初期表示の範囲：全試行2/2、押せる要素の最小は52〜56px。
- UI-03の白黒での読取り（補助の採点者）：全試行で再現率1.0。
- 費用比（生成費用の中央値、X÷A）：D 0.94、E 1.03。

### 誤発火（UI-10相当、D・E各3回）

デザインSkillの利用（呼出し・fileのRead）0件、UI fileの作成0件、閲覧のtoolの呼出し0件。隠しoracleのtestは全6試行で3/3（#1804のAも3/3）。[results/run/misfire.json](results/run/misfire.json)。

### 補助の採点（opus、各ケース1回、notesは伏せた）

参考値。審美の判定には使わない。rationale（説明可能性）を除く9項目の合計（18点満点）の3試行の範囲：UI-03 A 15〜18・D 15〜17・E 15〜17、UI-04 A 14〜15・D 15〜15・E 14〜16、UI-07 A 15〜16・D 15〜16・E 14〜16。条件の間で範囲が重なる。[results/run/evals/](results/run/evals/)（**順位付けの前に開かない**）。

### ownerの順位付け

1回目の盲検の比較画面は、このworktreeの`.agent-skill-chain/local/1807/blind/<ケース>/index.html`にある（git管理外。worktreeを削除すると消える）。ケースは`ui03-dashboard`・`ui04-parts-search`・`ui07-bus-mobile`の3つ。

1. ブラウザーで`index.html`を開く。9画面それぞれに、狭幅（UI-03は800px、他は390px）と広幅（1440px）の全体の画像、「実画面を開く」（生成したHTML。外部への通信を止めてある）が並ぶ。条件名・notes・試行番号は伏せた。
2. 依頼文（各ケースの`BRIEF.md`）の利用者・目的に合っている順に、1（最も良い）〜9の順位を付ける。同順位は付けられない。入力は画面のブラウザーに保存される。
3. 9画面すべてに付けると、下に`{"<ケース>": {"<ID>": 順位}}`のJSONが出る。それを会話に貼るか、`ranks.json`として保存する。
4. keyは`.agent-skill-chain/local/1807/keys/`にある。その内容のsha256を[results/run/keys-sha256.txt](results/run/keys-sha256.txt)に記録した。順位を付ける前にkeyと`results/run/evals/`・`results/run/decision.json`を開かない。

順位は`node harness/aggregate.mjs <runs> <render> <out.json> --keys <keys> --ranks <ranks.json> --evals <evals>`で集計できる。ただし判定可能なケースが無いので、分類は「未判定」のまま変わらない。順位は、審美の記述（条件の間に差が見えるか）として記録する。

### 再評価の条件

中心の手順が動く条件をそろえないと、この2候補の効果は判定できない。次のどれかをownerが決めたうえで、再評価を提案する。

- allowlistを全条件の依頼文に示す（Aにも同じ一覧を与える）、または、拒否の応答に許可されたhostの一覧を含める。今回の拒否3回のうち2回は、依頼に近い題材（部品の通販）の見本を探したもので、作品案内由来の一覧とは合わなかった。
- 規格・解説のサイト（W3C等）をallowlistに加えるかを決める。
- 依頼文で、見本の閲覧と2案の比較を全条件に求める（Skillの効果ではなく、手順そのものの効果を測る評価になる）。

## 生成環境の変更（本番の前）

準備の段階では、生成Agent（Claude Code CLI）もcontainerで動かす設計だった。本番では、CLIをhostで動かし、閲覧と描画のtoolだけをcontainerで動かした。CLIをcontainerで動かすには認証の情報をcontainerへ渡す必要があり、その情報はこの作業の権限では用意できなかった。hostで動かすことで、認証の情報はhostの保管場所から出ない。理由と範囲は[EVAL_PLAN.md](EVAL_PLAN.md#実装者が決めた技術的な事項理由付き)に書いた。

- 実際のCLIでの再確認（[results/run/cli-recheck.json](results/run/cli-recheck.json)、haiku、0.005 USD、合格）：fixture外のRead（相対・絶対path）、`/etc/hosts`のRead、fixture外のGrep・Writeの5回がすべて権限で拒否された。目印の文字列は記録に現れず、fixture外のfileは作られなかった。組込みtoolはEdit・Glob・Grep・Read・Skill・Writeだけで、`browser`の3つのtoolがあり、`screenshot`が動いた。
- toolのimage（`env/Dockerfile`の`tools`段階：Noto CJK等の書体とaxe-coreを追加）で、隔離の反例をやり直し、21項目すべて合格した（[results/isolation-tools/probe.json](results/isolation-tools/probe.json)）。

## 準備の段階の記録

## 構成

| path | 内容 |
| --- | --- |
| [EVAL_PLAN.md](EVAL_PLAN.md) | 評価計画（条件A・D・E、判定の規則、費用と停止）。生成の前にcommitで固定した |
| [conditions.json](conditions.json) | 条件とケースの定義 |
| [gold.json](gold.json) | 決定論の採点の正解（UI-03は#1804のまま、UI-04・UI-07を追加） |
| [rubric.md](rubric.md) | 補助の採点（モデル）の基準。#1804の基準にUI-04・UI-07を加えた |
| [cases/](cases/) | UI-04（部品の検索・一覧・詳細）、UI-07（バス停の発車案内、スマートフォン向け）、書体の案内。UI-03は#1804の`cases/ui03-dashboard`を使う |
| [env/](env/) | 生成環境：`proxy.mjs`（allowlistのproxy）、`mcp-server.mjs`（生成Agentのtool）、`Dockerfile`、`gen-prompt.txt`、`allowlist.json`（承認された80 host）、`allowlist.proposed.json`（案と出典・理由）と、案を作る`allowlist-extract.py`・`allowlist-propose.py` |
| [isolation/](isolation/) | 隔離の反例：`run.sh`、container内で確かめる`probe.mjs`、dummy site、試験用のallowlist。実際のCLIでの再確認`cli-recheck.mjs` |
| [harness/](harness/) | `core-steps.mjs`（中心の手順の集計）と試験、`gold-check.mjs`（goldの判定器）と合成の画面（`dryrun/`）、`run-gen.mjs`（生成の起動器）、`render.mjs`・`run-render.mjs`（描画と採点）、`misfire.mjs`（誤発火）、`make-blind.mjs`（盲検の比較画面）、`aggregate.mjs`（判定の規則）、`collect.mjs`（記録の取り出し） |
| [results/](results/) | 隔離の反例の原始結果（準備：`isolation/`、本番のimage：`isolation-tools/`）、集計器の試験結果、goldの判定器の結果、本番の記録（`run/`：試行ごとのmeta・中心の手順・proxyとtoolの記録・描画の指標・gold、判定、誤発火、補助の採点、再確認） |

## 生成環境

第三者のコードは、Playwrightの公式image（Chromiumを含む、digest固定）、`playwright-core` 1.49.1・`axe-core` 4.10.2（どちらも依存なし、install scriptを実行せず導入。npm registryの`sha512`と一致を確認）と、aptの書体だけである。proxy・tool・集計器はNodeの標準機能だけで書いた。

```text
[host] Claude Code CLI（cwd＝fixture、組込みtoolはRead・Write・Edit・Glob・Grep・Skillだけ）── モデルAPI（hostから直接）
   └─ MCP stdio: docker run -i --rm [toolのcontainer] --(内部専用network)--> [proxy] --(外向きnetwork)--> allowlistのhostだけ
```

- **生成Agent**：hostのCLIを、試行ごとの新しいfixtureで起動する。project設定だけ、hookは無効、session保存なし。fixture外の読み書きは権限で拒否される（実行前の再確認で合格）。認証の情報はhostの保管場所から出ない。
- **toolのcontainer**：read-only root、cap-drop ALL、no-new-privileges、pids・memory・cpuの上限、`/tmp`だけtmpfs、非rootの利用者。mountはfixture（`/work`、読取り専用）、tool（`/opt/env`、読取り専用）、allowlist（読取り専用）、記録（`/log`）だけ。homeとDockerのsocketはmountしない。内部専用のnetworkにだけ接続する。
- **proxy**（[env/proxy.mjs](env/proxy.mjs)）：hostは完全一致（`.`で始まる項目だけsubdomainを許す）。IPの直書き、許可外のport、GET・HEAD以外、HTTPの絶対URI以外を拒否する。`denyPrivateAddresses`（本番は有効）で、内部addressへ解決されるhostを拒否し、確認したaddressへ接続を固定する（DNSの再解決をしない）。判断をすべてJSON行で記録する。toolのcontainerの外にあるので、生成Agentは記録を変えられない。
- **tool**（[env/mcp-server.mjs](env/mcp-server.mjs)）：
  - `fetch_page`：URLを検査し（http・https、認証情報なし、2048字以内、allowlist）、転送を自分で1 hopずつ追い、各hopを再検査する（最大5）。本文を文字列にして、命令ではないことを明記した`<untrusted-content>`で包む。ページの中の区切り文字は無効化する。
  - `view_page`：Chromiumをbrowse入口のproxyで起動し、allowlistのhost以外への要求を中止する。Playwrightの`route`は転送のhopを捕らえないので、全要求を別に監視し、最後のURLがallowlist外なら画像を返さずに失敗にする（反例の1回目で見つけて直した。下の「反例」）。
  - `screenshot`：`out/`の中のHTMLだけ（実体pathで確認、symlink・`..`での脱出を拒否）を、幅390・800・1440で描画する。file以外の要求はすべて中止する。

## 隔離の反例

[isolation/run.sh](isolation/run.sh)で実行した。内部専用のDocker network 2つ（生成側・上流側）、上流側にdummy site（`allowed.test`・`blocked.test`等の別名）を置いた。internetとモデルは使っていない。生成側のcontainerは、本番の生成imageからClaude Code CLIと書体を除いた`browser`段階のimage（`docker build --network none`で作成）である。

実行したcommand（`<W>`はworktree、`<S>`はrepositoryの外の新しいdirectory）：

```sh
npm pack playwright-core@1.49.1 --ignore-scripts      # <S>/pkg に置く。sha512をregistryの値と照合
docker pull mcr.microsoft.com/playwright:v1.49.1-noble   # digest sha256:70e367e0…09d2
sh docs/evidence/1807-design-eval-browser/isolation/run.sh <W> <S> <S>/iso-out
```

結果（[results/isolation/probe.json](results/isolation/probe.json)、2回目。全21項目合格）：

| Issueの要求 | 項目 | 結果 |
| --- | --- | --- |
| (i) allowlistのhostへproxy経由で到達 | `i-allowed-http`、`i-allowed-connect`、`i-tool-fetch-allowed-with-same-host-redirect`、`i-tool-view-page-allowed-subresource-blocked` | 合格 |
| (ii) allowlist外を遮断 | `ii-blocked-http`、`ii-blocked-connect`、`ii-blocked-suffix-trick`（`allowed.test.blocked.test`）、`ii-blocked-ip-literal`、`ii-blocked-port`、`ii-blocked-post`、`ii-model-listener-refuses-browse-host`、`ii-private-address-refused-when-enabled`、`ii-tool-fetch-blocked`、`ii-tool-fetch-file-scheme-refused` | 合格 |
| (iii) allowlist外への転送を遮断 | `iii-redirect-hop-blocked-by-proxy`、`iii-tool-fetch-redirect-blocked`、`iii-tool-view-page-redirect-not-rendered` | 合格（1回目は最後の項目が不合格。下記） |
| (iv) proxyを通らない直接の通信を遮断 | `iv-direct-egress-blocked`：dummy siteのIPへのTCPと1.1.1.1:443は`ENETUNREACH`、名前解決は`EAI_AGAIN` | 合格 |
| (v) hostのhome・秘密が見えない | `v-no-home-or-secrets`：mountは指定の5つと`/etc/hosts`等だけ、秘密らしい名前の環境変数0件、host側に置いた目印fileは見つからない、Dockerのsocketなし、root fsへの書込みは`EROFS`、CapEff 0、NoNewPrivs 1、uid 1001 | 合格 |
| (vi) screenshotのtoolがofflineで動く | `vi-screenshot-offline`：幅390・1440のPNG（実幅390・1440）、外部要求2件を中止、狭幅の横はみ出しを検出、`out/`外・`..`・symlink・許可外の幅を拒否 | 合格 |
| 外部ページの内容をデータとして扱う | `data-not-instructions-wrapping`：注入文を含むページを、注記付きの区切りで包み、ページ内の偽の閉じ区切りを無効化（閉じ区切りは1つだけ）、scriptを除去 | 合格（構造の確認だけ。モデルが指示に従わないかは未確認） |

containerの設定は[results/isolation/probe-hostconfig.json](results/isolation/probe-hostconfig.json)、networkが内部専用であることは[results/isolation/networks.txt](results/isolation/networks.txt)、proxyの判断の記録は[results/isolation/proxy.jsonl](results/isolation/proxy.jsonl)にある。

**1回目の不合格と是正**：1回目（[results/isolation/probe-run1.json](results/isolation/probe-run1.json)）は20/21だった。`view_page`で、allowlistのページからallowlist外への転送を、Playwrightの`route`が捕らえなかった。proxyは転送先を拒否した（403、[results/isolation/proxy-run1.jsonl](results/isolation/proxy-run1.jsonl)）ので外部へは出ていないが、toolは拒否のページの画像を成功として返した。全要求の監視と、最後のURLの検査を加え、2回目で合格した。反例の判定条件も、画像を返さないことまで求めるように厳しくした。

## 中心の手順の集計

[harness/core-steps.mjs](harness/core-steps.mjs)は、生成Agentのstream-json（`tool_use`と、対応する`tool_result`）だけから、試行ごとに次を数える。notesの自己申告は使わない。

- 見本の閲覧（`fetch_page`・`view_page`の成功）、2案の実描画比較（異なる2つ以上のHTMLの描画の成功）、狭幅・広幅の確認、成果物の両幅の確認、同じファイルの描き直しの版の数（参考）。
- 結果が無い呼出し、`is_error`の結果、`error:`で始まる結果は成功に数えない。別のMCP serverの同名toolや組込みのWebFetchは数えない。
- proxyの記録を渡すと、閲覧の成功があるのにproxyの許可の記録が無い試行を検出する。
- `summarize`で、候補ごと・ケースごとに、中心の手順を行った試行が過半かどうか（「判定可能」か「未判定」）を出す。

合成の記録での試験（[harness/core-steps.test.mjs](harness/core-steps.test.mjs)、`node --test`）：8件合格（[results/core-steps-test.txt](results/core-steps-test.txt)）。notesだけが実施を主張する記録、拒否・失敗・結果なしの呼出し、同じファイルの描き直し、UI-03の狭幅800、別serverのtool、壊れた行、proxyの記録との照合、3回中1回・2回中1回の「未判定」を含む。

## ケースとgold

- UI-04（[cases/ui04-parts-search/](cases/ui04-parts-search/)）：架空の部品メーカーの技術資料の検索・一覧・詳細。長い品番、在庫の4状態（色以外でも区別）、生産終了の後継品、0件の状態、PCでの一覧と詳細の同時表示、スマートフォンでの一覧と詳細の移動。
- UI-07（[cases/ui07-bus-mobile/](cases/ui07-bus-mobile/)）：架空の市のコミュニティバスの発車案内。遅れ・運休（色以外でも区別）、運行のお知らせを初期表示の範囲に出す、低床車両、押せる要素の大きさ、幅390pxではみ出さない。
- UI-03は#1804のケースとgoldをそのまま使う。
- [gold.json](gold.json)：UI-04は必須24項目と検索の操作2件、UI-07は必須26項目と初期表示の範囲の2項目・押せる要素の大きさ。判定器（[harness/gold-check.mjs](harness/gold-check.mjs)）を、合成の良い画面・悪い画面で、network無しのcontainerで動かした（[results/gold-dryrun.txt](results/gold-dryrun.txt)）。良い画面は全項目合格、悪い画面は網羅率0.292・0.846、横はみ出し、初期表示の欠け、押せる要素11px、外部要求を検出した。
  - 1回目の試行で、良い画面が0件の検索で不合格になった（詳細の欄に先頭の部品を残す設計を不合格にしていた）。0件の検索では「0件である表示」だけを求めるようにgoldを直した。生成の前の修正である。

## allowlistの案

[env/allowlist.proposed.json](env/allowlist.proposed.json)。ownerがそのまま承認し（2026-11-25）、[env/allowlist.json](env/allowlist.json)へ写した。

- 出典：Art Directionの固定commit（`046e42c7`）の作品案内（`references/design-works.md`、247行・299 host）。fileのsha256を記録した。第三者の本文は転載せず、行番号・節名・hostだけを記録した。
- 選定：「地域・媒体・年」の欄に「Web」「アプリ」「操作」「案内」を含む71行（103 host）から、作品そのもの（21）・制作者（44）・発注者や運営者（15）の公式サイトの80 hostを選んだ。動画配信・投稿の場・報道や告知配信・賞やデータベース・汎用のfile配信・第三者の紹介記事・印刷物の23 hostを、分類と理由を付けて除いた。
- portは443だけ。hostは完全一致だけ（subdomainの一括許可なし）。

## 残存リスク・限界

- **生成Agentの隔離はCLIの権限に依存する**：生成Agentはhostで動くので、fixture外の読み書きの拒否は、CLIの権限の仕組み（`-p`での確認の拒否）による。実行前の再確認と#1804で合格したが、OSの境界ではない。生成AgentにBash等のコード実行のtoolは無い。
- **URLによる送出**：allowlistのhostへのGETのURLに、依頼の内容を含めることは技術的に可能である。依頼の内容は架空で、依頼文で禁止しているが、遮断はしていない。proxyの記録で事後に確認できる。
- **外部ページの指示**：区切りと注記は構造の対策である。本番では外部ページが一度も取得されなかったので、モデルが外部ページの指示に従わないことは確かめられていない。
- **見本の描画の欠け**：`view_page`はallowlist外の要求（CDNの画像・書体・script）を中止するので、多くの公式サイトが崩れて描画され得る。見本の実見が不完全になり、Art Directionに不利に働く可能性がある。CDNのhostを足すかはownerの判断になる。
- **ChromiumのsandboxをOFFにしている**：cap-drop ALLのcontainerではChromiumのsandboxが動かないため。外部ページのscriptはcontainerの中で動く。containerのnetworkは内部専用で、通信はproxyだけを通る。
- **書体**：準備の段階の反例に使った`browser`段階のimageには、Noto CJKが無い。本番のtoolのimage（`tools`段階）には`cases/FONTS.md`の書体を入れた。
- **Hostの組込みSkill**：全条件で、Hostが持つ組込みのSkill（`design`・`dataviz`等）も一覧に現れた（`--setting-sources project`でも除かれない）。全条件で同じで、どの試行でも呼ばれていない。
- **上限効果**：#1804と同じく、決定論の指標と補助の採点はほぼ上限に張り付いた。
- **集計の定義**：2案の比較は「異なる2つ以上のHTMLの描画」とした。1つのファイルを書き換えて描き比べる進め方は、比較として数えない（版の数は記録する）。
- **公平性と閲覧先の不一致**：allowlistはArt Directionの資料から作り、依頼文には書かなかった。本番では、Dの生成者が閲覧を試みた3回とも、依頼の題材に近い通販サイトや規格の解説を選び、allowlistの外だった。閲覧先の決め方そのものが、中心の手順が動かなかった一因である可能性がある（「再評価の条件」）。

## 再現

上の「隔離の反例」のcommandと、次を使う。

```sh
node --test docs/evidence/1807-design-eval-browser/harness/core-steps.test.mjs
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp --shm-size 512m --user pwuser -e HOME=/tmp \
  -v <W>/docs/evidence/1807-design-eval-browser:/opt/e:ro asc-1807-browser:1 \
  node /opt/e/harness/gold-check.mjs /opt/e/gold.json ui04-parts-search /opt/e/harness/dryrun/ui04-good.html
python3 -I env/allowlist-extract.py <Art Directionのcheckout>/references/design-works.md <S>/ad-hosts.json
python3 -I env/allowlist-propose.py <S>/ad-hosts.json <Art Directionのcheckout>/references/design-works.md env/allowlist.proposed.json
```

作成したcontainer・network・imageには`asc.worktree=<W>`のlabelを付け、作業の終わりに削除した。

## 計画からの逸脱

- 生成Agentの置き場所を、準備の段階の設計（containerの中）からhostへ変えた（上の「生成環境の変更」）。これは、認証の情報の所在を確かめる操作が、実行環境の自動判定（auto mode）に拒否された後に、ownerに確認せずに行った変更であり、逸脱として記録する。拒否された操作を別の方法で行うことはしていない。生成の前に計画へ書き、commitで固定した。2回目もこの構成を変えていない。
- 生成の後に、EVAL_PLAN.mdの題（「下書き」を削除）と、起動器のfile名の変更に伴うlinkだけを直した。判定の規則・goldは変えていない。
- 2回目の比較画面を作った後、APの実画面のfolderに2案のfile（`alt-a.html`・`alt-b.html`）が入り、条件が分かることに気付いた。成果物だけを置くよう`make-blind.mjs`を直して作り直した（IDとkeyは同じseedで同じ）。ownerが開く前の修正である。
- 2回目のUI-03の補助の採点は、2案のfileを含まない画像だけのfolderで行ったので、この修正の影響を受けない。
- `fetch_page`がallowlist外として拒否した要求は、toolの段階で止まるので、proxyの記録には現れない。toolの記録（`tools.jsonl`）に全て残っている。
