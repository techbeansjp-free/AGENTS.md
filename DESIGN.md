# DESIGN: security: agent-skill-chain-release.ymlが配布物経由でconsumerプロジェクトのCIへ混入する

- Issue: `#344`
- 対応する SPEC: `SPEC.md`

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| `AC-1`（新規配布物からの除外） | D1: `agent-skill-chain-release.yml`のテンプレート側削除 | `.agent-skill-chain/templates/github/.github/workflows/`から削除するのみで、`init`は元々source存在ファイルのみをコピーするため自動的に満たされる |
| `AC-2`（upgradeでも新規配布されない） | D1 | `upgrade`/`setup github`が使う`copyTreeMirror`はsource側の走査のみで動作するため、D1のみで満たされる（D4で回帰検証） |
| `AC-3`（本体自身のリリースにregression無し） | D2: 本体`.github/workflows/agent-skill-chain-release.yml`のコメント更新（内容ロジック無変更） | ステップ・トリガ・スクリプト参照は一切変更しない。コメントにIssue #344の由来と配布除外方針を追記するのみ |
| `AC-4`（verify-template-syncが正しく合否判定） | D3: `computeTemplateSyncDiffs`は無変更（根拠を本書に明記） | 一方向（配布元→展開先）検査であるため、配布元に存在しないファイルは元々検査対象外。既存の`agent-skill-chain-self-test.yml`（Issue #290）が同型の前例として実証済み |
| `AC-5`（root-cleanup.ymlのシークレット依存への方針） | D5: `SECURITY_POLICY.md`への追記（ドキュメント化のみ、`root-cleanup.yml`自体は無変更） | ADR-0017 Decision参照。改名はADR-0007全文再掲を要するため見送り、ドキュメント化のみで対処 |
| `AC-6`（分離基準の文書化） | D0: ADR-0017（本Issueの`related_adrs`ではなく本文中の言及で参照。proposed状態のため） | 分離基準をADR内に自己完結して記載（AGENTS.md本文は変更しない） |
| `AC-7`（実機確認） | D4: 実機検証手順（VALIDATION.mdでmanual実行） | `node bin/agents-md.js init <tmpdir>`相当を実行し`.github/workflows/`一覧を目視確認する独立検証タスク |

## 責務・境界

### コンポーネント構成

- **D0: ADR-0017**（`docs/adr/ADR-0017-distribution-scope-separation-and-release-workflow-exclusion.md`、本設計セグメントで作成済み・proposed）: 配布境界の分離基準（操作対象基準）と、本Issueの3つの決定（release.yml除外・template-sync無変更の根拠・root-cleanupシークレット方針）を自己完結して記録する。責務: 「なぜこの分離にしたか」の恒久的な意思決定記録。実装コード・運用手順は持たない。
- **D1: 配布元テンプレートからの`agent-skill-chain-release.yml`削除**（対象: `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-release.yml`）: ファイルを削除するのみ。責務: 配布物の内容を決定する唯一の正本（ディレクトリツリーそのもの）を変更する。設定ファイルによるallowlist/denylist機構は存在しない（`.agent-skill-chain/config/agent-skill-chain.yaml`の`templates.github_source`はディレクトリパスのみを保持し、除外リストの概念を持たない）ため、物理削除が唯一かつ最小の変更手段である。
- **D2: 本体`.github/workflows/agent-skill-chain-release.yml`のヘッダコメント更新**: 既存の`agent-skill-chain-self-test.yml`ヘッダコメント（Issue #290由来、「配布テンプレートには含めない」の明記パターン）に倣い、本ファイルが配布物ではなく本体専用の直接管理ファイルである旨と、ADR-0017を由来として追記する。ステップ・トリガ・環境変数・スクリプト参照は一切変更しない（AC-3のregression防止）。
- **D3: `verify-template-sync`（`src/lib/template-sync.ts`の`computeTemplateSyncDiffs`）は無変更**: 実装調査の結果、本関数は配布元（`templates/github/.github`）の全ファイルを走査し、展開先（`.github/`）に「存在するか」「内容一致するか」のみを検査する一方向ロジックであり、展開先にのみ存在するファイル（配布元に無いファイル）を差分として報告するコードパスを持たない。したがって`agent-skill-chain-release.yml`を配布元から削除しても、本体側の`.github/workflows/agent-skill-chain-release.yml`は「配布元に存在しないファイル」として検査対象外になるだけで、誤検知（未同期エラー）は発生しない。この挙動は`agent-skill-chain-self-test.yml`（Issue #290で同じ構造を先行適用済み）が現にCI green であり続けていることで実証済みである。責務境界: 本コンポーネントを変更対象に含めないことで、無関係な検査ロジックへの改変リスクをゼロにする。
- **D4: 回帰テスト・実機検証**: (a) `.agent-skill-chain/templates/github/.github/workflows/`配下に`agent-skill-chain-release.yml`が存在しないことを検査する単体テスト、(b) 本体`.github/workflows/agent-skill-chain-release.yml`が存在し既存のステップ構成を保持していることを検査する単体テスト（AC-3の静的側面）、(c) `computeTemplateSyncDiffs`（またはCLI経由の`verify template-sync`）が「展開先にのみ存在し配布元に無いファイル」を差分として報告しないことを確認する回帰テスト（D3の設計意図を将来の実装変更から保護するためのテスト、AC-4）、(d) `node bin/agents-md.js init <tmpdir>`実機実行による目視確認（AC-7、VALIDATION.mdに記録）。PLAN.mdで変更単位として具体化する。
- **D5: `SECURITY_POLICY.md`追記**（`.agent-skill-chain/standards/SECURITY_POLICY.md`、配布物）: `agent-skill-chain-root-cleanup.yml`が要求する`secrets.RELEASE_MAIN_PAT`について、(1) 何のためのシークレットか、(2) 未設定時に何が起きるか（admin merge手順が認証エラーで失敗するが、root-cleanupはrequired status checkに含まれないためPRマージ可否には影響しない）、(3) どう対処すべきか（PATを登録して機能を有効化する／無視してよい）を自己完結して記載する。責務境界: `agent-skill-chain-root-cleanup.yml`自体（ワークフロー内容・シークレット名）は一切変更しない（ADR-0017 Decision参照、SPEC.md AC-5の「ドキュメント化」選択肢のみを採用）。

### 依存関係

```text
D0(ADR-0017: 分離基準の決定)
  → D1(release.yml をテンプレートから削除)
  → D2(本体側ヘッダコメント更新、ロジック無変更)
  → D3(検査ロジックは無変更・根拠のみ記録)
  → D4(削除・無変更の両方を回帰テストで固定)

D0(ADR-0017: root-cleanupシークレット方針)
  → D5(SECURITY_POLICY.md追記、root-cleanup.yml自体は無変更)
```

D1〜D5はいずれもD0（ADR-0017）が確定した2つの決定（配布境界の除外方針／シークレット方針）の機械的な反映であり、相互に循環依存を持たない。D3は「変更しない」という設計判断そのものが成果物であるため、実装単位としては存在せず、D4のテストがD3の想定を検証する。

## 関連ADR

`related_adrs:`構造化フィールドは`accepted`のADRのみを参照可能（stale参照検査の対象）であるため、本Issueで新規作成したADR-0017（proposed）はここには記載しない。ADR-0017は「関連ADR」ではなく本Issueの中心的な設計決定そのものであり、`docs/adr/ADR-0017-distribution-scope-separation-and-release-workflow-exclusion.md`として本設計セグメントで作成済みである。設計ゲート承認後、進行役が`adr-finalize.sh`を起動し`accepted`へ遷移させる。

```yaml
related_adrs: []
```

参考として自然文で言及する既存の`accepted` ADR: ADR-0005（`secrets.RELEASE_MAIN_PAT`の由来・本体専用の性質を確定）、ADR-0007（`agent-skill-chain-root-cleanup.yml`が同シークレットを再利用する既存決定。本文は変更しない）。

## 障害・ロールバック考慮

- 想定される失敗モード1: `agent-skill-chain-release.yml`をテンプレートから削除した結果、本体`.github/workflows/agent-skill-chain-release.yml`側で何らかの理由（例: 誤って本体側ファイルも同時に削除する等の実装ミス）により本体自身のリリース自動化が停止する。影響: mainへのリリース対象push後、版数bump・タグ・GitHub Release作成が行われなくなる。検知: D4のテスト（本体ファイル存在・ステップ構成検査）、および次回mainリリース対象pushでの`agent-skill-chain / release`ワークフロー実行結果（AC-3、hybrid検証）。
- 想定される失敗モード2: `verify-template-sync`が想定に反して展開先限定ファイルを差分として報告し始める（D3の前提が崩れる場合）。影響: 本体リポジトリ自身のCI（`agent-skill-chain-ci.yml`の`verify-template-sync`ステップ）が赤くなる。検知: D4(c)の回帰テストが実装完了時点で即座に検出する。対処: `computeTemplateSyncDiffs`のロジック自体に変更が必要になった場合は、DESIGN.mdの再改定（設計ゲート再通過）を要する。
- ロールバック手順: `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-release.yml`の削除・本体側コメント更新・`SECURITY_POLICY.md`追記はいずれも独立したファイル単位の変更であり、`git revert`で個別または一括に即座に戻せる。マージ後に問題が発覚した場合、Coordination Backend（GitHub PR）のrevert PRとして扱う。
- 影響を受ける既存機能: `init`/`upgrade`/`setup github`（配布ファイル一覧が1件減る）、本体`agent-skill-chain / release`ワークフロー（コメントのみ変更、実行ロジックは不変）。`agent-skill-chain-root-cleanup.yml`・その他配布ワークフローには一切触れない。
