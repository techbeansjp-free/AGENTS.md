schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-590
target_sha: deaa1cc7cf893ad4a97e7d71a78a51498f4a6fb9

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/verify-root-clean-merge-gate.test.ts『ci (.github/workflows/agent-skill-chain-ci.yml): 'verify-root-clean (merge-ready)' ステップが存在し、既存の verify-root-clean.sh を無変更のまま呼び出す』および同名テストの .agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-ci.yml 版（`npx tsx --test test/unit/verify-root-clean-merge-gate.test.ts` → 6件 ok、fail 0）: 新規必須checkが既存の verify-root-clean.sh をそのまま実行することを本体・配布テンプレート両方で確認"
      - "test/integration/verify.test.ts『verify root-clean: root直下に対象4ファイルが無ければ成功し、存在すればすべて列挙して失敗する』（Issue #208で導入済み・本Issueで無変更、npm test内で ok）: 上記CIステップが呼び出す検出ロジック自体が、対象4ファイルの残存を理由に非0終了することを確認"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/unit/verify-root-clean-merge-gate.test.ts『ci (...): 'verify-root-clean (merge-ready)' の if 条件は skip_checks ガードと draft == false の両方を含む（AC-1・AC-2）』（本体・テンプレート双方で ok）: if条件が `github.event.pull_request.draft == false` を含み、draft中は当該ステップ自体が実行されないことを確認"
      - "gh pr checks 608（本Issue自身のPR、target_sha=deaa1cc7c時点でPRはDraftのまま）実行結果: verify・verify-config-doc-sync ともにpass。root直下にSPEC.md/DESIGN.md/PLAN.mdが存在する現在のDraft状態でも『verify-root-clean (merge-ready)』ステップ自体がスキップされCIが誤ってブロックしていないことを実PR上で確認"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/pr-merge.test.ts『pr merge (ISSUE-590 AC-3): マージ・同期成功後、root直下混入ファイルをroot-cleanup runが自動検出・削除する』（`npm test` 内で ok 277）: 実gitバイナリ上でgh pr merge成功・main worktree同期成功後、同一プロセス内でroot-cleanup.run()が呼ばれ、Issueブランチ自体には削除commitが追加されず短命ブランチ経由でrepoRoot直下の対象ファイルが検出・削除されることを確認"
      - "test/integration/pr-merge.test.ts『pr merge (ISSUE-590 AC-4 関連): root直下混入ファイルが無い場合、root-cleanup runはno-opで成功しPR作成・追加mergeを行わない』（ok 278）: 対象ファイルが無い正常系で追加のPR作成・マージが発生しないことを確認"
      - "test/integration/pr-merge.test.ts『pr merge (ISSUE-590 AC-3 失敗時): root-cleanup runがhuman_requiredで失敗しても、マージ自体は巻き戻さず非0終了で追加確認を促す』（ok 279）: 連鎖呼び出し失敗時もマージ結果自体が維持されることを確認"

  - ac_id: AC-4
    verification:
      mode: manual
      result: pass
      reason: "変更差分が特定ファイル群に触れていないことの確認であり、diffを人が目視して判断する必要があるため自動化しない"
      procedure: "git diff 0a1cf483a^..deaa1cc7c -- .agent-skill-chain/config/segments.yaml AGENTS.md を実行し、差分が0件（該当ファイルへの変更なし）であることを確認する。あわせて git show --stat deaa1cc7c で実装差分のファイル一覧を確認し、成果物配置パス（root直下）自体を変更するファイル移動が含まれないことを確認する。"
      executor: validation_worker
    evidence:
      - "git diff 0a1cf483a^..deaa1cc7c -- .agent-skill-chain/config/segments.yaml AGENTS.md の実行結果: 出力なし（変更ゼロ）"
      - "git show --stat deaa1cc7c の実行結果: 変更ファイルは .agent-skill-chain/ci/verify-root-clean.sh・.agent-skill-chain/scripts/pr-merge.sh・.agent-skill-chain/standards/GIT_CONVENTIONS.md・.github/workflows/agent-skill-chain-ci.yml（本体+テンプレート）・src/commands/pr.ts・src/commands/verify.ts・テスト2ファイルのみで、segments.yaml・AGENTS.md・成果物配置パスへの変更を含まない"

  - ac_id: AC-5
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/root-cleanup.test.ts 全9件（対象0件no-op、対象1件以上の短命ブランチ削除・admin merge、対象4件全削除、ISSUE-588 AC-1/AC-3のdefault branch解決、スコープ検査違反2種、自己修復、並行worktree非干渉）が本Issueの実装（deaa1cc7c）でも無修正のまま全件成功（`npm test` 内で該当スイート ok、fail 0）: root-cleanup.ts自体を変更していないことと合わせ、既存の非同期呼び出し経路（push to main契機）に回帰が無いことを確認"
      - "test/integration/pr-merge.test.ts『pr merge (ISSUE-590 AC-3)』『(ISSUE-590 AC-4 関連)』『(ISSUE-590 AC-3 失敗時)』（ok 277-279）: 新規追加した同期呼び出し経路（コンポーネントB）からroot-cleanup.run()を呼ぶケースが成功・no-op・失敗の3パターンとも正しく動作し、既存の非同期経路と論理を共有しつつ独立に機能することを確認"

regression:
  executed: true
  evidence:
    - "npm test（test/unit・test/integration 全スイート、node --test） → 1121 tests, 1121 pass, 0 fail, 0 cancelled"
    - "npm run build（tsc） → exit 0"
    - ".agent-skill-chain/ci/verify-template-sync.sh → exit 0"
    - ".agent-skill-chain/ci/verify-doc-length.sh → exit 0"
    - ".agent-skill-chain/scripts/lint-vocab.sh → exit 0"
    - ".agent-skill-chain/scripts/lint-references.sh → exit 0"
    - ".agent-skill-chain/scripts/adr-lint.sh check → exit 0"
    - "gh pr checks 608 実行結果（target_sha=deaa1cc7c時点のPR #608、Draft状態）: verify pass、verify-config-doc-sync pass、CodeRabbitはDraft検出によりスキップ"
