---
document_id: "5c8d9d20-eebf-424c-85e2-52e7388a0ead"
---

# レビュー: .agent-skill-chain 起動契約・コマンド・ワークフロー・スキル整合（Issue #143）

**前のステップ**: [03_実装計画.md](./03_実装計画.md)
**実装先**: `.worktree/chore/20260718_092843-起動契約コマンドワークフロー整合/`（実コミットは当該 worktree 内）
**本ファイルの位置づけ**: 実装先 worktree では 04_review.md は生成していない（本 issue は「文書整合」パッケージであり verify-and-close の実装完了レビューではなく、review-docs 相当のドキュメントレビューとして本ファイルに記録する）。

---

## 1. 実装内容の確認（39件の解消状況）

領域A 18件・領域B 21件、計 39 件すべてについて、対応する所有ファイルに差分を適用したことを確認した。詳細な ID→ファイル対応は [03_実装計画.md §1](./03_実装計画.md#1-タスク分解ファイル単位) のとおり。A-16 のみ「所有ファイル差分 0 件・言及のみ」が正しい実装結果である（02_設計 §3.7 の確定方針どおり）。

enforcement/README.md（他パッケージ #144 所有）は一切編集していない。CORE.md・run_command.md・AGENT_CONDUCT.md 側で allowlist 前提・検知限界注記・enforce off 実行主体制限などを追加したのみで、enforcement 配下への言及はすべてコメント形式の申し送りに留めた。

---

## 2. 敵対的観点リスト（攻めた観点と結論）

| # | 攻めた観点 | 検出した問題 | 対応・結論 |
| --- | --- | --- | --- |
| 1 | B-1 の「各フェーズ完了時の verify-and-close 削除」は run_command.md・PHASES.md だけを直しても、他ファイルに同型の記述が残っていないか | **検出**: boot/CORE.md §メインとサブの役割「worker（監査・書記以外）への依頼完了後は必ず verify-and-close を依頼する。requirement-discovery・design-feature・implement-feature 等いずれの完了後も省略してはならない」、および RULES.md §監査・書記「各工程の完了後、クローズ前に必ず verify-and-close を経る」が同型の矛盾を含んでいた（02_設計のスコープ外だった） | 両箇所を「implement-feature 完了後は verify-and-close、要求・要件・設計・実装計画完了後は review-docs」に修正し、run_command.md §Constraints を正本として参照させた |
| 2 | A-9 の見出し変更（AGENT_CONDUCT 第 3 部）でアンカーリンクが壊れないか | **検出**: skills/agent/run_command.md §委譲時の行動規範参照 が旧アンカー文字列を用いており、見出し変更後にリンク切れになる | run_command.md 側のアンカー文字列を新見出しに追随させて修正 |
| 3 | A-3（`enforce off` 実行主体を人間限定）と AGENT_CONDUCT の既存「人間の明示指示があればエージェントが env 設定・変更してよい」という一般例外が、`enforce off` を追加対象にした際に矛盾しないか | **検出**: 一般例外条項の文言のままだと、「人間が指示すればエージェントが `enforce off` を代行してよい」とも読め、A-3 の「実行主体は人間のみ」と字面上ぶつかる | AGENT_CONDUCT.md に `enforce off` を一般例外の対象外とする注記を追加し、ロックアウト時はエージェントがエスカレーションのみ行うと明記して解消 |
| 4 | A-4（quick 最小 00）は RULES.md・run_command.md 側の文言だけ直しても、テンプレート実体（00_要求定義.md）が「全セクション必須」の外観のままではサブが混乱しないか | 検出（軽微）: 00_要求定義.md テンプレートに quick 例外の言及が無かった | テンプレート冒頭に quick 最小 00 の注記を追加し、RULES.md を参照させた |
| 5 | B-15（04テンプレート §4.3 新設）で既存の §5〜§15 の番号がずれないか | 検証のみ・問題なし | subsection 追加のみでリナンバー不要であることを再読了で確認済み（§9 からの相互参照リンクも整合） |
| 6 | B-2（review-code/review-architecture README 縮退）で、README にしかなかった固有情報が失われていないか | 検証のみ・問題なし | 元 README の内容（手順・制約・成果物形式）はすべて SKILL.md 側に同等以上の内容として既存しており、README 縮退で失われた情報は無い（索引化のみ） |
| 7 | run_command.md 内にも skills/agent/SKILL.md(30) と同型の「README.md または SKILL.md」表記が別途無いか（B-2 の見落とし） | **検出**: run_command.md §command の実行のしかた にも同一表現が存在（02_設計は SKILL.md(30) のみを対象としていた） | 同時に「SKILL.md（正本）。README は索引」へ修正 |
| 8 | A-1/A-3 の allowlist 前提・エスカレーション文言を CORE.md だけに書くと、run_command.md 側（同じ carve-out の詳細規定側）で矛盾した記述が残らないか | 検証のみ・問題なし | run_command.md §外部書き込み操作の実行主体 にも同内容を短く反映済み（CORE を正本として参照する形） |

---

## 3. must-preserve リスト（不変条件と保持の確認）

| # | 不変条件 | 保持確認 |
| --- | --- | --- |
| 1 | メイン（進行役）の実作業絶対禁止 | CORE.md §Orchestrator Strict Rules・§フォールバック方針は規範強度を維持したまま。A-5 override は「委譲技術的不能環境限定」の条件付きのみ追加し、通常環境の絶対禁止は不変。A-6 のための文言集約（デフォルト起動・依頼タイプ別振る舞い・メインとサブの役割の重複トリム）は要点参照化のみで規範を弱めていない |
| 2 | 実装完了後の verify-and-close 必須・04_review 絶対強制 | B-1 修正は「実装着手前フェーズ」のみを review-docs へ切り替えたもので、implement-feature 完了後の verify-and-close 必須・04_review 絶対強制はすべての箇所（CORE/RULES/run_command/PHASES/verify-and-close.md）で維持されていることを再確認した |
| 3 | #35 branch 紐づけゲートは quick でも必須 | RULES.md・run_command.md・00_要求定義.md テンプレートいずれも「#35 は規模・モードに関係なく維持」を明記したまま。quick 最小 00 も frontmatter に `branch` を含む前提で設計されている |
| 4 | 二観点レビュー（両リスト必須・欠落は未完了） | B-2（README 縮退）は SKILL.md 側の必須要件をそのまま維持し、README は索引化のみ。B-15（04テンプレート §4.3 新設）は受け皿を追加しただけで要求は緩めていない。review-docs.md の DoD（両リスト必須）も変更していない |
| 5 | 証跡は書記（write-workflow-log）のみ・省略禁止 | B-13 の修正は「実行主体の明確化（chain 実行者自身が実行）」のみで、証跡記録の必須性・省略禁止は不変。write-workflow-log 側の SKILL.md/README.md は無変更（もともと矛盾がなかったため） |
| 6 | サブの独断起票禁止・Go は進行役 | B-16 の修正（run_command.md §サブissue作成時 の再定義）は「進行役承認後に issue 作成 command へ再委譲」という接続を追加しただけで、独断起票禁止・進行役承認必須の構造は維持 |
| 7 | 正本 1 か所・重複禁止 | A-6 の一連の修正（timestamp・quick 免除・close 移動・行動規範転記・反復打ち切り）はすべて「正本を 1 か所に定め、他は 1 行参照」の方向に**強化**しており、逆行はない |
| 8 | 他パッケージ（enforcement/spec/ledger 等）を直接改変しない | 全 30 ファイルの diff は 02_設計 §0.1 の所有ファイルリストの範囲内に収まっている。enforcement/README.md への言及はコメント・参照のみで実体は無変更（`git diff` で enforcement/ 配下に変更が無いことを確認済み） |

---

## 4. 受け入れ基準の確認

- 領域A 18件・領域B 21件、計 39 件すべてに対応する差分が実装先 worktree に存在する（[03_実装計画.md](./03_実装計画.md) の対応表で ID→ファイルのトレーサビリティを確保）。
- enforcement/README.md は実体改変ゼロ（`git status` で対象外を確認）。
- セルフレビューで新たに検出した 3 件の波及（CORE.md/RULES.md の verify-and-close 記述、AGENT_CONDUCT アンカー、enforce off 一般例外との衝突）はすべて実装済み反映まで完了。

## 5. 残課題（フォローアップ申し送り）

02_設計 §7「確定サマリー」の「他パッケージ申し送り」に加え、以下を追記する。

- 領域C（enforcement）: A-1 allowlist 実装、A-2 NDJSON 追跡化、A-3 tty 判定等の技術強制、A-7 系統C（Read/Grep 過大読込警告）の定義整合、A-12 失敗条件表への advisory ルール登載運用、A-13 48h 窓調整、A-16 書記防御縮退の実装判断。
- 領域E: B-14 setup 実装（テンプレート未配備時のパッケージ同梱コピー動作の実装確認）。
- 深い簡素化（A-7 §3.4 の「読了義務の凝縮版＋オンデマンド再設計」）は本 issue のスコープ外として別途フォローアップ issue を検討する（02_設計と同じ判断）。
