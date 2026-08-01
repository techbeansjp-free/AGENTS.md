# PLAN: worker-selection関連ファイルの禁止参照（セクション番号参照）を是正しmainのCIを復旧する

- Issue: `ISSUE-325`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 禁止参照コメント2箇所の是正 | `.agent-skill-chain/scripts/worker-launch.sh` の該当コメントから「（DESIGN.md §選択解決の設計）」を削除し、`src/lib/worker-selection.ts` 冒頭の「正本:」コメント1行目から「 / DESIGN.md §選択解決の設計」と「 / SPEC.md AC-1・AC-2・AC-3・AC-9」の両方を削除する。いずれも DESIGN.md の是正方針A・方針Bに従い、既存本文に既に記載済みの設計判断・責務説明を再確認したうえで参照句のみを削除する（新規追記は無し）。`worker-selection.ts` 冒頭1行目は削除後 `// 正本: AGENTS.md §設定` のみとなる。コードの実行内容は変更しない | `AC-1, AC-2, AC-3, AC-4` | なし |

変更単位は1つのみとする。両ファイルの修正は互いに独立しており、かつ両方とも同一 Issue の同一根本原因（Issue #307 作業中に一時的に存在した `DESIGN.md` の見出しへの参照、および Issue単位で破棄される `SPEC.md` の受入条件ID列挙が、その一時成果物の破棄後も残存したこと）に対する是正であるため、1つの変更単位としてまとめて実施する。`worker-selection.ts` 冒頭1行目の2箇所の削除（`DESIGN.md §選択解決の設計` 部分・`SPEC.md AC-1・AC-2・AC-3・AC-9` 部分）は同一ファイル・同一行に対する変更であるため、変更単位を分割せず同一単位内でまとめて実施する。

## 検証手順

変更単位 #1 の完了後、以下を順に実行し、全て成功することを確認する。

1. `npm run build` — TypeScript のビルドが成功すること（`worker-selection.ts` の型・構文に影響が無いことの確認）。
2. `npm test` — 単体テスト・結合テスト（`test/unit`・`test/integration`）が全て成功すること。コメントのみの変更であるため、修正前と同じ結果（成功）になることを確認する（AC-3）。
3. `.agent-skill-chain/scripts/lint-references.sh` — 禁止参照が0件、終了コード0になることを確認する（AC-1）。
4. `.agent-skill-chain/scripts/lint-vocab.sh` — 禁止語混入が無いこと（既存 CI ジョブへの regression が無いことの確認、AC-3）。
5. `.agent-skill-chain/scripts/adr-lint.sh check` — 本 Issue は ADR を伴わないため、既存 ADR の整合性検査に影響が無いこと（AC-3）。
6. `! grep -q 'SPEC\.md AC-' src/lib/worker-selection.ts` — 終了コード0（`grep -q` がマッチ無しで返す終了コード1を `!` で反転）になることを確認する（AC-4）。加えて、`src/lib/worker-selection.ts` 冒頭1行目が `// 正本: AGENTS.md §設定` と完全一致し、`AGENTS.md §設定` 部分の誤削除・区切り文字（` / `）の残存が無いことを目視確認する（DESIGN.md「障害・ロールバック考慮」で挙げた AC-4 固有の失敗モードの検出）。
7. 修正後の2箇所のコメント文面を目視レビューし、DESIGN.md の是正方針A・方針Bで確認した「設計判断が本文に残っていること」を再確認する（AC-2、`manual` 検証）。

## 実装順序の見直しについて

変更単位が1つのみであるため、実装順序の見直しは想定していない。手順3〜5の実行順序を入れ替える必要が生じた場合も、DESIGN.md の更新・設計ゲートの再通過は不要であり、本ファイルのみを更新すればよい。
