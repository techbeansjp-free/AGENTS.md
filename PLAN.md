# PLAN: security: agent-skill-chain-release.ymlが配布物経由でconsumerプロジェクトのCIへ混入する

- Issue: `#344`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.mdのD0（ADR-0017、`docs/adr/ADR-0017-distribution-scope-separation-and-release-workflow-exclusion.md`）は本設計セグメントで作成済みであり、以下は実装セグメントが行う変更単位である。AC-6（分離基準の文書化）はD0で既に充足済みのため、実装セグメントでの追加変更単位を要しない（VALIDATION.mdでADR-0017の存在・内容を確認するのみ）。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | `agent-skill-chain-release.yml`のテンプレート除外 | `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-release.yml`を`git rm`で削除する（DESIGN.md D1）。他の配布テンプレートのジョブ定義・トリガー・シークレット名には触れない（`agent-skill-chain-root-cleanup.yml`のヘッダコメント修正は`#5`で別途扱う）。 | `AC-1, AC-2` | なし |
| 2 | 本体`agent-skill-chain-release.yml`のヘッダコメント更新 | `.github/workflows/agent-skill-chain-release.yml`の先頭コメントに、本ファイルが配布物ではなく本体専用の直接管理ファイルである旨とADR-0017を追記する（DESIGN.md D2）。`agent-skill-chain-self-test.yml`のヘッダコメントの書きぶりに倣う。トリガ・ステップ・env・スクリプト参照は一切変更しない。 | `AC-3` | `#1` |
| 3 | 配布不在・本体存在の単体テスト追加 | (a) `.agent-skill-chain/templates/github/.github/workflows/`配下に`agent-skill-chain-release.yml`が存在しないことを検査するテスト、(b) `.github/workflows/agent-skill-chain-release.yml`が存在し、既存ジョブ名`release`・トリガ`push: branches: [main]`・`secrets.RELEASE_MAIN_PAT`参照ステップが保持されていることを検査するテストを`test/unit/`に追加する。 | `AC-1, AC-2, AC-3` | `#1, #2` |
| 4 | `verify-template-sync`回帰テスト追加 | `computeTemplateSyncDiffs`（または`verify template-sync`CLI）に対し、配布元テンプレートに存在せず展開先（`.github/`）にのみ存在するファイルが未同期差分として報告されないことを確認する回帰テストを`test/integration/verify.test.ts`（または同等の既存テストファイル）へ追加する。DESIGN.md D3で「無変更」と判断したロジックの前提を、将来の実装変更から保護するテストであり、`src/lib/template-sync.ts`自体は変更しない。 | `AC-4` | `#1` |
| 5 | `SECURITY_POLICY.md`追記および`root-cleanup.yml`ヘッダコメント整合性修正 | (a) `.agent-skill-chain/standards/SECURITY_POLICY.md`へ、`agent-skill-chain-root-cleanup.yml`が要求する`secrets.RELEASE_MAIN_PAT`の目的・未設定時の挙動（admin merge手順が認証エラーで失敗するが、`main.json`のrequired status checksに含まれないためPRマージ可否には影響しない）・対処方法（PATを登録して有効化する／無視してよい）を追記する。(b) `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-root-cleanup.yml`のヘッダコメントのうち`agent-skill-chain-release.yml`をファイル名で名指ししている1文を、ファイル名に依存しない自己完結した表現へ書き換える（DESIGN.md D5(a)(b)）。ジョブ定義・トリガー・`secrets.RELEASE_MAIN_PAT`という名称・ステップ構成・`permissions`は一切変更しない。 | `AC-5` | `#1` |
| 6 | 実機検証・VALIDATION.md記録 | `node bin/agents-md.js setup github <tmpdir>`相当を新規一時ディレクトリへ実機実行し（`init`は`.github/`自体を生成しないため対象コマンドにならない。`.github/`を実際に展開するのは`setup github`のみ）、展開された`.github/workflows/`一覧に`agent-skill-chain-release.yml`が含まれないこと、`agent-skill-chain-root-cleanup.yml`は含まれることを目視確認する。あわせてADR-0017の内容・`SECURITY_POLICY.md`追記内容・`agent-skill-chain-root-cleanup.yml`ヘッダコメントの書き換え後の記述がconsumer視点で自己完結して理解できるかを確認し、`VALIDATION.md`へ証跡として記録する。 | `AC-7` | `#1, #2, #5` |
| 7 | 本体リリース自動化のregression確認 | `#2`のコメント変更後、`release-resolve-version.sh`/`release-bump.sh`/`release-tag.sh`/`release-publish.sh`の既存単体テストが全てpassすることを確認する（静的側面）。動的側面（実際のmainへの対象pathへのpushでの`agent-skill-chain / release`実行）は、本Issueのマージそのものが`AGENTS.md`・`.agent-skill-chain/**`を変更するpushに該当するため、マージ後の実行結果を観測し`VALIDATION.md`（`hybrid`、`executor`: 進行役または独立検証担当）に記録する。 | `AC-3` | `#2` |

## テスト適用性（`.agent-skill-chain/standards/TEST_POLICY.md`準拠）

- 常時必須: lint/format・型検査・単体テスト（`#3, #4, #7`で追加・実行）・変更範囲の結合テスト・secretスキャン（`RELEASE_MAIN_PAT`という文字列自体は既存のADR-0005/0007で承認済みの識別子であり新規secret値を導入しないため、スキャン対象は「値」ではなく既存の文字列一致のみ）。
- 変更内容に応じ必須: 「認証・認可・秘密情報」区分に該当（`#5`がPAT要求ドキュメントを扱うため）→ 権限境界テストとして`#3`(b)のステップ構成検査（`secrets.RELEASE_MAIN_PAT`参照が本体ファイルにのみ残り配布ファイル側には存在しないこと）を兼用する。「デプロイ・監視・運用変更」区分にも該当（配布ワークフロー変更）→ 運用テストとして`#6`の実機検証を割り当てる。
- リリース単位: 該当なし（本Issue自体が次回リリースでの`agent-skill-chain / release`動作が回帰確認対象になるが、これは`#7`のhybrid検証で個別Issue単位として先行確認する）。

## 実装順序の見直しについて

`#3`と`#4`、`#5`と`#6`は依存関係が緩く並行実装可能だが、`#6`（実機検証）は`#1`・`#2`・`#5`の変更が全てmain相当のブランチへ反映済みである必要があるため最後に実行する。作業順序のみの見直しは本ファイルの更新のみで足り、DESIGN.mdの改定（設計ゲート再通過）は不要である。
