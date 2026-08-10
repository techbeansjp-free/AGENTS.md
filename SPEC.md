<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
<...> のプレースホルダを実際の内容に置き換えて記入すること。
-->

# SPEC: setup github / sync templates に --dry-run と上書き保護が無く、大文字小文字を区別しないファイルシステムでカスタムPRテンプレート等を無条件上書きする恐れがある

- Issue: `ISSUE-538`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/538-dry-run-safety-templates`

## 目的・背景

`agent-skill-chain setup github` および `agent-skill-chain sync templates` は、配布元テンプレート（`.agent-skill-chain/templates/github/.github/`・`.claude/agents/`・`.claude/skills/` に対応する配布元）を導入先リポジトリへミラーコピーする。このミラーコピーは既存ファイルとの内容比較を行わず、既存ファイルが配布元と異なっていても常に無条件で上書きする。

さらに `setup github`／`sync templates` のいずれにも、実書込み前に変更内容を確認できる `--dry-run` フラグが存在しない（`init`／`upgrade`／`uninstall` には既に存在する）。

この2点が重なることで、以下のような実害が起こりうる。

- consumer リポジトリが独自にカスタマイズした `.github/pull_request_template.md` 等が、`setup github`／`sync templates` の実行だけで無条件かつ無警告に配布元テンプレートで上書きされる。
- 大文字小文字を区別しないデフォルトファイルシステム（例: macOS APFS）を使う環境では、GitHubの慣習である大文字表記 `.github/PULL_REQUEST_TEMPLATE.md` を既に持つリポジトリで、配布元の小文字表記 `.github/pull_request_template.md` が同一ファイルとして扱われ、既存のカスタムファイルが本人の意図に反して同一実体として置き換わる。
- 事前に `--dry-run` で変更予定を確認する手段が無いため、利用者は実行結果を見るまで何が上書きされるかを把握できない。

本 Issue は、`setup github`／`sync templates` に安全側の確認手段（`--dry-run`）と、大文字小文字を区別しないファイルシステム特有の衝突を無条件で見過ごさない検知手段を追加し、利用者が実書込み前に被害を回避・把握できるようにすることを目的とする。

## 要求 → 要件 → 受入条件

要求から要件、そして機械検証可能な受入条件（AC-ID）まで一意に追跡できる形で記述する。AC-ID は `AC-1` のように `^AC-[0-9]+$` の形式に従う。

### 要求

- `setup github`／`sync templates` の実行前に、実際に書き込まれる変更内容を確認できるようにしてほしい（2026-08-10、別プロジェクトでの新規導入検討時にユーザーから報告）。
- 大文字小文字を区別しないファイルシステム上で、展開先の既存ファイルと大文字小文字のみ異なる同名ファイルが配布元に存在する場合、利用者の既存カスタムファイルを無条件・無警告で上書きしないでほしい。

### 要件

- 要件1: `setup github` コマンドは `--dry-run` フラグを受理し、指定時は対象ツリー（`.github/` 等、`setup github` が同期する範囲）への実書込みを一切行わず、書込み予定の変更内容一覧を標準出力へ表示する。
- 要件2: `sync templates` コマンドは `--dry-run` フラグを受理し、指定時は対象ツリー（`.github/`・`.claude/agents/`・`.claude/skills/` の同期範囲）への実書込みを一切行わず、書込み予定の変更内容一覧を標準出力へ表示する。
- 要件3: `--dry-run` 指定時、`setup github`／`sync templates` はいずれも対象ディレクトリ配下に新規ファイル・ディレクトリを作成せず、既存ファイルの内容も変更しない。
- 要件4: `setup github`／`sync templates` は、コマンドのヘルプ表示（`--help`／`-h` 相当）に `--dry-run` フラグの説明を含める。
- 要件5: `setup github`／`sync templates` が展開しようとするファイルについて、展開先に大文字小文字のみが異なる同名の既存ファイル（配布元のファイル名とバイト列一致ではないが、大文字小文字を区別しない比較では同一パスとみなされる既存ファイル）が存在する場合、その事実を検知する。
- 要件6: 要件5の検知結果は、無条件の上書きに先立って利用者が認識できる形で扱われる（具体的に警告として続行するか中断するかは、大文字小文字を区別する／しないファイルシステムいずれの実行環境でも一貫した挙動になるよう、本 Issue に紐づく `DESIGN.md` で確定する）。
- 要件7: 要件5の検知は `--dry-run` 指定時にも同様に行われ、実書込みを一切行わないまま検知結果を標準出力へ表示する。
- 要件8: 大文字小文字のみ異なる同名の既存ファイルが展開先に存在しない場合、`setup github`／`sync templates` の既存の（ミラー）動作は変更しない。

### 受入条件（Acceptance Criteria）

各 AC には、散文形式の Given/When/Then による受け入れシナリオを添える（構造化マーカーの強制は `bdd.profile: strict` の場合のみ。`.agent-skill-chain/config/agent-skill-chain.yaml` 参照）。以下の `<...>` は全て実内容に置き換える。空欄・プレースホルダ残存は `verify spec-bdd`（`.agent-skill-chain/ci/verify-spec-bdd.sh`）が機械検査し、spec-gate通過を妨げる。検証方法見込みは `automated`・`manual`・`hybrid` のいずれか1語で記す。

#### AC-1: `setup github --dry-run` は実書込みを行わず変更予定一覧のみを標準出力へ表示する

- Given: 導入済みの対象リポジトリで、配布元テンプレートの内容が展開先の既存内容と一部異なっている状態
- When: `agent-skill-chain setup github --dry-run` を実行する
- Then: 展開先のファイルシステムには一切書込みが行われず（新規作成・上書きとも無し）、終了コード0で、作成・変更予定のファイル一覧が標準出力へ表示される
- 検証方法見込み: `automated`

#### AC-2: `sync templates --dry-run` は実書込みを行わず変更予定一覧のみを標準出力へ表示する

- Given: 導入済みの対象リポジトリで、配布元テンプレート（`.github/`・`.claude/agents/`・`.claude/skills/` に対応する配布元）の内容が展開先の既存内容と一部異なっている状態
- When: `agent-skill-chain sync templates --dry-run` を実行する
- Then: 展開先のファイルシステムには一切書込みが行われず（新規作成・上書きとも無し）、終了コード0で、作成・変更予定のファイル一覧が標準出力へ表示される
- 検証方法見込み: `automated`

#### AC-3: `--dry-run` はヘルプ表示に明記されている

- Given: 任意の環境
- When: `agent-skill-chain setup github --help` および `agent-skill-chain sync templates --help`（または `-h`）を実行する
- Then: いずれの出力にも `--dry-run` フラグの説明が含まれる
- 検証方法見込み: `automated`

#### AC-4: 大文字小文字のみ異なる既存ファイルとの衝突を無条件上書きせずに検知する

- Given: 展開先に、配布元の展開先パスと大文字小文字のみが異なる同名の既存ファイルが存在する状態（例: 展開先パスが `.github/pull_request_template.md` で、展開先に既に `.github/PULL_REQUEST_TEMPLATE.md` が存在する）
- When: `agent-skill-chain setup github`（または `sync templates`）を `--dry-run` を付けずに実行する
- Then: 当該ファイルが検知され、検知結果が標準出力または標準エラー出力に明示される。既存ファイルの内容は、それが本来配布元と同一実体として扱われるべきでない限り、利用者に無警告のまま失われない（警告を伴い続行する／中断するのいずれかであるかは `DESIGN.md` で確定する）
- 検証方法見込み: `automated`

#### AC-5: 大文字小文字衝突の検知は `--dry-run` でも実書込み無しに行われる

- Given: AC-4 と同じ、大文字小文字のみ異なる既存ファイルが展開先に存在する状態
- When: `agent-skill-chain setup github --dry-run`（または `sync templates --dry-run`）を実行する
- Then: 展開先のファイルシステムには一切書込みが行われないまま、AC-4 と同じ検知結果が標準出力へ表示される
- 検証方法見込み: `automated`

#### AC-6: 大文字小文字が完全一致する既存ファイルへの既存の同期動作は変更しない

- Given: 展開先に、配布元と同一パス（大文字小文字含む完全一致）の既存ファイルが、配布元と異なる内容で存在する状態
- When: `agent-skill-chain setup github`（または `sync templates`）を `--dry-run` を付けずに実行する
- Then: 従来どおり当該ファイルは配布元の内容で上書きされ、AC-4 の大文字小文字衝突検知は発火しない（回帰無し）
- 検証方法見込み: `automated`

<!-- AC を追加する場合は AC-7, AC-8 ... と連番で追加する -->

## スコープ外

- 非推奨の `setup`（引数無し、bare）コマンドへの `--dry-run` 追加。当該コマンドは既に `copyTreeFailOnConflict`（内容が異なる既存ファイルへは無条件で中断する）を使用しており、本 Issue が対象とする無条件上書きの問題を持たない。利用者には `init` ＋ 必要なら `setup github` への移行を促す既存の非推奨警告がある。
- `setup labels`／`setup ruleset` サブコマンドへの `--dry-run` 追加。これらは GitHub API（ラベル・ruleset）を操作するのみでファイルシステムへのミラーコピーを行わないため、本 Issue が対象とする問題を持たない。
- 大文字小文字衝突を検知した場合の具体的な挙動（警告して続行するか、中断するか）と、`--force` 相当のオプトインを新設するか否かの確定。要件6のとおり `DESIGN.md` で確定する。
- 展開先が大文字小文字を区別しないファイルシステム上にあるかどうかを実行時に自動判定するロジックの具体的な実装方式。本 SPEC は「大文字小文字のみ異なる同名ファイルの存在」を検知対象とすることのみを要求し、判定アルゴリズムの選定は設計判断とする。
- 既存の `init`（`copyTreeFailOnConflict`）における大文字小文字衝突検知の追加。`init` は既に内容不一致の既存ファイルへの無条件上書きを行わない安全装置を持っており、本 Issue の対象外とする（必要であれば別 Issue で扱う）。
- `.github/`・`.claude/agents/`・`.claude/skills/` 以外の配布物（`config/agent-skill-chain.yaml` 等、`init`／`upgrade` が扱う対象）への `--dry-run`／大文字小文字衝突検知の適用。これらは既に `init`／`upgrade` で `--dry-run` を提供済みであり対象外とする。
