# SPEC: gate-local-review の信頼 clone が consumer project のビルド成功を前提とし、ローカルゲートレビューを実行できない

- Issue: `ISSUE-759`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/759-trusted-clone-build-prerequisite`

## 目的・背景

`.agent-skill-chain/scripts/gate-local-review.sh` は、レビュア起動の前に protected base SHA の隔離 clone を作り、その中で依存導入とビルドを行う。この隔離 clone は「verdict を記録する実行コードが、審査対象のコードではなく保護された base のコードであること」を担保するための仕組みであり、AGENTS.md の不変条件 I5（進行役の純粋性・成果物への非関与）と、証跡に記録される launcher digest の意味を支えている。**本 Issue の目的は、この担保を維持したまま、準備段が consumer project 側のビルド構成・ビルド成否に依存しない状態にすることである。**

現状の準備段は無条件に `npm ci --ignore-scripts` と `npm run build` を実行する。`npm run build` は実行対象リポジトリの `package.json` が定義する任意の処理であり、agent-skill-chain 本体の CLI 生成とは無関係でありうる。その結果、配布先（consumer project）では次の2形態で全ローカルゲートが起動不能になっている。

- Node consumer（WordPress テーマ、webpack 構成）: `npm ci` は成功するが `npm run build` が非0終了し、レビュア起動へ到達しない。
- 非 Node consumer（`package.json` を持たない）: `npm ci --ignore-scripts` の時点で停止する。回避には `npm` を成功扱いにする shim を PATH 先頭へ置く必要があった。

これは「全4ゲートがローカルで実行できない」ことを意味し、配布先の作業を完全に停止させる。

## 用語

| 用語 | 本 SPEC での意味 |
|---|---|
| consumer project | agent-skill-chain を導入した配布先リポジトリ。agent-skill-chain 本体のソースを持たない。 |
| 信頼 clone | `gate-local-review` が protected base SHA へ checkout して作る一時 clone。以降の実行コードの供給元。 |
| 準備段 | 信頼 clone の作成から、レビュア起動スクリプトを呼ぶ直前までの区間（依存導入・ビルドを含む）。 |
| レビュア起動段 | 準備段の完了後、隔離環境内の起動スクリプトがレビュアを起動し、verdict を証跡へ記録する区間。 |
| 信頼実行環境 | レビュア起動・prompt 生成・verdict 記録に使う実行コードと asset 一式が、審査対象由来でないと確認できる実行環境。 |

## 前提・入力・出力

- 対象は GitHub モードのローカルゲートレビュー経路である（本経路は GitHub の PR metadata 取得を前提に実装されている）。
- 入力は Issue ID・ゲート ID・レビュープロファイル・target SHA・base SHA・PR 番号・adapter 指定と、実行環境（protected base worktree、Node/npm の有無、導入済み agent-skill-chain CLI の有無）である。
- 出力は、レビュア起動と証跡投稿の実行、または前提不成立を示す非0終了と日本語メッセージである。
- 本 SPEC は要求と受入条件のみを定める。実現手段（隔離 clone 内でのビルド範囲の限定、配布済み CLI の利用、事前ビルド済み成果物の利用等）は設計セグメントで確定する。

## 実地確認した事実（原文引用）

準備段が無条件であること（`.agent-skill-chain/scripts/gate-local-review.sh`。引用は連続する原文で、行番号は付さない）:

```bash
# bin/ と node_modules/ はgitignoredであり、main worktreeのclean判定だけでは由来を証明できない。
# GitHubが返したbase SHAを一時cloneへcheckoutし、lockfileから依存を復元してbase sourceをbuildする。
# 以降はこの隔離clone内のCLI/adapterだけを使用し、source worktreeの生成物を実行しない。
TRUSTED_TMP="$(mktemp -d "${TMPDIR:-/tmp}/agent-skill-chain-local-review.XXXXXX")"
trap 'rm -rf -- "$TRUSTED_TMP"' EXIT
TRUSTED_ROOT="$TRUSTED_TMP/repo"
git clone --quiet --no-checkout "$REPO_ROOT" "$TRUSTED_ROOT"
```

```bash
(
  cd -- "$TRUSTED_ROOT"
  npm ci --ignore-scripts
  npm run build
)
```

無条件であることは既存の統合テストの期待値にも固定されている（`test/integration/gate-local-review.test.ts`）:

```ts
  assert.deepEqual(fs.readFileSync(fixture.npmTrace, 'utf8').trim().split('\n'), ['ci --ignore-scripts', 'run build']);
```

consumer project には agent-skill-chain 本体のソースもビルド定義も配布されない（`src/lib/asset-manifest.ts`）:

```ts
export const ROOT_LEVEL_ENTRIES = ['AGENTS.md', 'CLAUDE.md', path.join('docs', 'GLOSSARY.md')];
```

```ts
export const NAMESPACED_ENTRIES = ['standards', 'templates', 'schemas', 'config', 'adapters', 'scripts', 'ci', 'hooks'];
```

したがって consumer の信頼 clone で走る `npm run build` は consumer 自身のビルドであり、agent-skill-chain の CLI を生成しない。CLI の供給は別経路が担う（`.agent-skill-chain/scripts/cli-resolve.sh`）:

```bash
  if [[ -f "$_ASC_CLI_REPO_ROOT/bin/agents-md.js" ]]; then
    ASC_CLI=(node "$_ASC_CLI_REPO_ROOT/bin/agents-md.js")
    return 0
  fi

  if [[ -x "$_ASC_CLI_REPO_ROOT/node_modules/.bin/agent-skill-chain" ]]; then
    ASC_CLI=("$_ASC_CLI_REPO_ROOT/node_modules/.bin/agent-skill-chain")
    return 0
  fi
```

同じ根本原因は配布 CI テンプレートでは既に解消されている（`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml`）:

```yaml
      - name: Detect npm build prerequisites
        id: npm-prereq
        run: |
          if [[ -f package.json && ( -f package-lock.json || -f npm-shrinkwrap.json ) ]]; then
            echo "ci=true" >> "$GITHUB_OUTPUT"
```

信頼境界の担保は準備段のビルドそのものではなく、記録時の検査と digest が担っている（`src/commands/gate.ts`）:

```ts
    if (executionRoot !== root) throw new CliError('Issue worktreeのcandidate recorderからevidenceを投稿できません');
```

```ts
    if (head !== trustedBaseSha) throw new CliError('recorder HEADがtrusted base SHAと一致しません');
```

```ts
function localReviewLauncherDigest(root: string, trustedBaseSha: string): string {
  const blobs = LOCAL_REVIEW_LAUNCHER_PATHS.map((launcherPath) => {
    const shown = git(['show', `${trustedBaseSha}:${launcherPath}`], root);
    if (shown.status !== 0) throw new CliError(`trusted baseのlauncher構成を読めません: ${launcherPath}`);
```

その digest 算出対象には、配布対象に含まれない project policy 文書が含まれる（`src/commands/gate.ts`）:

```ts
  '.agent-skill-chain/project/manifest.yaml',
  '.agent-skill-chain/project/MODEL_TIER_TABLE.md',
```

## 要求 → 要件 → 受入条件

### 要求

配布先の利用者として、consumer project から信頼境界を損なわずにローカルゲートレビューを実行したい。実行可否が consumer 自身のビルド構成・ビルド成否に左右されない状態にしたい。

### 要件

- 要件1: 準備段の目的を「信頼実行環境の用意」に限定し、consumer project 固有のビルド処理の成否を前提としない。
- 要件2: `package.json`・lockfile・build script のいずれも持たない consumer project でも準備段が成立する。
- 要件3: 信頼実行環境は次の全てを満たす。(a) レビュア起動・prompt 生成・verdict 記録に使う実行コードと asset が、審査対象（target SHA の Issue worktree）由来でない。(b) その由来が実行時に識別でき、証跡へ記録される値（trusted base SHA・launcher digest・隔離種別）が引き続き埋まる。(c) 隔離環境が credential を伴う remote を保持しない。
- 要件4: 信頼実行環境を用意できない場合は実行しない。審査対象コードへのフォールバックを行わず、非0終了と、不成立の前提および是正手段を含む日本語メッセージを出す。
- 要件5: 既存の拒否経路（Issue worktree からの記録、recorder HEAD 不一致、protected base worktree の dirty）は現状のまま有効である。

### 受入条件（Acceptance Criteria）

#### AC-1: 非 Node consumer で準備段が成立する

- Given: `package.json` も lockfile も持たない consumer project の protected base worktree（既存のローカルレビュー統合テストと同種の stub 構成）
- When: 当該リポジトリの base SHA・target SHA に対してローカルゲートレビューを実行する
- Then: 準備段が依存導入・ビルドの不在を理由に停止せず、隔離 clone 内のレビュア起動スクリプトが呼ばれる。npm 呼び出し記録に `ci --ignore-scripts` と `run build` のいずれも含まれない
- 検証方法見込み: `automated`

#### AC-2: consumer 自身のビルド失敗が準備段を止めない

- Given: `package.json` と lockfile を持ち、build script が非0終了する consumer project
- When: 当該リポジトリに対してローカルゲートレビューを実行する
- Then: 準備段が当該ビルドの失敗を理由に停止せず、隔離 clone 内のレビュア起動スクリプトが呼ばれる
- 検証方法見込み: `automated`

#### AC-3: 実行コードの由来が審査対象でない

- Given: consumer project でレビュア起動段へ到達した実行
- When: レビュア起動スクリプトが実行される
- Then: そのスクリプトと adapter の解決元が Issue worktree（target SHA の作業ツリー）ではなく、base SHA の隔離 clone であることを実行時の値で確認でき、隔離 clone に remote が残っていない
- 検証方法見込み: `automated`

#### AC-4: 既存の拒否経路が維持される

- Given: recorder の HEAD が trusted base SHA と異なる場合、Issue worktree から記録を試みる場合、protected base worktree が dirty な場合のそれぞれ
- When: ローカルゲートレビューまたは証跡投稿を実行する
- Then: いずれも現状と同じく非0終了し、`recorder HEADがtrusted base SHAと一致しません`・`Issue worktreeのcandidate recorderからevidenceを投稿できません`・`protected base worktreeがdirtyです` の各メッセージが失われていない
- 検証方法見込み: `automated`

#### AC-5: 信頼実行環境を用意できない場合は明示的に失敗する

- Given: 隔離 clone 内で agent-skill-chain CLI を解決できず、自動導入も許可されていない実行環境（`AGENT_SKILL_CHAIN_AUTO_INSTALL=0` 等）
- When: ローカルゲートレビューを実行する
- Then: 非0終了し、標準エラーへ不成立の前提と是正手段を含む日本語メッセージを出す。レビュアを起動しないまま終了コード 0 で終わらない
- 検証方法見込み: `automated`

#### AC-6: agent-skill-chain 自身での実行が回帰しない

- Given: `package.json`・lockfile・build script を持ち、ビルドが CLI 実体を生成する本リポジトリ
- When: ローカルゲートレビューを実行する
- Then: 従来どおり base SHA の隔離 clone から解決した CLI と adapter で動作し、Issue worktree のビルド生成物を実行しない
- 検証方法見込み: `automated`

## 制約

- 信頼境界を弱める解を採らない。Issue worktree のコードをそのまま実行する（隔離 clone を廃してビルドを省く）方針は不変条件 I5 に反するため不可とする。
- 安全側ラチェット（不変条件 I8）に従い、前提不成立時は成功側へ倒さない。
- 全4ゲートと全実行環境の直積を受入条件として要求しない。AC は代表構成（非 Node consumer・ビルド失敗 consumer・本リポジトリ）で判定する。
- 変更は配布物（`.agent-skill-chain/` 配下と CLI 実装）に閉じ、consumer 側の作業を追加要求しない。

## 完了条件

- AC-1 から AC-6 の全てについて検証方法と証跡が対応している。
- 既存の gate-local-review 統合テストが、変更後の期待値へ更新されたうえで成功する。
- `verify doc-length`・`verify spec-bdd`・`lint references`・`lint vocab`・`lint secrets`・`adr-lint` を含む PR の CI が成功する。

## 未決事項

- 信頼実行環境の具体的な調達手段（隔離 clone 内でのビルド範囲の限定、導入済み配布パッケージの利用、事前ビルド済み成果物の利用のいずれか、またはその組み合わせ）は設計セグメントで確定する。
- 調達手段が「隔離 clone 外の配布パッケージ」を含む場合、その版と由来を証跡へどう記録するか（既存の launcher digest との関係）は設計セグメントで確定する。
- 実地確認した隣接事実として、launcher digest の算出対象 `LOCAL_REVIEW_LAUNCHER_PATHS` には `.agent-skill-chain/project/manifest.yaml` と `.agent-skill-chain/project/MODEL_TIER_TABLE.md` が含まれる一方、配布対象を定める `NAMESPACED_ENTRIES` は `project` を含まない。この不整合は準備段より後段（証跡投稿）で顕在化しうる別事象であり、本 Issue では扱わず、別 Issue の起票を要する。

## スコープ外

- Issue #762（レビュアの証跡投稿が無言で失敗し、strict の片側 slot が欠落したまま終了コード 0 で完了する事象）。本 Issue は準備段のビルド前提のみを対象とし、レビュア起動後の投稿成否の検査・診断保全は #762 の射程とする。
- 短縮 SHA を渡した場合の受理およびメッセージ改善（Issue 本文の併記報告）。原因は引数の正規化であり準備段のビルド前提とは独立であるため、別 Issue で扱う。
- Issue #757 の回避策（protected base worktree の設定変更）とローカルゲート実行の同時成立。原因は当該回避運用側にあり、本 Issue では扱わない。
- launcher digest が要求する project policy 文書が consumer に存在しない件（未決事項に記載）。
- GitHub Actions 上での自動ゲート検証 workflow の再導入。
- ローカルモード（Coordination Backend がローカル）でのゲート実行経路。
