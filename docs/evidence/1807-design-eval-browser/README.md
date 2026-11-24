# 見本の閲覧と実画面比較が動く環境でのデザイン判断Skillの評価（#1807、準備）

開発時の検証資料であり、配布対象に含めない。

## 状態

**準備の段階**。Issueの「承認までは、環境の構築、隔離の反例、ケースとgoldの準備（モデルの有料実行を除く）を進められる」の範囲だけを行った。モデルは一度も呼んでいない。containerからinternetへは一度も通信していない。

| 区分 | 内容 |
| --- | --- |
| 済み | 生成環境（proxy・tool・container構成）の実装、隔離の反例（21項目すべて合格、内部networkとdummy siteで、モデル・internetなし）、tool呼出しの記録から中心の手順を数える集計器と合成の記録での試験（8件合格）、UI-04・UI-07のケースとgold、goldの判定器と合成の画面での区別の確認、評価計画の下書き、allowlistの案 |
| ownerの判断済み | 閲覧の許可範囲の方針、人の評価の方法、試行数・ケース（27生成）、費用の上限（40 USD）。Issue #1807のコメント（2026-11-25）。[EVAL_PLAN.md](EVAL_PLAN.md)に反映した |
| ownerの確認待ち | allowlistの具体的な一覧（[env/allowlist.proposed.json](env/allowlist.proposed.json)、80 host）、誤発火（UI-10相当）の追加生成、生成imageの作成時の通信、実行前の隔離の再確認（haiku 1回）、実行の許可。推奨は[EVAL_PLAN.md](EVAL_PLAN.md#ownerに確認したい残りの事項) |
| 未実施 | 生成・評価のすべて（有料のモデル実行）。生成image（Claude Code CLIと書体を含む段階）の作成。#1804の描画器（axe-core・keyboard・reduced-motion）のUI-04・UI-07への対応。独立レビュー |

## 構成

| path | 内容 |
| --- | --- |
| [EVAL_PLAN.md](EVAL_PLAN.md) | 評価計画の下書き（条件A・D・E、判定の規則、費用と停止） |
| [conditions.json](conditions.json) | 条件とケースの定義 |
| [gold.json](gold.json) | 決定論の採点の正解（UI-03は#1804のまま、UI-04・UI-07を追加） |
| [rubric.md](rubric.md) | 補助の採点（モデル）の基準。#1804の基準にUI-04・UI-07を加えた |
| [cases/](cases/) | UI-04（部品の検索・一覧・詳細）、UI-07（バス停の発車案内、スマートフォン向け）、書体の案内。UI-03は#1804の`cases/ui03-dashboard`を使う |
| [env/](env/) | 生成環境：`proxy.mjs`（allowlistのproxy）、`mcp-server.mjs`（生成Agentのtool）、`Dockerfile`、`mcp.json`、`gen-prompt.txt`、`allowlist.json`（閲覧先は空）、`allowlist.proposed.json`（案）と、案を作る`allowlist-extract.py`・`allowlist-propose.py` |
| [isolation/](isolation/) | 隔離の反例：`run.sh`、container内で確かめる`probe.mjs`、dummy site、試験用のallowlist |
| [harness/](harness/) | `core-steps.mjs`（中心の手順の集計）と試験、`gold-check.mjs`（goldの判定器）と合成の画面（`dryrun/`）、`run-gen-docker.mjs`（生成の起動器。未実行） |
| [results/](results/) | 隔離の反例の原始結果、集計器の試験結果、goldの判定器の結果 |

## 生成環境

第三者のコードは、Playwrightの公式image（Chromiumを含む、digest固定）と`playwright-core` 1.49.1（依存なし、install scriptなし。npm registryの`sha512`と一致を確認）だけである。proxy・tool・集計器はNodeの標準機能だけで書いた。

```text
[生成container] --(内部専用network)--> [proxy] --(外向きnetwork)--> allowlistのhostだけ
  Claude Code CLI ── HTTPS_PROXY ──> :3128 model入口（CONNECTだけ、モデルAPIのhostだけ）
  tool（MCP stdio）── 明示 ──────> :3129 browse入口（CONNECT・GET・HEAD、閲覧allowlistだけ）
```

- **生成container**：read-only root、cap-drop ALL、no-new-privileges、pids・memory・cpuの上限、`/tmp`だけtmpfs、非rootの利用者。mountはfixture（`/work`）、tool（`/opt/env`、読取り専用）、allowlist（読取り専用）、記録（`/log`）だけ。homeとDockerのsocketはmountしない。認証の情報は、実行時に`--env-file`（repositoryの外のfile）で渡す。組込みtoolは`Read,Write,Edit,Glob,Grep,Skill`だけ（Bash・WebFetch・WebSearchなし）。
- **proxy**（[env/proxy.mjs](env/proxy.mjs)）：hostは完全一致（`.`で始まる項目だけsubdomainを許す）。IPの直書き、許可外のport、GET・HEAD以外、HTTPの絶対URI以外を拒否する。`denyPrivateAddresses`（本番は有効）で、内部addressへ解決されるhostを拒否し、確認したaddressへ接続を固定する（DNSの再解決をしない）。判断をすべてJSON行で記録する。生成containerの外にあるので、生成Agentは記録を変えられない。
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

[env/allowlist.proposed.json](env/allowlist.proposed.json)（**ownerの確認待ち。`env/allowlist.json`には未反映**）。

- 出典：Art Directionの固定commit（`046e42c7`）の作品案内（`references/design-works.md`、247行・299 host）。fileのsha256を記録した。第三者の本文は転載せず、行番号・節名・hostだけを記録した。
- 選定：「地域・媒体・年」の欄に「Web」「アプリ」「操作」「案内」を含む71行（103 host）から、作品そのもの（21）・制作者（44）・発注者や運営者（15）の公式サイトの80 hostを選んだ。動画配信・投稿の場・報道や告知配信・賞やデータベース・汎用のfile配信・第三者の紹介記事・印刷物の23 hostを、分類と理由を付けて除いた。
- portは443だけ。hostは完全一致だけ（subdomainの一括許可なし）。

## 残存リスク・限界

- **認証の情報**：生成containerの環境変数に、モデルAPIの認証の情報を置く。生成AgentにBashは無いが、Readで`/proc`を読めれば見える。fixture外のReadは、CLIの権限の仕組み（`-p`での確認の拒否）で拒否される想定で、#1804では確認したが、このimageの実際のCLIでは未確認。実行前の再確認を計画に入れた。漏れても送れる先はallowlistのhostとモデルAPIだけだが、URLに含めて送ることはproxyでは防げない。
- **URLによる送出**：allowlistのhostへのGETのURLに、依頼の内容を含めることは技術的に可能である。依頼の内容は架空で、依頼文で禁止しているが、遮断はしていない。proxyの記録で事後に確認できる。
- **外部ページの指示**：区切りと注記は構造の対策で、モデルが外部ページの指示に従わないことは確かめていない（モデルを呼んでいない）。
- **見本の描画の欠け**：`view_page`はallowlist外の要求（CDNの画像・書体・script）を中止するので、多くの公式サイトが崩れて描画され得る。見本の実見が不完全になり、Art Directionに不利に働く可能性がある。CDNのhostを足すかはownerの判断になる。
- **ChromiumのsandboxをOFFにしている**：cap-drop ALLのcontainerではChromiumのsandboxが動かないため。外部ページのscriptはcontainerの中で動く。containerのnetworkは内部専用で、通信はproxyだけを通る。
- **書体**：反例に使った`browser`段階のimageには、Noto CJKが無い（IPAゴシック等だけ）。生成imageでは`cases/FONTS.md`の書体を入れる計画である。
- **集計の定義**：2案の比較は「異なる2つ以上のHTMLの描画」とした。1つのファイルを書き換えて描き比べる進め方は、比較として数えない（版の数は記録する）。
- **公平性**：allowlistはArt Directionの資料から作ったので、Aは閲覧先を知らない。これはSkillの持つ知識の効果として測る対象であり、計画に理由を書いた。

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
