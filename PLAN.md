# PLAN: worker-selection関連ファイルの禁止参照（セクション番号参照）を是正しmainのCIを復旧する

- Issue: `ISSUE-325`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 禁止参照・陳腐化参照コメント計5箇所の是正 | `.agent-skill-chain/scripts/worker-launch.sh` の該当コメントから「（DESIGN.md §選択解決の設計）」を削除する（1箇所）。加えて `src/lib/worker-selection.ts` 内の以下4箇所を DESIGN.md 是正方針Bに従い是正する：(a) ファイル冒頭の「正本:」宣言行コメントから「 / SPEC.mdの受入条件番号（1番・2番・3番・9番）の列挙」と「 / DESIGN.md §選択解決の設計」の両方を削除し `// 正本: AGENTS.md §設定` のみとする、(b) `ModelTierTable`型のJSDocコメント内の「本 Issue で許容するアダプタキーは `codex` のみ（SPEC.md スコープ外: claude/human 用モデルの追加）。」を、Issue番号に依存しない恒久的な表現（例：「現時点で対応するアダプタキーは `codex` のみであり、claude/human 用のモデル対応表は未定義である。」）へ書き換える、(c) `resolveWorkerSelection`直前docstring末尾の adapter 解決順序説明文末尾の「（1番, 3番）」を削除する（直前の説明文自体は残す）、(d) `resolveModelForTier`直前docstring末尾のティア対応表からモデル文字列を得る処理の説明文末尾の「（2番, 9番）」を削除する（直前の説明文自体は残す）。いずれも既存本文に既に記載済み、または実質的に読み取れる設計判断・事実情報を再確認したうえで参照句のみを削除・書き換える（(b) を除き新規追記は無い）。コードの実行内容は変更しない。**本変更単位は commit `f56cde1`（ISSUE-325: worker-selection.ts/worker-launch.shの陳腐化参照5箇所を是正し回帰テストを拡張）として実装済みであり、本変更単位での実装作業は不要（設計記述の訂正のみ）** | `AC-1, AC-2, AC-3, AC-4` | なし |
| 2 | 回帰防止テストの拡張（恒久検査2件＋自己検証テスト1件） | `test/unit/worker-selection-reference.test.ts` に、`src/lib/worker-selection.ts` の内容を対象とした恒久検査を2件追加する：`assert.doesNotMatch(contents, /AC-[0-9]+/, ...)`（変更単位#1の(a)(c)(d)で削除した受入条件ID形式の参照が再発しないことの検証）、`assert.doesNotMatch(contents, /本 ?Issue/, ...)`（変更単位#1の(b)で削除した自己参照的「本Issue」文言が再発しないことの検証）。DESIGN.md「回帰防止テストの拡張設計」に従い、`worker-launch.sh`・`worker-selection.ts`双方を検査する既存の `DESIGN\.md §` 検査の共通 `for` ループとは別に、`worker-selection.ts` 固有の独立したテストケース（個別の `test()` ブロック）として追加し、テストケース名を AC-4 の恒久検証であることが分かる形へ更新する。加えて、AC-5に対応する自己検証テストケースを同ファイルへ追加する。当初案（実ファイル `src/lib/worker-selection.ts` の内容から抽出した文字列を汚染データとする構成）は、AC-4の恒久検査が是正後の実ファイルから該当パターンが1件も残らないことを要求するため抽出対象が常に空文字列となり自己矛盾するとstrict design-gateレビューで指摘され、実ファイルに依存しない構成へ全面的に書き換えた。具体的には、ファイル冒頭で正規表現定数 `ACCEPTANCE_CRITERIA_ID_PATTERN = /AC-[0-9]+/`・`SELF_REFERENTIAL_ISSUE_PATTERN = /本 ?Issue/` を定義し、AC-4の恒久検査2件とAC-5の自己検証テストケースの両方がこの同一定数を参照する（リテラルを複製しない）。AC-5の自己検証テストケースは実ファイルを一切参照せず、テスト内で明示的に構成した合成汚染文字列リテラル（受入条件ID形式の文字列例と「本Issue」という文言例の両方を含む、意図的に汚染させたin-memory文字列）に対し、上記の共有正規表現定数が `assert.match` でマッチすることを検証する。この設計により、共有定数の書き方が将来誤って壊れた場合、AC-4側の恒久検査とAC-5側の自己検証テストケースが同時かつ整合して失敗し、複製によるvacuous pass（AC-5側だけが独立した複製の正規表現で誤ってgreenのまま維持される事態）を防ぐ。**恒久検査2件をcommit `f56cde1`、AC-5自己検証テストケース（単一fixture方式）をcommit `1758e21`（ISSUE-325: AC-5(回帰防止テストの自己検証ケース)を実装）としていずれも実装済みである。ただし本改訂のstrict design-gateレビューで新設した以下2点は未実装であり、implementationセグメントで対応が必要**：(i) DESIGN.md「回帰防止テストの拡張設計」の追加項が定める、単一fixtureに起因する正規表現縮退の空振り成功（vacuous pass）対策としての複数独立fixture化（受入条件ID形式は桁数違いの複数値、自己参照Issue文言は空白有無の両パターンをそれぞれ独立したfixture・独立した `assert.match` へ拡張する）、(ii) 各fixtureが意図的な合成テストデータでありIssue #332の一掃対象から除外されるべき旨を明示するコードコメントの付与 | `AC-4, AC-5` | 1 |

変更単位は2つとする。変更単位#1は両ファイル（`worker-launch.sh`・`worker-selection.ts`）にまたがるが、いずれも同一 Issue の同一根本原因（Issue #307 作業中に一時的に存在した `DESIGN.md` の見出しへの参照、および Issue単位で破棄される `SPEC.md` の受入条件ID・スコープ・「本Issue」文言への参照が、その一時成果物の破棄後も残存したこと）に対する是正であるため、1つの変更単位としてまとめて実施する。`worker-selection.ts` 内の4箇所（ファイル冒頭の`正本:`宣言行・`ModelTierTable`型のJSDocコメント・`resolveWorkerSelection`直前docstring末尾・`resolveModelForTier`直前docstring末尾）も同一ファイルに対する一連の是正であるため単位を分割しない。変更単位#2（テスト拡張）は、変更単位#1でのコメント書き換え内容（削除後に `AC-[0-9]+`／`本 ?Issue` が残らないこと）を前提とした検証コードであるため、変更単位#1に依存する別単位として切り出す。AC-5の自己検証テストケースも、恒久検査2件（AC-4対応）の正規表現をそのまま参照する検証コードであるため同一変更単位#2内にまとめ、別単位に分割しない。

## 検証手順

変更単位#1は実装済み、変更単位#2は恒久検査2件・AC-5自己検証テストケース（単一fixture方式）が実装済みである。ただし変更単位#2のうち、本改訂で新設した複数fixture化・Issue #332除外コメントの2点はimplementationセグメントでの追加実装を要する（変更単位#2の備考欄参照）。下記手順0〜9はいずれも本Issue完了後を含めいつでも再実行可能な検証として位置づける。手順0（negative control）は`git show`によるbase commit参照方式であり作業ツリーの状態に依存しないため、手順1〜9との固定の実行順序を持たない。全手順が成功することを確認する。

0. **negative control（AC-4検証コマンドの空振り成功対策・作業ツリー状態に非依存）**: 是正前のbase commit（`origin/main`、コミット `4618b590fb35c739b49182672d5446b1cf57ba42`）の内容を直接参照する次のコマンドをリポジトリルートから実行する。
   ```
   git show 4618b590fb35c739b49182672d5446b1cf57ba42:src/lib/worker-selection.ts | grep -nE 'AC-[0-9]+|本 ?Issue'
   ```
   ファイル冒頭の`正本:`宣言行・`ModelTierTable`型のJSDocコメント・`resolveWorkerSelection`直前docstring末尾・`resolveModelForTier`直前docstring末尾の計4箇所がマッチし、終了コード0（マッチあり）を返すこと——すなわち手順6の検証コマンド（`! grep ...`）を是正前の内容に対して実行すれば終了コード1（失敗）になることを確認する。本コマンドは現在の作業ツリーが是正済み（変更単位#1・#2完了後）であるか否かに関係なく常に実行可能であり、本Issue完了後もいつでも再実行できる。ただし本コマンドは`git show`の出力を標準入力として`grep`へ渡す構成であるため、AC-4本来のコマンド`! grep -nE 'AC-[0-9]+|本 ?Issue' src/lib/worker-selection.ts`が持つ**パス引数**（`src/lib/worker-selection.ts`というファイルが実在すること）自体の妥当性は検証しない——負のコントロールが確かめられるのは「パターンを実際に検知できること」であり、「AC-4本来のコマンドの引数が正しいファイルを指し続けていること」ではない。この限界に対する恒久的な安全網は、DESIGN.md「機械検証手段」に記載の通り `test/unit/worker-selection-reference.test.ts` の `fs.readFileSync(path.join(repositoryRoot, 'src/lib/worker-selection.ts'), 'utf8')` がファイル不在時に例外を投げてテストが red になることで代替的に担保される。
1. `npm run build` — TypeScript のビルドが成功すること（`worker-selection.ts` の型・構文に影響が無いことの確認）。
2. `npm test` — 単体テスト・結合テスト（`test/unit`・`test/integration`）が全て成功すること。`worker-selection.ts` はコメントのみの変更であるため、拡張した `test/unit/worker-selection-reference.test.ts`（AC-4の恒久検査2件・AC-5の自己検証テストケース1件を含む）を含め全て成功することを確認する（AC-3、AC-4後段の恒久検証、AC-5）。
3. `.agent-skill-chain/scripts/lint-references.sh` — 禁止参照が0件、終了コード0になることを確認する（AC-1）。
4. `.agent-skill-chain/scripts/lint-vocab.sh` — 禁止語混入が無いこと（既存 CI ジョブへの regression が無いことの確認、AC-3）。
5. `.agent-skill-chain/scripts/adr-lint.sh check` — 本 Issue は ADR を伴わないため、既存 ADR の整合性検査に影響が無いこと（AC-3）。
6. `! grep -nE 'AC-[0-9]+|本 ?Issue' src/lib/worker-selection.ts` — 終了コード0（`grep -nE` がマッチ無しで返す終了コード1を `!` で反転）になることを確認する（AC-4）。このコマンドは `SPEC.md ` 接頭辞の有無に依存せず、ファイル冒頭の`正本:`宣言行・`ModelTierTable`型のJSDocコメント・`resolveWorkerSelection`直前docstring末尾・`resolveModelForTier`直前docstring末尾の4箇所すべてを検出対象に含む。手順0のnegative controlにより、本コマンドが陳腐化パターンを実際に検知できる状態にあることは既に確認済みである（対象ファイルのパス引数自体の妥当性はDESIGN.md記載の通り恒久的な自動テストの例外送出が代替的に担保する）。
7. 上記6のコマンドが検出すべき4箇所を、修正後のファイルに対して個別に目視確認する。
   - ファイル冒頭の`正本:`宣言行が `// 正本: AGENTS.md §設定` と完全一致し、`AGENTS.md §設定` 部分の誤削除・区切り文字（` / `）の残存が無いこと（DESIGN.md「障害・ロールバック考慮」で挙げたこの宣言行固有の失敗モードの検出）。
   - `ModelTierTable`型のJSDocコメント内の書き換え後の文が「対応するアダプタキーは `codex` のみであること」「claude/human 用モデル対応表が未定義であること」の2点を引き続き伝えていること（DESIGN.md「障害・ロールバック考慮」で挙げたこのコメント固有の失敗モードの検出）。
   - `resolveWorkerSelection`直前docstring末尾の括弧書き「（1番, 3番）」が削除され、adapter 解決順序の説明文自体（セグメント別上書き→`worker.adapter`→既定 human）は残っていること。
   - `resolveModelForTier`直前docstring末尾の括弧書き「（2番, 9番）」が削除され、ティア対応表からモデル文字列を得る処理の説明文自体（異常系の扱いを含む）は残っていること。
8. **AC-5 Then(b) 検証（automated）**: 次の2つの `grep -c` コマンドをリポジトリルートから実行し、結果がいずれも `1` であることを確認する（DESIGN.md「AC-5 Then(b) の機械検証コマンド」参照）。
   ```
   grep -c 'ACCEPTANCE_CRITERIA_ID_PATTERN = /' test/unit/worker-selection-reference.test.ts
   grep -c 'SELF_REFERENTIAL_ISSUE_PATTERN = /' test/unit/worker-selection-reference.test.ts
   ```
   加えて、`test/unit/worker-selection-reference.test.ts` の内容を目視レビューし、DESIGN.md「回帰防止テストの拡張設計」との整合を確認する。
   - (a) `ACCEPTANCE_CRITERIA_ID_PATTERN = /AC-[0-9]+/`・`SELF_REFERENTIAL_ISSUE_PATTERN = /本 ?Issue/` の2正規表現定数がファイル冒頭に1箇所のみ定義されており、AC-4の恒久検査2件（`worker-selection.ts` に対する独立したテストケース、`DESIGN.md §` 検査を含む共通 `for` ループとは別）とAC-5の自己検証テストケースの双方がこの同一定数を参照していること（リテラルの複製が無いこと）。
   - (b) AC-5の自己検証テストケースが実ファイル `src/lib/worker-selection.ts` を一切読み取らず、テスト内で明示的に構成した合成汚染文字列リテラルのみを対象としていること。
   - (c) `ACCEPTANCE_CRITERIA_ID_PATTERN` 用の合成汚染文字列が、桁数の異なる複数の具体値（例：1桁・2桁・3桁でそれぞれ異なる数字を持つfixture）を独立したfixtureとして含み、それぞれに対して独立した `assert.match` が実行されていること。`SELF_REFERENTIAL_ISSUE_PATTERN` 用の合成汚染文字列が、空白ありパターン（「本 Issue」）・空白無しパターン（「本Issue」）の両方を独立したfixtureとして含み、それぞれに対して独立した `assert.match` が実行されていること（複数fixtureを結合した単一文字列への単一アサーションにまとめられていないこと。DESIGN.md「回帰防止テストの拡張設計」の空振り成功リスク対策を参照）。各fixtureについて、対応する正規表現がマッチすることを個別に確認する。
   - (d) 各fixtureの定義箇所に、意図的な合成テストデータでありIssue #332の一掃対象から除外されるべき旨を明示するコードコメントが付されていること。
   - (e) `npm test`（手順2）の実行結果において、上記(c)で述べた各fixture独立のアサーションを含む全テストケースが成功していること。
9. 修正後の全箇所のコメント文面を目視レビューし、DESIGN.md の是正方針A・方針Bで確認した「設計判断・事実情報が本文に残っていること」を再確認する（AC-2、`manual` 検証）。

## 実装順序の見直しについて

変更単位#1（コメント是正）は実装済み（commit `f56cde1`）。変更単位#2（テスト拡張）のうち恒久検査2件はcommit `f56cde1`、AC-5自己検証テストケース（単一fixture方式）はcommit `1758e21`として実装済みである。ただし変更単位#2は本改訂のstrict design-gateレビューを受け、複数fixture化・Issue #332除外コメントの2点をDESIGN.md「回帰防止テストの拡張設計」の追加項として新設したため、この2点はimplementationセグメントでの追加実装をもって完了とする。実装順序としては、変更単位#2（テスト拡張）が変更単位#1（コメント是正）の完了後に着手する順序を採った（変更単位#2のテストが検査するパターンの不在は、変更単位#1の完了を前提とするため）。手順0（negative control）は`git show`によるbase commit参照方式へ変更したため、現在の作業ツリーの状態（変更単位#1・#2の完了前後）に関わらずいつでも独立して実行可能であり、他の手順との固定の実行順序を持たない——本Issue完了後もいつでも再実行できる恒久的な検証として位置づける。両単位内での検証手順3〜5・8の実行順序を入れ替える必要が生じた場合も、DESIGN.md の更新・設計ゲートの再通過は不要であり、本ファイルのみを更新すればよい。
