# DESIGN: agent-skill-chain — lint-vocab識別子認識本格実装・ADR-0002 finalize・secret scan CI導入

- Issue: `ISSUE-178`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| 要件1（識別子認識） / `AC-1`,`AC-2`,`AC-3` | `IdentifierContext`判定（`isCodeLikeReference`拡張：YAML識別子文脈・CLIサブコマンド文脈・コード識別子文脈の3判定＋外部語彙明示許可リスト） | 既存3除外（バッククォート・placeholder・パストークン）は変更せず追加のみ |
| 要件2（対象復帰） / `AC-4`,`AC-5` | `defaultVocabFileRoots()`改修＋残存誤検出の内容是正 | GLOSSARY.mdの恒久除外は維持 |
| 要件3（ADR-0002実機検証） / `AC-6` | 実機push検証（本DESIGN.md「ADR-0002実機検証結果」節に実施済み・証跡記載） | 本フェーズで完了済み |
| 要件4（ADR-0002確定） / `AC-7` | ADR-0002 `status: accepted`更新（本フェーズで実施済み） | Consequences本文は不変。status更新自体が検証完了を意味する運用として本節で確定 |
| 要件5（secret scan CIジョブ） / `AC-8`,`AC-9` | `SecretScanner`（新規`lint secrets`サブコマンド）＋CI `verify`ジョブへのステップ追加 | 新規jobではなく既存`verify`ジョブへ追加 |
| 要件6（required check化） / `AC-10`,`AC-11` | 既存job（`verify`）内への統合により`main.json`のruleset変更を不要化 | `verify-template-sync.sh`が両ファイル同期を検査 |
| AC-12（regression） | 「障害・ロールバック考慮」節＋PLAN.mdの全体回帰確認タスク | - |

## 責務・境界

### コンポーネント構成

#### A. lint-vocab識別子認識（要件1・要件2）

- **`IdentifierContext`判定ロジック**（`src/commands/lint.ts` `isCodeLikeReference()`の拡張）: 既存3除外（バッククォートスパン・`<placeholder>`・スラッシュ入りパストークン、および「パス形式禁止語は常に除外対象外」ガード）の**後段に追加**する。既存3除外・パス形式禁止語ガードの評価順序・挙動は変更しない（AC-3の後退防止）。
  1. **コード識別子文脈**（snake_case/camelCase/SCREAMING_SNAKE_CASE）: 禁止語の出現位置を含む最大の識別子文字列run（`[A-Za-z0-9_]+`）を抽出する。run長が禁止語長より長い場合（＝複合語の一部）、runを`_`区切り→各chunk内をcamelCase境界（小文字/数字→大文字の遷移直前）でさらに分割し、いずれかのセグメントが禁止語と大小文字を無視して完全一致すれば識別子文脈として除外する。run長が禁止語長と等しい場合（＝単独の語そのもの）はこの判定では除外しない（要件1「単独のissueは識別子文脈と誤認しない」）。
     - 例: `issue_id` → `[issue, id]` → `issue`に一致 → 除外。`issueId` → camelCase分割で`[issue, Id]` → 除外。`ISSUE_ID` → 大小無視で一致 → 除外。`issues`（区切り無し、複合境界なし） → 対象外のまま（散文誤用として引き続き検出対象）。
  2. **YAML識別子文脈**（キー構文＋flow-sequence要素の2形態。要件1「YAMLキー文脈」を、YAML構文上の裸スカラー識別子という同一原理でキー位置以外にも一般化したもの）: runが禁止語そのもの（複合でない）の場合に限り判定する。
     - (a) キー構文: 当該run直前が「行頭からの空白＋任意の`- `」のみであり、run直後（空白を挟んでよい）が`:`である（例: `issue:`、`  issue:`、`orchestrator:`）。
     - (b) flow-sequence要素: run直前（空白を挟んでよい、生の隣接文字で判定）が`[`または`,`、run直後（同様）が`,`または`]`である（例: `[issue, wip]`、`inputs: [issue, ...]`）。
  3. **CLIサブコマンド文脈**: runが禁止語そのもの（複合でない）で、かつ直前の生の1文字（空白スキップ無し）が「空白・行頭・`"`」のいずれかであり、直後の生の1文字も「空白・行末・`"`」のいずれかである場合（＝独立したシェルトークンとして出現）、前後の空白区切りトークン（引用符除去後）のいずれかが既知CLI verbホワイトリストに含まれれば除外する（例: `issue start`・`issue resume`）。この「生の隣接文字」判定により、日本語の仮名文字が直接隣接する場合（例:「issueについて」）は境界条件を満たさず誤って除外しない。
     - **verbホワイトリストの正本化**: `src/agents-md.ts`の`routes`オブジェクト（2トークンキー`'issue start'`等）を`src/lib/cli-routes.ts`へ切り出す（`agents-md.ts`は末尾で`main(...)`を副作用として実行するモジュールのため、`lint.ts`から直接importすると意図せずCLIが実行されてしまう。切り出しにより両者が同一の`routes`定義を安全にimportできるようにする）。`lint.ts`は`cli-routes.ts`のキーからverb（2トークン目）集合を導出し、ホワイトリストのハードコード二重管理・ドリフトを防ぐ。
  4. **外部語彙の明示許可リスト**（`EXTERNAL_VOCAB_ALLOWLIST`、`lint.ts`内の小さな定数配列）: 上記1〜3のいずれにも該当しないが、外部システム（GitHub等）が仕様として定めるフィールド名そのものであり、改名（外部仕様のため不可）・バッククォート付与（YAML構文を壊すため不可）のいずれの対応も取れない既知の少数の完全一致トークンのみを列挙する明示的な例外リスト。現時点で1件: `blank_issues_enabled`（`.github/ISSUE_TEMPLATE/config.yml`、GitHub公式スキーマのキー名。`blank_issues_enabled`を`_`分割すると`[blank, issues, enabled]`となり`issues`は`issue`の複数形であって完全一致しないため、上記1のコード識別子文脈では救えない）。runがこのリストの要素と完全一致する場合のみ除外する。正規表現・部分一致は持たず、無制限のsuppress機構にはしない。

- **`defaultVocabFileRoots()`改修**（`src/lib/scan.ts`）: `templates`・`config`・`schemas`・`scripts`の一時除外コメント・除外ロジックを撤廃し、`defaultLiveFileRoots()`と同一集合（`docs/GLOSSARY.md`のみ恒久除外）を返すようにする。

#### B. 残存誤検出の内容是正（要件2、AC-4を満たすための実データに基づく是正）

設計時点で`npm run build && node bin/agents-md.js lint vocab .agent-skill-chain/templates .agent-skill-chain/config .agent-skill-chain/schemas .agent-skill-chain/scripts`を実測実行し、上記Aの3判定＋許可リストで解消される行（`issue_id`・`issue_created_at`等の複合識別子、`issue:`・`orchestrator:`等のYAMLキー、`[issue, ...]`等のflow-sequence要素、`issue start`・`issue resume`のCLIサブコマンド、`blank_issues_enabled`）を除いた**真の残存分**を洗い出した。実装フェーズはこのリストを起点に、上記コマンドを再実行しながら是正する。

| 対象 | 内容 | 是正方針 |
|---|---|---|
| `.github/ISSUE_TEMPLATE/docs.yml`（1,2,14行目）、`provisioning/labels.yaml`（18行目） | 散文としての「ドキュメント」使用（GitHub Issueテンプレートの表示名・説明文） | 内容修正：「ドキュメント」を含まない表現へ言い換える（例:「資料」「README等」）。真の散文誤用であり識別子文脈の対象外 |
| `config/roles.yaml`（119行目）、`.github/workflows/agent-skill-chain-gate.yml`（115行目） | 「ブロック」（block、禁止語「ロック」とは無関係な意味）の部分文字列として「ロック」が一致する仮名の偶発衝突 | 内容修正：「ブロック」を含まない表現へ言い換える（例:「停止」「中断」）。識別子文脈判定（YAML/CLI/コード識別子）では解決できない別種の問題（日本語の部分文字列衝突）であり、本Issueのスコープ（3種の識別子文脈）外。恒久対応（仮名の単語境界判定の一般化）は本Issueでは行わず、必要性が再確認された時点で別Issueとする |
| `config/roles.yaml`（15,16,37行目 `issue.create`・`issue.state_transition`・`issue.report`）、`scripts/issue-start.sh`（3行目コメント中の`issue.allowed_types`） | ドット区切りの複合識別子（capability名・config参照）。snake_case/camelCase/SCREAMING_SNAKE_CASEのいずれでもないため上記A-1（コード識別子文脈）の対象外 | 内容修正：該当箇所をバッククォートで囲み既存のコードスパン除外を適用する。実装時に`src/lib/roles.ts`の型定義（`RolesDocument.role_contracts`のみが型付けされ、`roles.<role>.capabilities`は型付けされていない自由記述であることを`roles.ts`で確認済み）を再確認し、バッククォート付与が既存の読み出しロジック・`test/unit/roles.test.ts`のアサーションに影響しないことを検証してから適用する |

上記是正後、AC-4の期待（引数無しデフォルト対象で終了コード0）を満たす。

#### C. ADR-0002実機検証・finalize（要件3・要件4）

本DESIGN.mdの作成と同一フェーズで実施済み。詳細は次節「ADR-0002実機検証結果」。

#### D. secret scan CI（要件5・要件6）

- **`SecretScanner`**（新規`src/commands/lint.ts`の`secrets()`、CLIサブコマンド`lint secrets`、ラッパー`.agent-skill-chain/scripts/lint-secrets.sh`）: 既存の`lint vocab`/`lint references`と同じ「軽量な自前正規表現ベースの検査」方式を採る（外部ツール未導入。理由は下記）。
  - **検出パターン**（既知の秘密情報フォーマットの接頭辞に限定し誤検出率を抑える。エントロピーベースの汎用検出は持たない）:
    - AWS Access Key ID: `\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b`
    - AWS Secret Access Key（`aws_secret_access_key`キー名への代入文脈に限定し誤検出を抑える）: `(?i)aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}['"]?`
    - GitHub PAT: `\bgh[pousr]_[A-Za-z0-9]{36}\b`
    - Slack token: `\bxox[baprs]-[0-9A-Za-z-]{10,48}\b`
    - Google API key: `\bAIza[0-9A-Za-z_-]{35}\b`
    - Stripe secret key: `\bsk_(live|test)_[0-9A-Za-z]{24,}\b`
    - PEM秘密鍵ヘッダ: `-----BEGIN (RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----`
  - **動作モード2種**（`lint vocab`/`lint references`の引数契約パターンを踏襲しつつ、diffスコープの新モードを追加する）:
    - `lint secrets <path...>`: 指定ファイルの全行を対象に検査する（単体テスト・手動実行向け。AC-8/AC-9のGiven/When/Thenをファイル単位で構成できる）。
    - `lint secrets --diff <base-ref>`: `git diff <base-ref>...HEAD`で追加された行（`+`始まり、`+++`ヘッダを除く）のみを対象に検査する（CI向け。SPEC.mdスコープ外の「既存commit履歴の遡及監査」を行わず、当該PRで新たに追加される行のみを対象とすることで両立させる）。
  - 出力契約は`lint vocab`/`lint references`と同一（成功: 終了コード0、失敗: 終了コード1以上＋`ファイル:行`形式の標準エラー出力）。
  - **ツール選定の理由（gitleaks等の外部OSSツール不採用）**: 本リポジトリの依存関係は`ajv`・`yaml`の2つのみ（`package.json`）に抑えられており、CIも`actions/checkout`・`actions/setup-node`以外のMarketplace actionを使っていない。gitleaks等は別言語binaryの追加導入（Marketplace action経由のダウンロード、またはnpm wrapper経由の間接依存）を要し、本プロジェクトが一貫して採る「lint-vocab・lint-references同様、自前の小さなTypeScript実装＋薄いshラッパー」という既存アーキテクチャ・依存最小方針との整合性を優先し、既知フォーマット限定の軽量自前実装を採用する。検出網羅性の継続拡充（エントロピーベース検出等）は本Issueのスコープ外とし、必要が生じた時点で別Issueとする（AGENTS.md UNIX原則「疑わしい機能は追加しない」）。
- **CI統合**（正本`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml`、配布先`.github/workflows/agent-skill-chain-ci.yml`は同一内容に同期）: 新規jobを作らず、既存`verify`job内の`lint-references`ステップの後段に`lint-secrets`ステップを追加する。
  ```yaml
  - name: Fetch base branch for secret scan
    if: github.base_ref != ''
    env:
      BASE_REF: ${{ github.base_ref }}
    run: git fetch origin "$BASE_REF" --depth=1

  - name: lint-secrets (PRで追加された行のみ)
    if: github.base_ref != ''
    env:
      BASE_REF: ${{ github.base_ref }}
    run: ./.agent-skill-chain/scripts/lint-secrets.sh --diff "origin/$BASE_REF"
  ```
  既存の「Fetch base branch for diff-based checks」ステップ・`verify-adr`ステップも同様にそれぞれ個別に`git fetch`を行っており（shallow fetchで低コスト）、本ステップはこの既存パターンを踏襲する。`if: github.base_ref != ''`によりPR以外のトリガーでは実行しない（既存の同条件ステップと同じガード）。
  - **required check化（要件6）**: 新規jobを作らず既存`verify`job内のステップとして追加するため、`.agent-skill-chain/templates/github/provisioning/rulesets/main.json`の`required_status_checks`（既に`{"context": "verify"}`を含む）は変更不要。secret scanステップの失敗はそのまま`verify`job全体・ひいてはrequired checkである`verify`の失敗として伝播する。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0002
    relation: references
```

ADR-0002は本Issueのスコープである「ADR-0002 finalize」自体の対象ADRであり、本DESIGN.mdの作成と同一フェーズで`status: accepted`へ更新済み（次節参照）。

## ADR-0002実機検証結果

`SPEC.md`要件3に基づき、本リポジトリ（`techbeansjp-free/AGENTS.md`、`gh auth status`で確認したtoken scope: `gist, read:org, repo, workflow`）に対し、ADR-0002 Decision節記載の方式（`git commit-tree`によるparentlessコミット作成＋カスタムref namespaceへの`git push`）を実際に実行した。

### 実行コマンドと出力（証跡）

```
$ git hash-object -t tree /dev/null
4b825dc642cb6eb9a060e54bf8d69288fbee4904

# --- acquire相当: 新規refへのpush ---
$ SHA1=$(git commit-tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904 -m "test lease acquire (ISSUE-178 ADR-0002 verification)")
# SHA1=0832afaf56e6b7f5c7c0932c7c7a27462a1d58a0
$ git push origin "$SHA1:refs/agent-skill-chain/leases/adr0002-verification-178"
To https://github.com/techbeansjp-free/AGENTS.md.git
 * [new reference]   0832afaf56e6b7f5c7c0932c7c7a27462a1d58a0 -> refs/agent-skill-chain/leases/adr0002-verification-178
（終了コード0：成功）

# --- 競合pushの試行: 別のparentlessコミットを同じrefへforce無しでpush ---
$ SHA2=$(git commit-tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904 -m "test lease acquire CONFLICT attempt (ISSUE-178 ADR-0002 verification)")
# SHA2=9eec500b1e22b8e2b5efec9970ee4532e76d720e
$ git push origin "$SHA2:refs/agent-skill-chain/leases/adr0002-verification-178"
To https://github.com/techbeansjp-free/AGENTS.md.git
 ! [rejected]        9eec500b1e22b8e2b5efec9970ee4532e76d720e -> refs/agent-skill-chain/leases/adr0002-verification-178 (non-fast-forward)
error: failed to push some refs to 'https://github.com/techbeansjp-free/AGENTS.md.git'
（終了コード1：拒否＝compare-and-set保証の実測確認）

# --- release相当: テスト用refの削除 ---
$ git push origin --delete refs/agent-skill-chain/leases/adr0002-verification-178
To https://github.com/techbeansjp-free/AGENTS.md.git
 - [deleted]         refs/agent-skill-chain/leases/adr0002-verification-178
（終了コード0：成功）

# --- クリーンアップ確認 ---
$ git ls-remote origin 'refs/agent-skill-chain/*'
（出力なし：残存ref無しを確認）
```

### 結論

3項目すべてが実測どおりに成功した。

1. カスタムref namespace（`refs/agent-skill-chain/leases/*`）への新規push（acquire相当）が成功した。
2. 既存refに対する非fast-forwardなpushが`[rejected]`（`non-fast-forward`）としてサーバ側で拒否され、compare-and-set保証が実機で機能することを確認した。
3. `git push origin --delete`によるref削除（release相当）が成功し、テスト用refを残さずクリーンアップできた。

これにより、SPEC.md AC-6・AC-7の要求どおり、現在の資格情報（`contents: write`相当の権限を持つtoken）でADR-0002 Decision節の方式が実機で機能することを確認できたため、**要件4の「push成功時」の分岐**を採用する。ADR-0002の`status`フィールドのみを`proposed`から`accepted`へ更新済み（`docs/adr/ADR-0002-github-lease-git-ref-cas.md`）。Context/Decision/Consequences/`supersedes`は一切変更していない（`adr_finalization_worker`のscope: `adr_status_only`を遵守）。

Consequences節に残る「実機検証がまだ完了していない」という記述と、実際には検証が完了したという状態の間の不整合は、SPEC.md要件4が定める運用（**`status: accepted`への遷移それ自体が「検証完了」を意味する**）で解消する。ADR本文（Context/Decision/Consequences）はaccepted後不変というライフサイクル規約（`.agent-skill-chain/templates/adr/ADR.md`）があるため、新規ADRでの補記や本文書き換えは行わない。Consequences節の当該文は「ADR-0002がproposedだった当時に残っていた既知の未検証事項」という単なる歴史的記述として扱い、`status: accepted`という事実そのものが読者に「その後検証済みである」ことを伝える運用とする。この解釈はADR本文を一切変更しないため、`.agent-skill-chain/scripts/adr-lint.sh check`の構造検査にも影響しない（実測: `node bin/agents-md.js lint adr check` 終了コード0）。

## 障害・ロールバック考慮

- 想定される失敗モード:
  - 識別子文脈判定の過剰除外（本来検出すべき散文誤用を誤って除外してしまう）: AC-2の回帰テストが防止する。実装フェーズは`test/integration/lint.test.ts`に新規テストケースを追加し、3種の識別子文脈それぞれについて「除外される例」と「隣接する散文誤用は除外されない例」を対で検証する。
  - secret scanの誤検知によるCI全体停止（AC-9）: 検出パターンを既知フォーマットの接頭辞限定にし、汎用エントロピー検出を持たないことでリスクを抑える。誤検知が実際に発生した場合はパターン自体を狭める方向で対応し、抑制リストの濫用（何でも許可する方向）は避ける。
  - secret scanの検出漏れ（AC-8）: MVPパターンセットは既知の主要フォーマットに限定されるため、未知フォーマットの秘密情報は検出できない可能性がある。本Issueのスコープは「検知・失敗させる振る舞いの導入」であり、検出網羅性の継続拡充は別Issueとする（SPEC.mdスコープ外）。
  - `blank_issues_enabled`の外部語彙許可リストが将来他の外部スキーマフィールドでも必要になり肥大化する可能性 → 完全一致のみを許可する狭い設計のため、肥大化しても各エントリの妥当性はコードレビューで個別に検証可能（正規表現による包括suppressにはしない）。
- ロールバック手順: 本Issueの全変更はこのPR単位でのcommitであり、PRをrevertすれば`defaultVocabFileRoots()`の4ディレクトリ除外・ADR-0002の`status`・CI workflowの変更はすべて同時に巻き戻る。ADR-0002のみを個別に戻す必要が生じた場合は、`status`フィールドのみの変更であるため、`accepted`→`proposed`への逆更新も本文に影響しない。
- 影響を受ける既存機能:
  - `agent-skill-chain lint vocab`のデフォルト対象範囲が拡大する（AC-4）。既存の`test/integration/lint.test.ts`の「path引数省略時のデフォルト対象は違反なしで終了コード0」テストは、除外ディレクトリ変更後も同じ期待（0件）を維持する前提（是正完了後）。
  - CI実行時間: `lint-secrets`ステップ追加によりCI全体の所要時間がわずかに増加する（diffベースのため軽量、既存`verify-adr`ステップと同等オーダー）。
  - branch protection / rulesetは変更しない（`main.json`は無変更、既存の`verify`必須チェックがそのままsecret scanも包含する）。
