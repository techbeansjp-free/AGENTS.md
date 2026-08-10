schema_version: agent-skill-chain/validation-report/v1
issue_id: ISSUE-567
target_sha: c2577493b3ed345d3d00fac89ad6eaf0ee871a02

acceptance_criteria:
  - ac_id: AC-1
    verification:
      mode: automated
      result: pass
    evidence:
      - '.agent-skill-chain/config/agent-skill-chain.yaml (issue_sync.enabled: true)'
      - "test/integration/issue-sync.test.ts: 'issue-sync: 設定ファイルを一切上書きしない場合、実際の既定値（enabled: true）でマーカー区間へ転記される（ISSUE-567）'"

  - ac_id: AC-2
    verification:
      mode: automated
      result: pass
    evidence:
      - '.agent-skill-chain/templates/standard/agent-skill-chain.yaml (issue_sync.enabled: true)'
      - "test/integration/init.test.ts: 'init --profile=standard（既定含む）: config/agent-skill-chain.yaml・CLAUDE.mdに本リポジトリ自身のdogfooding専用設定が混入しないこと（ISSUE-522）' に追加したissue_sync.enabled: trueのアサーション（本Issueで追加、ISSUE-567 AC-2）"

  - ac_id: AC-3
    verification:
      mode: automated
      result: pass
    evidence:
      - '.agent-skill-chain/schemas/config.schema.yaml examples[0].issue_sync (enabled: true, target/max_body_charsの構造は不変)'
      - "test/unit/schema.test.ts: \"validateAgainstSchema('config') (ISSUE-567 AC-3): examples[0]のissue_sync.enabledは新しい既定値trueと整合する\"（本Issueで追加）"

  - ac_id: AC-4
    verification:
      mode: hybrid
      result: pass
      reason: >-
        SPEC.mdのGiven/When/Thenは「issue_sync.enabled: falseを明示記載した設定ファイルを、既定値変更後のコード・
        テンプレートの下で読み込む」ことだけを検証範囲とする（`agent-skill-chain upgrade`の実行は含まない）。
        この範囲はresolveSyncSettings（本Issueで変更していない）が設定ファイルの値をそのまま読む既存の自動テスト
        で機械検証できるためautomated寄りだが、DESIGN.md「設計要素4」・PLAN.md「変更単位4」・
        ADR-0021 D-4項目6が前提とする「`upgrade`はconfig/agent-skill-chain.yamlを一般アセット同期の対象から
        除外済み」という記述の実際の正しさを、独立検証として手動でコードと実際の`upgrade`実行結果を確認した
        （反証観点）ためhybridとする。
      procedure: >-
        (1) 自動テスト: 既存のtest/integration/issue-sync.test.ts
        「issue-sync: 明示的にissue_sync.enabled: falseを設定した場合はIssue本文が一切変更されない」で、
        明示的なfalseがresolveSyncSettingsにそのまま読まれ転記が発生しないことを確認した（AC-4字義どおりの範囲）。
        (2) 手動検証: `init`で新規プロジェクトを作成し、issue_sync.enabled: falseへ明示編集した後
        `upgrade`を実行したところ、config/agent-skill-chain.yaml全体が配布テンプレート（standardプロファイル、
        issue_sync.enabled: true）へ`overwritten`として上書きされ、明示的なfalseがtrueへ差し戻されることを
        実機で確認した（src/commands/upgrade.tsの`profileRepair`時のみの除外分岐と、
        src/lib/fs-copy.tsのcopyTreeMirrorが常に上書きする実装を突き合わせて確認、
        既存のtest/integration/upgrade.test.tsの「標準アセットはパッケージ同梱版へ上書きされる」テストが
        同じ仕様を裏付けている）。DESIGN.md/PLAN.md/ADR-0021が述べる「config/agent-skill-chain.yamlの
        upgrade除外」は、実際にはprofile値判定不能時の復旧ケースに限定された除外であり、
        通常経路での全体除外ではない。AC-4自体（設定ファイルの読み込み挙動）はこの独立検証結果に
        影響されず成立するが、`upgrade`経路で既存プロジェクトの明示的オプトアウトが差し戻されうるという
        残存リスクをフォローアップ課題として記録した（ISSUE-567のIssueコメントに記載）。
      executor: validation_worker (claude)
    evidence:
      - "test/integration/issue-sync.test.ts: 'issue-sync: 明示的に issue_sync.enabled: false を設定した場合は Issue 本文が一切変更されない'"
      - 'test/integration/upgrade.test.ts: upgrade: .agent-skill-chain/project/配下のカスタム内容は変更されず、標準アセットはパッケージ同梱版へ上書きされる（既存テスト、標準アセット全体上書きの裏付け）'
      - 'src/commands/upgrade.ts（recoveredConfigDestの除外はprofileRepair時のみ）とsrc/lib/fs-copy.ts（copyTreeMirrorの上書き実装）の直接確認'
      - 'ISSUE-567 Issueコメント（validation_workerによる独立検証finding記録）'

  - ac_id: AC-5
    verification:
      mode: manual
      result: pass
      reason: >-
        ADR本文の決定記述・根拠・オプトアウト経路の記載が要求の意図を正しく反映しているかは
        自然文の意味解釈を要し、機械的な文字列一致検査だけでは十分に検証できないため manual とする。
      procedure: >-
        docs/adr/ADR-0021-github-issue-sync-full-text-content-canonical.mdを直接読み、
        D-2（GitHubモード向け配布・生成設定では既定enabled: trueとする決定、ISSUE-567・
        2026-08-10ユーザー方針指示を根拠として明記）、D-4項目6（既存プロジェクトは初期化時点の
        既定値のまま変更されない旨）、D-5（enabled説明にISSUE-567の既定値変更を明記）、
        Consequences（既定有効化の影響と明示的オプトアウト経路enabled: falseの維持を明記）の
        各該当箇所が、新しい決定・根拠・オプトアウト経路の3点をすべて含むことを確認した。
      executor: validation_worker (claude)
    evidence:
      - 'docs/adr/ADR-0021-github-issue-sync-full-text-content-canonical.md D-2, D-4項目6, D-5, Consequences'

  - ac_id: AC-6
    verification:
      mode: manual
      result: pass
      reason: >-
        `.agent-skill-chain/ci/verify-config-doc-sync.sh`はdocs/CONFIGURATION.mdのトップレベル項目の
        有無のみを検査し、既定値の説明文が最新かどうかは検査しないため、旧既定値記述の残留有無は
        目視・grep確認によるmanual検証とした。
      procedure: >-
        AGENTS.md・docs/CONFIGURATION.md・docs/ARCHITECTURE.mdについて「既定は無効」「既定
        `enabled: false`」等の旧既定値のみを前提とした表現が残っていないかgrepおよび該当箇所の
        目視確認を行った。3ファイルとも新しい既定値（GitHubモード向け配布・生成設定では
        `enabled: true`、明示的な`false`でオプトアウト可能）と整合する記述に更新されていることを
        確認した。
      executor: validation_worker (claude)
    evidence:
      - 'AGENTS.md（Coordination Backend節の表・issue_sync有効時の説明段落）'
      - 'docs/CONFIGURATION.md `### issue_sync` セクション（既定値説明）'
      - 'docs/ARCHITECTURE.md 補足段落（issue_sync.enabled: trueの記述）'

  - ac_id: AC-7
    verification:
      mode: automated
      result: pass
    evidence:
      - "test/integration/issue-sync.test.ts 全8テスト（既定値変更後も転記対象・転記先・上限・マーカー処理・競合リトライ・本文上限超過時の切替の既存挙動が回帰していないことを検証）"
      - 'npm test（全体回帰、詳細はregressionセクション参照）'

regression:
  executed: true
  evidence:
    - 'npm test（node --import tsx --test、test/unit + test/integration 全ファイル）: 1057 pass / 0 fail'
    - '.agent-skill-chain/ci/verify-doc-length.sh: 成功'
    - '.agent-skill-chain/scripts/lint-vocab.sh: 成功（既定対象範囲＝AGENTS.md・.agent-skill-chain/{standards,templates,config,schemas,scripts,ci}/・src/、docs/・test/は既定対象外のため0件）'
    - '.agent-skill-chain/scripts/lint-references.sh: 成功'
    - '.agent-skill-chain/scripts/adr-lint.sh check: 成功'
    - 'npm run build（tsc）: 成功'
    - 'PR #575 CI（agent-skill-chain / ci の verify job・config documentation sync・risk・CodeRabbit）: 全てSUCCESS（HEAD一致確認済み）'
