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

さらに、準備段を通過しても consumer project では証跡投稿が成立しない。証跡へ記録する launcher digest の算出対象に、配布対象外の project policy 文書が含まれているためである（後述「実地確認した事実」）。準備段だけを直しても「consumer から信頼境界を損なわずにローカルゲートレビューを実行する」という要求は満たされないため、本 Issue は launcher digest の算出対象の見直しも対象に含める。

## 用語

| 用語 | 本 SPEC での意味 |
|---|---|
| consumer project | agent-skill-chain を導入した配布先リポジトリ。agent-skill-chain 本体のソースを持たない。 |
| 信頼 clone | `gate-local-review` が protected base SHA へ checkout して作る一時 clone。以降の実行コードの供給元。 |
| 準備段 | 信頼 clone の作成から、レビュア起動スクリプトを呼ぶ直前までの区間（依存導入・ビルドを含む）。 |
| レビュア起動段 | 準備段の完了後、隔離環境内の起動スクリプトがレビュアを起動し、verdict を証跡へ記録する区間。 |
| 信頼実行環境 | レビュア起動・prompt 生成・verdict 記録に使う実行コードと asset 一式が、審査対象由来でないと確認できる実行環境。 |
| 配布集合 | `agent-skill-chain` が consumer project へ配布し、導入済み consumer に必ず存在する asset の集合（`ROOT_LEVEL_ENTRIES` と `NAMESPACED_ENTRIES` が定める範囲）。 |

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

準備段より前の拒否経路（同 `gate-local-review.sh`）:

```bash
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
  echo "protected base worktreeがdirtyです。review evidenceを投稿しません。" >&2
  exit 1
fi
```

consumer project には agent-skill-chain 本体のソースもビルド定義も配布されない（`src/lib/asset-manifest.ts`）:

```ts
export const ROOT_LEVEL_ENTRIES = ['AGENTS.md', 'CLAUDE.md', path.join('docs', 'GLOSSARY.md')];
```

```ts
/**
 * `.agent-skill-chain/` 配下の名前空間一覧。`project/` は意図的に含めない
 * （consumer project 固有ポリシーであり、`upgrade`/`uninstall` の対象から常に除外するため）。
 */
export const NAMESPACED_ENTRIES = ['standards', 'templates', 'schemas', 'config', 'adapters', 'scripts', 'ci', 'hooks'];
```

導入時に consumer 側へ生成される project policy 文書は2件だけであり、`MODEL_TIER_TABLE.md` は生成されない（`src/lib/project-policy-scaffold.ts`）:

```ts
  const manifestSrc = resolveAsset(path.join('templates', 'project-policy', 'manifest.yaml'), targetDir);
  const rulesSrc = resolveAsset(path.join('templates', 'project-policy', 'RULES.md'), targetDir);
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

CLI の解決元はスクリプト自身の配置位置から導かれるが、そこに実体が無い場合は PATH 上の実体へも解決する（同 `.agent-skill-chain/scripts/cli-resolve.sh`）:

```bash
_ASC_CLI_RESOLVE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
_ASC_CLI_REPO_ROOT="$(cd -- "$_ASC_CLI_RESOLVE_DIR/../.." &>/dev/null && pwd)"
```

```bash
  local path_cli
  if path_cli="$(command -v agent-skill-chain 2>/dev/null)" \
    && [[ -f "$path_cli" && -x "$path_cli" && -s "$path_cli" ]] \
    && "$path_cli" --help >/dev/null 2>&1; then
    ASC_CLI=("$path_cli")
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

証跡へ記録される実行環境の値（同 `src/commands/gate.ts`）:

```ts
      execution: {
        launcher: 'agent-skill-chain/gate-local-review/v1',
        trusted_base_sha: trustedBaseSha,
        launcher_digest: launcherDigest,
        launcher_token_digest: launcherToken.digest,
        isolation: 'ephemeral_clone',
        sandbox: 'read_only',
      },
```

launcher digest は固定パス集合の全件取得に成功しなければ算出できず、算出対象には配布集合外の project policy 文書2件が含まれる（同 `src/commands/gate.ts`）:

```ts
const LOCAL_REVIEW_LAUNCHER_PATHS = [
  '.agent-skill-chain/scripts/gate-local-review.sh',
  '.agent-skill-chain/scripts/gate-launch-reviewer.sh',
  '.agent-skill-chain/scripts/gate-review.sh',
  '.agent-skill-chain/adapters/claude.sh',
  '.agent-skill-chain/adapters/codex.sh',
  '.agent-skill-chain/adapters/human.sh',
  '.agent-skill-chain/config/roles.yaml',
  '.agent-skill-chain/project/manifest.yaml',
  '.agent-skill-chain/project/MODEL_TIER_TABLE.md',
  '.agent-skill-chain/schemas/gate-report.schema.yaml',
  '.agent-skill-chain/schemas/project-policy.schema.yaml',
] as const;
```

```ts
  const blobs = LOCAL_REVIEW_LAUNCHER_PATHS.map((launcherPath) => {
    const shown = git(['show', `${trustedBaseSha}:${launcherPath}`], root);
    if (shown.status !== 0) throw new CliError(`trusted baseのlauncher構成を読めません: ${launcherPath}`);
    return { path: launcherPath, digest: digestOf(shown.stdout) };
  });
```

隔離環境から credential を伴う remote を除く処理は remote の削除である（同 `.agent-skill-chain/scripts/gate-local-review.sh`）:

```bash
# reviewerにcredential-bearing remote URLやglobal Git設定を見せない。target objectはlocal clone済みなので
# remoteを削除してもgit showによるread-only成果物参照は維持できる。
git -C "$TRUSTED_ROOT" remote remove origin
```

コアレビュー方針・分類の読み取り元は隔離 clone ではなく protected base worktree の root である（同 `src/commands/gate.ts`）:

```ts
    // reviewer policy/classifierはprotected base（main worktree）をtrust rootとし、Issue worktreeが
    // 同じPRで変更したcandidate policyを自己承認に使わない。
    const policyRoot = root;
```

方針文書を持たないリポジトリでは方針そのものが解決されず、そこから導かれる制約も生じない（`src/lib/model-selection.ts`）:

```ts
  const manifestPath = path.join(root, '.agent-skill-chain', 'project', 'manifest.yaml');
  if (!fs.existsSync(manifestPath)) return undefined;
```

```ts
  const policy = loadCoreReviewPolicy(root);
  if (!policy) {
    return { required: false, status: 'resolved', reason: 'policy_absent', changed_paths: [] };
  }
```

証跡の trusted actor を解決する方針は GitHub の保護された default branch から取得する（同 `src/lib/model-selection.ts`）:

```ts
/** Issue #680: evidenceの信頼元はGitHub上の保護されたdefault branchから読む。 */
export function loadProtectedCoreReviewPolicy(root: string): CoreReviewPolicy | undefined {
```

## 要求 → 要件 → 受入条件

### 要求

配布先の利用者として、consumer project から信頼境界を損なわずにローカルゲートレビューを実行し、その結果を証跡として記録したい。実行可否が consumer 自身のビルド構成・ビルド成否に左右されない状態にしたい。

### 要件

- 要件1: 準備段の目的を「信頼実行環境の用意」に限定し、consumer project 固有のビルド処理を起動せず、その成否を前提としない。
- 要件2: `package.json`・lockfile・build script のいずれも持たない consumer project でも準備段が成立する。
- 要件3: 信頼実行環境は次の全てを満たす。(a) レビュア起動・prompt 生成・verdict 記録に使う実行コードと asset が、審査対象（target SHA の Issue worktree）由来でない。(b) その由来が実行時に識別でき、証跡へ記録される値（trusted base SHA・launcher digest・隔離種別）が consumer project での実行においても実際に埋まる。(c) 隔離環境が credential を伴う remote を保持しない。
- 要件4: 信頼実行環境を用意できない場合は実行しない。審査対象コードへのフォールバックを行わず、非0終了と、不成立の前提および是正手段を含む日本語メッセージを出す。
- 要件5: 既存の拒否経路（Issue worktree からの記録、recorder HEAD 不一致、protected base worktree の dirty）は現状のまま有効である。
- 要件6: launcher digest の算出対象は配布集合の要素のみで構成する。配布集合外の文書（consumer 固有 project policy 文書を含む）は算出対象に含めず、その有無・内容によって証跡記録が失敗せず digest 値も変動しない。

要件6 を置く理由（必要性）: 要件3(b) は consumer project の実行でも launcher digest が埋まることを要求するが、現行の算出対象には consumer へ配布も生成もされない `.agent-skill-chain/project/MODEL_TIER_TABLE.md` が含まれ、全件取得に失敗すると算出が例外で停止する（実地確認した事実の `NAMESPACED_ENTRIES`・`src/lib/project-policy-scaffold.ts`・`LOCAL_REVIEW_LAUNCHER_PATHS` の各引用）。したがって算出対象を見直さない限り要件3(b) は原理的に充足できない。

要件6 が信頼境界を弱めない理由（束縛対象の定義）: 除外の正当化は「別の値がリポジトリ全体を束縛するから安全」という網羅性の主張には置かない。launcher digest は証跡の execution 節で `launcher`・`trusted_base_sha`・`isolation: ephemeral_clone` と併記される値であり（実地確認した事実の execution 引用）、その役割は「この verdict を生成した実行系が、審査対象ではなく隔離 clone 内の保護 base 由来であること」を後から検証可能にすることである。よって digest が束縛すべき対象は、レビュア起動・prompt 生成・verdict 記録を実際に実行するコードと、その実行系が隔離 clone から読み込む asset に限られる。consumer 固有の project policy 文書はこの定義に当たらない。隔離 clone 内の実行系はこれらの文書を読まないためである。

除外対象が信頼判断に影響しない理由: project policy 文書がコアレビューの要否・reviewer capability・証跡の trusted actor の判断へ影響する経路は次の2つであり、いずれも launcher digest とは独立の機構で束縛される。(a) コアレビューの分類と capability 要求は protected base worktree の root を trust root として読む（実地確認した事実の `policyRoot` 引用）。本 SPEC が対象とするローカルゲートレビュー経路では、この root は「protected base worktree が dirty でないこと」と「recorder HEAD が trusted base SHA と一致すること」の既存検査（同引用。要件5・AC-4 が維持を要求する）を通過した作業ツリーであり、読み取り内容はその時点で trusted base SHA に束縛される。(b) 証跡の trusted actor 登録は GitHub の保護された default branch から取得する（同 `loadProtectedCoreReviewPolicy` 引用）。どちらの経路も隔離 clone 内の blob を読まないため、launcher digest の算出対象から当該文書を外しても、これら2経路の束縛は変化しない。

加えて、当該文書を持たない consumer では影響そのものが存在しない。方針文書が無ければコアレビュー方針は解決されず `policy_absent` となり（同 `classifyCoreReview` 引用）、そこから導かれる制約が生じない。この状態で当該文書の digest 取得を必須にすることは、信頼判断へ影響しない対象を理由に実行を停止させるだけである。

### 要件と受入条件の対応

| 要件 | 対応する受入条件 |
|---|---|
| 要件1 | AC-1, AC-2, AC-9 |
| 要件2 | AC-1 |
| 要件3(a) | AC-3, AC-6, AC-10 |
| 要件3(b) | AC-7 |
| 要件3(c) | AC-11 |
| 要件4 | AC-5 |
| 要件5 | AC-4 |
| 要件6 | AC-7, AC-8 |

### 受入条件（Acceptance Criteria）

#### AC-1: 非 Node consumer で準備段が成立する

- Given: `package.json` も lockfile も持たない consumer project の protected base worktree（既存のローカルレビュー統合テストと同種の stub 構成）。事前条件として、隔離 clone 内に信頼実行コード一式（レビュア起動スクリプト・adapter・CLI 実体）が存在することを判定時に確認する（その配置手段は設計セグメントが確定する。存在しない場合は AC-5 の対象であり本 AC の対象外）
- When: 当該リポジトリの base SHA・target SHA に対してローカルゲートレビューを実行する
- Then: 準備段が依存導入・ビルドの不在を理由に停止せず、隔離 clone 内のレビュア起動スクリプトが呼ばれる。npm 呼び出し記録に `ci --ignore-scripts` と `run build` のいずれも含まれない
- 検証方法見込み: `automated`

#### AC-2: consumer 自身のビルドを起動しない

- Given: `package.json` と lockfile を持ち、build script が「痕跡ファイルを作成してから非0終了する」consumer project。AC-1 と同じ事前条件（隔離 clone 内に信頼実行コード一式が存在すること）を判定時に確認する
- When: 当該リポジトリに対してローカルゲートレビューを実行する
- Then: 隔離 clone 内のレビュア起動スクリプトが呼ばれる。npm 呼び出し記録に `run build` が含まれず、隔離 clone 内に当該 build script の痕跡ファイルが存在しない（終了コードの握り潰しでは充足しない）
- 検証方法見込み: `automated`

#### AC-3: 実行コードの由来が審査対象でない

- Given: consumer project でレビュア起動段へ到達した実行
- When: レビュア起動スクリプトが実行される
- Then: そのスクリプトと adapter の解決元が Issue worktree（target SHA の作業ツリー）ではなく、base SHA の隔離 clone であることを実行時の値で確認できる
- 検証方法見込み: `automated`

#### AC-4: 既存の拒否経路が維持される

- Given: recorder の HEAD が trusted base SHA と異なる場合、Issue worktree から記録を試みる場合、protected base worktree が dirty な場合のそれぞれ
- When: ローカルゲートレビューまたは証跡投稿を実行する
- Then: いずれも現状と同じく非0終了し、実地確認した事実に原文引用した3メッセージ（`recorder HEADがtrusted base SHAと一致しません`、`Issue worktreeのcandidate recorderからevidenceを投稿できません`、`protected base worktreeがdirtyです。review evidenceを投稿しません。`）が失われていない
- 検証方法見込み: `automated`

#### AC-5: 信頼実行環境を用意できない場合は明示的に失敗する

- Given: 設計が選ぶ調達手段が何であれ、その手段では隔離環境に信頼実行コードを用意できない実行環境（例として、実行環境に agent-skill-chain の実行コード実体が存在せず、外部からの取得も行えない状態）
- When: ローカルゲートレビューを実行する
- Then: レビュアを起動しないまま非0終了し、標準エラーへ「不成立の前提」と「是正手段」を含む日本語メッセージを出す。終了コード 0 で終わらず、審査対象（Issue worktree）の実行コードへフォールバックしない
- 検証方法見込み: `automated`

#### AC-6: agent-skill-chain 自身での実行が回帰しない

- Given: `package.json`・lockfile・build script を持ち、ビルドが CLI 実体を生成する本リポジトリ
- When: ローカルゲートレビューを実行する
- Then: 従来どおり base SHA の隔離 clone から解決した CLI と adapter で動作し、Issue worktree のビルド生成物を実行しない
- 検証方法見込み: `automated`

#### AC-7: consumer 形状のリポジトリで証跡の実行環境値が埋まる

- Given: 配布集合は導入済みだが `.agent-skill-chain/project/MODEL_TIER_TABLE.md` を持たない consumer 形状のリポジトリと、その protected default branch の SHA
- When: 当該 SHA を trusted base SHA として、レビュアの verdict を証跡へ投稿する
- Then: `trusted baseのlauncher構成を読めません` を理由に停止せず、投稿された証跡の execution が、`trusted_base_sha` に当該 SHA、`launcher_digest` に `sha256:` で始まる非空値、`isolation` に `ephemeral_clone` を持つ
- 検証方法見込み: `automated`

#### AC-8: launcher digest が consumer 固有文書に影響されない

- Given: 配布集合の内容は同一で、`.agent-skill-chain/project/` 配下の consumer 固有文書の有無・内容だけが異なる2つのリポジトリ状態
- When: それぞれの trusted base SHA に対して launcher digest を算出する
- Then: 算出された launcher digest が両者で一致し、いずれの状態でも算出が失敗しない
- 検証方法見込み: `automated`

#### AC-9: consumer の依存導入が失敗しても準備段が成立する

- Given: `package.json` と lockfile を持ち、consumer 自身の依存導入が必ず失敗する consumer project（到達不能な private registry の指定・ネットワーク到達不可・engine 制約の不一致のいずれか1つを再現した stub 構成）。AC-1 と同じ事前条件（隔離 clone 内に信頼実行コード一式が存在すること）を判定時に確認する
- When: 当該リポジトリに対してローカルゲートレビューを実行する
- Then: 準備段が依存導入の失敗を理由に非0終了せず、隔離 clone 内のレビュア起動スクリプトが呼ばれる。すなわち consumer 自身の依存導入の終了コードが準備段の成否条件として使われていない
- 検証方法見込み: `automated`

#### AC-10: prompt 生成・verdict 記録に使う CLI の解決元が隔離 clone 内である

- Given: 配布集合のみを持ち agent-skill-chain 本体のソースを持たない consumer project で、レビュア起動段へ到達した実行。かつ、隔離 clone の外に agent-skill-chain CLI の実体が存在する状態（consumer リポジトリ root 直下の `node_modules/.bin/agent-skill-chain` と、`command -v agent-skill-chain` が解決する PATH 上の実体の両方を用意する）
- When: 準備段以降の処理が、prompt 生成と verdict 記録に使う CLI を解決して実行する
- Then: 実行された CLI 実体のパスが隔離 clone のディレクトリ配下にあり、用意した隔離 clone 外の2実体はいずれも実行されない。隔離 clone 内に CLI 実体を用意できない場合は、外部の実体へ落ちずに AC-5 の経路で非0終了する
- 検証方法見込み: `automated`

#### AC-11: 隔離環境が credential を伴う remote を保持しない

- Given: レビュア起動段へ到達した実行における隔離 clone
- When: レビュア起動スクリプトが実行される
- Then: 隔離 clone に登録された remote が存在しない、または登録された全 remote の URL が credential を含まない。実地確認した事実に原文引用した `git -C "$TRUSTED_ROOT" remote remove origin` による remote 不在の状態は本条件を充足する
- 検証方法見込み: `automated`

## 制約

- 信頼境界を弱める解を採らない。Issue worktree のコードをそのまま実行する（隔離 clone を廃してビルドを省く）方針は不変条件 I5 に反するため不可とする。
- 安全側ラチェット（不変条件 I8）に従い、前提不成立時は成功側へ倒さない。
- 全4ゲートと全実行環境の直積を受入条件として要求しない。AC は代表構成（非 Node consumer・ビルドが失敗する consumer・依存導入が失敗する consumer・consumer 形状のリポジトリ・本リポジトリ）で判定する。
- 変更は配布物（`.agent-skill-chain/` 配下と CLI 実装）に閉じ、consumer 側の作業を追加要求しない。
- 要件6 が求める見直しは launcher digest の算出対象に限る。project policy の配布方針、model selection policy の適用範囲、証跡に記録する他の値の意味は変更しない。

## 完了条件

- AC-1 から AC-11 の全てについて検証方法と証跡が対応している。
- 「要件と受入条件の対応」表の全要件に、少なくとも1つの AC が対応している。
- 既存の gate-local-review 統合テストが、変更後の期待値へ更新されたうえで成功する。
- `verify doc-length`・`verify spec-bdd`・`lint references`・`lint vocab`・`lint secrets`・`adr-lint` を含む PR の CI が成功する。

## 未決事項

- 信頼実行環境の具体的な調達手段（隔離 clone 内でのビルド範囲の限定、導入済み配布パッケージからの実体複製、事前ビルド済み成果物の配置のいずれか、またはその組み合わせ）は設計セグメントで確定する。ただし手段の選択肢は AC-10 の制約下にあり、どの手段を選んでも、実行される CLI・レビュア起動スクリプト・adapter の実体は隔離 clone 配下に存在しなければならない。
- 調達「元」が隔離 clone 外の配布パッケージである場合に、その版と由来を証跡へどう記録するか（既存の launcher digest との関係）は設計セグメントで確定する。この場合も実行に用いる実体は隔離 clone 配下へ配置し、隔離 clone 外の実体を直接実行する解は採らない。
- launcher digest の算出対象に含める配布集合要素の具体的な列挙は、要件6 が定める上限（配布集合の要素のみ）の内側で設計セグメントが確定する。

## スコープ外

- Issue #762（レビュアの証跡投稿が無言で失敗し、strict の片側 slot が欠落したまま終了コード 0 で完了する事象）。本 Issue は準備段のビルド前提と launcher digest の算出対象を対象とし、レビュア起動後の投稿成否の検査・診断保全は #762 の射程とする。
- 短縮 SHA を渡した場合の受理およびメッセージ改善（Issue 本文の併記報告）。原因は引数の正規化であり本 Issue の対象とは独立であるため、別 Issue で扱う。
- Issue #757 の回避策（protected base worktree の設定変更）とローカルゲート実行の同時成立。原因は当該回避運用側にあり、本 Issue では扱わない。
- `.agent-skill-chain/project/` 配下の文書を consumer project へ配布する方針変更。要件6 は逆方向（算出対象から外す）の解を採るため、配布範囲は変更しない。
- GitHub Actions 上での自動ゲート検証 workflow の再導入。
- ローカルモード（Coordination Backend がローカル）でのゲート実行経路。
