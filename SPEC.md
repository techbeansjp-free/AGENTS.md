# SPEC: lint-vocab: gh CLIサブコマンド引数リテラル'issue'を禁止語として誤検知し全PR CIが恒久赤化する

- Issue: `ISSUE-469`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/469-lint-vocab-cli-arg-quote`

## 目的・背景

`.agent-skill-chain/scripts/lint-vocab.sh`（`agent-skill-chain lint vocab`、実体は `src/commands/lint.ts` の `vocab()`）は、規範文書・コメント中の散文表記における禁止語（`docs/GLOSSARY.md` が定義する、旧システム名称・「issue」小文字表記等）の混入を機械検査する。検査対象を「生きたファイル」（`.agent-skill-chain/`・`src/`・`docs/` 等）とし、コード識別子文脈・YAML識別子文脈・CLIサブコマンド文脈・外部語彙許可リストという4種の除外判定（`isCodeLikeReference` / `isIdentifierContext` 系関数群、Issue #178・#187 で導入）により、コード上の正当な識別子・キー・サブコマンド利用と散文中の誤用とを区別している。

`src/lib/review-light.ts:60` の `gh(['issue', 'view', issueNumber, '--json', 'labels'], root)`（`gh issue view` サブコマンド呼び出しの引数配列、PR #460／Issue #449 でmainへ混入）は、配列要素 `'issue'`（単一引用符で囲まれた、禁止語と完全一致する単独の文字列リテラル）を含む。この箇所は既存の4種の除外判定のいずれにも該当せず、`lint vocab` が禁止語違反として誤検知する。

```
$ node bin/agents-md.js lint vocab
src/lib/review-light.ts:60: 禁止語 'issue' が見つかりました（'成果物' を使用してください）
```

この誤検知は2026-08-06時点でmain上に混入したまま解消されておらず、`agent-skill-chain / ci` workflowの `verify` ジョブがmain・全オープンPR（本Issueと無関係な変更を含む）で恒久的にfailし続けている。現状は個々のPRを `gh pr merge --admin` でブランチ保護をバイパスしてマージする運用回避で凌いでいるが、CIがlintの意味のある結果を示さなくなっており、自身の変更内容の正当性を機械的に確認できない状態が続いている。

これはIssue #461（`verify-spec-bdd` のプレースホルダ誤検知）と同種の、「lintツールが規範文書用の検査ルールで正当なコード記法・API引数を誤検知する」再発パターンである。

## 要求 → 要件 → 受入条件

### 要求

進行役（adachi-tatsuru）からの要求: `gh(['issue', 'view', ...])` のような、単一引用符で囲まれた禁止語と完全一致する文字列リテラルがコード上の配列要素・関数引数として単独で使われる箇所を `lint vocab` が誤検知しないようにし、main・全PRのCIを恒久赤化状態から回復させたい。修正は既存の散文誤用検出・識別子文脈判定の精度を後退させない形で行う。

### 要件

- 要件1: 非散文ファイル（`.md` 以外の、コード・設定・スクリプト等の「生きたファイル」）において、禁止語と完全一致する文字列が単一引用符（`'`）で囲まれ、かつ配列要素・関数呼び出し引数等のプログラムコード上の値として単独のトークンで出現する場合、`lint vocab` はこれを禁止語違反として検出しない。
- 要件2: 要件1の除外は、既存のダブルクォート（`"`）境界判定・コード識別子文脈・YAML識別子文脈・CLIサブコマンド文脈（`cliVerbs()` ホワイトリストに基づく判定）・外部語彙許可リストのいずれの既存動作にも退行を生じさせない。特に、散文（`.md`）中の禁止語誤用、複合識別子でない単独のbare識別子（例: 変数名がちょうど禁止語と一致する場合）、区切り文字の無い屈折形の扱いなど、既存テスト（`test/integration/lint.test.ts`）が固定している挙動は全て現状のまま維持する。
- 要件3: 要件1の除外は、`src/lib/review-light.ts:60` の実際の混入箇所を含め、一般化された規則（個別ファイル・個別行のハードコード例外ではない）として機能する。
- 要件4: 修正後、mainブランチおよび既存オープンPRの `agent-skill-chain / ci` workflowの `verify` ジョブが、本Issueが報告した誤検知を原因とするfailureを起こさなくなる。
- 要件5: 対応は自動化されたテストで再現・検証可能な形にする（`test/integration/lint.test.ts` 等に、修正前は失敗し修正後は成功する回帰テストケースを追加できること）。

### 受入条件（Acceptance Criteria）

#### AC-1: review-light.ts:60の実際の混入箇所が誤検知されなくなる

- Given: `src/lib/review-light.ts` の60行目に `gh(['issue', 'view', issueNumber, '--json', 'labels'], root)` が存在する
- When: `agent-skill-chain lint vocab`（`.agent-skill-chain/scripts/lint-vocab.sh` 経由、または対象を `src/lib/review-light.ts` に絞った直接実行）を実行する
- Then: 当該行が禁止語 `'issue'` の違反として報告されない
- 検証方法見込み: `automated`

#### AC-2: 単一引用符で囲まれた単独の禁止語リテラルが非散文コード中の配列・関数引数として使われる一般ケースで誤検知しない

- Given: `.ts` 等の非散文ファイルに、単一引用符で囲まれた禁止語のみから構成される文字列リテラルが、カンマ区切りの配列要素または関数呼び出し引数として単独のトークンで出現する行が複数（`review-light.ts:60` 以外の新規ケースを含む）ある
- When: `lint vocab` を実行する
- Then: いずれの箇所も違反として検出されない
- 検証方法見込み: `automated`

#### AC-3: 散文（.md）中の禁止語誤用は引き続き検出される（退行なし）

- Given: `.md` ファイル中に、単一引用符で禁止語を囲んだ表記を含め、禁止語が散文中の誤用として出現する行がある（既存の `test/integration/lint.test.ts` が定義するケースと同等の内容）
- When: `lint vocab` を実行する
- Then: 修正前と同様に違反として検出される
- 検証方法見込み: `automated`

#### AC-4: 既存の識別子文脈・YAML文脈・CLIサブコマンド文脈・屈折形・外部語彙許可リストの判定結果に変化がない（regressionなし）

- Given: `test/integration/lint.test.ts` が既に定義している全ケース（コード識別子文脈、YAML識別子文脈、CLIサブコマンド文脈、散文中の偶然の共起、屈折形、外部語彙許可リスト等）
- When: 修正後の `lint vocab` を実行する
- Then: 全ケースが現行の期待結果（既存のassertion）と一致し、既存テストが全て成功する
- 検証方法見込み: `automated`

#### AC-5: main・新規PRのCI（agent-skill-chain / ci workflowのverifyジョブ）が本誤検知を原因として失敗しなくなる

- Given: 本Issueの修正を含むPRがマージされた状態のmain
- When: main上、または本Issue修正をベースとする新規PR上で `agent-skill-chain / ci` workflowが実行される
- Then: 本Issueが報告した `lint vocab` の誤検知（`review-light.ts:60` の `'issue'`）を原因とする `verify` ジョブのfailureが発生しない
- 検証方法見込み: `hybrid`

## スコープ外

- `src/lib/review-light.ts` 自体のロジック変更。`gh(['issue', 'view', ...])` という `gh issue view` 呼び出し自体は正当な実装であり、変更対象ではない。
- `docs/GLOSSARY.md` が定義する禁止語一覧・禁止語自体の定義の変更。
- 既存のダブルクォート境界判定・CLIサブコマンド動詞ホワイトリスト（`cliVerbs()`、agent-skill-chain自身のCLIルートから導出）の仕組み自体の再設計。要件2が求めるのはこれらの既存動作の維持であり、置き換えではない。
- `gh` CLI固有の全サブコマンド・全引数を網羅する個別ホワイトリストの整備。本Issueが対応するのは引用符付き単独文字列リテラルという構文パターンの一般的な認識であり、外部CLIツールごとの語彙整備ではない。
- `lint references`・`lint adr`・`lint secrets` 等、`lint vocab` 以外のサブコマンドの検査ロジック変更。
- 現状運用されている `gh pr merge --admin` によるブランチ保護バイパス運用そのものの廃止判断（本Issueの修正によりCIが正常化すれば、当該運用回避が不要になることが期待されるが、運用手順自体の変更は別途の判断とする）。
