# SPEC: agent-skill-chain Tier 1 — adapters launch_worker（spec/design/implementation/validationワーカー起動）の設計・実装

- Issue: `ISSUE-166`
- 作成者: `claude`
- 対象ブランチ: `feature/166-launch-worker`

## 目的・背景

`.agent-skill-chain/adapters/{claude,codex,human}.sh` は、ゲート判定ワーカー起動（`launch_gate_reviewer`、read-only、#164項目②・PR #165で実装済み）まではカバーしているが、セグメント作業ワーカー起動（`launch_worker`相当：Issueのspec/design/implementation/validation各セグメントで実際にAIエージェント（claude/codex）または人間へ作業を割り当て・起動する部分）は3ファイルとも冒頭コメントで「別途設計・実装が必要なため対象外」と明記されたまま未着手である。

`launch_worker`はベンダー中立のrole contract（`.agent-skill-chain/config/roles.yaml`の`role_contracts`）と、進行役が呼び出す`.agent-skill-chain/scripts/segment-start.sh`（`segment start` CLIサブコマンドへの薄いラッパー。現状はwriter lease有効性を検査しrole_contractを標準出力へ返すのみで、実際のワーカー実行系起動は行わない）を、実行系起動へ変換する未実装の中間層である。本Issueはこの中間層を設計・実装し、`launch_gate_reviewer`で確立した「ゲート判定の起動」に続けて「セグメント作業そのものの起動」を機能させる。

`launch_gate_reviewer`との本質的な相違点は、レビュアの権限が**read-only**（`roles.yaml`の`gate_reviewer`は`lease: none`、複数並列可、`artifact.edit`禁止）であるのに対し、`launch_worker`が起動するセグメント作業ワーカーは**writer**（AGENTS.md「役割・権限・writer lease」節、1 Issueにつき同時1つのみ、成果物branchへのcommit/push、SPECワーカーのみDraft PR作成を行う）である点にある。この違いにより、writer lease取得・解放の順序、ワーカー自身によるcommit/push、WIP上限（有効writer lease数）との整合、SPECワーカーのみに課される非対称な責務（Draft PR作成）という、`launch_gate_reviewer`には無かった設計論点が新たに発生する。

## 要求 → 要件 → 受入条件

### 要求

`.agent-skill-chain/adapters/{claude,codex,human}.sh` に `launch_worker` 関数群を実装し、Issueのspec/design/implementation/validation各セグメントで実際にAIエージェント（claude/codex）または人間へ作業を割り当て・起動できるようにしたいという要求（Issue #166本文「目的」節）。

### 要件

- 4 adapter（`claude.sh`/`codex.sh`/`human.sh`）が同一シグネチャの`launch_worker`関数を持ち、将来の adapter 追加（4番目以降）でも同じ契約に従える起動契約を定義する。
- 4セグメント（spec/design/implementation/validation）すべてに対応し、`.agent-skill-chain/config/roles.yaml`の`role_contracts`（`spec_worker`/`design_worker`/`implementation_worker`/`validation_worker`のinputs/outputs/rules/completion/forbidden）を起動先ワーカーへ渡す。
- writer lease取得（`.agent-skill-chain/scripts/lease-acquire.sh`相当）と`launch_worker`起動の順序、および起動失敗時のlease解放（`.agent-skill-chain/scripts/lease-release.sh`相当）を明確にする。1 Issueには同時に1つのwriter leaseのみ許可される制約（AGENTS.md「役割・権限・writer lease」節）を`launch_worker`の呼び出し手順が壊さないことを保証する。
- 進行役からの呼び出し方法として、`.agent-skill-chain/scripts/segment-start.sh`（`segment start` CLI）が返すrole_contractを`launch_worker`へどう受け渡すかを確定する。
- adapter別の実装方針を分担する。claude/codexはAI実行系の実起動、humanは通知発行＋非同期の人間作業待ちとする方針を、`launch_gate_reviewer`の前例（claude=実起動、codex=同一シグネチャのI/Fのみでfail-safe deferral、human=通知＋非同期）を踏まえて定める。
- エラー・タイムアウト・未起動時の安全側挙動（AGENTS.md I8「既定は常に安全側」）を定める。特に、writer lease取得済み状態でワーカー起動が失敗した場合に、leaseを保持したまま放置しない（解放するか、明示的にblocked報告する）ことを保証する。
- WIP上限（`wip_limit`、既定3、有効writer lease数で判定）との整合を、`launch_worker`がlease取得前提のためどこで担保されるかを含めて定める。
- SPECワーカーのみが担うDraft PR作成という非対称な責務（`roles.yaml`の`worker.segment_overrides.spec.additional_capabilities: [pr.draft_create]`）を、`launch_worker`のsegment別分岐でどう扱うかを定める。
- ワーカーによる実際のcommit/push（`launch_gate_reviewer`は書込みをadapterシェル側の`record-verdict`等trusted CLIに限定していたが、`launch_worker`ではワーカー自身が成果物へ書込み、`checkpoint.sh`経由でcommit/pushする）の権限境界を定める。
- `launch_gate_reviewer`と同様、認証情報（`ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN`等）の実値をログ・stdoutに出さない。

### 受入条件（Acceptance Criteria）

#### AC-1: 4 adapterすべてに同一シグネチャの`launch_worker`関数が定義される

- Given: `.agent-skill-chain/adapters/{claude,codex,human}.sh`（現状は3ファイルとも`launch_worker`相当が未実装のプレースホルダコメントのみ）
- When: 本Issueの設計・実装が完了した状態で3ファイルを確認する
- Then: 3ファイルすべてに同一の位置引数・env変数シグネチャを持つ`launch_worker`関数が定義されており、呼び出し側（進行役・CI）がadapterの種類を意識せず同一の呼び出し方法で起動できる
- 検証方法見込み: `automated`

#### AC-2: writer lease取得→`launch_worker`起動→解放の順序が設計され、起動失敗時にleaseが放置されない

- Given: Issueの対象segmentに対しwriter leaseが未取得の状態
- When: `launch_worker`の呼び出し手順（設計成果物に記載）に従い、lease取得→ワーカー起動→（成功時は保持継続／失敗時は解放またはblocked報告）を実行する
- Then: ワーカー起動が失敗した場合でも、leaseが取得されたまま放置される（renewが止まりTTL切れまで他ワーカーがacquireできない状態が長時間続く）ことがなく、解放または明示的なblocked報告のいずれかが行われる
- 検証方法見込み: `automated`

#### AC-3: `segment-start.sh`が返すrole_contractを`launch_worker`が受け取り、ワーカーへ引き渡す

- Given: `.agent-skill-chain/scripts/segment-start.sh <issue_id> <segment>`が返すrole（`spec_worker`等）とrole_contract（inputs/outputs/rules/completion/forbidden）
- When: 進行役が`segment-start.sh`実行後に`launch_worker`を呼び出す
- Then: `launch_worker`はrole_contractの内容（またはそれを引き渡すための確立された手順）をもとに起動対象ワーカーへ入力・規約を伝達する
- 検証方法見込み: `automated`

#### AC-4: claude adapterはAI実行系を実起動する

- Given: `ANTHROPIC_API_KEY`または`CLAUDE_CODE_OAUTH_TOKEN`が設定済みで、対象segmentのworktree・writer leaseが有効な状態
- When: `claude.sh`の`launch_worker`を呼び出す
- Then: claude実行系（Claude Code CLI等）がworktree内で起動し、role_contractに従った作業（commit/push含む）を試行する。認証未設定・CLI不在は`launch_gate_reviewer`と同様のfail-safe（silent passしない）で扱う
- 検証方法見込み: `automated`

#### AC-5: codex adapterは同一シグネチャのI/Fのみを提供しfail-safe deferralへ倒す

- Given: Codex実行系の具体起動（CLI/API・認証・read-write制約）が未確定な現状
- When: `codex.sh`の`launch_worker`を呼び出す
- Then: `launch_gate_reviewer`と同様、silent passせず、未構成であることを明示した上で安全側（error/human_required相当）へ倒す。将来のCodex実行系結線のための拡張ポイントが関数内コメントとして明記される
- 検証方法見込み: `manual`

#### AC-6: human adapterは通知発行＋非同期の人間作業待ちへ結線する

- Given: 対象Issue・segment・writer leaseが有効な状態
- When: `human.sh`の`launch_worker`を呼び出す
- Then: 人間オペレータへの通知（GitHubモードでは`gh issue comment`等、ローカルモードではpendingマーカー）が発行され、同期ブロックせずdeferredとして返る。人間が作業完了後に報告する手順（`report_status`等既存関数との連携）が明記される
- 検証方法見込み: `manual`

#### AC-7: エラー・タイムアウト・未起動時に常に安全側（silent passしない）挙動になる

- Given: ワーカー実行系の起動失敗・timeout・異常終了が発生する状態
- When: 3 adapterいずれかの`launch_worker`がこれらの異常系に遭遇する
- Then: AGENTS.md I8「既定は常に安全側」に従い、完了扱い（success）へ誤って倒れることがなく、終了コードまたは報告により失敗・要人間確認の状態が呼び出し側から機械的に判別できる
- 検証方法見込み: `automated`

#### AC-8: WIP上限（有効writer lease数、既定`wip_limit: 3`）との整合が保たれる

- Given: 既に`wip_limit`件のwriter leaseが有効な状態
- When: 新たなIssue/segmentに対し`launch_worker`呼び出しの前段でlease取得を試みる
- Then: `wip_limit`超過となるlease取得が行われず（既存の`lease-acquire.sh`側の制約、または`launch_worker`呼び出し手順側の事前チェックのいずれかで）、超過したまま`launch_worker`が起動されることはない
- 検証方法見込み: `manual`

#### AC-9: SPECワーカーのみに課されるDraft PR作成の非対称性が`launch_worker`のsegment分岐で扱われる

- Given: `roles.yaml`の`worker.segment_overrides.spec.additional_capabilities: [pr.draft_create]`（spec segmentのみDraft PR作成を追加で行う）
- When: segment=`spec`とsegment=`design`/`implementation`/`validation`のそれぞれで`launch_worker`を呼び出す
- Then: spec segmentの場合のみ、ワーカー完了後の最初のcheckpoint push直後に`update_integration_record`（`pr-create.sh`）相当の呼び出しが行われる導線が設計に含まれ、他segmentでは行われない
- 検証方法見込み: `manual`

#### AC-10: 既存テストスイート・既存`launch_gate_reviewer`機能を壊さない

- Given: 本Issue着手前の`npm test`が全pass、かつ`launch_gate_reviewer`が3 adapterで動作する状態
- When: 本Issueの設計・実装（`launch_worker`追加）を適用した状態で`npm test`を実行する
- Then: 追加分を含め全テストがpassし、既存の`launch_gate_reviewer`関数の挙動（シグネチャ・終了コード契約）に変更が生じない
- 検証方法見込み: `automated`

## スコープ外

- `launch_gate_reviewer`自体の変更（#164項目②・PR #165で実装済み、対象外）。
- #164の他の対象範囲（配布用CIへの`npm test`組み込み、`gate reconcile`のGitHubモード対応）は完了済みのため対象外。
- Tier 2以降（CLI管理コマンド不足、`.agent-skill-chain/project/`統合、doctor網羅性等）は別Issueで対応。
- Codex実行系の具体的な起動コマンド・認証方式の確定（AC-5が定めるのはfail-safe deferralのI/Fのみであり、実起動結線は別途のADR・Issueで決定する）。
- `docs/system-spec/`実体構築（別ADR承認後、別Issueで対応。本SPECの対象外）。
- 本Issueの設計（`DESIGN.md`/ADR/`PLAN.md`）・実装・検証（`VALIDATION.md`）の作成そのもの（これらは本SPECを入力として後続segmentで作成する別成果物であり、本ファイルの記述範囲外）。
