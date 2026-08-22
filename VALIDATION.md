# 由来: AGENTS.mdが定める不変条件I7（仕様⇔検証の追跡）の規約に基づく検証報告である。
# 本ファイルは純粋なYAMLとして記述する（verify ac-coverage が単一YAML文書として読むため）。
#
# 目的: Issue ISSUE-798「root成果物の削除がLLMワーカー1ラウンドを消費し、claude adapterでは
#       完走できない」の実装を、実装セグメントとは独立に受入・回帰の観点で検証し、SPEC.md が
#       定める AC-1〜AC-12 それぞれの充足可否と証跡を確定する。
#
# 対象範囲: 新設した決定的コマンド `root-cleanup branch <issue_id>` とその薄いラッパー、
#       root成果物の3状態区分を与える純関数、`.agent-skill-chain/config/roles.yaml` の
#       root_artifact_cleanup_worker（ロール定義と入出力契約の双方）、writer lease スキーマの
#       segment enum 拡張、worktree削除コマンドが有効leaseを探す走査方法の置換、および
#       claude adapter のセグメント作業ワーカー既定許可コマンド列挙。
#
# 対象外（本検証で判定しないもの）:
#   - 既定ブランチへのpushを契機とする事後清掃自動化と root残存検査の内部設計そのもの。
#     本検証はそれらの外部挙動が変わっていないこと（AC-11）だけを判定する。
#   - ADR status更新コマンドが、対応するロール定義でlease取得能力を宣言しながら実装では
#     writer leaseを取得していないという既存の宣言・実装不一致。DESIGN.md が本Issueの範囲外と
#     明示しており、本検証でも是正せず観測事実として扱う。
#   - codex adapter の sandbox 境界、進行役の権限、4セグメント・4ゲートの構成。
#
# 用語（本ファイル内での定義）:
#   - root成果物: repository root 直下の SPEC.md・DESIGN.md・PLAN.md・VALIDATION.md の4ファイル。
#   - 本コマンド: 新設した CLI サブコマンド `root-cleanup branch <issue_id>` と、その薄いラッパー
#     .agent-skill-chain/scripts/root-cleanup-branch.sh。
#   - 削除対象 / 内容喪失リスクあり / 不在: SPEC.md が定める対象ファイルの3状態区分。
#   - 全量実行: 対象SHAの作業ツリーで `npm test` を前景で1回だけ完走させた実行。
#
# 入力: SPEC.md（AC-1〜AC-12）、DESIGN.md（D1〜D14）、PLAN.md、および対象SHA
#       3c7149eab1bd7bd8b481f7a8073563669fa7985b の実装・自動テスト。
# 出力: 本ファイルの acceptance_criteria（ACごとの検証方法・結果・証跡）と regression。
#
# 検証方法と前提:
#   - 全12 ACの検証方法は automated である。SPEC.md の各ACの「検証方法見込み」と一致する。
#   - 判定の基礎は、対象SHAの作業ツリーでの `npm test` 全量実行1回である。実測結果は
#     tests 1638 / pass 1637 / fail 0 / cancelled 0 / skipped 1 / todo 0、duration 745128ms、
#     終了コード0。`npm test` は pretest で `npm run build`（tsc）を実行するため、型検査の
#     成功もこの終了コード0に含まれる。
#   - 制約（証跡の粒度）: 全量実行の標準出力は末尾のみを保持したため、AC別テストの個別
#     「✔」行は保持していない。したがってAC別の pass 判定は「当該テストが対象SHAに存在すること」
#     と「全量実行が fail 0 かつ終了コード0であること」の連言から導いている。個別行の欠落を
#     判定の根拠にはしていない。
#   - 上記に加えて、テスト結果に依存しない独立確認を実施した。内訳は各ACの evidence に記す。
#     これは自動テストが主張どおりの対象を見ているかを、テストを介さずに確かめるためである。
#
# 完了条件: 全AC-IDに verification.result と evidence が対応し、regression の実行結果が
#       記録されていること。
#
# 未決事項:
#   - 本コマンドを本番のIssueブランチに対して実地起動する検証は行っていない。実地起動は
#     root成果物を削除しcommit・pushするため、本検証セグメントの成果物である本ファイル自身を
#     消す。統合テストが一時リポジトリ上で同じ経路を実行しており、実地起動はPRをReadyへ移す
#     直前に進行役が行う運用上の手順である。

schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-798
target_sha: 3c7149eab1bd7bd8b481f7a8073563669fa7985b

acceptance_criteria:
  - ac_id: AC-1
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/roles.test.ts: 'loadRoles (AC-1): root_artifact_cleanup_worker が scope 限定の書込みロールとして定義されている'"
      - "test/unit/roles.test.ts: 'loadRoles: role_contracts に全必須ロールが存在する' / 'loadRoles: 各 role_contract は inputs/outputs/rules/completion/forbidden を持つ'"
      - "独立確認: .agent-skill-chain/config/roles.yaml を直接読み、roles: 配下に root_artifact_cleanup_worker（lease: writer、scope: root_artifacts_only、capabilities は lease.acquire/renew/release と branch.commit/branch.push のみ、forbidden に out_of_scope.change と root_artifact.content_edit）が、role_contracts: 配下に同名の inputs/outputs/rules/completion/forbidden が、既存の adr_finalization_worker と同構造で存在することを確認した"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-2
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-2): 引数がissue_id 1個以外のときは使い方エラーで非ゼロ終了する'"
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-2): 標準入力を与えても結果が変わらない（内容入力経路を持たない）'"
      - "test/unit/root-cleanup-branch-closure.test.ts: 'AC-2 (D13): 本コマンドの推移的import閉包に、アダプタ・ワーカー・レビュアの起動実装が現れない' / 'AC-2: 本コマンドは標準入力を読む経路を持たない'"
      - "独立確認: src/commands/root-cleanup-branch.ts が args.length !== 1 を CliError で拒否し、可変部が parseIssueId で [0-9]+ へ限定された Issue 番号だけの固定commitメッセージ定数を用いることを直接読んで確認した"
      - "独立確認: src/commands/root-cleanup-branch.ts・src/lib/root-artifact-state.ts・.agent-skill-chain/scripts/root-cleanup-branch.sh を process.stdin / readFileSync(0 / /dev/stdin / readSync(0 で走査し、標準入力の読み取り経路が1件も無いことを確認した"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-3
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-3/AC-9): 削除のみのcommitを作りpushし、SHAを出力して終了コード0'"
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-3境界): 起動時点で作業ツリーから消えていてもno-opにならない'"
      - "test/unit/root-artifact-state.test.ts: '作業ツリー上に存在し HEAD と一致するものは削除対象になる' / 'index へ未記録の削除（作業ツリーから消えているだけ）は削除対象になる' / 'index へ記録済みの削除（HEADにのみ残る）は削除対象になり、index 不在として扱われる'"
      - "独立確認: src/commands/root-cleanup-branch.ts の commit 直前段が index と HEAD の差分を再取得し、全エントリが削除であること・削除対象集合と完全一致することの2点を満たさなければ commit しない構造であることを直接読んで確認した"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-4
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-4): 対象4ファイル以外がindexへ記録されているときはcommitせず停止する'"
      - "独立確認: src/commands/root-cleanup-branch.ts の index スコープ検査が、削除ステージングより前に git diff --cached --name-only HEAD の結果から対象4ファイルを除いたパスを列挙し、1件でもあれば worktree・index を変更せず日本語診断とともに非ゼロ終了する順序であることを直接読んで確認した"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-5
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-5): 対象4ファイルが全て不在のときだけcommitもpushもせず終了コード0'"
      - "test/unit/root-artifact-state.test.ts: 'どこにも存在しないものは不在になる' / '分類は常に対象4ファイルちょうどを、相互排他な1区分ずつで返す'"
      - "独立確認: src/commands/root-cleanup-branch.ts で no-op 経路（削除対象0件）も remote 同期・事後条件検査の無条件段を必ず通り、作業ツリーに1件も無くとも HEAD の tree に残存があれば終了コード0を返さない構造であることを直接読んで確認した。AC-5 の境界（作業ツリー不在かつ HEAD 存在）は削除対象へ分類され AC-3 経路をとる"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-6
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-6): 内容が変更された対象ファイルがあるときは削除せず停止する' / 'root-cleanup branch (AC-6): 未追跡の対象ファイルがあるときは削除せず停止する'"
      - "test/unit/root-artifact-state.test.ts: '未追跡ファイルとして存在するものは内容喪失リスクありになる' / 'HEAD に存在せず index にのみ存在する（新規記録済み）ものは内容喪失リスクありになる' / 'index の内容が HEAD と異なるものは内容喪失リスクありになる' / 'index の file mode が HEAD と異なるものは内容喪失リスクありになる' / '作業ツリーの内容変更・型変更は内容喪失リスクありになる' / '未マージエントリは内容喪失リスクありになる' / '解釈できない git 出力は対象4ファイルすべてを内容喪失リスクありへ倒す'"
      - "独立確認: src/lib/root-artifact-state.ts の決定表が、解釈できない git 出力・未マージ・非blob・blob OID差・file mode差をすべて content_loss_risk へ倒す一方、追跡済みファイルの未ステージ削除・ステージ済み削除は deletable へ落とすことを直接読んで確認した。停止判定は no-op 判定より前段にある"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-7
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-7): 対象外パスの未記録の変更・未追跡ファイルを巻き込まず実行後も保持する'"
      - "独立確認: src/commands/root-cleanup-branch.ts の削除ステージングが --literal-pathspecs 付きで対象4ファイルのリテラルのみを pathspec に与える git rm であり、対象外パスを構造的に巻き込めないことを直接読んで確認した"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-8
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/root-cleanup-branch.test.ts (a): 'root-cleanup branch (AC-8a): 対象worktreeが既定ブランチをチェックアウトしている場合は拒否する' / '(AC-8a): detached HEADの対象worktreeでは実行しない' / '(AC-8a): remote先頭が存在しないときはcommitもpushもせず停止する' / '(AC-8a): remoteが先行している場合はcommitもpushもせず停止する' / '(AC-8a): 対象外の未pushcommitがあるときはcommitもpushもせず停止する'"
      - "test/integration/root-cleanup-branch.test.ts (b): 'root-cleanup branch (AC-8b, ローカルモード): 他segmentの有効leaseがあれば削除・commit・pushせず停止する' / '(AC-8b, ローカルモード): 期限切れleaseでも停止し、回収しない' / '(AC-8b, GitHubモード): 他segmentの有効leaseがあれば停止する' / '(AC-8b, GitHubモード): 取得直後の再走査で他leaseを検出したら自leaseを解放して譲る'"
      - "test/integration/cleanup-lease-scan.test.ts: 'AC-8 (D11): cleanup は新segment root_artifact_cleanup の有効leaseを検出して削除を拒否する' / 'AC-8 (D11): cleanup は既存segmentの有効leaseも従来どおり検出する' / 'AC-8 (D11): 期限切れleaseは cleanup の停止理由にならない（既存挙動を緩めも強めもしない）'"
      - "独立確認: src/commands/root-cleanup-branch.ts の lease 判定が segment を列挙せず Issue 番号 prefix の ref 走査で行われ、1件でも検出すれば取得を試みずに保持者・segment・失効時刻を提示して停止すること、および src/commands/cleanup.ts の有効lease探索が segment名5件の直書き列挙から activeLeasesFor(issueNumber) へ置換されていることを直接読んで確認した"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-9
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-3/AC-9): 削除のみのcommitを作りpushし、SHAを出力して終了コード0'"
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-9): push失敗は非ゼロ終了し、ローカルだけがcleanな状態で0を返さない'"
      - "独立確認: 既存の残存検査 verify root-clean は repoRoot 直下の対象4ファイルの存在のみを見る実装である（src/commands/verify.ts の rootClean）。本コマンドの終了コード0直前の事後条件検査は remote 先頭の tree・local HEAD の tree・作業ツリーの3点を見るため、verify root-clean が見る集合を包含する。したがって終了コード0は削除経路・no-op経路のいずれでも verify root-clean の成功を含意する"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-10
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/worker-allowlist.test.ts: 'AC-10: ci/ 配下の実行が scripts/ 配下と同じ2表記で許可されている' / 'AC-10: ファイル削除系のコマンドと無制限自動承認は列挙されていない' / 'AC-10: 削除系を意図的に列挙しない理由が列挙の近傍に記述されている'"
      - "test/integration/root-cleanup-branch.test.ts: 'root-cleanup branch (AC-8b/AC-10): ワーカーがlease保持中にラッパーを起動しても削除は成立しない'"
      - "独立確認: .agent-skill-chain/adapters/claude.sh の WORKER_ALLOWED_TOOLS_DEFAULT を直接読み、Bash(.agent-skill-chain/ci/*) と Bash(bash .agent-skill-chain/ci/*) が scripts/ 側と同じ2表記で加わっていることを確認した。同定義行を Bash\\((rm|git rm|find|git update-index)[^)]*\\) で走査した結果は0件であり、bypassPermissions は既定に用いない旨のコメント3箇所のみで既定指定としては現れない"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-11
    verification: {mode: automated, result: pass}
    evidence:
      - "test/integration/worker-allowlist.test.ts: 'AC-11: 既存の事後清掃自動化・root残存検査のラッパーが同じサブコマンドへ委譲し続ける' / 'AC-11: 既存の事後清掃自動化・root残存検査の実装が新設モジュールへ依存しない'"
      - "独立確認: 実在する6パス（src/commands/root-cleanup.ts・src/commands/verify.ts・src/lib/root-artifacts.ts・src/commands/lease.ts・.agent-skill-chain/scripts/root-cleanup.sh・.agent-skill-chain/ci/verify-root-clean.sh。存在を ls で確認済み）を対象に git show --stat 3c7149ea を実行した結果、差分エントリは0件であった。既存の清掃自動化・残存検査・lease acquire の実装は対象SHAで1行も変わっていない"
      - "回帰: 既存テストは期待値を変更せずに成功している。全量実行の fail は0件であり、既存の verify-root-clean 関連テスト（'verify-root-clean (merge-ready)' ステップの存在・if条件・配置順を検査する6件）も pass した"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

  - ac_id: AC-12
    verification: {mode: automated, result: pass}
    evidence:
      - "test/unit/roles.test.ts: 'loadRoles (AC-12): 進行役の forbidden が不変で、新ロールに著述・内容編集能力が無い'"
      - "独立確認: git show 3c7149ea -- .agent-skill-chain/config/roles.yaml の差分が root_artifact_cleanup_worker の追加2ブロックのみで構成され、進行役のロール定義には1行の変更も無いことを確認した。新ロールの capabilities は lease.acquire・lease.renew・lease.release・branch.commit・branch.push の5件のみで、成果物の著述・内容編集に相当する能力を含まない"
      - "独立確認: 本コマンドは対象Issueの識別子1個以外の入力経路を持たないため、進行役が本コマンドを経由して成果物を著述する経路が構造的に存在しない（AC-2の独立確認と同一の根拠）"
      - "local-test-run: npm test @ 3c7149ea（tests 1638 / pass 1637 / fail 0 / skipped 1 / 終了コード0）"

regression:
  executed: true
  evidence:
    - "local-test-run: npm test @ 3c7149eab1bd7bd8b481f7a8073563669fa7985b。実測 tests 1638 / suites 0 / pass 1637 / fail 0 / cancelled 0 / skipped 1 / todo 0 / duration_ms 745128.763492、終了コード0"
    - "型検査・ビルド: npm test の pretest が npm run build（tsc）を実行し成功。単独実行でも終了コード0"
    - "機械検査（いずれも前景実行・終了コード0）: .agent-skill-chain/ci/verify-doc-length.sh / .agent-skill-chain/ci/verify-template-sync.sh / .agent-skill-chain/ci/verify-config-doc-sync.sh / .agent-skill-chain/scripts/lint-references.sh / .agent-skill-chain/scripts/lint-vocab.sh / .agent-skill-chain/scripts/adr-lint.sh check"
    - "既存挙動の非回帰: 既存の事後清掃自動化・root残存検査・lease acquire の実装6パスに対象SHAで差分が無いこと（git show --stat の出力が空）と、それらの既存テストが期待値変更なしに成功したこと"
