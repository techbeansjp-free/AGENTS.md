<!--
正本: AGENTS.md 4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: DESIGN.md（PLAN.md は別ファイル）、ゲート: design-gate）。
-->

# DESIGN: リリース自動化（バージョンbump・タグ付け・GitHub Release作成）

- Issue: `ISSUE-196`
- 対応する SPEC: `SPEC.md`

mainへのリリース対象変更を契機に、`package.json` の `version` 自動更新・gitタグ・GitHub Release を人手なしで生成し続ける仕組みを、GitHub Actions ワークフロー1本として復元する。旧実装（削除済み `release.yml`）が抱えた「package.json は semver、実タグは日時形式」という二重版数体系を廃し、単一の semver 体系に統一することで SPEC レビューで問題化した AC-5 の曖昧さを構造的に解消する。

## 決定した設計判断（6点）

1. **リリース対象の判定基準**: mainへのpushが「配布物・その生成元」を変更した場合のみをリリース対象とする。`paths` フィルタで対象を限定する。対象=`src/**`, `.agent-skill-chain/**`, `AGENTS.md`, `CLAUDE.md`, `docs/GLOSSARY.md`, `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.test.json`。除外=`.github/**`（配布物でない）, `README.md`, `CONTRIBUTING.md`, `docs/adr/**`, `docs/system-spec/**`, `docs/maintainer/**`, `test/**`。除外群は `package.json` の `files`（`bin/`・`.agent-skill-chain/`・`AGENTS.md`・`CLAUDE.md`・`docs/GLOSSARY.md`）が配布する成果物にも、その生成元（`src/**`→`bin/`）にも該当せず、consumer が受け取る内容を変えないため、リリースを起こさない。
2. **版数体系の統一**: リリース版数は `package.json` の semver を唯一の正本とし、gitタグ=`v<semver>`、GitHub Release の tag/name も同一文字列とする。3者は常に同一の `target` 値から生成されるため定義上一致する（AC-4）。旧日時形式タグ（`v20260720.060726` 等）は semver 正規表現 `^v[0-9]+\.[0-9]+\.[0-9]+$` に一致しないため、以後の後退判定の比較対象から機械的に除外される（AC-5 の「版数体系をまたいだ比較はしない」を体系選択そのもので保証）。
3. **marketplace/apm の廃止**: 新配布方式は `npx github:techbeansjp-free/AGENTS.md` によるGitHub直接参照であり、旧 `release-marketplace`・`apm-release` ジョブが公開していた marketplace/apm 生成物は主導線から外れている。両ジョブは踏襲せず廃止する。併せて、既に削除済みパス（`.agent-skill-chain/source/`・`.adapters/claude`）を参照したまま放置され誤解を招く `.claude-plugin/marketplace.json` を本Issueの実装で削除する（判断根拠は ADR-0005）。
4. **無限ループ・二重発火防止**: 版数bumpは専用の短命ブランチ上のコミット `chore(release): v<target> [skip ci]` として作り、squashマージでmainへ反映する。squashマージが生成するmain上のコミットはこの `[skip ci]` 付きメッセージを引き継ぐため、GitHub Actions は当該pushに対するworkflow run自体を生成しない（公式仕様）。これが再帰トリガ抑止の主機構である（AC-6）。タグ生成・Release生成は本ワークフローのトリガ（`push: branches:[main]`）ではないため再帰トリガ源にならない。二重発火は `concurrency: {group: release, cancel-in-progress: false}` による直列化、bumpブランチ名への `target` 版数埋め込みによる同名ブランチ・PRの重複作成防止、タグ・Release作成前の存在チェック（冪等）で防ぐ（AC-7）。
5. **認証・secret・I4適合（PR経由）**: main への版数bump反映は生pushではなく必ずPRを経由する。bumpコミットは短命ブランチ `release/bump-v<target>`（branch protection対象外）へ `GITHUB_TOKEN` でpushし、`gh pr create` で小さなPRを作成、`gh pr merge --admin --squash` でマージする。この admin merge は required status check を bypass するが、進行役に標準承認済みの `gh pr merge --admin` 運用（ruleset の bypass_actor に登録済みの admin 資格情報 secret `RELEASE_MAIN_PAT`）と同一の特権操作であり、生pushではなくPR経由である点で I4「mainへの変更はPR経由のみ」の文言上の要求を満たす。I4は「PR経由」を求めるのであって「全チェックが緑であること」までは求めておらず、ゲートCIのsecrets（`ANTHROPIC_API_KEY` 等）未設定という別問題には一切依存しない。タグpush・GitHub Release作成は保護対象外（tag ref はbranch protection非対象）のため `GITHUB_TOKEN`（`contents: write`）で足りる。`RELEASE_MAIN_PAT` を要するのは bump PR の admin merge のみに限定する（最小権限）。
6. **障害・ロールバック**: 後述「障害・ロールバック考慮」に詳述。基本方針は「各ステップ冪等・失敗時は未完成物を残さず次回runが自己修復」「版数後退は禁止のためロールバックは後退でなくroll-forward（次patch）」。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| 要件1 / AC-1 | バージョン解決器（既定=patch自動bump経路）＋ bumpブランチ・PR作成／admin merge器 | 既定経路は人手ゼロで版数を更新（AC-1「人手の介在なく」を既定動作で充足） |
| 要件2 / AC-2 | タガー（冪等） | `target` から `v<semver>` タグを生成 |
| 要件2 / AC-3 | リリーサ（冪等） | 同タグを指す GitHub Release を生成 |
| 要件3 / AC-4 | 版数体系の統一（単一 `target` 値を3者へ適用） | package.json=tag=release が同一文字列で定義上一致 |
| 要件4 / AC-5 | バージョン解決器の単調保証（semver 比較 `target > latest`、seed規則、非semverタグ除外） | 自動化の内部一貫性のみを対象。非semverの旧タグは比較対象外 |
| 要件5 / AC-6 | `[skip ci]` 付きbumpコミットのsquashマージ（主機構）＋ トリガ設計（tag/release非トリガ）＋ concurrency ＋ 防御的skip-ciガード | 再帰トリガの唯一の経路（bump PRのmainへのマージコミット）を `[skip ci]` で遮断 |
| 要件6 / AC-7 | concurrency直列化 ＋ bumpブランチ名への `target` 埋め込みによる重複ブランチ・PR防止 ＋ タガー・リリーサの存在チェック（冪等） | 単一契機に対し高々1件、同一版数の重複生成なし |

## 責務・境界

### コンポーネント構成

責務は6つに分割し、いずれも単一責務とする。

- **トリガ・concurrency層**（`.github/workflows/agent-skill-chain-release.yml`）: `on: push: branches:[main]` にリリース対象 `paths` フィルタを適用してリリース契機を検出し、`concurrency: {group: release, cancel-in-progress: false}` で契機を直列化する。`permissions: contents: write`。防御として、HEADコミットメッセージに `[skip ci]` を含む場合はジョブを早期skipする（GitHub側で既にrun抑止されるため冗長だが安価な二重防御）。次段以降を起動するのみで版数計算・生成物作成の内容判断は持たない。
- **バージョン解決器**（単体テスト可能な単位。CLIサブコマンドまたは `.agent-skill-chain/ci/` 配下の独立nodeスクリプトとして実装し、YAMLインライン式の未テストロジックにしない）: 既存タグのうち semver 正規表現に一致する最大版数 `latest` を求め、下記アルゴリズムで `target`・`needCommit` を決定し、後退禁止ガードを適用する。責務は「次版数の決定」のみで、副作用（書込み・push・タグ作成）を持たない。

  ```text
  latest := semver正規表現 ^v[0-9]+\.[0-9]+\.[0-9]+$ に一致する既存タグの最大版数
            （一致タグが1件も無ければ seed := package.json.version を latest とみなす）
  pkg    := package.json.version
  if semver(pkg) > semver(latest):
      target := pkg          # マージ済みPRで人手が minor/major を先行bump済み → 尊重
      needCommit := false    # package.json は既に target を保持
  else:
      target := patchIncrement(latest)   # 既定: 自動でpatch加算（人手介在なし＝AC-1既定経路）
      needCommit := true                 # package.json を書き換えるコミットが必要
  assert semver(target) > semver(latest) # AC-5 後退禁止ガード。不成立ならリリースせず失敗
  ```

  初回run時、既存の semver 一致タグは存在せず（旧タグ `v20260720.*` は非一致）、seed=`0.2.0` → else経路 → 初回自動リリースは `v0.2.1`。
- **bumpブランチ・PR作成／admin merge器**（`needCommit` が真のときのみ実行）: `package.json` の `version` を `target` に書き換え、短命ブランチ `release/bump-v<target>` 上に `chore(release): v<target> [skip ci]` としてcommitして `GITHUB_TOKEN`（branch protection対象外の release ブランチ）でpushし、`gh pr create` で機械生成の版数台帳更新PR（本文にIssue-196 由来を明記）を作成、`gh pr merge --admin --squash` で main へマージする。マージには進行役に標準承認済みの admin merge 権限（bypass_actor 登録済み `RELEASE_MAIN_PAT`）を用い、required status check を bypass する。このPRは SPEC/DESIGN/PLAN/VALIDATION を伴わない機械生成の版数台帳更新のみのPRであり、Issue成果物ではなく既に承認済みの決定（本Issueの design-gate 承認）の機械的執行に過ぎないため、4セグメントゲート（Check Run必須）の対象外として扱う。ブランチ名に `target` 版数を含むため、同一版数のbumpブランチ・PRは重複作成されない。同名ブランチ・同名PRが既存の場合（前回runのmerge失敗残骸等）は新規作成せず既存を検出して再利用しマージする（冪等）。
- **タガー（冪等）**: `v<target>` タグが未存在のときのみ、リリース対象commit（`needCommit`時は bump PR のマージ後に main へ着地した版数bumpコミット、非commit時はrunをトリガしたHEAD）へ注釈付きタグを作成しpushする。`GITHUB_TOKEN` を用いる。
- **リリーサ（冪等）**: `v<target>` の GitHub Release が未存在のときのみ、当該タグを指すReleaseを作成する。`GITHUB_TOKEN` を用いる。
- **テンプレート同期・stale除去**（実装セグメントの構成要素）: 上記ワークフローを配布元正本 `.agent-skill-chain/templates/github/.github/workflows/` と展開先 `.github/workflows/` の双方へ同一内容で配置する（`verify-template-sync.sh` が両者一致を検査するため片方だけの追加はCI失敗となる）。併せて stale な `.claude-plugin/marketplace.json` を削除する。

### 依存関係

```text
トリガ・concurrency層 → バージョン解決器 → bumpブランチ・PR作成／admin merge器(needCommit時のみ) → タガー → リリーサ
バージョン解決器 → (読取のみ) 既存gitタグ / package.json
```

各コンポーネントは後段を起動する一方向依存のみで循環はない。バージョン解決器は読取専用で副作用を持たず、書込み系（bumpブランチ・PR作成／admin merge器・タガー・リリーサ）から独立して単体検証できる。責務は6分割され単一コンポーネントへの集中はない。

## 関連ADR

本設計の恒久的判断（版数体系のsemver統一・marketplace/apm廃止・版数bumpコミットをmainへPR経由 admin merge で反映するI4適合方式）は、本Issueで新規作成する ADR-0005（status: proposed）に記録する。ADR-0005 は本Issueのdesignセグメントで proposed として作成され、design-gate 承認時に accepted へ遷移する。accepted 前かつ同一Issue内の proposed ADR であるため、`accepted` のみ参照可能な下記構造化フィールドには登録せず、由来は本文で示す（構造化参照は accepted ADR が無いため空とする）。

```yaml
related_adrs: []
```

## 障害・ロールバック考慮

- 想定される失敗モードと自己修復:
  - **bumpブランチのpush失敗**（認証・権限、または競合による非fast-forward）: PR未作成・main不変（`package.json` 未bump）。タグ・Releaseも未生成。次のリリース契機で再試行され、状態不整合を残さない（安全側）。
  - **PR作成後、admin mergeに失敗**: PR・bumpブランチは残るが main は不変。次run時、同一 `target` なら既存ブランチ・PRを検出して再利用しマージを再試行する（冪等）。契機が進み `target` が上がった場合、旧bump PR/ブランチはstaleとなるが、バージョン解決器はより高い版数を採用するためリリースの正しさに影響しない（stale PRは後述の掃除対象）。
  - **マージ成功後、タグ作成に失敗**: main の `package.json` はbump済み（`pkg > latest`）だがタグ・Releaseが無い状態。次回run時バージョン解決器が case `needCommit=false` を選択し、欠落したタグ・Releaseを当該版数で補完する（自己修復・冪等）。
  - **タグ作成後、GitHub Release作成に失敗**: 再run時、タガーは存在チェックによりタグ作成をskip、リリーサが欠落Releaseのみを作成する（冪等）。
  - **契機の並行到来**: `concurrency: {group: release}` が直列化し、bumpブランチ名への `target` 埋め込みが同名ブランチ・PRの重複作成を弾き、後続runはタグ・Releaseの存在チェックによりno-opとなる（AC-7）。
- ロールバック手順: 誤リリースの取消は、`gh release delete v<x>` と `git push origin --delete refs/tags/v<x>` でRelease・タグを除去する。`package.json` の版数は後退禁止（AC-5ガード）のため、版数を下げて再リリースはできず、修正は次patchへの roll-forward で行う（例: `v0.2.3` が不良なら `v0.2.4` を出す）。この方針を運用前提として明記する。marge失敗で残った stale な bumpブランチ・PR は `git push origin --delete release/bump-v<x>` と `gh pr close` で掃除する。
- 影響を受ける既存機能・整合性上の留意点:
  - 版数bumpコミットは main へ生pushせず、短命ブランチ `release/bump-v<target>` 上のコミットを小さなPRとして作成し `gh pr merge --admin --squash` でマージすることで、I4「mainへの変更はPR経由のみ」を文言通り満たす。この admin merge は required status check を bypass するが、I4が求めるのは「PR経由」であって「全チェックが緑であること」ではなく、かつ進行役に標準承認済みの特権マージ運用（bypass_actor 登録済み admin 権限）と同一の操作である。したがってゲートCIのsecrets（`ANTHROPIC_API_KEY` 等）未設定という可修復な別問題には一切依存しない。このPRは機械生成の版数台帳更新（`[skip ci]` 付き・SPEC/DESIGN/PLAN/VALIDATION を伴わないIssue非成果物）であり、既に承認済みの本Issue design-gate 決定の機械的執行に過ぎないため、4セグメントゲートの対象外である。本判断は ADR-0005 に記録する。
  - 既存ワークフロー（`agent-skill-chain-{ci,gate,risk,reconcile}.yml`）への影響: `reconcile` は `branches-ignore:[main]`、他は `pull_request` トリガである。bumpコミットの `[skip ci]` は当該pushおよびその head commit を持つ pull_request イベントの双方でworkflow run生成を抑止する（公式仕様）ため、bumpブランチpushによる `reconcile`、bump PR による `ci`/`gate`/`risk` はいずれも起動しない。仮にこれらが起動しても required status check は admin merge が bypass するため bump PR のマージは妨げられない。squashマージ後の main コミットも `[skip ci]` によりどのworkflow runも生成しないため、本ワークフロー追加による既存トリガとの競合・二重起動は発生しない。
