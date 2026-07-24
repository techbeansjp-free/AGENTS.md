# SPEC: release publish の gh release create が --generate-notes を使わず、GitHub Release から What's Changed / Full Changelog の自動生成が失われている

- Issue: `ISSUE-226`
- 作成者: `spec-worker`
- 対象ブランチ: `bugfix/226-release-generate-notes`

## 目的・背景

`agent-skill-chain release publish <target>`（リリーサ）は、`v<target>` タグを指す GitHub Release を作成する責務を負う。現行実装は `gh release create` へ固定文字列 `agent-skill-chain v<target> のリリース。` のみを `--notes` として渡しており、`--generate-notes`（GitHub がマージ済みPRのタイトルから What's Changed / Full Changelog セクションを自動生成する機能）を使用していない。その結果、旧実装（タイムスタンプ版数体系時代）の Release には存在した「What's Changed」（マージ済みPR一覧: タイトル・PR番号・作成者）と「Full Changelog」（前回タグとの比較リンク）が、新実装の Release（例: v0.2.6）には一切含まれていない。

ADR-0005（accepted）は版数体系（semver、`v<major>.<minor>.<patch>`）・main反映方式（PR経由admin merge）・marketplace/apm廃止のみを決定しており、Release本文の生成方式には言及していない。本件は ADR-0005 が意図的に決定した仕様ではなく、Issue #196 実装時の作り込み漏れであり、本 Issue はこれを復元する。

前提となる実測事実（2026-07-24、副作用のない `POST /repos/{owner}/{repo}/releases/generate-notes` API で確認）:

- `previous_tag_name` を明示指定（v0.2.5→v0.2.6）すると、What's Changed（PRタイトル・番号・作成者）と `**Full Changelog**: .../compare/v0.2.5...v0.2.6` が生成される。
- `previous_tag_name` を省略すると GitHub は Release 履歴から起点を自動検出する。semver 移行後最初のタグ v0.2.2 に対して省略した場合、自動検出は旧タイムスタンプ形式タグ `v20260720.060726` を起点に選び、新旧版数体系をまたいだ Full Changelog を生成した（ただしコマンド・API自体は失敗しない）。
- したがって「新旧版数体系をまたいだ比較をしない」（ADR-0005 と整合する成功基準）を満たすには、自動検出に任せず、直前の semver タグを明示的に起点指定する必要がある。

## 要求 → 要件 → 受入条件

### 要求

`release publish` が作成する GitHub Release の本文に、前回リリース以降に main へマージされた PR の一覧（What's Changed 相当）と、前回タグとの比較リンク（Full Changelog 相当）が自動的に含まれること。「前回リリース」の起点は新版数体系移行後の直近 semver タグを基準とし、旧タイムスタンプ形式タグとの間で changelog をまたがせないこと。版数体系・冪等スキップ・タグ命名規則など ADR-0005 が確定した既存仕様は変更しないこと。

### 要件

- `publish()` は `gh release create` に `--generate-notes` を指定し、GitHub の自動生成 Release notes（What's Changed / Full Changelog）を有効化する。既存の固定文 `agent-skill-chain v<target> のリリース。` は `--notes` として維持する（gh CLI の公式仕様: `--generate-notes` と `--notes` の併用時、`--notes` の内容は自動生成 notes の先頭に付加される。`gh release create --help` で確認済み）。
- 直前の semver タグ（`v<major>.<minor>.<patch>` 形式のタグのうち、今回 target 未満で最大のもの）が存在する場合、`--notes-start-tag` でそれを明示指定する。GitHub の自動起点検出は Release 履歴由来で旧タイムスタンプ形式タグを拾いうる（上記実測）ため、自動検出に委ねない。
- 直前の semver タグが存在しない場合（新版数体系移行後の最初のリリース、または consumer リポジトリの初回リリース等）は `--notes-start-tag` を付けず、gh CLI / GitHub API の既定挙動（起点自動検出、失敗しない）に委ねる。
- タグ一覧の取得は `git tag --list`（ローカル）で行う。release workflow は `fetch-depth: 0` で checkout しタグを含む全 ref を取得済みであり、同一 job 内の `release resolve-version` が既に同じ手段で動作している。
- 既存の冪等スキップ（`gh release view` で既存 Release 検出時は作成せずスキップ）・target の semver 形式検査・標準出力/終了コードの契約は変更しない。

### 受入条件（Acceptance Criteria）

#### AC-1: Release 本文にマージ済み PR への言及（What's Changed 相当）が含まれる

- Given: `v<target>` タグと、それ未満で最大の semver タグ（直前タグ）がリポジトリに存在し、直前タグ以降に main へマージされた PR がある。
- When: `agent-skill-chain release publish <target>` を実行する。
- Then: `gh release create` が `--generate-notes` 付きで呼び出され、作成される Release 本文に直前 semver タグ以降にマージされた PR への言及（タイトル・PR番号・作成者）が含まれる。
- 検証方法見込み: `hybrid`（automated: gh スタブで `gh release create` の引数に `--generate-notes` が含まれることを固定 / manual: 本文の実生成は GitHub 側の挙動のため、副作用のない generate-notes API 実測で What's Changed の内容を確認）

#### AC-2: Release 本文に直前 semver タグとの比較（Full Changelog 相当）が含まれる

- Given: AC-1 と同じ。加えて旧タイムスタンプ形式タグ（例: `v20260720.060726`）が混在していてもよい。
- When: `agent-skill-chain release publish <target>` を実行する。
- Then: `gh release create` が `--notes-start-tag <直前semverタグ>` 付きで呼び出され（旧タイムスタンプ形式タグは起点として選ばれない）、Release 本文に直前 semver タグと今回タグの比較リンク（`.../compare/<直前>...v<target>`）が含まれる。
- 検証方法見込み: `hybrid`（automated: gh スタブで `--notes-start-tag` に直前 semver タグが渡り、タイムスタンプ形式タグ・target 以上のタグが選ばれないことを固定 / manual: 比較リンクの実生成は generate-notes API 実測で確認）

#### AC-3: 直前の semver タグが存在しない場合でもコマンドが失敗しない

- Given: リポジトリに target 未満の semver タグが 1 つも存在しない（新版数体系移行後の最初のリリース等。今回タグ `v<target>` 自体は存在してよい）。
- When: `agent-skill-chain release publish <target>` を実行する。
- Then: `gh release create` は `--notes-start-tag` なし・`--generate-notes` 付きで呼び出され、コマンドは終了コード 0 で成功する（起点は gh CLI / GitHub の既定挙動に委ねる。generate-notes API は起点不在・自動検出いずれでも失敗しないことを実測済み）。
- 検証方法見込み: `automated`（gh スタブ環境で semver タグ不在リポジトリに対する publish が exit 0 となり、引数に `--notes-start-tag` が含まれないことを固定）

#### AC-4: 冪等スキップ・版数体系に回帰がない

- Given: `v<target>` の GitHub Release が既に存在する、または target が semver 形式でない。
- When: `agent-skill-chain release publish <target>` を実行する。
- Then: Release 既存時は従来どおり `gh release create` を呼ばず冪等スキップ（exit 0、Release 作成呼び出し回数は増えない）。target が semver 形式でない場合は従来どおりエラーで拒否する。既存の tag/publish 連続二重発火シナリオも従来どおり成果物は高々 1 件のまま。
- 検証方法見込み: `automated`（既存の統合テスト（冪等スキップ・二重発火・semver 検査）が無修正の期待値のまま成功し続けることを確認）

## スコープ外

- ADR-0005 が確定した版数体系（semver）・main 反映方式（PR経由 admin merge）・marketplace/apm 廃止方針自体の見直し。
- 旧タイムスタンプ形式リリースの本文を遡って書き換えること。
- `release resolve-version` / `release bump` / `release tag` の挙動変更（本 Issue は `publish` のみを対象とする）。
- Release 本文のカスタムテンプレート化（`.github/release.yml` によるカテゴリ分け等）。GitHub 既定の自動生成形式をそのまま用いる。
