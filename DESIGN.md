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
4. **無限ループ・二重発火防止**: 自動bumpコミットのメッセージ末尾に `[skip ci]` を付す。GitHub Actions は push/pull_request の commit メッセージに `[skip ci]` を含む場合、当該pushに対するworkflow run自体を生成しない（公式仕様）。これが再帰トリガ抑止の主機構である（AC-6）。タグ生成・Release生成は本ワークフローのトリガ（`push: branches:[main]`）ではないため再帰トリガ源にならない。二重発火は `concurrency: {group: release, cancel-in-progress: false}` による直列化と、タグ・Release作成前の存在チェック（冪等）で防ぐ（AC-7）。
5. **認証・secret**: branch protection 配下の main への bump コミットpushは、bypass_actor 登録済み admin PAT `RELEASE_MAIN_PAT` を用いる（既定 `GITHUB_TOKEN` は保護ブランチをbypassできず、かつ user PAT でのpushは `[skip ci]` が無ければ再トリガを起こすため `[skip ci]` が必須）。タグpush・GitHub Release作成は保護対象外（tag ref はbranch protection非対象）のため `GITHUB_TOKEN`（`contents: write`）で足りる。secret を要するのは main への直接pushのみに限定する（最小権限）。
6. **障害・ロールバック**: 後述「障害・ロールバック考慮」に詳述。基本方針は「各ステップ冪等・失敗時は未完成物を残さず次回runが自己修復」「版数後退は禁止のためロールバックは後退でなくroll-forward（次patch）」。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| 要件1 / AC-1 | バージョン解決器（既定=patch自動bump経路）＋ package.json書込み・mainコミッタ | 既定経路は人手ゼロで版数を更新（AC-1「人手の介在なく」を既定動作で充足） |
| 要件2 / AC-2 | タガー（冪等） | `target` から `v<semver>` タグを生成 |
| 要件2 / AC-3 | リリーサ（冪等） | 同タグを指す GitHub Release を生成 |
| 要件3 / AC-4 | 版数体系の統一（単一 `target` 値を3者へ適用） | package.json=tag=release が同一文字列で定義上一致 |
| 要件4 / AC-5 | バージョン解決器の単調保証（semver 比較 `target > latest`、seed規則、非semverタグ除外） | 自動化の内部一貫性のみを対象。非semverの旧タグは比較対象外 |
| 要件5 / AC-6 | `[skip ci]` 付きbumpコミット（主機構）＋ トリガ設計（tag/release非トリガ）＋ concurrency ＋ 防御的skip-ci/actorガード | 再帰トリガの唯一の経路（bumpコミットのmainへのpush）を `[skip ci]` で遮断 |
| 要件6 / AC-7 | concurrency直列化 ＋ タガー・リリーサの存在チェック（冪等） | 単一契機に対し高々1件、同一版数の重複生成なし |

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
- **package.json書込み・mainコミッタ**（`needCommit` が真のときのみ実行）: `package.json` の `version` を `target` に書き換え、`chore(release): v<target> [skip ci]` としてcommitし、`RELEASE_MAIN_PAT` で main へpushする。
- **タガー（冪等）**: `v<target>` タグが未存在のときのみ、リリース対象commit（`needCommit`時はbumpコミット、非commit時はrunをトリガしたHEAD）へ注釈付きタグを作成しpushする。`GITHUB_TOKEN` を用いる。
- **リリーサ（冪等）**: `v<target>` の GitHub Release が未存在のときのみ、当該タグを指すReleaseを作成する。`GITHUB_TOKEN` を用いる。
- **テンプレート同期・stale除去**（実装セグメントの構成要素）: 上記ワークフローを配布元正本 `.agent-skill-chain/templates/github/.github/workflows/` と展開先 `.github/workflows/` の双方へ同一内容で配置する（`verify-template-sync.sh` が両者一致を検査するため片方だけの追加はCI失敗となる）。併せて stale な `.claude-plugin/marketplace.json` を削除する。

### 依存関係

```text
トリガ・concurrency層 → バージョン解決器 → package.json書込み・mainコミッタ(needCommit時のみ) → タガー → リリーサ
バージョン解決器 → (読取のみ) 既存gitタグ / package.json
```

各コンポーネントは後段を起動する一方向依存のみで循環はない。バージョン解決器は読取専用で副作用を持たず、書込み系（コミッタ・タガー・リリーサ）から独立して単体検証できる。責務は6分割され単一コンポーネントへの集中はない。

## 関連ADR

本設計の恒久的判断（版数体系のsemver統一・marketplace/apm廃止）は、本Issueで新規作成する ADR-0005（status: proposed）に記録する。ADR-0005 は本Issueのdesignセグメントで proposed として作成され、design-gate 承認時に accepted へ遷移する。accepted 前かつ同一Issue内の proposed ADR であるため、`accepted` のみ参照可能な下記構造化フィールドには登録せず、由来は本文で示す（構造化参照は accepted ADR が無いため空とする）。

```yaml
related_adrs: []
```

## 障害・ロールバック考慮

- 想定される失敗モードと自己修復:
  - **bumpコミットのmainへのpush失敗**（認証・権限、または競合による非fast-forward）: タグ・Releaseは未生成。main上の `package.json` はコミット未着地のため不変。次のリリース契機で再試行され、状態不整合を残さない（安全側）。
  - **push成功後、タグ作成に失敗**: `package.json` はbump済みだがタグ・Releaseが無い状態。次回run時 `pkg > latest` となりバージョン解決器が case `needCommit=false` を選択、欠落したタグ・Releaseを当該版数で補完する（自己修復・冪等）。
  - **タグ作成後、GitHub Release作成に失敗**: 再run時、タガーは存在チェックによりタグ作成をskip、リリーサが欠落Releaseのみを作成する（冪等）。
  - **契機の並行到来**: `concurrency: {group: release}` が直列化し、後続runはタグ・Releaseの存在チェックによりno-opとなる（AC-7）。
- ロールバック手順: 誤リリースの取消は、`gh release delete v<x>` と `git push origin --delete refs/tags/v<x>` でRelease・タグを除去する。`package.json` の版数は後退禁止（AC-5ガード）のため、版数を下げて再リリースはできず、修正は次patchへの roll-forward で行う（例: `v0.2.3` が不良なら `v0.2.4` を出す）。この方針を運用前提として明記する。
- 影響を受ける既存機能・整合性上の留意点:
  - bumpコミットは main へPRを経由せず直接pushする。これは I4（mainへの変更はPR経由のみ）と緊張するが、branch protection の bypass_actor に登録済みの admin PAT を用いる、機械生成のリリース台帳コミット（`[skip ci]` 付き・ワーカー成果物ではない）に限定した特権システムアクタの動作であり、既に運用中の `gh pr merge --admin` による特権マージと同種の明示的例外である。より厳密なI4準拠（bot PRの自動マージ経由）は、本リポジトリのゲートCIが現状 `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` 未設定で機能しておらずPR経由の版数コミットがゲート未通過でデッドロックするため現時点で採用せず、将来のフォローアップ候補とする。
  - 既存ワークフロー（`agent-skill-chain-{ci,gate,risk,reconcile}.yml`）はいずれも main への push をトリガにしない（`reconcile` は `branches-ignore:[main]`、他は `pull_request`）ため、本ワークフロー追加による既存トリガとの競合・二重起動は発生しない。
