# 長寿命Contextの再発の実測（Issue #1737 Phase 0）

2026-11-20に、owner 1名の端末にあるClaude CodeとCodexのsession記録を集計した。session記録は私的データのため、集計値だけを置く。案件名は伏せた。

## 方法

- 1つのtranscript fileを1 agentとする。期間はfileの更新日時で分けた。A：2026-10-17（v0.5.0の公開）〜11-09、B：2026-11-10以降（ADR 0004の判断の後）。どちらもv0.5の公開後である。
- Claude Code：`message.id`で重複を除いた。1回の呼出しのcontextは`input + cache_read + cache_creation`とした。
- Codex：`token_count`の`last_token_usage.input_tokens`をcontextとし、累計が変わった行だけを数えた。subagentの判別は`session_meta.source`によるもので、精度は確かめていない。
- ASCの開発は、作業directoryの名前で判別した。ASC作業用の親folderで開いたsession 2件（最大790k・534k）は「その他」に入っており、ASCの作業である可能性がある（確かめていない）。

## 結果（Claude Code）

| 期間 | agent | 最大context 130k以上 | 400k以上 | 800k以上 | cache_readのうち最大400k以上のagentの割合 |
|---|---|---|---|---|---|
| A | 4,149 | 1,592（38%） | 196 | 24 | 60% |
| B | 1,516 | 594（39%） | 77 | 8 | 58% |

- 期間Bの800k以上の8件は、すべて進行役（main）のsessionだった。130k以上の件数はsubagentの方が多い（main 123・sub 471）が、subagentの最大は800k未満だった。
- 期間Bの400k以上の77件のうち、compactionとみられる急な低下があったのは20件で、残りは大きなcontextのまま続いていた。
- 期間Bで130k以上のagentは、ASC以外の案件（5案件）に集中していた。ASCの開発と判別できたのは87 agentで、130k以上は6件、最大は721k（670回の呼出し）の1件だった。5案件でASCを使っていたかは確かめていない（未確認）。

## 結果（Codex、期間B）

318 agentのうち130k以上は118件、400k以上は6件だった。cache_readの91%を、最大400k以上のagentが占めた。

## 判断

ADR 0004の判断の後も、130k以上のcontextは再発している。ただし大半はASC以外の案件であり、ASCの利用との関係は示していない。Issueの手順に従い、Phase 1へ進む。ownerは2026-11-20に、Phase 1をbaselineとadaptiveの2条件で行うと決めた（[測定計画](PHASE1_ADAPTIVE_PROTOCOL.md)）。結果はADR 0004の追記に記録した（導入しない）。
