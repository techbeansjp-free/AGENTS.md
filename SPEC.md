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
| 調達実行コード | 隔離 clone の作成時点では clone 内に存在せず、準備段が隔離 clone の外から取得して隔離 clone 配下へ配置した、レビュア起動・prompt 生成・verdict 記録・adapter に用いる実行コードの実体。 |

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
- 要件3: 信頼実行環境は次の全てを満たす。(a) レビュア起動・prompt 生成・verdict 記録に使う実行コードと asset が、審査対象（target SHA の Issue worktree）由来でない。(b) その由来が実行時に識別でき、証跡へ記録される値（trusted base SHA・launcher digest・隔離種別）が consumer project での実行においても実際に埋まる。(c) 隔離環境に登録された remote が1件も存在しない。隔離 clone は local path から作られるため remote の URL に credential を含まず、「URL が credential を含まないこと」を条件に置くと常に真となり検査として機能しない。remote が登録されたまま残れば、ambient な credential helper や global Git 設定を経由して外部への push・fetch 経路が生きるため、remote の不在そのものを要件とする。
- 要件4: 信頼実行環境を用意できない場合は実行しない。審査対象コードへのフォールバックを行わず、非0終了と、不成立の前提および是正手段を含む日本語メッセージを出す。
- 要件5: 既存の拒否経路（Issue worktree からの記録、recorder HEAD 不一致、protected base worktree の dirty）は現状のまま有効である。
- 要件6: launcher digest の算出対象は配布集合の要素のみで構成する（上限）。同時に、レビュア起動・prompt 生成・verdict 記録を実際に行う実行コードと、その実行系が隔離 clone から読み込む asset のうち配布集合に属するものは、必ず算出対象に含める（下限）。下限の具体的な範囲は、実地確認した事実に原文引用した現行 `LOCAL_REVIEW_LAUNCHER_PATHS` の要素から `.agent-skill-chain/project/` 配下の2件を除いた残り全件を下回らない。配布集合外の文書（consumer 固有 project policy 文書を含む）は算出対象に含めず、その有無・内容によって証跡記録が失敗せず digest 値も変動しない。加えて、算出対象として定めた配布集合の要素のいずれかを trusted base SHA から取得できない場合は、取得できた要素だけの部分集合で digest を算出せず、非0終了して証跡を投稿しない。算出対象の許容範囲は、本要件が定めるこの上限（配布集合の要素のみ）と下限のみによって一意に定まる。本 SPEC の他の記述は下限の根拠と除外の妥当性を述べるものであり、配布集合より狭い上限を追加で課さない。
- 要件7: 調達実行コードは、次の全てを満たす場合にのみ実行する。(a) 調達元の識別子（何をどこから取得したかを一意に示す値）が実行時に確定する。(b) 調達した実体の内容から算出した digest が、審査対象（target SHA の Issue worktree）が変更しうる情報源に依存しない期待値と一致する。(c) (a) の識別子と (b) の digest を証跡へ記録する。いずれかを満たせない場合は調達実行コードを実行せず、要件4 の経路で非0終了する。

要件6 を置く理由（必要性）: 要件3(b) は consumer project の実行でも launcher digest が埋まることを要求するが、現行の算出対象には consumer へ配布も生成もされない `.agent-skill-chain/project/MODEL_TIER_TABLE.md` が含まれ、全件取得に失敗すると算出が例外で停止する（実地確認した事実の `NAMESPACED_ENTRIES`・`src/lib/project-policy-scaffold.ts`・`LOCAL_REVIEW_LAUNCHER_PATHS` の各引用）。したがって算出対象を見直さない限り要件3(b) は原理的に充足できない。一方で、算出対象に残した要素については全件取得の成功を算出の前提とする（取得できない要素があれば算出しない）。これは実地確認した事実に原文引用した `if (shown.status !== 0) throw new CliError(...)` が示す現行の束縛強度をそのまま維持するものであり、算出対象の縮小を口実に部分集合での算出を許すと安全側ラチェット（不変条件 I8）に反するためである。

要件6 が信頼境界を弱めない理由（束縛対象の定義）: 除外の正当化は「別の値がリポジトリ全体を束縛するから安全」という網羅性の主張には置かない。launcher digest は証跡の execution 節で `launcher`・`trusted_base_sha`・`isolation: ephemeral_clone` と併記される値であり（実地確認した事実の execution 引用）、その役割は「この verdict を生成した実行系が、審査対象ではなく隔離 clone 内の保護 base 由来であること」を後から検証可能にすることである。よって digest が必ず束縛しなければならない対象は、レビュア起動・prompt 生成・verdict 記録を実際に実行するコードと、その実行系が隔離 clone から読み込む asset である。この定義は要件6 の下限のみを与える規範であり、上限は与えない——当該定義に当たるもの（配布集合に属する範囲）を算出対象から外してはならないが、当該定義に当たらない配布集合の要素を算出対象へ加えることは、要件6 が定める唯一の上限（配布集合）の内側であり妨げない。下限を定めなければ、算出対象を極小の部分集合へ縮小した設計が要件6 に反さないことになり、現行の束縛強度を下回る縮小を許してしまうためである（安全側ラチェット・不変条件 I8）。要件6 の下限は、この定義に当たる要素と、現行 `LOCAL_REVIEW_LAUNCHER_PATHS` から `.agent-skill-chain/project/` 配下の2件を除いた列挙との和集合である。列挙側の要素を、それが当該定義に当たるか否かに関わらず下限へ含めるのは、現行実装が既に束縛している対象を下回らないためであり（安全側ラチェット・不変条件 I8）、列挙側の要素はいずれも配布集合に属するため、両者は上限の内側で同時に充足できる。consumer 固有の project policy 文書を算出対象から外す根拠は、それが上限（配布集合）の外にあることである。隔離 clone 内の実行系がこれらの文書を読まないことは、この除外が束縛の実効性を損なわないことを補足する事実であり、配布集合より狭い上限を課すものではない。

除外対象が信頼判断に影響しない理由: project policy 文書がコアレビューの要否・reviewer capability・証跡の trusted actor の判断へ影響する経路は次の2つであり、いずれも launcher digest とは独立の機構で束縛される。(a) コアレビューの分類と capability 要求は protected base worktree の root を trust root として読む（実地確認した事実の `policyRoot` 引用）。本 SPEC が対象とするローカルゲートレビュー経路では、この root は「protected base worktree が dirty でないこと」と「recorder HEAD が trusted base SHA と一致すること」の既存検査（同引用。要件5・AC-4 が維持を要求する）を通過した作業ツリーであり、読み取り内容はその時点で trusted base SHA に束縛される。(b) 証跡の trusted actor 登録は GitHub の保護された default branch から取得する（同 `loadProtectedCoreReviewPolicy` 引用）。どちらの経路も隔離 clone 内の blob を読まないため、launcher digest の算出対象から当該文書を外しても、これら2経路の束縛は変化しない。

加えて、当該文書を持たない consumer では影響そのものが存在しない。方針文書が無ければコアレビュー方針は解決されず `policy_absent` となり（同 `classifyCoreReview` 引用）、そこから導かれる制約が生じない。この状態で当該文書の digest 取得を必須にすることは、信頼判断へ影響しない対象を理由に実行を停止させるだけである。

要件7 を置く理由（必要性）: 要件3(a)(b) と AC-3・AC-7・AC-10 は、実行される実体が隔離 clone 配下にあることと、証跡に trusted base SHA・launcher digest・隔離種別が埋まることまでしか要求しない。したがって、隔離 clone の外にあった実体をそのまま隔離 clone 配下へ複製して実行する調達手段を採ると、実行された verdict 記録コードの由来が未検証のままでもこれらを全て充足でき、本 SPEC の目的（verdict を記録する実行コードが保護された base 由来であること）が破れる。実地確認した事実に原文引用した `command -v agent-skill-chain` による PATH 上の実体への解決は、実行コードの供給元が隔離 clone 外にも存在しうることを示す。配置先が隔離 clone 配下であることは由来の検証にならないため、調達実行コードそのものの由来と完全性の検証、およびその証跡への記録を要件として要求する。

### 要件と受入条件の対応

| 要件 | 対応する受入条件 |
|---|---|
| 要件1 | AC-1, AC-2, AC-9, AC-14 |
| 要件2 | AC-1, AC-14 |
| 要件3(a) | AC-3, AC-6, AC-10, AC-15 |
| 要件3(b) | AC-7, AC-13 |
| 要件3(c) | AC-11 |
| 要件4 | AC-5 |
| 要件5 | AC-4 |
| 要件6 | AC-7, AC-8, AC-12 |
| 要件7 | AC-13 |

AC-14 は個別要件の検証に加えて、要求全体（consumer project から信頼境界を損なわずにローカルゲートレビューを実行し、その結果を証跡として記録する）が実際に成立することを、事前条件を持たない形で束縛する下限の受入条件である。他の AC が前提の不成立によって不適用となる場合でも、AC-14 は不適用にならない。

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

- Given: 設計が選ぶ調達手段が何であれ、その手段では隔離環境に信頼実行コードを用意できない実行環境（例として、実行環境に agent-skill-chain の実行コード実体が存在せず、外部からの取得も行えない状態）。本 AC の対象は信頼実行コードの供給元が実行環境側に存在しない場合に限る。AC-14 の Given が定める実行環境（agent-skill-chain の実行コード実体が利用できる状態）で非0終了することは本 AC の充足とは見なさず、AC-14 の不充足として扱う。本 AC が言う「供給元が実行環境側に存在しない」とは、実行コード実体を consumer の `node_modules` 配下にも PATH 上にも解決できないことを指す。配布物がローカルの package キャッシュにのみ存在する状態はこれに当たり、AC-14 の Given には該当しない
- When: ローカルゲートレビューを実行する
- Then: レビュアを起動しないまま非0終了し、標準エラーへ「不成立の前提」と「是正手段」を含む日本語メッセージを出す。終了コード 0 で終わらず、審査対象（Issue worktree）の実行コードへフォールバックしない。当該メッセージには、実行コード実体についてどの候補をどこで探索して見つけられなかったかを特定できる情報（探索した候補の識別子と探索先）を含める。探索結果を示さず一般的な失敗のみを出力する実装は本 AC を充足しない
- 検証方法見込み: `automated`

#### AC-6: agent-skill-chain 自身での実行が回帰しない

- Given: `package.json`・lockfile・build script を持ち、ビルドが CLI 実体を生成する本リポジトリ
- When: ローカルゲートレビューを実行する
- Then: 従来どおり base SHA の隔離 clone から解決した CLI と adapter で動作し、Issue worktree のビルド生成物を実行しない
- 検証方法見込み: `automated`

#### AC-7: consumer 形状のリポジトリで証跡の実行環境値が埋まる

- Given: 配布集合は導入済みだが `.agent-skill-chain/project/MODEL_TIER_TABLE.md` を持たない consumer 形状のリポジトリと、その protected default branch の SHA
- When: 当該 SHA を trusted base SHA として、レビュアの verdict を証跡へ投稿する
- Then: `.agent-skill-chain/project/` 配下の文書を取得できないことを理由として `trusted baseのlauncher構成を読めません` で停止せず、投稿された証跡の execution が、`trusted_base_sha` に当該 SHA、`launcher_digest` に `sha256:` で始まる非空値、`isolation` に `ephemeral_clone` を持つ。本 AC が停止を認めない範囲は `.agent-skill-chain/project/` 配下の文書の不在に限り、算出対象として定めた配布集合の要素を取得できない場合の停止は本 AC の対象外である（当該場合の要求は AC-12）
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
- Then: 実行された CLI 実体のパスが隔離 clone のディレクトリ配下にあり、用意した隔離 clone 外の2実体はいずれも実行されない。隔離 clone 内に CLI 実体を用意できない場合は、外部の実体へ落ちずに AC-5 の経路で非0終了する。本 AC の Given は用意する2実体の真正性（要件7(b) の期待値との一致）を定めないため、当該2実体を調達元とする設計が要件7(b) の検証に失敗し、外部の実体へ落ちないまま要件4 の経路で非0終了することは、本 AC に反しない。レビュア起動段への到達と証跡投稿の要求は本 AC ではなく AC-14 が独立に課す
- 検証方法見込み: `automated`

#### AC-11: 隔離 clone に remote が登録されていない

- Given: レビュア起動段へ到達した実行における隔離 clone
- When: レビュア起動スクリプトが実行される
- Then: 隔離 clone に登録された remote が1件も存在しない（隔離 clone に対する `git remote` の出力が空である）。remote が登録されたまま、その URL が credential を含まないことをもって本条件を充足したとは見なさない。実地確認した事実に原文引用した `git -C "$TRUSTED_ROOT" remote remove origin` に相当する remote 削除を行わず remote を残す実装は本条件を充足しない
- 検証方法見込み: `automated`

#### AC-12: 下限に属する算出対象要素を取得できない場合に launcher digest が算出されない

- Given: 要件6 が下限として定めた算出対象要素のそれぞれについて、当該要素だけが trusted base SHA で欠落しており取得できないリポジトリ状態を用意する（例として `.agent-skill-chain/adapters/claude.sh` を欠く状態。配布集合の要素が導入済み consumer に必ず存在するという前提が崩れた状態）。設計が下限を超えて算出対象へ加えた要素がある場合は、それらについても同様の状態を用意する
- When: 用意した各状態の SHA を trusted base SHA として、レビュアの verdict を証跡へ投稿する
- Then: いずれの状態でも、取得できた要素だけの部分集合で launcher digest を算出することなく非0終了し、証跡を投稿しない。取得できなかった要素を示す日本語メッセージを標準エラーへ出す。下限に属する要素のうち1件でも、その欠落が停止を招かない状態が存在する場合は、当該要素が算出対象に含まれていないことを意味し本 AC を充足しない
- 検証方法見込み: `automated`

#### AC-13: 調達実行コードの由来と完全性が検証され証跡へ記録される

- Given: 配布集合のみを持ち agent-skill-chain 本体のソースを持たない consumer project での実行。準備段が調達実行コードを持ち込む設計を採る場合は、(i) 調達元の実体が要件7(b) の期待値どおりである状態と、(ii) 調達元の実体の内容を1バイト改変した状態の2状態を用意する
- When: 用意した各状態でローカルゲートレビューを実行する
- Then: (i) ではレビュア起動段へ到達し、投稿された証跡に調達元の識別子と調達した実体の digest が非空値で記録される。(ii) ではレビュアを起動しないまま非0終了し、証跡を投稿しない。改変した実体を隔離 clone 配下へ複製したことのみを根拠に実行する経路は本 AC を充足しない。準備段が調達実行コードを持ち込まない設計を採る場合は、(i)(ii) に代えて、隔離 clone 外の実体が実行コードとして隔離 clone 配下へ複製・配置されないことを実行時の観測で示すことをもって充足する。この充足経路は AC-14 が要求するレビュア起動段への到達を免除しない
- 検証方法見込み: `automated`

#### AC-14: 代表 consumer 構成でレビュア起動段への到達と証跡投稿が成立する

- Given: AC-1・AC-2・AC-9 が定める3つの consumer 構成（`package.json` も lockfile も持たない構成、build script が痕跡ファイルを作成してから非0終了する構成、consumer 自身の依存導入が必ず失敗する構成）のそれぞれ。加えて、実行環境には agent-skill-chain の実行コード実体が、consumer が導入時に用いた配布物と同じ形で利用できる状態にある（consumer の `node_modules` 配下・PATH 上の実体のいずれか）。本 AC の Given は実行環境の事実のみで構成し、隔離 clone 内に信頼実行コードが存在することを事前条件としない
- When: 各構成に対してローカルゲートレビューを実行する
- Then: いずれの構成でも、準備段が信頼実行コード一式（レビュア起動スクリプト・adapter・CLI 実体）を隔離 clone 配下へ実際に用意したうえでレビュア起動段へ到達し、レビュアが起動され、verdict が証跡へ投稿される。3構成のいずれかで AC-5 の経路（レビュアを起動しないままの非0終了）へ倒れる実装は本 AC を充足しない
- 検証方法見込み: `automated`

本 AC により、AC-1・AC-2・AC-9 が Given に置く事前条件（隔離 clone 内に信頼実行コード一式が存在すること）は、当該3構成において実際に成立することが要求される。したがって「信頼実行コードを一切用意せず常に AC-5 の経路で失敗する」実装は、AC-1・AC-2・AC-9 が事前条件の不成立により不適用となることをもって完了条件を満たすことはできない。

#### AC-15: prompt 生成が読み込む asset の解決元が審査対象でない

- Given: AC-14 と同じ実行環境でレビュア起動段へ到達した実行。かつ、Issue worktree（target SHA の作業ツリー）側に、prompt 生成が読み込む asset（レビュー観点の template・schema・role contract 等）と同一の相対パスへ、内容を識別可能な形で改変した複製を配置した状態
- When: レビュア起動段が prompt を生成する
- Then: 実行時に解決された各 asset のパスがいずれも Issue worktree 配下ではなく、隔離 clone 配下、または実地確認した事実に原文引用した `policyRoot` が示す protected base worktree の root 配下である。生成された prompt に、Issue worktree 側で改変した内容が現れない
- 検証方法見込み: `automated`

## 制約

- 信頼境界を弱める解を採らない。Issue worktree のコードをそのまま実行する（隔離 clone を廃してビルドを省く）方針は不変条件 I5 に反するため不可とする。
- 安全側ラチェット（不変条件 I8）に従い、前提不成立時は成功側へ倒さない。
- 全4ゲートと全実行環境の直積を受入条件として要求しない。AC は代表構成（非 Node consumer・ビルドが失敗する consumer・依存導入が失敗する consumer・consumer 形状のリポジトリ・算出対象要素を取得できないリポジトリ状態・調達実行コードが改変された実行環境・審査対象側に改変 asset を配置した実行環境・本リポジトリ）で判定する。
- 変更は配布物（`.agent-skill-chain/` 配下と CLI 実装）に閉じ、consumer 側の作業を追加要求しない。
- 要件6 が求める見直しは launcher digest の算出対象と、算出対象要素を取得できない場合の停止挙動に限る。project policy の配布方針、model selection policy の適用範囲、証跡に記録する他の値の意味は変更しない。

## 完了条件

- AC-1 から AC-15 の全てについて検証方法と証跡が対応している。
- 「要件と受入条件の対応」表の全要件に、少なくとも1つの AC が対応している。
- 既存の gate-local-review 統合テストが、変更後の期待値へ更新されたうえで成功する。
- `verify doc-length`・`verify spec-bdd`・`lint references`・`lint vocab`・`lint secrets`・`adr-lint` を含む PR の CI が成功する。

## 未決事項

- 信頼実行環境の具体的な調達手段（隔離 clone 内でのビルド範囲の限定、導入済み配布パッケージからの実体複製、事前ビルド済み成果物の配置のいずれか、またはその組み合わせ）は設計セグメントで確定する。ただし手段の選択肢は AC-10・AC-13・AC-14 の制約下にあり、どの手段を選んでも、実行される CLI・レビュア起動スクリプト・adapter の実体は隔離 clone 配下に存在しなければならず、かつ AC-14 が定める代表 consumer 構成でレビュア起動段へ実際に到達しなければならない。「調達手段を用意しない」ことは選択肢に含まれない。
- 調達「元」が隔離 clone 外の配布パッケージである場合に、要件7 が記録を求める調達元識別子と実体 digest を証跡のどのキーへどの表現で格納するか（既存の launcher digest との併記形式）は設計セグメントで確定する。由来・完全性の検証を行うこと自体と、記録すべき値の種類は要件7 と AC-13 が確定済みであり、設計セグメントへ委ねない。この場合も実行に用いる実体は隔離 clone 配下へ配置し、隔離 clone 外の実体を直接実行する解は採らない。
- launcher digest の算出対象に含める配布集合要素の具体的な列挙は、要件6 が定める上限（配布集合の要素のみ）と下限（レビュア起動・prompt 生成・verdict 記録を実際に行う実行コードおよびその実行系が隔離 clone から読み込む asset のうち配布集合に属するもの。現行 `LOCAL_REVIEW_LAUNCHER_PATHS` から `.agent-skill-chain/project/` 配下の2件を除いた全件を下回らない）に挟まれた範囲で設計セグメントが確定する。下限を下回る縮小は設計セグメントへ委ねない。

## スコープ外

- Issue #762（レビュアの証跡投稿が無言で失敗し、strict の片側 slot が欠落したまま終了コード 0 で完了する事象）。本 Issue は準備段のビルド前提と launcher digest の算出対象を対象とし、レビュア起動後の投稿成否の検査・診断保全は #762 の射程とする。
- 短縮 SHA を渡した場合の受理およびメッセージ改善（Issue 本文の併記報告）。原因は引数の正規化であり本 Issue の対象とは独立であるため、別 Issue で扱う。
- Issue #757 の回避策（protected base worktree の設定変更）とローカルゲート実行の同時成立。原因は当該回避運用側にあり、本 Issue では扱わない。
- `.agent-skill-chain/project/` 配下の文書を consumer project へ配布する方針変更。要件6 は逆方向（算出対象から外す）の解を採るため、配布範囲は変更しない。
- GitHub Actions 上での自動ゲート検証 workflow の再導入。
- ローカルモード（Coordination Backend がローカル）でのゲート実行経路。
