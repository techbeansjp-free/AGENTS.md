# Adaptive rotationの測定計画（Issue #1737 Phase 1）

2026-11-20。この計画は試行の前にcommitし、結果を見た後に閾値・条件・判定を変えない。例外は下の改訂1（scenarioの変更）で（この文と次の「除外しない」の例外は、2026-11-21に結果の後で追記した。閾値・条件・判定は変えていない）、前提条件の不成立を受けたownerの決定により、比較する試行の前にcommitした。閾値と採用条件は変えていない。

## 範囲

ownerは2026-11-20に、Phase 1を次の2条件で行うと決めた（案B）。

- **baseline**：1つの進行役sessionを段階ごとに再開して続ける（ADR 0004と同じ）。
- **adaptive**：baselineと同じく続けるが、次の切替え規則が成り立った段階の境界でだけ、新しいsessionへ引き継ぐ。

固定rotation（ADR 0004の`state`）は再実施しない。ADR 0004の結果を歴史的な対照とする。Semantic Projectionは、adaptiveが採用条件を満たした場合だけ、別の試行で評価する。

## 条件

- harness：`phase1-run.mjs`の`baseline`・`adaptive`、scenario `xl`。
- scenario `xl`：fixtureの4つの写し（`complex/`〜`complex4/`）を順に渡す16段階。2つ目以降は、前の写しが終わった後に新しいIssueとして渡す。3段階目で与えるowner制約（commitの末尾に`Refs: #<Issue>`）を最後まで守るかを測る。
- model：Codex CLI 0.169.0、`gpt-6.1-sol`、effort medium。全試行で同一。
- 実行環境：macOSのhostモード。ADR 0004（Linuxのhostモード、Codex CLI 0.166.0-alpha.5.1）と環境が違うため、数値はこの試行の中だけで比べる。
- macOSの`/usr/bin/git`はCommand Line Toolsを要するshimで、sandboxの既定はその読取りを拒否する。harnessは評価用に限り、その読取りを許し、実体のgitをPATHの先頭に置く。この対処の前の動作確認（4段階、毎境界で引継ぎ）では、Agentがgitを使えずNodeでcommitを組み立てていた。その記録は試行に含めない。また、login shellはpath_helperでsandboxが拒否するdirectoryをPATHの先頭に置き、ASCの`start`がgitを起動できずEPERMで失敗したので、`allow_login_shell=false`を指定する。この不具合で止めた1回目のbaseline（1段階目まで）も試行に含めない。
- Codexは`--ignore-user-config`でも`CODEX_HOME`の`AGENTS.md`（ownerの個人規約）を読み込む。両条件に同じく効くので、そのままにする。
- 順序：baseline・adaptive・adaptive・baselineの2組。1試行ずつ順に実行する。
- 欠測・失敗した試行も除外しない。例外は、上記の環境の不具合で試行を始められなかった記録（動作確認と、1段階目で止めたbaseline）で、理由とともに結果に残す。

## 切替え規則

段階が完了した時点（その段階のoracleが合格し、作業treeが空で、成果がcommitされている）を自然な境界とする。最後の段階を除き、その境界で進行役sessionの直前の呼出しの入力tokenが **100,000以上** なら引き継ぐ。

- 引継ぎでは、終わるsessionを1回だけ再開し、状態ファイルに有効なowner制約と、完了したIssueとそのcommit SHAを記録させる。本文の要約やコードは書かせない。この呼出しの費用と時間は合計に含める。
- 次の段階は新しいsessionで始め、状態ファイルを最初に読ませる。状態ファイルの目標と許可は、試行の開始時にstate条件と同じ内容をharnessが書く。
- 閾値100,000の根拠：ADR 0004の`state`では、新しいsessionの呼出しは1回あたり平均約45kで、呼出し回数はbaselineの1.52倍だった。続ける場合の1回あたりの入力がおよそ45k×1.52≒69kを超えると、作り直す方が呼出し1回分あたり安くなる見込みになる。引継ぎの1回分の費用と、段階の途中でcontextがさらに増えることを考え、境界での切替えはその約1.5倍の100kとした。この値は評価用であり、製品の仕様ではない。

## 前提条件

ADR 0004の再検討条件は、baseline側の進行役の平均入力contextが130k以上であることを求める。1回目のbaselineで平均が130k未満なら、この規模では再検討条件を満たさないと記録して、残りの試行を行わない。

## 採用条件（ADR 0004と同じ）

1. 処理tokenの中央値がbaselineの80%以下。
2. 2組ともadaptiveの処理tokenがbaselineより少ない。
3. 所要時間の中央値がbaselineの120%以下。
4. 品質がbaselineに劣らない。
   - 全oracleの合格。
   - owner制約を守ったcommitの数。
   - owner所有のfile（要件・oracle・AGENTS.md）をAgentが変更していない。
   - Git管理状態の照合の一致。
   - 停止・実行失敗の数。

条件1〜3を満たした場合だけ、ADR 0004と同じく、どの試行がどちらの条件かを伏せた独立レビューを行い、未解決のHigh・Mediumを比べる。条件1〜3のどれかを満たさなければ、adaptiveは採用しないので、このレビューは行わない。

## 改訂1：scenario `xxl`（2026-11-20、`xl`の1回目のbaselineの後）

`xl`の1回目のbaselineは、進行役の平均入力が109,114で前提条件を満たさなかった（[結果](PHASE1_ADAPTIVE_RESULTS.json)）。前提条件どおり`xl`の残りの試行は行わない。ownerは2026-11-20に、段階を倍にして測り直すと決めた。この改訂は`xxl`の試行の前にcommitする。

- scenarioを`xxl`に替える。fixtureの8つの写し（`complex/`〜`complex8/`）を順に渡す32段階で、2つ目以降の渡し方とowner制約（3段階目）は`xl`と同じ。
- 切替え規則（100,000）、順序（baseline・adaptive・adaptive・baseline）、model、実行環境、前提条件（1回目のbaselineの平均が130k未満なら残りを行わない）、採用条件は変えない。
- `xl`の試行は`xxl`の比較に含めない。

## 記録する値

試行ごとに、所要時間、処理token、進行役の呼出し回数、進行役の入力の平均・中央値・p95・最大、引継ぎの回数と各引継ぎの直前の入力、引継ぎ後の最初の段階の呼出し回数、owner制約の遵守、oracle、Git管理状態の照合を記録する。
