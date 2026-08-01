# SPEC: worker-selection関連ファイルの禁止参照（セクション番号参照）を是正しmainのCIを復旧する

- Issue: `ISSUE-325`
- 作成者: `agent-skill-chain worker`
- 対象ブランチ: `bugfix/325-worker-selection-forbidden-reference`

## 目的・背景

`origin/main`（v0.2.24、Issue #307 / PR #308マージ後）の以下2ファイルのコメント内に、AGENTS.mdが禁止するセクション参照（`§選択解決の設計`）が混入している。

- `.agent-skill-chain/scripts/worker-launch.sh`（該当コメント行）
- `src/lib/worker-selection.ts`（該当コメント行）

AGENTS.mdは、規範文書・ソースコードコメント中のセクション番号参照・ファイルパス＋行番号参照を禁止している。セクション追加・ファイル分割・見出し移動のたびに参照が陳腐化し、AIがその陳腐化に気付かず古い位置情報を正しいものとして誤解釈するためである。この規約は `.agent-skill-chain/scripts/lint-references.sh`（実体は agent-skill-chain CLI の `lint references` サブコマンド）が機械検査する。

上記2箇所の参照先は、Issue #307 の作業中に一時的に存在した Issue 単位の `DESIGN.md` の見出し「選択解決の設計」である。Issue 単位の `SPEC.md`／`DESIGN.md`／`PLAN.md` はその Issue の作業期間中のみ存在し、Issue 完了後は破棄される一時成果物であり、`lint references` が見出し解決に使う走査対象（AGENTS.md・`docs/GLOSSARY.md`・`.agent-skill-chain/{standards,templates,config,schemas,scripts,ci}/`・`src/`・`.github/workflows/`）にも含まれない。そのため当該参照は現時点で見出しテキストによる解決ができず、`lint-references.sh` が exit 1 で禁止参照として報告する。`.github/workflows/agent-skill-chain-ci.yml` の `verify` ジョブは `on: pull_request` のみで起動し main への push では起動しないため、main 自体でジョブが失敗するのではなく、main をマージ済みの各オープン PR で `verify` ジョブが個別に失敗し、結果として複数 PR で CI が連鎖的に赤くなっている。

本 Issue は、この2箇所の禁止参照を是正し、`lint-references.sh` を main 上で exit 0 に復旧することを目的とする。

## 要求 → 要件 → 受入条件

### 要求

- main の `verify` CI ジョブを復旧し、連鎖的に失敗している他 PR の CI 状態を正常化したい（リポジトリ利用者・他 Issue 作業者からの実務上の要求）。

### 要件

- `.agent-skill-chain/scripts/worker-launch.sh` と `src/lib/worker-selection.ts` の該当コメントから、AGENTS.md「参照・コメントの陳腐化防止」節が禁止するセクション番号参照を除去する。
- 除去にあたり、当該コメントが元々説明していた設計判断（意味的内容）を失わない。参照先の見出しに書かれていた契約の要旨がコメント本文に既に記載されていない場合は、その場に書き下す。
- `src/lib/worker-selection.ts` 冒頭コメント1行目は、`正本:` に続けて `AGENTS.md §設定` ・ 受入条件番号の列挙 ・ `DESIGN.md` 見出し参照の3つをスラッシュ区切りで並べる記法だった。このうち受入条件番号の列挙部分（Issue単位で破棄される `SPEC.md` の受入条件を1番・2番・3番・9番の4件挙げていた参照）を除去する。この参照は `lint-references.sh` の `§` パターン検出では捕捉されないが、AGENTS.md「参照・コメントの陳腐化防止」節が定める「ソースコードコメントの追跡識別子として認めるのは Issue ID のみであり、要求ID・ADR ID・テストIDの対応はソースコメントではなく別途のtraceability情報で管理する」という規約に抵触する陳腐化参照であり、本 Issue の是正対象に含める。除去後は `正本: AGENTS.md §設定` のみを残す（`DESIGN.md` 見出し参照部分は前項の `§` パターン除去対象に含まれる）。
- コメント修正はコードの実行内容（ロジック・振る舞い）を一切変更しない。

### 受入条件（Acceptance Criteria）

#### AC-1: `lint-references.sh` が exit 0 で成功する

- Given: `.agent-skill-chain/scripts/worker-launch.sh` と `src/lib/worker-selection.ts` のコメント修正を適用した作業ツリー
- When: `.agent-skill-chain/scripts/lint-references.sh`（デフォルト対象＝生きたファイル全体）を実行する
- Then: 禁止参照が0件で終了コード0を返す
- 検証方法見込み: `automated`

#### AC-2: 該当2ファイルのコメントが説明していた設計判断の意味的内容が失われない

- Given: 修正前の `worker-launch.sh` 該当コメント（「worker context 自体の失敗（設定不正・ティア解決失敗）は、まだ何も起動していない段階のエラーとして扱う」という設計判断）、および修正前の `worker-selection.ts` 冒頭コメント（1行目は `正本:` に続けて `AGENTS.md §設定` ・ 受入条件番号の列挙（Issue単位で破棄される `SPEC.md` の受入条件を1番・2番・3番・9番の4件挙げる参照） ・ `DESIGN.md` の見出し「選択解決の設計」への参照の3つをスラッシュ区切りで並べる記法であり、当該モジュール自身が正本であるという宣言ではなく、当該モジュールが従うべき上流の正本文書・関連文書を列挙する記法である（本リポジトリの `正本:` コメント記法の通例。例：`.agent-skill-chain/scripts/lint-references.sh`・`.agent-skill-chain/ci/verify-branch-name.sh` 冒頭も同記法）。モジュール自体の責務宣言（セグメント作業ワーカー起動時の adapter・model_tier・reasoning_effort・具体的なモデル文字列を config とセグメント名だけから決める純粋関数群であること、ティア名から具体的なモデル文字列への解決＝`resolveModelForTier` をここで完結させ、`.agent-skill-chain/adapters/codex.sh` 等のアダプタは解決済みの値を環境変数経由で受け取るだけであること）は1行目ではなく、1行目に続くモジュール概要のコメント本文（config とセグメント名だけから adapter・model_tier・reasoning_effort・モデル文字列を決める、という記述が続く箇所）に存在する）
- When: 禁止参照を除去する修正を適用する
- Then: 上記の設計判断（`worker-launch.sh`）・モジュール責務宣言（`worker-selection.ts` の1行目に続くモジュール概要のコメント本文）のいずれも、修正後のコメント本文（除去箇所の周辺に既に存在する記述、または新たに書き下した記述）から読み取れる状態を維持する。参照の除去のみを理由に説明内容が欠落しない
- 検証方法見込み: `manual`（コメント修正前後の内容比較によるレビュー）

#### AC-3: 既存の build・self-test・その他 CI ジョブに regression が無い

- Given: `.agent-skill-chain/scripts/worker-launch.sh` と `src/lib/worker-selection.ts` のコメント修正を適用した作業ツリー
- When: `npm run build`、`npm test`、`.agent-skill-chain/scripts/lint-vocab.sh`、`.agent-skill-chain/scripts/adr-lint.sh check` を実行する
- Then: いずれも修正前と同じ結果（成功）で終了する。コメントのみの変更でありコードの実行内容を変えないため、単体テストの結果に変化が無い
- 検証方法見込み: `automated`

#### AC-4: `worker-selection.ts` 冒頭コメントから要求ID列挙の陳腐化参照が除去される

- Given: 修正前の `src/lib/worker-selection.ts` 冒頭1行目（`正本:` に続けて `AGENTS.md §設定` ・ 受入条件番号の列挙（Issue単位で破棄される `SPEC.md` の受入条件を1番・2番・3番・9番の4件挙げる参照） ・ `DESIGN.md` の見出し「選択解決の設計」への参照をスラッシュ区切りで並べる記法だった1行）
- When: 当該行から受入条件番号の列挙部分（Issue 完了後に破棄される `SPEC.md` の受入条件ID列挙）を除去する修正を適用する
- Then: 修正後の1行目は `// 正本: AGENTS.md §設定` のみとなり、`! grep -q 'SPEC\.md AC-' src/lib/worker-selection.ts` を実行した終了コードが0（成功）を返す（`grep -q` はマッチが無いとき終了コード1を返すため、それを `!` で反転することで「マッチが存在しないこと」を終了コード0の成功として一意に検証する）。当該行以外の箇所にも同様の要求ID・ADR ID・テストID列挙参照が新たに混入しない
- 検証方法見込み: `automated`

## スコープ外

- `.agent-skill-chain/scripts/worker-launch.sh`・`src/lib/worker-selection.ts` の禁止参照以外の記述内容・ロジックの変更。
- `lint-references.sh`（CLI の `lint references` 実装）自体の判定ロジックの変更。
- Issue 単位の `SPEC.md`／`DESIGN.md`／`PLAN.md` が Issue 完了後に破棄される運用そのものの見直し（本 Issue はこの運用を前提として、ソースコメント側を是正する）。
- 他 PR の `verify` CI ジョブ再実行そのもの（本 Issue の変更が main にマージされた後、各 PR 側で解消される）。
- 要求ID・ADR ID・テストIDの対応を機械管理する `docs/system-spec/90-traceability/` 相当の仕組みの新設（AGENTS.mdの規定通り、ADRによる段階導入を経て別 Issue で構築する）。
- `test/` 配下（`test/unit/worker-selection.test.ts`・`test/unit/config.test.ts`・`test/unit/schema.test.ts`・`test/integration/worker-context.test.ts`・`test/integration/release.test.ts`・`test/helpers/tmp-repo.ts` 等）に存在する同種の陳腐化参照（`SPEC.md AC-...` 形式のコメント）。`lint-references.sh` の既定走査対象に `test/` が含まれないため現時点ではCIを赤化させないが、規約上は本 Issue と同種の問題であり、走査対象拡張時の再発防止も含めて別 Issue #332 で扱う。
