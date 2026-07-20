<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: spec、成果物: SPEC.md、ゲート: spec-gate）。
-->

# SPEC: agent-skill-chain — lint-vocab識別子認識本格実装・ADR-0002 finalize・secret scan CI導入

- Issue: `ISSUE-178`
- 作成者: `claude`
- 対象ブランチ: `feature/178-gap-batch3`

## 目的・背景

Issue #176（writer lease原子性強化バッチ）の「対象外」で明示的に別Issueへ先送りされた3件と、同時期から継続言及されているADR-0002 finalize未実施をまとめて解消する。相互依存は無いが、いずれも「以前のIssueで意図的に先送りにした残課題」という共通性を持つため1バッチにまとめる。

1. **lint-vocabスキャナの識別子・YAML/CLIサブコマンド名認識の本格実装**: `.agent-skill-chain/scripts/lint-vocab.sh`（実体は`src/commands/lint.ts`の`vocab()`、CLI `agent-skill-chain lint vocab`）は現在`defaultVocabFileRoots()`（`src/lib/scan.ts`）で`.agent-skill-chain/{templates,config,schemas,scripts}/`を一時的に対象外としている。理由：現行スキャナの誤検出除外ロジック（`isCodeLikeReference()`）は「バッククォートのコードスパン」「`<placeholder>`トークン」「`/`を含むパス風トークン」の3種のみを正当な技術的参照として認識する。これに対し、上記4ディレクトリでは禁止語（例：「issue」）が以下のように識別子的に使われており、いずれも現行の3種のいずれにも該当しないため誤検出（false positive）を起こす。
   - YAMLキー（`/`を含まずバッククォートも無い、行頭の`issue:`のような素の識別子。実例：`.agent-skill-chain/config/agent-skill-chain.yaml`の`issue:`セクション、`issue_id`フィールド）
   - CLIサブコマンド名（`issue start`・`issue resume`のような、バッククォート無しで散文中に埋め込まれたコマンド列）
   - コード中の識別子名（`snake_case`・`camelCase`の変数名・関数名で、パスのように`/`を含まない単独トークン）
   
   このため上記4ディレクトリは`defaultVocabFileRoots()`から恒久的にではなく「follow-up issueで対象復帰する」前提の一時除外として除かれている（`src/lib/scan.ts`のコメントに明記）。本Issueがそのfollow-up issueであり、識別子文脈と散文中の禁止語混入を区別できるスキャナへ改修したうえで4ディレクトリを対象復帰する。

2. **ADR-0002（GitHubモードwriter leaseのgit ref-based compare-and-set化）のfinalize**: `docs/adr/ADR-0002-github-lease-git-ref-cas.md`は`status: proposed`のまま据え置かれている。ADRのContext節はローカルbareリポジトリでのシミュレーションによるgit ref compare-and-set機構自体の技術検証（Issue #176 SPEC.mdで実施済み）を実測確認済みと記述する一方、Consequences節は「`contents: write`権限がこのカスタムref namespace（`refs/agent-skill-chain/*`）への実pushを許可するかは、実リポジトリでの実機検証がまだ完了していない」と明記しており、両節の間に未解消のギャップが残っている。本Issueでこのリポジトリ（`techbeansjp-free/AGENTS.md`、fine-grained PAT、`contents: write`スコープ）に対する実機検証（実際に`git push origin <sha>:refs/agent-skill-chain/leases/<issue>-<segment>`を試行する）を行い、結果に応じてADRのライフサイクル（`status`フィールドのみの更新、AGENTS.md「ADR・テンプレート・テスト適用性」節が定めるADR finalization手順に従う）を確定させる。

3. **secret scanのCI導入**: `.github/workflows/agent-skill-chain-ci.yml`（正本は`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml`、2箇所は内容同一で`verify-template-sync.sh`が同期を検査する）には現在、ブランチ名・worktreeパス・テンプレート同期・成果物存在・AC対応・ADR・用語・参照規約の各検査は揃っているが、secret（認証情報・APIキー等）の混入を検知するジョブ/ステップが無く、required checkにもなっていない。`.agent-skill-chain/standards/TEST_POLICY.md`「常時必須」区分は「依存関係・secretスキャン」をすべてのIssueで無条件必須と定めているが、CI設定はこの規約を実装していない。本Issueでsecret scanジョブ/ステップを追加し、検出時にPRを失敗させる（required check化）。

## 用語

- **識別子文脈**: コードのシンボル名（変数・関数・引数名）、YAMLのキー名、CLIのサブコマンド名・引数名など、自然言語の散文ではなく構文的な名前として語が出現する文脈。本Issueのlint-vocab改修における中心概念。
- **散文中の禁止語混入**: 識別子文脈ではない、自然文の文章表現として禁止語（`docs/GLOSSARY.md`「禁止同義語」列に列挙された語）が使われている状態。lint-vocabが検出すべき対象。
- **カスタムref namespace**: `refs/heads/`・`refs/tags/`以外の任意のgit ref名前空間。本Issueでは`refs/agent-skill-chain/leases/*`を指す（ADR-0002 Decision節）。
- **required check**: GitHubのbranch protection / rulesetでマージ条件として必須指定されたCheck Run。本Issueのsecret scanジョブはこの状態にすることが成功基準の一部。

## 要求 → 要件 → 受入条件

要求から要件、そして機械検証可能な受入条件（AC-ID）まで一意に追跡できる形で記述する。AC-ID は `AC-1` のように `^AC-[0-9]+$` の形式に従う。

### 要求

Issue #178本文（対象範囲1〜3・成功基準）に基づく要求：

- lint-vocabスキャナが、コード・YAML・CLIサブコマンド名としての識別子的な禁止語利用を誤検出せず、かつ散文中の禁止語混入は引き続き検出する状態にしたい。現在対象外の`.agent-skill-chain/{templates,config,schemas,scripts}/`を、誤検出無しで検査対象に戻したい。
- ADR-0002を`proposed`のまま放置せず、実機検証結果に基づいて`accepted`または`superseded`のいずれかへ確定させたい。
- CIにsecret scanジョブを追加し、実際にsecretパターンを検知して失敗させ、かつrequired checkとして機能させたい。
- 上記変更後も既存テストスイート（`chore/162-agent-skill-chain-bootstrap`統合ブランチ上の全件）が引き続き全てpassする状態を維持したい。

### 要件

- **要件1（lint-vocabの識別子認識）**: `src/commands/lint.ts`の`isCodeLikeReference()`系ロジック（またはその代替）を拡張し、以下の識別子文脈を「正当な技術的参照」として散文誤用の検出対象から除外する。
  - YAMLキー文脈: 行内で禁止語が`key: value`または`key:`（YAMLマッピングキーとしての用法。行頭または字下げの直後に出現し、直後に`:`が続く）の形式で出現する箇所。
  - CLIサブコマンド文脈: `agent-skill-chain <verb> <banned-word>`または`<banned-word> <verb>`のような、既知のCLI verb（例：`start`、`resume`、`acquire`、`release`）と隣接する形での出現。設計フェーズで具体的な検出規則（既知verbのホワイトリスト方式か、より一般的な構文パターンかを含む）を確定する。
  - コード識別子文脈: `snake_case`・`camelCase`・`SCREAMING_SNAKE_CASE`の複合識別子の一部として禁止語が出現する箇所（例：`issue_id`、`issueId`、`ISSUE_ID`）。単独の`issue`という語そのもの（複合語の一部でない場合）は識別子文脈と誤認せず、引き続き散文誤用として検出対象に残す。
  - 上記いずれの拡張も、既存の除外規則（バッククォートスパン・`<placeholder>`・スラッシュ入りパストークン）およびパス形式禁止語（`.agent-skill-chain/source`等）の除外対象外扱いを後退させない（regressionなし）。
- **要件2（対象ディレクトリの復帰）**: `src/lib/scan.ts`の`defaultVocabFileRoots()`から`.agent-skill-chain/{templates,config,schemas,scripts}/`の除外を撤廃し、`defaultLiveFileRoots()`と同一の対象範囲（`docs/GLOSSARY.md`の恒久除外のみ残る）に統一する。
- **要件3（ADR-0002実機検証）**: このリポジトリ（`techbeansjp-free/AGENTS.md`、現在のfine-grained PATクレデンシャル）に対して実際に`git push origin <sha>:refs/agent-skill-chain/leases/<test-ref>`を試行し、成功・失敗を実測する。テスト用refは本番のlease機構と衝突しない識別子（例：`refs/agent-skill-chain/leases/178-verification-test`）を使い、検証後に`git push origin --delete`で削除する。
- **要件4（ADR-0002ライフサイクル確定）**: 要件3の結果に応じて次のいずれかを行う。
  - push成功時: ADR-0002の`status`フィールドのみを`accepted`へ更新する（AGENTS.md「ADR・テンプレート・テスト適用性」節が定めるADR finalization手順に従い、Context/Decision/Consequences本文・`supersedes`は変更しない）。Consequences節の「実機検証がまだ完了していない」という記述と実際の状態の不整合は、本文不変の原則があるため新規ADRでの補記ではなく、`status`更新それ自体が「検証完了」を意味する運用としてPLAN.md/DESIGN.mdで確定する。
  - push失敗時（権限不足等）: ADR-0002の本文は書き換えず、新規ADR（`docs/adr/ADR-0003-*.md`）を作成してADR-0002を`superseded`にし、対応方針（PAT scope拡張の運用手順文書化、または別方式への転換）をこの新規ADRのDecision節に記録する。
- **要件5（secret scan CIジョブ）**: `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml`（正本）と`.github/workflows/agent-skill-chain-ci.yml`（配布先、内容同一で同期）の両方にsecret scanのステップまたはジョブを追加する。検出時はステップが非ゼロ終了しCI全体を失敗させる。既存の`npm ci`・`npm run build`・`npm test`・各種`verify-*`/`lint-*`ステップとの実行順序・所要時間への影響を考慮し、依存の無いステップ同士の並列化（別jobへの分離）または既存jobの適切な位置への追加を設計フェーズで判断する。
- **要件6（secret scanのrequired check化）**: GitHub branch protection / rulesetの設定（`.agent-skill-chain/templates/github/provisioning/rulesets/main.json`が正本、`.agent-skill-chain/scripts/setup-ruleset.sh`で適用）にsecret scanジョブ（または追加後のCI全体のCheck Run名）が含まれるようにし、このリポジトリへ実際に適用してrequired checkとして機能することを確認する。

### 受入条件（Acceptance Criteria）

#### AC-1: 識別子文脈（YAMLキー・CLIサブコマンド・コード識別子）としての禁止語利用は誤検出されない

- Given: `.agent-skill-chain/config/agent-skill-chain.yaml`に実在する`issue:`（YAMLキー、バッククォート無し・スラッシュ無し）、`issue_id`（YAMLキー名の一部）、および散文中に埋め込まれた`agent-skill-chain issue start`のようなCLIサブコマンド列という3種の識別子文脈での禁止語「issue」の実利用を含むテストファイルを用意する
- When: `agent-skill-chain lint vocab`（改修後の実装）をこのファイルに対して実行する
- Then: 上記3種の識別子文脈の行はいずれも違反として報告されない（終了コード0、または他の真の違反のみが報告される）ことを自動テストで実測確認する
- 検証方法見込み: `automated`

#### AC-2: 散文中の禁止語混入は引き続き検出される（regressionなし）

- Given: AC-1と同一ファイル内に、識別子文脈ではない散文としての禁止語混入（例：「このissueの内容を確認してください」）を1行以上追加で含める
- When: `agent-skill-chain lint vocab`を実行する
- Then: 散文誤用の行のみが違反として報告され（終了コード1以上）、AC-1の識別子文脈の行は引き続き違反として報告されないことを自動テストで実測確認する
- 検証方法見込み: `automated`

#### AC-3: 既存の除外規則・パス形式禁止語の特例が後退しない

- Given: 既存テスト（`test/integration/lint.test.ts`）が検証しているバッククォートスパン・`<placeholder>`・スラッシュ入りパストークンの除外、およびパス形式禁止語（`.agent-skill-chain/source`）がこれらの除外の対象外である特例
- When: 識別子認識改修後のスキャナで既存テストを再実行する
- Then: 既存テストが全てpassし、識別子認識の拡張がこれらの既存の正しい挙動を壊していないことを実測確認する
- 検証方法見込み: `automated`

#### AC-4: `.agent-skill-chain/{templates,config,schemas,scripts}/`が検査対象へ復帰し、誤検出なしで実行できる

- Given: `src/lib/scan.ts`の`defaultVocabFileRoots()`から4ディレクトリの除外を撤廃した状態
- When: `agent-skill-chain lint vocab`（引数無し、デフォルト対象）をリポジトリ全体に対して実行する
- Then: 終了コード0（4ディレクトリ中に散文としての真の禁止語混入が存在しない前提。存在する場合はそれを是正した上でコード0）で完走し、識別子的な正当利用に起因する誤検出が発生しないことを実測確認する
- 検証方法見込み: `automated`

#### AC-5: `docs/GLOSSARY.md`が引き続き恒久的に対象外である

- Given: `docs/GLOSSARY.md`が「禁止同義語」列で禁止語を文字通り列挙する構造を持つこと
- When: `agent-skill-chain lint vocab`（デフォルト対象）を実行する
- Then: `docs/GLOSSARY.md`自体は引き続き対象外のままであり、自己言及による誤検出が発生しないことを確認する（既存の恒久除外ロジックの維持を確認するregressionテスト）
- 検証方法見込み: `automated`

#### AC-6: ADR-0002カスタムref namespaceへの実機push検証が実施され結果が記録される

- Given: このリポジトリの現在のfine-grained PATクレデンシャル（`contents: write`スコープ、`gh auth status`で確認可能）
- When: `refs/agent-skill-chain/leases/<test-ref>`のようなカスタムref namespaceへ`git push origin <sha>:<ref>`を実際に試行し、成功または失敗（エラーメッセージ含む）を記録する
- Then: 検証結果（成功/失敗とその根拠となるコマンド出力）がVALIDATION.mdまたはDESIGN.mdに実測証跡として記載される
- 検証方法見込み: `manual`（実機へのgit push試行を伴う一回性の検証手順のため。手順・実行者・証跡はVALIDATION.mdで確定する）

#### AC-7: ADR-0002が`accepted`または`superseded`のいずれかで確定し`proposed`のまま残らない

- Given: AC-6の実機検証結果
- When: 検証成功時はADR-0002の`status`のみを`accepted`へ更新し（本文・`supersedes`は不変）、検証失敗時は新規ADRを作成してADR-0002を`superseded`にする
- Then: PR完了時点でADR-0002の`status`が`proposed`以外になっており、`.agent-skill-chain/scripts/adr-lint.sh check`（`supersedes`⇔`superseded-by`の対称性検査）がpassすることを実測確認する
- 検証方法見込み: `automated`（adr-lint.sh checkによる構造検査）+ `manual`（status遷移がAGENTS.mdのADR finalizationライフサイクル規約に従っていることの確認）

#### AC-8: secret scanがCIジョブとして実行され、ダミーsecretパターンを含む差分を実際に検知・失敗させる

- Given: 実在の認証情報ではない、テスト専用と明示されたダミーsecret文字列（例：`AKIA` prefixのダミーAWSキー形式文字列等、意図的に仕込んだテストフィクスチャ）を含むテスト用の差分
- When: この差分を含むPRに対してCI（`.github/workflows/agent-skill-chain-ci.yml`のsecret scanステップ）を実行する
- Then: secret scanステップが検出により非ゼロ終了し、CI全体（該当job）が失敗することを実際のGitHub Actions実行結果（run URL）で実測確認する。検証後、このテスト用差分・ダミーsecretはリポジトリ履歴に残さない、またはmainへの混入経路を持たない形で扱う（例：検証用の使い捨てブランチ・PRで確認しmergeしない）
- 検証方法見込み: `automated`（CI実行）+ `manual`（実行結果の確認・後始末）

#### AC-9: secret scanを含まない通常の差分ではCIが従来通りpassする

- Given: secretパターンを含まない通常のコード変更
- When: CIを実行する
- Then: secret scanステップが誤検知（false positive）を起こさず、CI全体が従来通りpassすることを実測確認する（既存テストスイート・既存の`verify-*`/`lint-*`ステップの実行結果に影響しないこと含む）
- 検証方法見込み: `automated`

#### AC-10: secret scanがrequired checkとして機能する

- Given: secret scanを含むCIジョブが追加され、branch protection / ruleset設定（`.agent-skill-chain/templates/github/provisioning/rulesets/main.json`）に反映された状態
- When: secret scanが失敗する差分を含むPRを作成する
- Then: GitHub上でこのPRがrequired checkの未達によりmerge不可状態になることを実際のPR画面・API（`gh pr view --json statusCheckRollup`等）で実測確認する
- 検証方法見込み: `manual`（GitHub UI/APIでのrequired check状態の実機確認）

#### AC-11: 正本（`.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml`）と配布先（`.github/workflows/agent-skill-chain-ci.yml`）が同期している

- Given: secret scanジョブ/ステップを両ファイルへ追加した状態
- When: `.agent-skill-chain/ci/verify-template-sync.sh`を実行する
- Then: 終了コード0（2ファイルの内容が一致）となることを実測確認する
- 検証方法見込み: `automated`

#### AC-12: 既存テストスイートが全てpassする（regressionなし）

- Given: 本Issueの全変更（lint-vocab改修・ADR-0002 status更新または新規ADR・CI workflow更新）を`chore/162-agent-skill-chain-bootstrap`統合ブランチ上へ反映した状態
- When: リポジトリのテストスイート全体（`npm test`相当）を実行する
- Then: 既存テストが全てpassし、新規追加テストも全てpassする（regressionなし）
- 検証方法見込み: `automated`

## スコープ外

この Issue では対応しない事項を明記する。曖昧語・対象外欠落は仕様ゲートの反証観点で指摘される。

- 実装チェックリスト第24.1章のうち、secret scan以外（format/SAST/dependency scan）のCI導入。
- `docs/system-spec/`の実体構築（ADR-0001が`accepted`になった後、別Issueで対応。本Issueが扱うのはADR-0002のみ）。
- lint-vocabスキャナの識別子認識について、YAMLキー・CLIサブコマンド・コード識別子の3種以外の未知の識別子文脈（将来発見された場合は別Issueで追加対応する）。
- ADR-0002の実機検証がpush失敗に終わった場合の、新方式（PAT scope拡張以外の代替lease機構）の実装自体（新規ADRでの方針決定・記録までを本Issueのスコープとし、方針が「別方式への転換」だった場合の実装は別Issue）。
- secret scanで使用する具体的なツール・実装方式（例：正規表現ベースの自作スクリプトか、既存OSSツールの導入か）の選定は設計フェーズ（DESIGN.md）で確定する。本SPEC.mdでは「検知・失敗させる」という振る舞い要件のみを定め、実装手段は指定しない。
- 既存のsecret検出漏れ（過去commitに既に混入している可能性のあるsecretの遡及スキャン・履歴からの除去）。本Issueは今後のPRに対するCI検査の追加のみを対象とし、履歴の遡及監査は別Issue。
