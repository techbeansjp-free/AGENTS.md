# SPEC: codex adapterのlaunch_gate_reviewerが`codex exec`未対応の`--ask-for-approval`オプションでゲートレビュー起動に即座に失敗する

- Issue: `ISSUE-356`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/356-codex-exec-ask-for-approval-unsupported`

## 目的・背景

`.agent-skill-chain/adapters/codex.sh` の `launch_gate_reviewer` 関数が組み立てる `codex exec` コマンドラインには `--ask-for-approval never` オプションが含まれている。しかし実際にインストールされている codex CLI（codex-cli 0.146.0、ChatGPTアカウントでログイン済み）の `codex exec` サブコマンドはこのオプションを受け付けず、実行すると `error: unexpected argument '--ask-for-approval' found` で即座に終了する。

この結果、gate reviewer役割にcodexアダプタが選択された構成（core対象のStrict審査を含む）では、`launch_gate_reviewer` 経由のゲートレビュー起動が常に失敗する。`_codex_fail_safe` によるフェイルセーフ機構自体は存在するが、これは認証不成立・CLI不在などlifecycle上想定された異常系の検知を意図したものであり、コマンドライン自体が起動できないという別種の障害はその対象外である。同ファイルの `launch_worker` 関数は `--ask-for-approval` を使用しないコマンドを組み立てており、本Issueで観測された障害の対象外である。

## 要求 → 要件 → 受入条件

### 要求

`launch_gate_reviewer` が組み立てる `codex exec` コマンドラインが、実際にインストールされているcodex CLIの `codex exec` サブコマンドで受理される形式になっている状態にする。ゲートレビューが「approvalを求めず自動実行する」という既存の意図した挙動を維持したまま、引数エラーによる即時失敗を解消する。

### 要件

- `launch_gate_reviewer` が組み立てる `codex exec` コマンドラインは、対象codex CLIの `codex exec --help` に列挙されたオプションのみで構成される。
- ゲートレビュー実行中、承認確認プロンプトによってブロックされることなく、read-onlyサンドボックス下でモデル生成コマンドが実行される（既存の「決してinteractive承認を要求しない」という意図を保持する）。
- 本修正は `launch_gate_reviewer` の起動コマンド組み立てに閉じ、`launch_worker`（`--ask-for-approval` 不使用のため本バグの対象外）の既存動作を変更しない。
- 修正後も、ゲートレビュー起動時に認証不成立・CLI不在等の既存フェイルセーフ経路（`_codex_fail_safe`）は従来どおり機能する。

### 受入条件（Acceptance Criteria）

#### AC-1: `codex exec`未対応オプションの不使用

- Given: `.agent-skill-chain/adapters/codex.sh` の `launch_gate_reviewer` が組み立てる `codex exec` コマンドライン。
- When: そのコマンドラインを構成するオプション群を、対象codex CLIバージョンの `codex exec --help` が列挙するオプション一覧と照合する。
- Then: `--ask-for-approval` など `codex exec` サブコマンドに存在しないオプションが含まれない。
- 検証方法見込み: `automated`

#### AC-2: ゲートレビュー起動が引数エラーで即時失敗しない

- Given: `codex exec` が `--ask-for-approval` を受け付けない環境（codex-cli 0.146.0相当）。
- When: `launch_gate_reviewer` を呼び出し、codexによるゲートレビューを起動する。
- Then: `error: unexpected argument '--ask-for-approval' found` に相当する引数エラーで即座に終了しない。
- 検証方法見込み: `automated`

#### AC-3: 承認プロンプトで停止しない挙動の維持

- Given: 修正後の `launch_gate_reviewer` が組み立てるコマンドライン。
- When: そのコマンドラインでcodexがモデル生成コマンドの実行を試みる。
- Then: 人間の承認入力を待たずに実行され（`never`相当のapproval policyが適用され）、read-onlyサンドボックスの制約は維持される。
- 検証方法見込み: `automated`

#### AC-4: `launch_worker`の非破壊

- Given: 本Issueの変更後の `.agent-skill-chain/adapters/codex.sh`。
- When: `launch_worker` が組み立てるコマンドラインを確認する。
- Then: `launch_worker` の既存コマンド組み立て（`--ask-for-approval` 不使用）に変更がない。
- 検証方法見込み: `automated`

#### AC-5: 既存フェイルセーフ経路の維持

- Given: 本Issueの変更後のコードベース。
- When: codex CLI不在・認証不成立など既存の `_codex_fail_safe` 対象シナリオで `launch_gate_reviewer` を呼び出す。
- Then: 従来どおりフェイルセーフ経路（`human_required`相当への降格）が機能し、サイレントに成功扱いにならない。
- 検証方法見込み: `automated`

#### AC-6: 既存動作への非破壊

- Given: 本Issueの変更後のコードベース。
- When: `npm test` を実行する。
- Then: `test/integration/gate-adapters.test.ts`・`test/unit/gate-credentialless-ci.test.ts` を含む既存テストが全て成功し続ける。
- 検証方法見込み: `automated`

## スコープ外

- `codex exec` が `-m` に指定したモデル名（例: `gpt-5.6`）をChatGPTアカウントでサポートしているかどうかの調査・対応。
- `launch_worker` のコマンド組み立て自体の変更（本バグの影響を受けないことの確認のみが対象）。
- `.agent-skill-chain/config/roles.yaml` 等、gate reviewerにcodexアダプタを割り当てる設定自体の変更。
- codex CLIバージョン間の互換性維持（将来のcodex CLIバージョンで `approval_policy` 設定キー自体が変更された場合の追従は別Issueで扱う）。
