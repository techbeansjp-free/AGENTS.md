# PLAN: worker-selection関連ファイルの禁止参照（セクション番号参照）を是正しmainのCIを復旧する

- Issue: `ISSUE-325`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 禁止参照・陳腐化参照コメント計5箇所の是正 | `.agent-skill-chain/scripts/worker-launch.sh` の該当コメントから「（DESIGN.md §選択解決の設計）」を削除する（1箇所）。加えて `src/lib/worker-selection.ts` 内の以下4箇所を DESIGN.md 是正方針Bに従い是正する：(a) ファイル冒頭の「正本:」宣言行コメントから「 / SPEC.md AC-1・AC-2・AC-3・AC-9」と「 / DESIGN.md §選択解決の設計」の両方を削除し `// 正本: AGENTS.md §設定` のみとする、(b) `ModelTierTable`型のJSDocコメント内の「本 Issue で許容するアダプタキーは `codex` のみ（SPEC.md スコープ外: claude/human 用モデルの追加）。」を、Issue番号に依存しない恒久的な表現（例：「現時点で対応するアダプタキーは `codex` のみであり、claude/human 用のモデル対応表は未定義である。」）へ書き換える、(c) `resolveWorkerSelection`直前docstring末尾の adapter 解決順序説明文末尾の「（AC-1, AC-3）」を削除する（直前の説明文自体は残す）、(d) `resolveModelForTier`直前docstring末尾のティア対応表からモデル文字列を得る処理の説明文末尾の「（AC-2, AC-9）」を削除する（直前の説明文自体は残す）。いずれも既存本文に既に記載済み、または実質的に読み取れる設計判断・事実情報を再確認したうえで参照句のみを削除・書き換える（(b) を除き新規追記は無い）。コードの実行内容は変更しない | `AC-1, AC-2, AC-3, AC-4` | なし |
| 2 | 回帰防止テストの拡張（恒久検査2件＋自己検証テスト1件） | `test/unit/worker-selection-reference.test.ts` に、`src/lib/worker-selection.ts` の内容を対象とした恒久検査を2件追加する：`assert.doesNotMatch(contents, /AC-[0-9]+/, ...)`（変更単位#1の(a)(c)(d)で削除した受入条件ID形式の参照が再発しないことの検証）、`assert.doesNotMatch(contents, /本 ?Issue/, ...)`（変更単位#1の(b)で削除した自己参照的「本Issue」文言が再発しないことの検証）。DESIGN.md「回帰防止テストの拡張設計」に従い、`worker-launch.sh`・`worker-selection.ts`双方を検査する既存の `DESIGN\.md §` 検査の共通 `for` ループとは別に、`worker-selection.ts` 固有の独立したテストケース（個別の `test()` ブロック）として追加し、テストケース名を AC-4 の恒久検証であることが分かる形へ更新する。加えて、AC-5に対応する自己検証テストケースを同ファイルへ追加する：実ファイル `src/lib/worker-selection.ts` の内容から抽出した受入条件ID形式の文字列1件と「本Issue」文言1件を連結したin-memory文字列（実ファイルへは書き戻さない）に対し、既存2アサーションと同一の正規表現（`/AC-[0-9]+/`・`/本 ?Issue/`）が `assert.match` でマッチすることを検証し、恒久検査2件の正規表現自体が検知能力を持つことを機械的に自己検証する | `AC-4, AC-5` | 1 |

変更単位は2つとする。変更単位#1は両ファイル（`worker-launch.sh`・`worker-selection.ts`）にまたがるが、いずれも同一 Issue の同一根本原因（Issue #307 作業中に一時的に存在した `DESIGN.md` の見出しへの参照、および Issue単位で破棄される `SPEC.md` の受入条件ID・スコープ・「本Issue」文言への参照が、その一時成果物の破棄後も残存したこと）に対する是正であるため、1つの変更単位としてまとめて実施する。`worker-selection.ts` 内の4箇所（ファイル冒頭の`正本:`宣言行・`ModelTierTable`型のJSDocコメント・`resolveWorkerSelection`直前docstring末尾・`resolveModelForTier`直前docstring末尾）も同一ファイルに対する一連の是正であるため単位を分割しない。変更単位#2（テスト拡張）は、変更単位#1でのコメント書き換え内容（削除後に `AC-[0-9]+`／`本 ?Issue` が残らないこと）を前提とした検証コードであるため、変更単位#1に依存する別単位として切り出す。AC-5の自己検証テストケースも、恒久検査2件（AC-4対応）の正規表現をそのまま参照する検証コードであるため同一変更単位#2内にまとめ、別単位に分割しない。

## 検証手順

変更単位#1（コメント是正）に着手する前に手順0（negative control）を実行し、変更単位 #1・#2 の完了後に手順1〜9を順に実行し、全て成功することを確認する。

0. **negative control（AC-4検証コマンドの空振り成功対策）**: 変更単位#1のコメント修正を適用する前の作業ツリー（陳腐化パターンが実在する状態。実装が既に進んでいる場合は当該修正コミットの1つ前、または `git show <修正前SHA>:src/lib/worker-selection.ts` で修正前内容を取得する）に対して `grep -nE 'AC-[0-9]+|本 ?Issue' src/lib/worker-selection.ts`（`!` を付けない生の形）を実行し、ファイル冒頭の`正本:`宣言行・`ModelTierTable`型のJSDocコメント・`resolveWorkerSelection`直前docstring末尾・`resolveModelForTier`直前docstring末尾の計4箇所がマッチし、`!`反転前の生コマンドが終了コード0（マッチあり）を返すこと——すなわち手順6の反転済みコマンド（`! grep ...`）を修正前状態に対して実行すれば終了コード1（失敗）になることを確認する。この手順は、DESIGN.md「機械検証手段」が指摘する空振り成功（対象ファイル不在時に `grep` の終了コード2が `!` で反転され誤って終了コード0となる失敗モード）に対する防御であり、手順6の検証コマンドが実装時点で検査対象ファイルを正しく読めており、かつ実際にマッチを検知できる状態にあることを、修正適用前に担保する。
1. `npm run build` — TypeScript のビルドが成功すること（`worker-selection.ts` の型・構文に影響が無いことの確認）。
2. `npm test` — 単体テスト・結合テスト（`test/unit`・`test/integration`）が全て成功すること。`worker-selection.ts` はコメントのみの変更であるため、拡張した `test/unit/worker-selection-reference.test.ts`（AC-4の恒久検査2件・AC-5の自己検証テストケース1件を含む）を含め全て成功することを確認する（AC-3、AC-4後段の恒久検証、AC-5）。
3. `.agent-skill-chain/scripts/lint-references.sh` — 禁止参照が0件、終了コード0になることを確認する（AC-1）。
4. `.agent-skill-chain/scripts/lint-vocab.sh` — 禁止語混入が無いこと（既存 CI ジョブへの regression が無いことの確認、AC-3）。
5. `.agent-skill-chain/scripts/adr-lint.sh check` — 本 Issue は ADR を伴わないため、既存 ADR の整合性検査に影響が無いこと（AC-3）。
6. `! grep -nE 'AC-[0-9]+|本 ?Issue' src/lib/worker-selection.ts` — 終了コード0（`grep -nE` がマッチ無しで返す終了コード1を `!` で反転）になることを確認する（AC-4）。このコマンドは `SPEC.md ` 接頭辞の有無に依存せず、ファイル冒頭の`正本:`宣言行・`ModelTierTable`型のJSDocコメント・`resolveWorkerSelection`直前docstring末尾・`resolveModelForTier`直前docstring末尾の4箇所すべてを検出対象に含む。手順0のnegative controlにより、本コマンドが検査対象ファイルを正しく読めており空振り成功でないことは既に確認済みである。
7. 上記6のコマンドが検出すべき4箇所を、修正後のファイルに対して個別に目視確認する。
   - ファイル冒頭の`正本:`宣言行が `// 正本: AGENTS.md §設定` と完全一致し、`AGENTS.md §設定` 部分の誤削除・区切り文字（` / `）の残存が無いこと（DESIGN.md「障害・ロールバック考慮」で挙げたこの宣言行固有の失敗モードの検出）。
   - `ModelTierTable`型のJSDocコメント内の書き換え後の文が「対応するアダプタキーは `codex` のみであること」「claude/human 用モデル対応表が未定義であること」の2点を引き続き伝えていること（DESIGN.md「障害・ロールバック考慮」で挙げたこのコメント固有の失敗モードの検出）。
   - `resolveWorkerSelection`直前docstring末尾の括弧書き「（AC-1, AC-3）」が削除され、adapter 解決順序の説明文自体（セグメント別上書き→`worker.adapter`→既定 human）は残っていること。
   - `resolveModelForTier`直前docstring末尾の括弧書き「（AC-2, AC-9）」が削除され、ティア対応表からモデル文字列を得る処理の説明文自体（異常系の扱いを含む）は残っていること。
8. `test/unit/worker-selection-reference.test.ts` の拡張後の内容を目視レビューし、(a) `/AC-[0-9]+/`・`/本 ?Issue/` の2パターンが `worker-selection.ts` に対する恒久検査として、`DESIGN.md §` 検査を含む共通 `for` ループとは別の独立したテストケースで追加されていること、(b) AC-5対応の自己検証テストケースが、実ファイルを書き換えずin-memory文字列に対して同一の2正規表現を `assert.match` で検証する形で追加されていることを確認する（DESIGN.md「回帰防止テストの拡張設計」との整合確認）。
9. 修正後の全箇所のコメント文面を目視レビューし、DESIGN.md の是正方針A・方針Bで確認した「設計判断・事実情報が本文に残っていること」を再確認する（AC-2、`manual` 検証）。

## 実装順序の見直しについて

変更単位#2（テスト拡張）は変更単位#1（コメント是正）の完了後に着手する固定順序とする（変更単位#2のテストが検査するパターンの不在は、変更単位#1の完了を前提とするため）。手順0（negative control）は変更単位#1の着手前に実行する固定順序とする（変更単位#1適用後の作業ツリーでは陳腐化パターンが既に除去されており、negative controlの前提である「陳腐化パターンが実在する状態」を再現できないため）。両単位内での検証手順3〜5・8の実行順序を入れ替える必要が生じた場合も、DESIGN.md の更新・設計ゲートの再通過は不要であり、本ファイルのみを更新すればよい。
