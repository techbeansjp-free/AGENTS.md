# SPEC: 期限切れ writer lease の安全な再開と秘密情報の露出防止

- Issue: `ISSUE-286`
- 作成者: `run-issue-286`
- 対象ブランチ: `bugfix/286-expired-writer-lease-resume-and-redaction`

## 目的・背景

GitHub Coordination Backend の writer lease は専用 Git ref に耐久化する。しかし、期限切れの
lease が dirty worktree に対応すると、既存の reconcile は worktree を保護するため ref を
回収しない。その後、同じ作業を再開しようとしても、期限切れ ref の存在により acquire の
non-force push が拒否され、未commitの変更を checkpoint できない。

また、lease の bearer token が commit subject と Issue 可視コメントへ YAML 全文として記録される。
この token は lease 操作の認可子であり、Git 履歴・Issue コメント・標準出力に露出してはならない。
本変更は、元作業を証明できる再開だけを許可し、別作業者による奪取を拒否したまま、可視化・ログ・
commit metadata から token を排除する。

## 用語・前提

- **lease ref**: `refs/agent-skill-chain/leases/<issue>-<segment>`。writer lease の GitHub backend 正本。
- **resume proof**: 期限切れ lease の holder、Issue、専用 worktree、branch が同一の再開要求を
  結び付ける、トークンを表示しない検証情報。
- **dirty worktree**: 未commit または未push の変更を持つ対象 Issue 専用 worktree。
- GitHub backend では ref の比較更新が排他制御の正本であり、Issue コメント・label は補助的な
  可視性に限る。

## 要求 → 要件 → 受入条件

### 要求

期限切れ lease により正当な作業者の checkpoint が停止する状態を解消し、同時に token を
Git metadata、Issue コメント、CLI 出力へ残さない。

### 要件

- 期限切れ lease は、同一 Issue・同一 segment・同一 holder の再開証明と dirty worktree の
  対応が確認できる場合だけ、比較更新で新しい lease へ移譲する。
- holder、Issue、segment、worktree、branch のいずれかが一致しない場合は、lease ref と
  worktree を変更せず `human_required` 相当の失敗として停止する。
- 新規 acquire、renew、resume、release の Git commit subject、Issue comment、成功出力、
  エラー出力に bearer token を含めない。token は lease ref の非表示 payload と、実行者が
  明示的に保護して渡す入力だけで扱う。
- 旧形式の token を含む lease ref は値を出力せず、再開可能なら安全な形式へ置換し、再開不可なら
  失効扱いとして明示する。

### 受入条件（Acceptance Criteria）

#### AC-1: 同一作業者の期限切れ lease を安全に再開できる

- Given: GitHub backend に期限切れの lease ref、対応する dirty worktree、同一 Issue・segment・
  holder を証明する再開情報がある
- When: 作業者が resume を実行する
- Then: worktree 内容を変更・破棄せず、ref を比較更新して新しい lease を取得し、checkpoint を
  継続できる
- 検証方法見込み: `automated`

#### AC-2: 他作業者による期限切れ dirty lease の奪取を拒否する

- Given: 期限切れ lease に対応する dirty worktree があるが、holder、Issue、segment、worktree、
  branch のいずれかが再開証明と異なる
- When: acquire、resume、または reconcile を実行する
- Then: lease ref、worktree、未commit変更を変更せず、理由を token 非露出で報告して停止する
- 検証方法見込み: `automated`

#### AC-3: lease token を可視 metadata と CLI 出力へ保存しない

- Given: GitHub backend で acquire、renew、resume、release を実行する
- When: 作成した commit、Git log、Issue comment、標準出力、標準エラーを検査する
- Then: token はいずれにも含まれず、可視情報は Issue、segment、holder、期限、状態だけを持つ
- 検証方法見込み: `automated`

#### AC-4: 旧形式 lease を秘密を出さずに移行または失効できる

- Given: token を commit subject または Issue コメントに含む旧形式の期限切れ lease ref がある
- When: reconcile または正当な resume を実行する
- Then: token を出力せず、安全形式への比較更新または ref の失効を行い、以後の操作は旧形式を
  trust root として使わない
- 検証方法見込み: `hybrid`

## スコープ外

- 未commit変更の自動破棄、別 Issue への worktree 転用、または branch protection の緩和。
- 既に外部へ複製された token の失効以外の侵害対応。GitHub の履歴改変は行わず、露出した
  token は再利用不能にする。
- GitHub backend 以外の coordination state を正本に追加すること。
