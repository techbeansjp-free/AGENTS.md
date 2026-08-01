# SPEC: worker-selection関連ファイルの禁止参照（セクション番号参照）を是正しmainのCIを復旧する

- Issue: `ISSUE-325`
- 作成者: `agent-skill-chain worker`
- 対象ブランチ: `bugfix/325-worker-selection-forbidden-reference`

## 目的・背景

`origin/main`（v0.2.24、Issue #307 / PR #308マージ後）の以下2ファイルのコメント内に、AGENTS.mdが禁止するセクション参照（`§選択解決の設計`）が混入している。

- `.agent-skill-chain/scripts/worker-launch.sh`（該当コメント1箇所）
- `src/lib/worker-selection.ts`（該当コメント計4箇所。詳細は本節後段に列挙する）

AGENTS.mdは、規範文書・ソースコードコメント中のセクション番号参照・ファイルパス＋行番号参照を禁止している。セクション追加・ファイル分割・見出し移動のたびに参照が陳腐化し、AIがその陳腐化に気付かず古い位置情報を正しいものとして誤解釈するためである。この規約は `.agent-skill-chain/scripts/lint-references.sh`（実体は agent-skill-chain CLI の `lint references` サブコマンド）が機械検査する。

上記2箇所の参照先は、Issue #307 の作業中に一時的に存在した Issue 単位の `DESIGN.md` の見出し「選択解決の設計」である。Issue 単位の `SPEC.md`／`DESIGN.md`／`PLAN.md` はその Issue の作業期間中のみ存在し、Issue 完了後は破棄される一時成果物であり、`lint references` が見出し解決に使う走査対象（AGENTS.md・`docs/GLOSSARY.md`・`.agent-skill-chain/{standards,templates,config,schemas,scripts,ci}/`・`src/`・`.github/workflows/`）にも含まれない。そのため当該参照は現時点で見出しテキストによる解決ができず、`lint-references.sh` が exit 1 で禁止参照として報告する。`.github/workflows/agent-skill-chain-ci.yml` の `verify` ジョブは `on: pull_request` のみで起動し main への push では起動しないため、main 自体でジョブが失敗するのではなく、main をマージ済みの各オープン PR で `verify` ジョブが個別に失敗し、結果として複数 PR で CI が連鎖的に赤くなっている。

`src/lib/worker-selection.ts` を精査すると、Issue #307 で作成され Issue 完了後に既に破棄された `SPEC.md`／`DESIGN.md` への陳腐化参照は、`lint-references.sh` が検出する `§` パターン（ファイル冒頭の`正本:`宣言行）だけでなく、同ファイル内に計4箇所存在する。いずれも「Issue単位の一時成果物のID・見出しをソースコメントへ焼き付けた結果、参照先が消滅または意味変化した後もコメント側だけが取り残される」という同一の根拠（AGENTS.md「参照・コメントの陳腐化防止」節）に該当する。

1. ファイル冒頭の`正本:`宣言行 — 破棄された `SPEC.md` の受入条件（1番・2番・3番・9番の4件）と、破棄された `DESIGN.md` の見出しへの参照。
2. `ModelTierTable`型のJSDocコメント内の、許容アダプタキーに関する記述にある「本 Issue で許容するアダプタキーは `codex` のみ（SPEC.md スコープ外: ...）」という一文 — 破棄された `SPEC.md` へのスコープ参照に加え、「本 Issue」という文言が Issue #307 を指して書かれている。Issue #307 完了後の現在（本 Issue #325 の作業中）にこの記述を読むと、あたかも「今読んでいる Issue」を指しているかのように誤読される。
3. `resolveWorkerSelection`直前のdocstring内、adapter解決順序を説明する一文の末尾の括弧書き（「（最終フォールバック）」の順で解決する、に続く箇所） — 破棄された `SPEC.md` の受入条件（1番, 3番）への参照。`SPEC.md ` という接頭辞を伴わない、受入条件番号だけの単独記法である。
4. `resolveModelForTier`直前のdocstring内、ティア対応表からモデル文字列を得る処理を説明する一文の末尾の括弧書き — 破棄された `SPEC.md` の受入条件（2番, 9番）への参照。同じく `SPEC.md ` 接頭辞を伴わない単独記法である。

本 Issue（ISSUE-325）は、`worker-launch.sh` の禁止参照1箇所に加え、`worker-selection.ts` 内のこれら4箇所すべての陳腐化参照を是正し、`lint-references.sh` を main 上で exit 0 に復旧すること、および `worker-selection.ts` 全体から同種の陳腐化参照が再発しないことを機械検証できる状態にすることを目的とする。

## 要求 → 要件 → 受入条件

### 要求

- main の `verify` CI ジョブを復旧し、連鎖的に失敗している他 PR の CI 状態を正常化したい（リポジトリ利用者・他 Issue 作業者からの実務上の要求）。

### 要件

- `.agent-skill-chain/scripts/worker-launch.sh` の該当コメントから、AGENTS.md「参照・コメントの陳腐化防止」節が禁止するセクション番号参照を除去する（1箇所）。
- `src/lib/worker-selection.ts` 内の、Issue #307 で作成され既に破棄された `SPEC.md`／`DESIGN.md` への陳腐化参照（受入条件ID列挙・`DESIGN.md` 見出し参照・「本Issue」という文言を含む箇所）を、次の**計4箇所すべて**から除去する。ファイル冒頭の`正本:`宣言行のみを除去して他3箇所を残すことは要件を満たさない。
  - ファイル冒頭の`正本:`宣言行は、`正本:` に続けて `AGENTS.md §設定` ・ 受入条件番号の列挙 ・ `DESIGN.md` 見出し参照の3つをスラッシュ区切りで並べる記法だった。このうち受入条件番号の列挙部分（1番・2番・3番・9番の4件）と `DESIGN.md` 見出し参照部分を除去し、`正本: AGENTS.md §設定` のみを残す。
  - `ModelTierTable`型のJSDocコメント内の、許容アダプタキーに関する記述にある「本 Issue で許容するアダプタキーは `codex` のみ（SPEC.md スコープ外: ...）」という一文は、`SPEC.md` へのスコープ参照を除去する。加えて、「本 Issue」という文言は Issue #307 完了後は別の Issue（現時点では本 Issue #325）を指してしまい誤読を招くため、Issue番号に依存しない書き方（例：「現時点で許容するアダプタキーは `codex` のみ」等、恒久的に成立する表現）へ是正することを是正対象に含める。
  - `resolveWorkerSelection`直前のdocstring内、adapter解決順序を説明する一文の末尾の括弧書き、および`resolveModelForTier`直前のdocstring内、ティア対応表からモデル文字列を得る処理を説明する一文の末尾の括弧書き（いずれも受入条件番号のみを列挙する単独記法）を除去する。
  - これらの参照は `lint-references.sh` の `§` パターン検出では捕捉されない箇所を含むが、AGENTS.md「参照・コメントの陳腐化防止」節が定める「ソースコードコメントの追跡識別子として認めるのは Issue ID のみであり、要求ID・ADR ID・テストIDの対応はソースコメントではなく別途のtraceability情報で管理する」という規約に抵触する陳腐化参照であり、本 Issue の是正対象に含める。
- 除去にあたり、当該コメントが元々説明していた設計判断・意味的内容を失わない。参照先の見出し・受入条件に書かれていた契約の要旨がコメント本文に既に記載されていない場合は、その場に書き下す。
- コメント修正はコードの実行内容（ロジック・振る舞い）を一切変更しない。
- 回帰防止のため、本Issueの作業中に新規作成する回帰防止テストファイル `test/unit/worker-selection-reference.test.ts`（`.agent-skill-chain/scripts/worker-launch.sh`・`src/lib/worker-selection.ts` の2ファイルに対する禁止参照パターン `DESIGN\.md §` の不在検査を含む）に、`src/lib/worker-selection.ts` 全体から受入条件ID形式の参照および「本Issue」文言が残存しないことを恒久的に機械検証するテストケースを含める（実装セグメントで実施。詳細は本節後段の受入条件のうち、陳腐化参照の除去を検証する項の実装への申し送り段落、およびそれに続くテスト自己検証を扱う項に記載する）。

### 受入条件（Acceptance Criteria）

#### AC-1: `lint-references.sh` が exit 0 で成功する

- Given: `.agent-skill-chain/scripts/worker-launch.sh` と `src/lib/worker-selection.ts` のコメント修正を適用した作業ツリー
- When: `.agent-skill-chain/scripts/lint-references.sh`（デフォルト対象＝生きたファイル全体）を実行する
- Then: 禁止参照が0件で終了コード0を返す
- 検証方法見込み: `automated`

#### AC-2: 該当2ファイルのコメントが説明していた設計判断の意味的内容が失われない

- Given: 修正前の `worker-launch.sh` 該当コメント（「worker context 自体の失敗（設定不正・ティア解決失敗）は、まだ何も起動していない段階のエラーとして扱う」という設計判断）、および修正前の `worker-selection.ts` の以下4箇所のコメント
  - ファイル冒頭の`正本:`宣言行: `正本:` に続けて `AGENTS.md §設定` ・ 受入条件番号の列挙 ・ `DESIGN.md` の見出し「選択解決の設計」への参照の3つをスラッシュ区切りで並べる記法であり、当該モジュール自身が正本であるという宣言ではなく、当該モジュールが従うべき上流の正本文書・関連文書を列挙する記法である（本リポジトリの `正本:` コメント記法の通例。例：`.agent-skill-chain/scripts/lint-references.sh`・`.agent-skill-chain/ci/verify-branch-name.sh` 冒頭も同記法）。モジュール自体の責務宣言（セグメント作業ワーカー起動時の adapter・model_tier・reasoning_effort・具体的なモデル文字列を config とセグメント名だけから決める純粋関数群であること、ティア名から具体的なモデル文字列への解決＝`resolveModelForTier` をここで完結させ、`.agent-skill-chain/adapters/codex.sh` 等のアダプタは解決済みの値を環境変数経由で受け取るだけであること）は`正本:`宣言行ではなく、それに続くモジュール概要のコメント本文（config とセグメント名だけから adapter・model_tier・reasoning_effort・モデル文字列を決める、という記述が続く箇所）に存在する。
  - `ModelTierTable`型のJSDocコメント内の、許容アダプタキーに関する記述: 「本 Issue で許容するアダプタキーは `codex` のみ（SPEC.md スコープ外: claude/human 用モデルの追加）」という記述が伝える実質的な意味は、「`resolveModelForTier` が扱うアダプタキーは現時点では `codex` のみであり、`claude`／`human` 用のティア対応表は現時点で未定義である（将来追加され得るが、追加時期・方法は本コメントの関知するところではない）」という、コード自体の現状の対応範囲に関する事実である。
  - `resolveWorkerSelection`直前のdocstring内、adapter解決順序を説明する一文の末尾: 「（最終フォールバック）」の順で解決する（1番, 3番）」という記述のうち、括弧内の受入条件番号を除いた「adapter・model_tier・reasoning_effort は◯◯・△△・□□（最終フォールバック）の順で解決する」という adapter 解決順序の説明文自体。
  - `resolveModelForTier`直前のdocstring内、ティア対応表からモデル文字列を得る処理を説明する一文の末尾: 「得る（2番, 9番）。対応表そのものが無い・当該ティアのエントリが無い・当該アダプタ用のモデルが...」という記述のうち、括弧内の受入条件番号を除いた「ティア対応表からモデル文字列を得る。対応表そのものが無い・当該ティアのエントリが無い場合は◯◯する」という異常系を含む説明文自体。
- When: 禁止参照・陳腐化参照を除去する修正を適用する
- Then: 上記の設計判断（`worker-launch.sh`）・モジュール責務宣言（`worker-selection.ts` の`正本:`宣言行に続くモジュール概要）・アダプタキー対応範囲の事実（`ModelTierTable`型のJSDocコメント）・adapter 解決順序の説明（`resolveWorkerSelection`直前のdocstring）・ティア対応表からモデル文字列を得る処理の説明（`resolveModelForTier`直前のdocstring）のいずれも、修正後のコメント本文（除去箇所の周辺に既に存在する記述、または新たに書き下した記述）から読み取れる状態を維持する。参照の除去のみを理由に説明内容が欠落しない
- 検証方法見込み: `manual`（コメント修正前後の内容比較によるレビュー）

#### AC-3: 既存の build・self-test・その他 CI ジョブに regression が無い

- Given: `.agent-skill-chain/scripts/worker-launch.sh` と `src/lib/worker-selection.ts` のコメント修正を適用した作業ツリー
- When: `npm run build`、`npm test`、`.agent-skill-chain/scripts/lint-vocab.sh`、`.agent-skill-chain/scripts/adr-lint.sh check` を実行する
- Then: いずれも修正前と同じ結果（成功）で終了する。コメントのみの変更でありコードの実行内容を変えないため、単体テストの結果に変化が無い
- 検証方法見込み: `automated`

#### AC-4: `worker-selection.ts` 全体から要求ID列挙・自己参照的Issue文言の陳腐化参照が除去される

前回改訂時の本受入条件はファイル冒頭の`正本:`宣言行のみを是正対象としていたが、design-gate strictレビューにて「同一の根拠（Issue完了後に破棄される Issue 単位の `SPEC.md` の受入条件ID参照は陳腐化する）が他の3箇所にも等しく当てはまる」「機械検証コマンド `! grep -q 'SPEC\.md AC-' ...` は `SPEC.md ` という接頭辞を伴わない受入条件番号のみの単独括弧書き形式（例：カンマ区切りの番号2つを丸括弧で囲む形）を素通りする」という指摘を受け、対象範囲・検証コマンドの両方を全面的に書き換える。

- Given: 修正前の `src/lib/worker-selection.ts` における以下4箇所
  1. ファイル冒頭の`正本:`宣言行: `正本:` に続けて `AGENTS.md §設定` ・ 受入条件番号の列挙（1番・2番・3番・9番） ・ `DESIGN.md` の見出し「選択解決の設計」への参照をスラッシュ区切りで並べる記法だった1行
  2. `ModelTierTable`型のJSDocコメント内の、許容アダプタキーに関する記述: 「本 Issue で許容するアダプタキーは `codex` のみ（SPEC.md スコープ外: ...）」という一文
  3. `resolveWorkerSelection`直前のdocstring内、adapter解決順序を説明する一文の末尾: 「（1番, 3番）」という受入条件番号の単独括弧書き
  4. `resolveModelForTier`直前のdocstring内、ティア対応表からモデル文字列を得る処理を説明する一文の末尾: 「（2番, 9番）」という受入条件番号の単独括弧書き
- When: 上記4箇所すべてから、破棄された `SPEC.md`／`DESIGN.md` への陳腐化参照（受入条件ID列挙・見出し参照・「本Issue」という自己参照的文言）を除去する修正を適用する。除去後、ファイル冒頭の`正本:`宣言行は `// 正本: AGENTS.md §設定` のみとなり、`ModelTierTable`型のJSDocコメント内の該当記述は Issue 番号に依存しない恒久的な表現（例：「現時点で許容するアダプタキーは `codex` のみ」）となり、`resolveWorkerSelection`直前・`resolveModelForTier`直前それぞれのdocstring末尾の括弧書きは受入条件番号を含まない形（説明文自体は残す。前掲の意味的内容保存の受入条件を参照）となる
- Then: 次の検証コマンドをリポジトリルートから実行し、終了コード0（成功）を得る。
  ```
  ! grep -nE 'AC-[0-9]+|本 ?Issue' src/lib/worker-selection.ts
  ```
  このコマンドは `grep -nE` が `AC-` に続く数字（受入条件ID形式）または「本Issue」「本 Issue」という自己参照的文言のいずれかを検出した場合に終了コード0（マッチあり）を返し、それを `!` で反転することで「ファイル全体を通じて2種類の陳腐化パターンが1件も残存しないこと」を終了コード0の成功として一意に検証する。`SPEC.md ` という接頭辞の有無に依存しないため、単独括弧書きも検出対象に含まれる。本コマンドは Issue ID を追跡識別子として記載する正当なコメント（例：`// Issue #123: ...`。検出対象は「Issue」単体ではなく「本Issue」「本 Issue」という自己参照表現のみに限定しているため）を誤検知しない。是正前の作業ツリーに対して本コマンドを実行すると、上記4箇所がマッチし終了コード1（失敗）を返すことを実装時に確認すること。
- 検証方法見込み: `automated`

**実装への申し送り**：本ACの機械検証コマンド（`! grep -nE 'AC-[0-9]+|本 ?Issue' src/lib/worker-selection.ts`）は実装時の一時確認用のコマンドであり、それ自体はリポジトリへ組み込まれる恒久的な回帰防止策ではない。恒久的な回帰防止は、本Issueの作業中に新規作成する `test/unit/worker-selection-reference.test.ts`（`.agent-skill-chain/scripts/worker-launch.sh`・`src/lib/worker-selection.ts` の2ファイルに対して `assert.doesNotMatch(contents, /DESIGN\.md §/, ...)` を検査するテストケースを含む）に、`src/lib/worker-selection.ts` の内容に対して `assert.doesNotMatch(contents, /AC-[0-9]+/, ...)` および `assert.doesNotMatch(contents, /本 ?Issue/, ...)` 相当の検査を追加することで実装する。これらの検査の実装内容と、その検査が実際に陳腐化パターンの再発を検知できることの機械的な自己検証は、本節に続く受入条件（テスト自体の自己検証を扱う項）が担う。

#### AC-5: 新規作成する回帰防止テストが陳腐化パターン混入を実際に検知できることを、テスト自体が機械的に自己検証する

strict spec-gateレビューにて「要件が『回帰防止テストの新規作成』を必須としているにもかかわらず、これまでの受入条件のいずれもそのテストの存在・有効性を検証しない」という指摘を受け新設する。直前の陳腐化参照除去を検証する受入条件だけでは、回帰防止テストの新規作成自体を実装セグメントが省略しても他の受入条件はすべて充足してしまい、恒久的な回帰防止という目的が達成されないままIssueが完了しうる。

strict design-gateレビューにて「本ACの当初案は、実ファイル `src/lib/worker-selection.ts` の内容に受入条件ID形式の文字列と『本Issue』という文言を連結した文字列を汚染データとして用いる構成だったが、直前の陳腐化参照除去を検証する受入条件は是正後の実ファイルからこれら2パターンが1件も残らないことを恒久的に要求するため、是正後は実ファイル由来部分が常に空文字列となり『実ファイルの内容を使う』という構成自体が意味を成さない」という自己矛盾の指摘を受け、汚染データの構成方法を全面的に書き換える。是正後の合理的な構成は、実ファイルの内容には一切依存しない、テスト内で明示的に組み立てた合成文字列リテラルを汚染データとして用いるものである。

- Given: 本Issueの作業中に新規作成する `test/unit/worker-selection-reference.test.ts` が、次の3テストケースを含むこと。(1) `.agent-skill-chain/scripts/worker-launch.sh`・`src/lib/worker-selection.ts` の2ファイルをループし禁止参照パターン `DESIGN\.md §` の不在を検査するテストケース1件。(2) `src/lib/worker-selection.ts` の内容に対し受入条件ID形式（`AC-` に数字を続けた形。直前の陳腐化参照除去を検証する受入条件の恒久検査が用いる正規表現 `/AC-[0-9]+/` が対象とする形式）の不在を検査するテストケース1件。(3) 同ファイルの内容に対し自己参照文言「本Issue」「本 Issue」（正規表現 `/本 ?Issue/` が対象とする形式）の不在を検査するテストケース1件。このうち(2)(3)が用いる上記2つの正規表現は、それぞれ定数名 `ACCEPTANCE_CRITERIA_ID_PATTERN`（受入条件ID形式検出用）・`SELF_REFERENTIAL_ISSUE_PATTERN`（自己参照Issue文言検出用）として同一ファイル内に1箇所ずつ定義し、本ACで新設する自己検証テストケースからも共有する（テストケース間でリテラルを複製しない）こと
- When: 同テストファイルへ、以下の自己検証テストケースを追加する。実ファイル `src/lib/worker-selection.ts` の内容は一切参照・使用しない。受入条件ID形式の文字列例（`AC-` という接頭辞に数字を続けた形式の文字列。正規表現 `/AC-[0-9]+/` が対象とする形式そのものであり、具体的な数字は問わない）と「本Issue」という文言例（例：`本 Issue のスコープ外`）の両方を含む、テスト内で明示的に構成した合成の文字列リテラル（実ファイルに依存しない、意図的に汚染させたin-memory文字列）を用意し、上記の共有された2つの定数 `ACCEPTANCE_CRITERIA_ID_PATTERN`・`SELF_REFERENTIAL_ISSUE_PATTERN` がこの合成汚染文字列に対して `assert.match` でマッチすることを検証する。その上で `npm test`（または `node --test test/unit/worker-selection-reference.test.ts`）を実行する
- Then: (a) 定数 `ACCEPTANCE_CRITERIA_ID_PATTERN`・`SELF_REFERENTIAL_ISSUE_PATTERN` それぞれが、上記の合成汚染文字列に対して実際にマッチすること（`assert.match` で検証）。もし正規表現の書き方に不備があり陳腐化パターンを見逃すようになっていれば、この自己検証テストケース自体が失敗し赤くなることで、回帰防止テストが「検知できない壊れた状態」のまま気付かれず放置されるリスクを防ぐ。(b) 上記2つの定数それぞれについて、定義箇所（`<定数名> = /.../` という代入式）がテストファイル内に1箇所のみ存在すること（リテラルの二重管理を避けるため。定義が2箇所以上に分裂していれば、一方の定義だけが将来書き換えられて検知力を失っても他方が誤ってマッチし続け、直前の陳腐化参照除去を検証する受入条件の恒久検査と本ACの自己検証テストケースが同一の正規表現定数を確実に共有しているとは保証できなくなる）。次の検証コマンドをリポジトリルートから実行し、いずれも出力が `1` であることを確認する。
  ```
  grep -c 'ACCEPTANCE_CRITERIA_ID_PATTERN = /' test/unit/worker-selection-reference.test.ts
  grep -c 'SELF_REFERENTIAL_ISSUE_PATTERN = /' test/unit/worker-selection-reference.test.ts
  ```
  加えて是正後の実ファイル `src/lib/worker-selection.ts` を対象とする上記3テストケースもすべて成功する（green：陳腐化パターンが実際に存在しないことの確認）。全テストケースの成功と上記2コマンドの出力がいずれも `1` であることをもって、要件が定める「受入条件ID形式の参照および『本Issue』文言が残存しないことを恒久的に機械検証する」が実効性を持って満たされていることが確認される
- 検証方法見込み: `automated`（実ファイルを一切参照せず合成文字列リテラルのみを対象とするため、CI上で安全に自動実行できる。実ファイルへ一時的に陳腐化パターンを混入させてred/greenを確認する手法は、作業ツリーの汚染・元に戻し忘れのリスクを伴うため採用しない）

## スコープ外

- `.agent-skill-chain/scripts/worker-launch.sh`・`src/lib/worker-selection.ts` の禁止参照以外の記述内容・ロジックの変更。
- `lint-references.sh`（CLI の `lint references` 実装）自体の判定ロジックの変更。
- Issue 単位の `SPEC.md`／`DESIGN.md`／`PLAN.md` が Issue 完了後に破棄される運用そのものの見直し（本 Issue はこの運用を前提として、ソースコメント側を是正する）。
- 他 PR の `verify` CI ジョブ再実行そのもの（本 Issue の変更が main にマージされた後、各 PR 側で解消される）。
- 要求ID・ADR ID・テストIDの対応を機械管理する `docs/system-spec/90-traceability/` 相当の仕組みの新設（AGENTS.mdの規定通り、ADRによる段階導入を経て別 Issue で構築する）。
- `test/` 配下（`test/unit/worker-selection.test.ts`・`test/unit/config.test.ts`・`test/unit/schema.test.ts`・`test/integration/worker-context.test.ts`・`test/integration/release.test.ts`・`test/helpers/tmp-repo.ts` 等）に存在する同種の陳腐化参照（`SPEC.md AC-...` 形式のコメント）。`lint-references.sh` の既定走査対象に `test/` が含まれないため現時点ではCIを赤化させないが、規約上は本 Issue と同種の問題であり、走査対象拡張時の再発防止も含めて別 Issue #332 で扱う。
