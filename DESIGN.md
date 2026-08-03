# DESIGN: gate reviewer prompt digest がclone間のgit abbrev桁数差で再現不能

- Issue: `ISSUE-369`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`（差分セクションの省略なし固定長full hash化） | `buildReviewerPrompt()`（`src/commands/gate.ts`）の`git diff`呼び出しへの`--full-index`追加 | `--full-index`はcore.abbrev（auto含む）を一切参照せず、リポジトリのハッシュアルゴリズムに応じた完全桁数（SHA-1なら40桁）を常に出力する。固定7桁・固定8桁のような`--abbrev=<N>`指定はcloneの総オブジェクト数次第で一意性確保のため`N`桁を超えて伸長され得るためAC-1を満たさない（SPEC.md該当注記どおり） |
| `AC-2`（総オブジェクト数・省略hash伸長条件が異なる複数clone間の完全一致） | 決定性回帰テスト（新規`test/integration/gate-reviewer-prompt-determinism.test.ts`） | 詳細は後述「AC-2テスト構築方針」節 |
| `AC-3`（生成clone・検証cloneが異なる場合の submit-evidence → verify-evidence 往復成功） | 往復統合テスト（`test/integration/gate-evidence.test.ts`への追加） | 既存の`gate submit-evidence`/`gate verify-evidence`契約（`evidencePromptDigest()`等）は無変更のまま、生成用clone・検証用cloneを別ディレクトリに用意して往復させる |
| `AC-4`（diff以外のプロンプト内容が修正前後で不変） | 既存の`test/integration/gate-judgment.test.ts`内の`gate reviewer-prompt`関連テスト（ルーブリック文言・AC-ID一覧・出力JSON契約を検証済み）の継続pass、および同ファイルへ追加する新規テストでの「golden snapshotとの比較」 | 詳細は後述「AC-4テスト構築方針（golden snapshot）」節。変更点が`git diff`呼び出しの引数追加1箇所のみであるため、diff区間以外のセクション生成コードには一切触れない |

## 責務・境界

### コンポーネント構成

- `buildReviewerPrompt()`（`src/commands/gate.ts`）: レビュア判定プロンプト全体の組み立て。本Issueでの変更範囲は、判定対象の差分を生成する`git(['diff', '--no-ext-diff', '--no-color', ...])`呼び出し引数への`--full-index`追加のみ。他のセクション（ルーブリック・AC-ID一覧・出力JSON契約・成果物本文）は無変更。
- `evidencePromptDigest()`（既存、変更なし）: `buildReviewerPrompt()`の出力文字列からsha256 digestを算出する。本Issueは入力（プロンプト文字列）を決定的にすることが目的であり、本関数自体には手を加えない。
- `gate submit-evidence` / `gate verify-evidence`（既存、変更なし）: `prompt_digest`の記録・再計算比較の契約はSPEC.mdのスコープ外節どおり変更しない。本Issueの修正により、両者が異なるcloneで実行されても入力プロンプトが一致するようになる結果として往復が成立する。
- 決定性回帰テスト群（新規、`test`配下）: 実装コードには属さない検証専用コンポーネント。AC-2〜AC-4の機械検証を担う。

### 依存関係

```text
gate reviewer-prompt CLI
  → buildReviewerPrompt()
    → git diff --no-ext-diff --no-color --full-index <base>...<target> -- <artifacts>   (本Issueで --full-index を追加)
  → evidencePromptDigest()（無変更）
    → gate submit-evidence / gate verify-evidence（無変更、prompt_digest比較契約はそのまま）
```

責務は`buildReviewerPrompt()`内のdiff生成という単一箇所に閉じており、`evidencePromptDigest()`・`gate submit-evidence`・`gate verify-evidence`とは呼び出し方向の依存のみで循環はない。

## AC-2テスト構築方針

design-gate strictレビューにて、AC-2の「意図的に大量のオブジェクトを追加投入して省略hashの一意性伸長が実際に発生する状態を再現したclone」というSPEC.md承認済みのGiven条件を、`core.abbrev`の明示設定のみで代替する方式へ、SPEC.md自体の再改定・spec-gate再承認を経ずに縮小していたblocking指摘（`ac2-scope-narrowed-without-spec-regate`）を受けた。SPEC.mdのAC-2 Givenを変更せず、これを実際に満たす再現手段へ設計を改める（詳細な根拠は`ADR-0020`参照、`related_adrs`参照ルールに従い判断の帰結自体は本節に自己完結して記載する）。

本節が定めるテストは、新規ファイル`test/integration/gate-reviewer-prompt-determinism.test.ts`に実装する（既存の`test/integration/gate-judgment.test.ts`はAC-1・AC-4の単一clone内検証を扱うファイルであり、本節が要する複数clone・大量オブジェクト投入という異なるセットアップ責務を混在させないため、新規ファイルへ分離する）。

- `git`の`core.abbrev=auto`は、実行時にリポジトリが保持する総オブジェクト数から一意性を確保できると推定される最小桁数を算出し、必要であれば実際の衝突検査によりさらに桁数を伸長する。したがって`core.abbrev`を明示設定せずとも、総オブジェクト数を十分大きくするだけで一意性伸長を実際に発生させることができ、SPEC.md AC-2のGiven条件（「意図的に大量のオブジェクトを追加投入して……実際に発生する状態を再現したclone」）をそのまま満たせる。
- 回帰テスト用cloneでは、一意な内容を持つ大量のblobオブジェクトを機械的に生成・登録する（例: `git hash-object -w --stdin`をループ実行、または`git fast-import`によるバッチ投入）。必要個数は固定の決め打ちにせず、テスト実行時に「そのcloneで`git rev-parse --short`等が返す既定abbrev桁数が、オブジェクト追加前のベースラインcloneの桁数を上回っていること」を事前条件アサーションとして確認し、満たすまで投入数を増やす。これによりgitバージョン間のヒューリスティック差異に依存せず、一意性伸長の実発生を毎回機械的に保証する。ただし無限ループを避けるため投入数に上限（例: 20,000個）を設け、上限に達しても伸長条件を満たさない場合はテストを失敗として扱う（実行環境のgitヒューリスティック異常を早期に検知するため）。
- 一意性伸長が実発生した上記cloneと、追加投入を行っていないベースラインcloneの双方で`--full-index`追加後の`buildReviewerPrompt()`を実行し、出力バイト列が完全一致することを検証する。これによりAC-1が要求する「`--abbrev`の自動伸長機構に一切依存しない」ことを、SPEC.md AC-2のGiven条件どおりの条件下で直接証明する。
- 上記に加え、`core.abbrev`を明示的に異なる値（例: `7`・`12`）に固定したcloneでも出力が一致することを補助的に検証し、`--full-index`が`core.abbrev`の設定値そのものにも左右されないことを確認する。この補助検証は主検証（実オブジェクト数由来の一意性伸長）を代替するものではない。

## AC-4テスト構築方針（golden snapshot）

AC-4は「修正前後で同一の入力を与えたとき、hash桁数表記を除き他の内容が修正前と同一」であることを求めるが、本fix適用後のリポジトリには「修正前」のコードが存在しないため、実行時に修正前後を再現して比較することはできない。これを解決するため、golden snapshotをリポジトリへ固定コミットする方式を採る。

- golden snapshot生成は、コード変更を一切含まない独立した変更単位として、`--full-index`追加（PLAN.md変更単位#2）より**前**に着手する最初の変更単位（PLAN.md変更単位#1）に位置づける。`buildReviewerPrompt()`（`src/commands/gate.ts`）がまだ`--full-index`引数を含まない現状のコード状態のまま、固定入力（`issue_number`・`gate_id`・`target_sha`・`base_sha`を固定した最小fixtureリポジトリ、`test/fixtures/`配下に既存の類似fixture方式があればそれに合わせて配置）に対して`buildReviewerPrompt()`を1回実行し、その出力を`test/fixtures/gate-reviewer-prompt-golden.txt`としてリポジトリに固定コミットする。この変更単位を`--full-index`追加より先に完了・コミットしておくことで、「修正前」コードを事後的に復元する手段を用意する必要なく、その出力を確実に捕捉できる。このgoldenファイルは以降再生成しない固定値として扱う。
- 新規テスト（`test/integration/gate-judgment.test.ts`へ追加、実装はPLAN.md変更単位#3で行う）では、`--full-index`追加（変更単位#2）適用後の`buildReviewerPrompt()`出力に対し、「判定対象の差分」セクション内のhash桁数表記行（`index <hash>..<hash>`等）のみを正規表現で除去・正規化したうえで、goldenファイルの同一箇所を同じ正規化にかけた文字列と完全一致することを検証する。これにより「diff区間のhash桁数表記を除き修正前と同一」というAC-4の条件を、実際に修正前のコードを再実行することなく機械的に証明する。
- goldenファイル自体が意図せず陳腐化しないよう、goldenファイル生成に用いた固定入力（fixtureリポジトリの内容・`target_sha`・`base_sha`）をテストコード内にコメントではなくアサーション対象の定数として明記し、fixture側が変更された場合はgoldenファイルとの不一致としてテストが失敗する構成にする。

## 関連ADR

```yaml
related_adrs: []
```

`accepted`のADRの中に本設計と直接関連するものは無い。本Issueで新設する`docs/adr/ADR-0020-gate-reviewer-prompt-full-index-determinism.md`（status: proposed）は、本設計（`--full-index`採用およびAC-2テスト構築方針の判断根拠）を確定させるADRであり、同一設計セグメントの主成果物であるため`related_adrs:`には計上しない（設計ゲート承認時のfinalizationで`accepted`へ遷移した後、他Issueから参照する場合にのみ`related_adrs:`の対象となる）。

## 障害・ロールバック考慮

- 想定される失敗モード: `--full-index`追加により差分区間のバイト列が変わるため、本fix適用前に生成・記録された既存のreview evidence（`prompt_digest`を含む、例: Issue #351／PR #357の既失敗ラウンド）は、fix適用後に再計算する`expectedPromptDigest`と一致しなくなる。これはSPEC.mdのスコープ外節が明示する既知の対象外事項であり、当該Issueのstrict gate roundは本fixマージ後に`gate reviewer-prompt`の再実行・レビュア再判定・`gate submit-evidence`の再提出が別途必要になる（本Issueのスコープには含まない運用上の申し送り事項）。
- ロールバック手順: 変更が`buildReviewerPrompt()`内の`git diff`呼び出し引数1箇所への`--full-index`追加のみに閉じているため、当該commitをrevertするだけで修正前の挙動へ完全に戻せる。ロールバック後は本Issueが報告した非決定性が再発するのみで、他機能への波及は無い。
- 影響を受ける既存機能: `gate reviewer-prompt`／`gate submit-evidence`／`gate verify-evidence`を経由する全Issueのspec/design/implementation/validation各ゲート（特にstrict profile）。標準プロファイル（レビュア1体）でも同一のプロンプト生成経路を通るため同様に決定性が改善される。`evidencePromptDigest()`のハッシュ関数選定・`gate verify-evidence`の比較ロジック自体には影響しない。
