# ADR 0005: Host Harness と ASC Engineering Control Layer の責務境界

2026-11-20。状態: owner が Issue #1738 で示した方針の正本化。[ADR 0002](ARCHITECTURE_DECISION_0002.md)（必要な品質を最小の仕組みで保証する）の原則を、Host との境界について具体化する。ADR 0002 と食い違う場合は ADR 0002 を優先する。

本書の「Host」は、Codex・Claude Code などの AI の Host 製品を指す。ADR 0002 の「Host で判定する」の Host は、AI ではない決定論的な実行側（ASC の Controller を含む）の意味で、本書の Host とは別である。

## 決定

ASC は汎用の Agent Harness を再実装しない。Codex・Claude Code などの Host がすでに Base Harness（Agent loop・Context・Tool 実行・Session・Sandbox・Process lifecycle）を提供している。ASC はその上に、ソフトウェア開発に固有の制御（Goal・Contract・Authority・Evidence・Review）を薄く載せる。

```text
Project Authority             Git / 要求 / Contract / CI / Project Rule / 検証済み Evidence
        ▲
ASC Engineering Control Layer Goal / Scope / Authority / Evidence / Review 契約 / 検証の方針 / worktree / Context の方針
        ▲
Host Harness                  Agent loop / Context / Tool 実行 / Session / Sandbox / Process lifecycle
        ▲
Model
```

ASC が所有するのは原則として2段目である。正本（authority）は最上段にあり、ASC も Host も Model も、それを置き換えない。

## ASC が持つ責務

1. **Engineering Goal / Contract**: Goal・要求・受入条件・範囲、Work Unit と依存などの分解契約、project 固有の契約と適用規約の参照、owner が決めた制約と許可範囲。
2. **Authority の境界**: commit・push・PR・merge・外部への副作用などの操作権限と、owner の承認の意味。モデルの出力を authority にしない。Host にできることと、ASC が許可したことを混同しない。
3. **Git / worktree の束縛**: repository・worktree・branch・base・HEAD の取り違えを防ぎ、Issue と worktree を分ける。古い HEAD に Evidence やレビューを再利用しない。
4. **Evidence 契約**: test・lint・build・CI・独立レビューなどが何を証明し、何を証明しないか。HEAD・Contract・対象への束縛。欠けた・古い・合わない Evidence を成功として扱わない。
5. **独立レビュー契約**: 実装とレビューの Context の独立、Reviewer が元要求・実差分・Evidence を自分で確かめること、重大度・是正・再レビューの条件。Reviewer の出力をそのまま事実や承認にしない。
6. **検証の選び方と開発の方針**: 変更・リスク・project 契約に応じて必要な検証を選び、最終の品質契約を弱めない。目的別の Skill を選ぶ。
7. **Context の使い方の方針**: conversation を workflow の authority にしない。親の会話全文を handoff しない。path・SHA・digest などの pointer を優先し、必要なものだけを読む。いつ新しい Context に替えると有利かの評価と方針（#1737）も含む。Host の conversation engine・compaction・session store そのものは再実装しない。
8. **派生した読み取りモデル**: 実測で必要性が示された場合に限り、Git・Contract・Evidence から作り直せる、使い捨ての read model（影響範囲・レビュー範囲・Evidence の選択の候補など）を持てる。cache を含め authority にはしない。削除しても、ASC の正しさ・再開・検証・レビュー・Delivery が成り立たなければならない。
9. **ASC 自身の評価**: 改善は「失敗や記録 → 仮説 → 対照評価（品質・token・時間）→ 採否」で決める。仕組みを作ったことを価値としない。

## ASC が原則として持たない責務

次は Host の責務とする。明確な Evidence と理由がない限り、ASC に再実装しない。

| 区分 | 持たないもの |
| --- | --- |
| 汎用の Agent runtime | agent loop、turn の scheduling、汎用の tool 呼び出し loop、model との通信・streaming、汎用の再試行、conversation engine |
| 汎用の Context runtime | context window の管理、model ごとの compaction、会話の永続化、汎用の session DB |
| 汎用の Tool runtime | shell・filesystem・browser などの汎用 executor、汎用の MCP runtime、tool protocol そのもの。ASC 固有の安全な wrapper や validator が要る場合は、薄い adapter に留める |
| 汎用の Sandbox | Host の sandbox の再実装、全 OS 向けの汎用 container・VM・cgroup の管理。ASC は必要な安全条件を定め、Host の能力を事前に確かめ、足りなければ止める（fail-closed） |
| 汎用の Subagent runtime | subagent の scheduler、汎用の worker pool、multi-agent の messaging、Host の session・Agent の識別の再実装。ASC は役割・独立性・範囲・モデル選択の方針を定める |
| 中央の共有 memory / DB | 会話を永続する中央 DB、チーム共有の Graph DB を authority にする構成、daemon・DB・migration を ASC の利用の前提にする構成 |

## 例外: ASC が runtime を持ってよい条件

「持たない」は絶対の禁止ではない。次のすべてを満たす場合に限り、例外を検討する。

1. Host に同等の能力がない。または、Host をまたいで守るべき開発上の不変条件を、Host の能力では成り立たせられない。
2. ソフトウェア開発に固有の責務である。
3. 薄い adapter では解決できない。
4. 失敗の仕方と authority の境界が明確である。
5. 対照評価で、品質が下がらず、総費用の上で価値があることを示した。
6. 新しい第二の正本を作らない。作る場合は owner が必要性を明示して承認している。
7. Host ごとの任意の経路として分けられるなら、標準経路に強制しない。

7つの条件は、今後追加する機構に適用する。**snapshot Controller は、v0.5 の受入（#1578、#1579）で owner が受け入れた既存の例外**で、この7条件での再評価はしていない。例外の主な機構は、下の表の「snapshot 経路」の列に挙げたもので、詳細は [利用手順](USAGE.md) を正とする。受入の記録が、Linux の従来の backend と `hostExecution` の backend のどちらまでを含むかは確かめていない（未確認）。owner が明示して選んだ場合だけ使い、標準の Host 経路から暗黙に切り替えない。

## 標準の Host 経路と snapshot 経路

| | 標準の Host 経路 | snapshot 経路（owner が明示して選択） |
| --- | --- | --- |
| Agent loop・Context・Tool 実行 | 利用中の Host | 起動した Host 製品（Codex CLI など）のまま。汎用の Agent runtime は、どちらの経路でも Host が持つ |
| ASC が持つ実行の機構 | Host の公式手段を呼ぶ薄い adapter（`host-session` による別 session の起動・待機上限・結果の保存）と、現在の Host 環境で検証コマンドを実行して記録する薄い CLI（`worktree-verify`） | どの backend でも、Controller が snapshot、修復の反復と実行予算、Work Unit の実行順と並列を持つ。Linux の従来の backend では、これに加えて Agent の起動と寿命の管理（systemd user service・cgroup）、sandbox の設定と起動前の確認、検証の隔離した実行、Agent の期限切れでの新しい Agent への引継ぎを持つ（`src/workflow.mjs` は Context の枯渇を表す `ASC_CONTEXT_EXHAUSTED` も同じ扱いにしているが、その code を出すコードはなく、枯渇を検出して引き継ぐ機構はない）。`hostExecution` の backend では、Agent と検証の実行・sandbox・終了の管理を owner が指定した Host へ委ね、その Host の期限切れでは新しい Agent へ自動では引き継がない。指定した Host が同梱の `bin/asc-codex-host.mjs` の場合は、その中で ASC のコードが sandbox の設定と起動前の診断、検証前の診断と依存資産の写しを行う |
| 作業場所 | 実 worktree | 隔離した snapshot |
| ASC の役割 | worktree・project context・レビュー契約・Evidence と authority の確認 | 上に加えて、隔離した実行と検証の制御 |
| 切り替え | — | `--snapshot` などの明示の選択だけ。標準経路から自動で切り替えない |

詳しい手順は [利用手順](USAGE.md) を参照する。

## 新しい機能の置き場所の判定

ASC に新しい runtime の機構を足す前に、Issue か PR で少なくとも次に答える。

| 問い | Yes なら |
| --- | --- |
| ソフトウェア開発に固有の Goal・Contract・Evidence・Review・Authority か | ASC の候補 |
| Host がすでに汎用の機構として提供しているか | Host への委譲を優先する |
| ASC は方針・validator・adapter だけで済むか | 薄い実装を優先する |
| conversation・DB・graph を新しい authority にするか | 原則として採らない |
| 実測された失敗や費用があるか | なければ、まず過去のデータでの評価（Phase 0）から |
| 対照評価で総費用と品質を比べたか | 比べていなければ製品にしない |
| Host の差を吸収するためだけの大きな抽象になっていないか | 見直す |

## 既存の判断との関係

| 判断 | 関係 |
| --- | --- |
| [ADR 0002](ARCHITECTURE_DECISION_0002.md)、#1578（v0.5 の Goal・Contract・Evidence 駆動への刷新） | 責務の境界と最小の仕組みの原則。本 ADR はその Host との境界を具体化する |
| #1579（複雑な Goal・復旧・性能の受入） | 標準の Host 経路と snapshot 経路を分けて受け入れた。本 ADR の「標準の Host 経路と snapshot 経路」の表は、その区別を責務として書いたもの |
| #1517（進行状態を repository state から再開し、context の増幅を減らす） | 「repository・workflow state が authority、conversation は使い捨て」。本 ADR の 7 に含める |
| [ADR 0003](ARCHITECTURE_DECISION_0003.md)（リポジトリ派生グラフの導入の保留） | 本 ADR の 8 と、#1737 の Semantic Projection は、ADR 0003 の再検討条件に従う |
| #1648 / [ADR 0004](ARCHITECTURE_DECISION_0004.md)（グラフ型 runtime の考え方） | ループの終了条件と明示的な状態は導入せず、判断点の宣言は保留した判断。本 ADR の「対照評価なしに製品にしない」の先例。#1737 の Adaptive-lived Context は、ADR 0004 の再検討条件と同じ採用条件で比べる |
| #1737（Adaptive-lived Context と DB レスの Semantic Projection の評価） | 本 ADR に従う。Adaptive-lived Context は 7 の方針と評価として扱い、汎用の session・context runtime は Host に残す。Semantic Projection は 8 の派生した read model の候補で、authority にせず、共有 DB を要求しない |
| #1755（CLI で sessionを終わらせずに Context を更新する） | 本 ADR の 7 に従う。CLI の進行役 session を終わらせて新しい session に任せる方式は、続きを動かす者がいなくなるため採らない。Context の更新は Host の自動 compaction に任せ、ASC は規則（`skills/asc/references/coordination.md`）と、`SessionStart` hook から呼ぶ読取り専用の `resume-context`（Host の公式手段を呼ぶ薄い adapter）だけを持つ。閾値を下げる既定の変更は、ADR 0004 と同じ採用条件で測るまで行わない。測定は、#1737 の実績（1試行 25M〜127M token、2組で約300M token）から費用が大きく、owner の判断を待つ |

## 見直す条件

- Host が、ASC の責務（Evidence の束縛・独立レビュー・authority の境界など）を Host 自身の機能として同等に提供した場合は、ASC 側の実装を薄くするか、取り除く。
- Host に必要な能力がなく、上の例外の条件をすべて満たす機構が評価で示された場合は、その機構に限って例外を認める。
- 過去の Issue の本文は正本にしない。責務の境界の正本は本 ADR とする。README は入口で、操作の手順は [利用手順](USAGE.md) にある。ADR 0002 と食い違えば ADR 0002 を優先する。
