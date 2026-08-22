# SPEC: Orphaned active writer lease recovery

- Issue: `ISSUE-820`
- 作成者: `emergency_orchestrator`
- 対象ブランチ: `bugfix/820-orphaned-writer-lease-recovery`

## 目的・背景

worker が終了して one-time credential も失われた場合、期限前の active writer lease を安全に解放できず、同じ Issue の自走が TTL まで停止する。この Issue は、実行中 writer を奪わず、保存されていない成果物を失わず、監査可能に orphaned lease だけを回復する。

## 要求 → 要件 → 受入条件

### 要求

進行役は、credential を持たない orphaned writer lease を、厳密な安全条件を満たす場合だけ期限前に回収し、同じ Issue の作業を直ちに再開できる。

### 要件

- 回復判定の入力は、正本から一度に観測した active lease 全体とする。Issue、segment、holder、branch、worktree、`acquired_at`、`expires_at` を含み、credential の実値を材料にしない非secret digest を観測 lease instance のスナップショットとして固定する。
- 回復可能性は全ケースで一つの terminal proof 規則だけで成立する。trusted launcher が、観測 lease instance の digest、credential を渡した一意な runtime identity、worker start、継続監視、terminal exit、非再起動、terminal 時点の branch・worktree・HEAD・remote SHA、および `acquired_at` 以後の report 集合またはその digest を同一の耐久化 lifecycle record に束縛し、対象 process の terminal exit と非再起動を確認した後に記録した完全な terminal attestation を必須とする。
- worker の `completed` report は補助証跡であり、単独では回復可能性を立証しない。report がある場合は report の lease instance digest と runtime identity が terminal attestation に一致する場合だけ採用し、report が無い場合も完全な terminal attestation があれば判定を続ける。`acquired_at` より前の report、古い実行の遅延 report、同じ holder・HEAD に対する別 lease の report、runtime identity が不明または不一致の report、および worker 生存中に投稿されただけの report は回復根拠にしない。
- process または PID の不在、経過時間、startup grace、stale heartbeat のいずれも単独または組み合わせで terminal proof にしない。正常な起動窓、未起動、起動中、launcher 生存、監視不能、runtime identity 不明・不一致、terminal exit または非再起動の未立証は全て回復を拒否する。
- 回復処理は、観測した lease instance に CAS で束縛された排他的 recovery claim を取得してから安全条件を判定する。report 投稿、lease の renew・release・resume、対象 worker の起動、および回復は同じ claim を検査し、競合する操作の片方だけが成立する。claim の競合・状態不明・検査不能時は回復しない。
- claim 取得後に terminal attestation、`acquired_at` 以後の report 集合とその digest、worktree、HEAD および remote 状態を再観測する。claim 前の観測から変化した場合、単一の terminal proof が完全に成立しない場合、worktree が clean でない場合、または未push commit がある場合は回復しない。claim 取得後から削除まで、検査済み report の追加・変更、renew、release、resume または worker start が成功し得る状態を許さない。
- holder と観測スナップショットに束縛した明示確認を必須とする。削除は、再観測した digest を含む全 lease スナップショットが直前の正本と一致する場合だけ CAS で行い、更新・延長・再取得された lease は削除しない。
- CAS 削除前に、回復 attempt、holder、観測 digest、判定根拠、時刻を含む GitHub Issue 上の耐久化された監査予約を記録し、読み戻しで確認する。予約の記録または確認が失敗したら lease を変更しない。削除後は同じ attempt に最終結果を記録・確認し、それが失敗した場合は部分成功の理由付き非0終了として「回復完了」を報告しない。
- claim は安全な中止時と回復終了時に解除を確認する。削除前に claim の取得・保持状態を確認できない場合は lease を削除しない。削除後に最終監査結果または claim 解除を確認できない場合は部分成功の理由付き非0終了とする。いずれも正当な writer の作業、report、lifecycle 証跡および監査証跡を削除せず、回復完了または再開可能と報告しない。
- 回復経路は credential の実値を読み取らず、CLI・コメント・log・report に出力せず、Git 管理下、Issue・PR、監査証跡、lifecycle record または report に保存せず、明示確認の入力・照合値・digest 材料にも使わない。通常の lease 運用が既に行う Git 管理外かつ権限 `0600` の credential 保管はこの禁止の対象外であり、回復経路は新たな表示・永続化を行わない。

### 受入条件（Acceptance Criteria）

#### AC-1: positive terminal proof を持つ lease だけを回復対象にする

- Given: trusted launcher が観測 lease instance digest、一意な runtime identity、worker start、継続監視、terminal exit、非再起動、terminal 時点の branch・worktree・HEAD・remote SHA、および `acquired_at` 以後の report 集合またはその digest を同一 record に束縛し、終了確認後に耐久化した完全な terminal attestation がある
- When: holder と観測 digest に束縛した明示確認付き回復を実行する
- Then: terminal attestation だけが positive terminal proof として採用され、report の有無にかかわらず他の安全条件の検査へ進める
- 検証方法見込み: `automated`

#### AC-2: 起動状態または終了状態が曖昧なら回復しない

- Given: PID 不在や時間経過だけが観測された、worker が未起動・起動中・report 投稿後も生存中、launcher 生存、監視不能、runtime identity 不明・不一致、terminal exit・非再起動未立証、completed report だけが存在する、または report が `acquired_at` より前・別 lease instance・別 runtime identity のいずれかである
- When: 回復を実行する
- Then: 正常な起動窓を含め lease と worktree は変更されず、理由付き非0終了となる
- 検証方法見込み: `automated`

#### AC-3: 未保存または未push の作業があれば回復しない

- Given: 対象 worktree に未commit変更または remote に存在しない commit がある
- When: 回復を実行する
- Then: lease は保持され、変更と commit は一切削除されない
- 検証方法見込み: `automated`

#### AC-4: recovery claim と再検査で競合を排除する

- Given: 回復と、report 投稿、lease の renew・release・resume または worker start が同じ観測 lease に対して競合する
- When: 観測 lease に束縛した claim を取得し、terminal attestation・report 集合と digest・worktree・HEAD・remote 状態を再検査する
- Then: 競合する操作の片方だけが成立し、claim 前後で状態または report 集合が変化した場合は削除せず理由付き非0終了となる
- 検証方法見込み: `automated`

#### AC-5: 対象同一性、監査順序および失敗時の保存を強制する

- Given: 削除前の明示確認・lease スナップショット・監査予約・claim のいずれかを確認できない、または削除後の最終監査結果か claim 解除を確認できない
- When: 回復を実行する
- Then: 削除前の失敗では CAS 削除を拒否して lease を保持し、削除後の失敗では部分成功とする。どちらも正当な writer の作業と全証跡を削除せず、理由付き非0終了となり、回復完了または再開可能と報告されない
- 検証方法見込み: `automated`

#### AC-6: 回復後は1 writer のまま直ちに再取得できる

- Given: AC-1〜AC-5 を満たし、監査予約後の CAS 削除、claim 解除および最終監査結果の確認まで完了した
- When: 同じ Issue の新しい writer が lease acquire を実行し、並行する別 acquire も実行する
- Then: 1つだけが成功し、成功した writer は直ちに作業を再開できる
- 検証方法見込み: `automated`

#### AC-7: 回復経路で credential の実値を利用または永続化しない

- Given: credential の実値を通常の Git 管理外かつ権限 `0600` の保管先に持つ active lease がある
- When: 成否を問わず回復を実行し、CLI・コメント・log・report、Git 管理下、Issue・PR、監査証跡、lifecycle record、明示確認、照合値および digest 材料を検査する
- Then: credential の実値は読み取られず、CLI・コメント・log・report に出力されず、Git 管理下・Issue・PR・監査証跡・lifecycle record・report に保存されず、明示確認入力・照合値・digest 材料にも使われない。既存の通常保管は変更されない
- 検証方法見込み: `automated`

## スコープ外

- TTL の短縮または無効化。
- writer credential の出力、共有、永続化。
- 1 Issue の複数 writer 許可。
- 保存済み成果物や GitHub audit 証跡の削除。
