# 評価記録の一覧

過去の評価・検証の記録と、その結論の1行である。各記録は記載のcommit・版に対するもので、現行仕様や現在の合格証明ではない（[文書の利用範囲](../README.md)）。結論の詳細と限界は各記録を読む。

`v05/evaluation/`にある評価は、末尾の表に並べる。

| 記録 | 結論 |
| --- | --- |
| [1024-consumer-acceptance](1024-consumer-acceptance/) | consumer acceptanceの3機構（git依存の準備・packed bin・規模による出力上限）の故障注入の証跡 |
| [1106-step-chain-edges](1106-step-chain-edges/) | 旧Step chainのgateは成果物の形だけを検査し、別Issueの成果物へ入れ替えても通った（測定のみ） |
| [1509-review-repetition](1509-review-repetition/) | 同義の指摘による追加の往復は観測されず、追加機構を導入しない |
| [1541-unicode-distribution](1541-unicode-distribution/) | 配布物のUnicode（NFC/NFD）互換性の修正をLinux上の合成NFDで確認した。macOS実機は未確認 |
| [1566-claude-code-host-identity](1566-claude-code-host-identity/) | Claude Codeのagentは`agent_id`と`SendMessage`の宛先で識別でき、ASC側のagent台帳は要らない |
| [1579-acceptance-applicability](1579-acceptance-applicability/) | 既存受入の適用範囲と現行差分の回帰を固定し、#1579を終了可能と判断した |
| [1601-distribution-findings.md](1601-distribution-findings.md) | 配布物レビューの9指摘はいずれも現行sourceで対応済みで、追加の修正は不要 |
| [1622-1627-skill-workflows](1622-1627-skill-workflows/) | #1622〜#1627を現行と照合し、案内・referenceを追記し、任意Skill `tracker-issue-writing`を足した（#1627の協議Skillは任意の配置`v05/optional-skills`に分けた） |
| [1642-host-skill-sync](1642-host-skill-sync/) | Host入口の通常更新・uninstallを隔離した利用先で確認した（24ケース成功） |
| [1644-host-session-names](1644-host-session-names/) | `host-session`（開始名`自動: `、正常終了名`済: 自動: `）を追加した検証 |
| [1644-host-session-root](1644-host-session-root/) | `host-session`の起動rootを主要checkoutにし、対象worktreeと分けた修正の検証 |
| [1666-official-skill-comparison](1666-official-skill-comparison/) | 公式Skillとの匿名比較で見つかったASCの弱点2つを、1文ずつ直した |
| [1671-agent-skills-comparison](1671-agent-skills-comparison/) | agent-skillsとの匿名比較から、`user-journey-acceptance`へ2点を1文ずつ足した |
| [1673-model-decision-points](1673-model-decision-points/) | `subagent-model-selection`に、委譲時のモデルの明示と判断の節目だけの相談の文を足した |
| [1765-decision-reuse](1765-decision-reuse/) | 決定済みツール操作の再推論を省く境界機構は実装しない |
| [1767-context-read-selection](1767-context-read-selection/) | Context読込み選択の追加機構（優先順位付け・検索手順の明示）は不採用 |
| [1768-delegation-total-cost](1768-delegation-total-cost/) | 委譲の総費用の評価で改善を示せず不採用。`subagent-model-selection`は変えない |
| [1773-skill-supply-chain](1773-skill-supply-chain/) | 外部Skill・MCP設定の供給網検査（SkillSpector）は不採用 |
| [1774-security-audit-eval](1774-security-audit-eval/) | Security Audit方式の取込みは不採用（現行の独立レビューで十分） |
| [1779-context-json-eval](1779-context-json-eval/) | `context.json`による規則の読み落としの削減は不採用 |
| [1780-runtime-claim-eval](1780-runtime-claim-eval/) | Reviewerのruntime挙動の断定を減らす一文は不採用。`review-method.md`は変えない |
| [1781-orchestration-parallel](1781-orchestration-parallel/) | 限定改善を採用し、`subagent-model-selection`に1段落を足した |
| [1782-event-resume](1782-event-resume/) | 待機からの再開は既存の経路で十分で、製品は変えない |
| [1783-skill-coexistence](1783-skill-coexistence/) | 他Skillとの共存時の選択の改善は不採用。Host設定の案内だけを`v05/USAGE.md`へ足した |
| [1784-skill-diet](1784-skill-diet/) | `asc`の不要な指示の削減案は採用せず、現状維持 |
| [1785-eval-preflight](1785-eval-preflight/) | 評価の事前検査・少数試行は標準の工程として足さない（不採用） |
| [1786-doc-readability](1786-doc-readability/) | 技術文書の書き方は現行方式で十分で、製品は変えない |
| [1793-host-session-read-scope](1793-host-session-read-scope/) | `host-session claude`のReviewerの読取り範囲を、起動引数`--restricted`で限定した |
| [1800-review-read-scope-rest](1800-review-read-scope-rest/) | Codex・Claude Codeの両経路で、Reviewerの読取りを対象worktreeに限った |
| [1801-small-context-descriptions](1801-small-context-descriptions/) | 配布Skill 16件の`description`の短縮を採用した |
| [1804-design-judgment](1804-design-judgment/) | デザイン判断の4候補とMotion Atlasは、どれも採用しない |
| [1807-design-eval-browser](1807-design-eval-browser/) | 外部のデザインSkillはそのままの形では採用しない（ownerの判断） |
| [1814-skill-invocation](1814-skill-invocation/) | `project-assets`で`CLAUDE.md`の案内文を採用する条件Iが、Skillの読込みの水準を満たした |
| [1815-design-judgment](1815-design-judgment/) | デザイン判断の取込み候補は効果なしで、取り込まない |
| [1817-skill-application](1817-skill-application/) | Skill本文の改善案2つ（`asc`・`estimate-and-scope`）が採用の候補の水準を満たし、ownerが採用した（[PR #1819](https://github.com/techbeansjp-free/AGENTS.md/pull/1819)でmerge、[v0.5.110](https://github.com/techbeansjp-free/AGENTS.md/releases/tag/v0.5.110)から配布） |
| [1820-write-tools-read](1820-write-tools-read/) | ASCの本文が読まれるかを分けたのはフォルダで、toolと依頼文ではなかった（段階1） |
| [1823-slim-always-read](1823-slim-always-read/) | 毎回読む規則を縮めた案は採用しない |
| [1828-warranty-scope](1828-warranty-scope/) | `warranty-scope`と品質保証範囲の雛形を配布した |
| [1829-estimate-warranty](1829-estimate-warranty/) | 保守の依頼の判定について、`estimate-and-scope`の提出版が2回とも水準を満たした |
| [1835-design-eval-layers](1835-design-eval-layers/) | デザイン評価の方式F（FLR）・S（SSR）は、どちらも不採用 |
| [1840-user-environment](1840-user-environment/) | 利用者の環境での測定は、R・Cとも固定した水準の一部を満たさなかった（測定の仕組みの直しは#1845） |
| [decision-ownership](decision-ownership/) | `decision-ownership`を取り込み、評価して配布した |
| [engineering-judgment](engineering-judgment/) | `engineering-judgment`・`estimate-and-scope`を取り込み、評価して配布した |
| [shared-harness](shared-harness/) | 評価記録ではなく、共通の測定の仕組み |

`v05/evaluation/`の評価記録：

| 記録 | 結論 |
| --- | --- |
| [repository-graph](../../v05/evaluation/repository-graph/) | #1614のリポジトリ派生グラフの評価。導入は保留（[ADR 0003](../../v05/ARCHITECTURE_DECISION_0003.md)） |
| [graph-runtime](../../v05/evaluation/graph-runtime/) | #1648・#1737のグラフ型runtime：ループの終了条件・明示的な状態は導入せず、判断点の宣言は保留。Adaptive-lived Context（adaptive rotation）も導入しない（[ADR 0004](../../v05/ARCHITECTURE_DECISION_0004.md)） |
| [AUTORESEARCH_1766_ASSESSMENT.md](../../v05/evaluation/AUTORESEARCH_1766_ASSESSMENT.md) | 改善案の固定評価による自動反復（autoresearch）は、現時点では実装不要 |
| [scenario-review-results](../../v05/evaluation/scenario-review-results/) | 標準Reviewerへのシナリオ導出・反証の追加を採用した評価。検出率はbaselineと同じで、性能向上の主張ではない |
