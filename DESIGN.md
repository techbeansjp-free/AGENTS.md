# DESIGN: gate-local-review.sh が共有 protected base worktree の HEAD を PR base_sha へ detach checkout することを要求し、並行Issue運用（wip_limit > 1）と実質的に両立しない

- Issue: `ISSUE-643`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`（HEADがbase_shaと異なっても実行できる） | `gate-local-review.sh` の前提チェック — `CURRENT_SHA == BASE_SHA` の厳密一致判定を削除し、デフォルトブランチ判定＋到達可能性判定へ置換 | 隔離clone側は現行どおり`BASE_SHA`をdetach checkoutするため、レビュー対象の同一性は変わらない |
| `AC-2`（default branchでない共有worktreeは拒否） | `gate-local-review.sh` の前提チェック — デフォルトブランチ判定（`git symbolic-ref --short HEAD` と `DEFAULT_BRANCH` の比較） | Issue worktree・detached HEAD はこの判定で拒否される |
| `AC-3`（base_shaが到達不能なら拒否） | `gate-local-review.sh` の前提チェック — 到達可能性判定（`git merge-base --is-ancestor "$BASE_SHA" HEAD`） | 未知/改ざん/到達不能コミットは非0終了として一律拒否 |
| `AC-4`（共有worktreeがdirtyなら拒否） | `gate-local-review.sh` の前提チェック — dirty判定（`git status --porcelain`） | 既存ロジックを判定順序末尾に維持し、変更しない |
| `AC-5`（レビュー実体は隔離clone内でbase_shaを使う） | `gate-local-review.sh` の隔離レビュー実行（`TRUSTED_ROOT`のclone・detach checkout・build・adapter起動・trusted recorder dispatch） | 前提チェックの結果に関わらず本コンポーネントの実装は変更しない |
| `AC-6`（エラーメッセージがdetach checkoutを促さない） | `gate-local-review.sh` の前提チェック — 各拒否分岐のエラーメッセージ文言 | `expected=<base_sha>` 形式・detach checkoutを促す文言を含めない。拒否理由（root不一致／default branch不一致／到達不能／dirty）のみを述べる |

## 責務・境界

### コンポーネント構成

- `.agent-skill-chain/scripts/gate-local-review.sh` の前提チェック（Attestation Precondition）: 共有 protected base worktree（`REPO_ROOT`）が、Issue worktree／candidate code ではなく信頼済みの実行環境であることを検証する。検証項目は次の4つに分離し、この順序で評価する。
  1. worktree root一致判定: `git -C "$REPO_ROOT" rev-parse --show-toplevel` が `REPO_ROOT` 自身と一致すること（既存ロジックを維持。スクリプト自身の配置とgit worktree構造の整合性を担保する）。
  2. デフォルトブランチ判定（新設）: `git -C "$REPO_ROOT" symbolic-ref --quiet --short HEAD` で得た現在ブランチ名が、GitHub API から取得済みの `DEFAULT_BRANCH` と一致すること。detached HEAD（空文字）・Issue branch は不一致として拒否する。
  3. base_sha到達可能性判定（新設）: `git -C "$REPO_ROOT" merge-base --is-ancestor "$BASE_SHA" HEAD` が成功すること。`REPO_ROOT` のHEADが`BASE_SHA`と完全一致する場合（祖先=自分自身）も成功として扱う後方互換な包含判定であり、HEADが`BASE_SHA`より前進済みの場合も成功する。
  4. dirty判定: `git -C "$REPO_ROOT" status --porcelain` が空であること（既存ロジックを維持）。
  いずれかが不成立の場合、共有worktreeへの副作用（checkout・fetch等の書き込み操作）を一切行わずに非0終了する。本コンポーネントは`REPO_ROOT`に対して読み取り専用（read-only）のgit問い合わせのみを行う。
- `.agent-skill-chain/scripts/gate-local-review.sh` の隔離レビュー実行（Isolated Review Execution、既存・変更なし）: 前提チェック通過後にのみ、`REPO_ROOT` を `--no-checkout` で一時clone（`TRUSTED_ROOT`）し、`BASE_SHA` をdetach checkoutしてbuildする。以降のadapter起動・trusted recorderへのdispatchはすべて`TRUSTED_ROOT`内で完結し、`REPO_ROOT`（共有worktree）を一切変更しない。

前提チェックと隔離レビュー実行は「読み取り専用の検証 → 検証通過後の隔離実行」という一方向の呼び出し関係のみを持ち、隔離レビュー実行から前提チェックへの逆参照は無い。

### 依存関係

```text
前提チェック（REPO_ROOTへread-only）→ 隔離レビュー実行（TRUSTED_ROOTへ書込・REPO_ROOTは不変）
```

### 図示要否の判断

- 判断: `不要`
- 根拠: 依存関係は「前提チェック → 隔離レビュー実行」という一本の呼び出し連鎖のみ（1件）で、3件以上の基準に該当しない。前提チェック内部は4つの判定項目を持つが、これらは単一コンポーネント内の順次条件分岐であり、状態遷移（2件以上）や責務境界（コンポーネント3件以上）には該当しない。したがってMermaid図示は不要と判断する。

## 関連ADR

```yaml
related_adrs:
  - id: ADR-0059
    relation: adopts
```

## 障害・ロールバック考慮

- 想定される失敗モード:
  - デフォルトブランチ判定・到達可能性判定を誤って緩めすぎた場合、Issue worktreeや到達不能なcommitからの実行を誤って許可してしまう可能性がある。本設計は既存の「worktree root一致」「dirty」判定を変更せず維持し、新設2判定はいずれも失敗時デフォルトで拒否（`set -euo pipefail`下での非0終了）となるよう実装するため、判定ロジック自体の不具合を除きこの失敗モードは生じない。
  - 共有 protected base worktree がPRマージ後の自動同期（`agent-skill-chain pr merge`によるfetch+fast-forward、`.agent-skill-chain/standards/GIT_CONVENTIONS.md`）に失敗し、ローカルHEADが`BASE_SHA`を含む最新default branch履歴へ追従していない場合、到達可能性判定が誤って拒否側に倒れる。これは安全側（fail-closed）の挙動であり、運用対応は進行役が共有worktreeを`git pull --ff-only`等で最新化した上で再実行することで解消する。共有worktreeのdetach checkoutとは異なり、fast-forward pullはwip_limitに基づく並行Issue運用と衝突しない。
- ロールバック手順: `gate-local-review.sh` の前提チェック差分のみをrevertすれば、Issue着手前の「`CURRENT_SHA == BASE_SHA` 完全一致要求」という既存動作へ戻る。隔離レビュー実行（`TRUSTED_ROOT`まわりのclone・build・adapter起動・trusted recorder dispatchロジック）・呼び出し引数（`<issue_id> <gate_id> <profile> <target_sha> <base_sha> <pr_number> <adapter>`）は変更しないため、revertに追加のmigrationは不要。
- 影響を受ける既存機能: `gate-local-review.sh` を呼び出す進行役の手動ゲートレビュー起動経路のみ。`gate-review.sh`・`gate-launch-reviewer.sh`・`gate-publish.sh`等、隔離clone内で実行される既存スクリプト群のインターフェース・挙動は変更しない。
