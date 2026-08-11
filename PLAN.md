# PLAN: gate-local-review.sh が共有 protected base worktree の HEAD を PR base_sha へ detach checkout することを要求し、並行Issue運用（wip_limit > 1）と実質的に両立しない

- Issue: `ISSUE-643`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | デフォルトブランチ判定の追加 | `gate-local-review.sh` の前提チェックへ、`REPO_ROOT` の現在ブランチ（`git symbolic-ref --quiet --short HEAD`）が既取得済みの `DEFAULT_BRANCH` と一致するかを検証するステップを追加する。worktree root一致判定（既存）は維持し、その直後に配置する。不一致時（detached HEAD含む）は、default branchでないことを示すエラーメッセージで非0終了する | `AC-2, AC-6` | なし |
| 2 | base_sha到達可能性判定の追加、HEAD厳密一致要求の削除 | `CURRENT_SHA != BASE_SHA` を理由に拒否していた既存の厳密一致判定を削除し、`git -C "$REPO_ROOT" merge-base --is-ancestor "$BASE_SHA" HEAD` による到達可能性判定へ置換する。失敗時（未知/到達不能なcommit）は到達不能であることを示すエラーメッセージで非0終了する | `AC-1, AC-3, AC-6` | `#1` |
| 3 | dirty判定の順序維持確認 | 既存の `git status --porcelain` によるdirty判定を、#1・#2の新設判定の後段に維持する（判定順序：root一致 → default branch → 到達可能性 → dirty）。ロジック自体・メッセージ文言は変更しない | `AC-4` | `#1, #2` |
| 4 | エラーメッセージのdetach-promoting文言除去確認 | #1〜#3で新設・変更した各拒否分岐のエラーメッセージに、`expected=<base_sha>` 形式および共有worktreeのdetach checkoutを促す文言が含まれていないことを確認する。含まれる場合は拒否理由（root不一致／default branch不一致／到達不能／dirty）のみを述べる文言へ修正する | `AC-6` | `#1, #2, #3` |
| 5 | 前提チェック分岐の自動テスト追加 | `test/integration/`（既存の`gh-stub`・tmp repoヘルパーを利用するテストと同様のスタイル）に、`gate-local-review.sh` を実bashで駆動するテストケースを追加する：(a) 共有worktreeのHEADが`BASE_SHA`より前進していても隔離clone作成まで進む（AC-1）、(b) `REPO_ROOT` がdefault branchでない場合に拒否される（AC-2）、(c) `BASE_SHA`がdefault branch履歴から到達不能な場合に拒否される（AC-3）、(d) 共有worktreeがdirtyな場合に拒否される（AC-4）、(e) AC-1成立時、隔離clone（`TRUSTED_ROOT`相当）が`BASE_SHA`をdetach checkoutし共有worktreeのHEAD・内容が実行前後で変化しないことを確認する（AC-5）。`gh api` 呼び出しは`gh-stub`でPR/defaultブランチ情報を返すよう固定し、隔離clone後段の`npm ci`/`npm run build`／adapter起動／trusted recorder dispatchはPATH上のスタブコマンドで置き換え、実ネットワーク・実credentialへは一切アクセスしない | `AC-1, AC-2, AC-3, AC-4, AC-5` | `#1, #2, #3, #4` |
| 6 | AC-6のmanual確認記録 | SPEC.mdでAC-6の検証方法見込みを`manual`としているため、#1〜#4適用後の`gate-local-review.sh`を対象に、AC-2・AC-3それぞれの拒否分岐で実際に出力されるエラーメッセージ文言を目視確認し、`expected=<base_sha>`形式・detach checkoutを促す文言が含まれないことをVALIDATION.mdの検証記録として残す準備を行う（実施自体は検証セグメントの責務） | `AC-6` | `#4, #5` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。
