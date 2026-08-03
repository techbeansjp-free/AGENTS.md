# DESIGN: gate reviewer prompt digest がclone間のgit abbrev桁数差で再現不能

- Issue: `ISSUE-369`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`（差分セクションの省略なし固定長full hash化） | `buildReviewerPrompt()`（`src/commands/gate.ts`）の`git diff`呼び出しへの`--full-index`追加 | `--full-index`はcore.abbrev（auto含む）を一切参照せず、リポジトリのハッシュアルゴリズムに応じた完全桁数（SHA-1なら40桁）を常に出力する。固定7桁・固定8桁のような`--abbrev=<N>`指定はcloneの総オブジェクト数次第で一意性確保のため`N`桁を超えて伸長され得るためAC-1を満たさない（SPEC.md該当注記どおり） |
| `AC-2`（総オブジェクト数・省略hash伸長条件が異なる複数clone間の完全一致） | 決定性回帰テスト（`test/integration/gate-judgment.test.ts`への追加） | 詳細は後述「AC-2テスト構築方針」節 |
| `AC-3`（生成clone・検証cloneが異なる場合の submit-evidence → verify-evidence 往復成功） | 往復統合テスト（`test/integration/gate-evidence.test.ts`への追加） | 既存の`gate submit-evidence`/`gate verify-evidence`契約（`evidencePromptDigest()`等）は無変更のまま、生成用clone・検証用cloneを別ディレクトリに用意して往復させる |
| `AC-4`（diff以外のプロンプト内容が修正前後で不変） | 既存の`test/integration/gate-judgment.test.ts`内の`gate reviewer-prompt`関連テスト（ルーブリック文言・AC-ID一覧・出力JSON契約を検証済み）の継続pass、および新規テストでの「差分セクション以外のセクション文字列が変更前後で同一」の直接比較 | 変更点が`git diff`呼び出しの引数追加1箇所のみであるため、diff区間以外のセクション生成コードには一切触れない |

## 責務・境界

### コンポーネント構成

- `buildReviewerPrompt()`（`src/commands/gate.ts`）: レビュア判定プロンプト全体の組み立て。本Issueでの変更範囲は「判定対象の差分」セクションを生成する`git diff`呼び出し引数のみ（141〜144行相当の`['diff', '--no-ext-diff', '--no-color', ...]`に`--full-index`を追加する）。他のセクション（ルーブリック・AC-ID一覧・出力JSON契約・成果物本文）は無変更。
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

spec-gate strictレビューにて、AC-2の「意図的に大量のオブジェクトを追加投入して省略hashの一意性伸長が実際に発生する状態を再現したclone」という前提について、必要なオブジェクト数・生成方法が未指定でテスト構築コストが高い可能性がある旨の非blocking指摘（`ac2-test-fixture-feasibility`）を受けた。これに対する設計判断は次のとおり（詳細な根拠は`ADR-0020`参照、`related_adrs`参照ルールに従い判断の帰結自体は本節に自己完結して記載する）。

- 根本原因は「実行時に有効となるabbrev桁数がclone毎のローカルなgit状態（core.abbrev）に依存し、`git diff`の出力バイト列を左右する」ことである。総オブジェクト数の差はその一因（`core.abbrev=auto`時の自動伸長トリガー）に過ぎない。
- そこで回帰テストでは、`core.abbrev`を明示的に異なる値（例: `7`・`12`・未設定＝auto）に設定した複数clone環境を用意し、同一の根本メカニズム（ローカルgit状態依存でabbrev桁数が変わり得る）を決定的かつCI実行時間内で再現する。`--full-index`を追加した`buildReviewerPrompt()`の出力が、これら`core.abbrev`設定の異なる全clone間で完全一致することを検証すれば、AC-1が要求する「`--abbrev`の自動伸長機構に一切依存しない」ことの直接証明になる。
- 上記に加え、可能な範囲で総オブジェクト数を実際に大きく変えたclone（新規clone vs 数百〜数千個の追加blobを投入したclone）でも出力が一致することを補助的に検証し、実運用のclone差（新規clone・履歴蓄積clone）に近い条件でも回帰しないことを確認する。ただし、core.abbrev=autoの一意性伸長そのものを実際に自然発生させることまでは要求しない（`ADR-0020`の欠点節に将来の追加検討事項として記録する）。

## 関連ADR

```yaml
related_adrs: []
```

`accepted`のADRの中に本設計と直接関連するものは無い。本Issueで新設する`docs/adr/ADR-0020-gate-reviewer-prompt-full-index-determinism.md`（status: proposed）は、本設計（`--full-index`採用およびAC-2テスト構築方針の判断根拠）を確定させるADRであり、同一設計セグメントの主成果物であるため`related_adrs:`には計上しない（設計ゲート承認時のfinalizationで`accepted`へ遷移した後、他Issueから参照する場合にのみ`related_adrs:`の対象となる）。

## 障害・ロールバック考慮

- 想定される失敗モード: `--full-index`追加により差分区間のバイト列が変わるため、本fix適用前に生成・記録された既存のreview evidence（`prompt_digest`を含む、例: Issue #351／PR #357の既失敗ラウンド）は、fix適用後に再計算する`expectedPromptDigest`と一致しなくなる。これはSPEC.mdのスコープ外節が明示する既知の対象外事項であり、当該Issueのstrict gate roundは本fixマージ後に`gate reviewer-prompt`の再実行・レビュア再判定・`gate submit-evidence`の再提出が別途必要になる（本Issueのスコープには含まない運用上の申し送り事項）。
- ロールバック手順: 変更が`buildReviewerPrompt()`内の`git diff`呼び出し引数1箇所への`--full-index`追加のみに閉じているため、当該commitをrevertするだけで修正前の挙動へ完全に戻せる。ロールバック後は本Issueが報告した非決定性が再発するのみで、他機能への波及は無い。
- 影響を受ける既存機能: `gate reviewer-prompt`／`gate submit-evidence`／`gate verify-evidence`を経由する全Issueのspec/design/implementation/validation各ゲート（特にstrict profile）。標準プロファイル（レビュア1体）でも同一のプロンプト生成経路を通るため同様に決定性が改善される。`evidencePromptDigest()`のハッシュ関数選定・`gate verify-evidence`の比較ロジック自体には影響しない。
