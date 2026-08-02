# ADR

```yaml
id: ADR-0017
status: proposed
title: 配布テンプレートと本体専用ファイルの分離基準を確立し、agent-skill-chain-release.ymlを配布物から除外する
tags: [distribution, github-actions, release, template-sync, security]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

`agent-skill-chain-release.yml`（agent-skill-chain本体＝techbeansjp-free/AGENTS.md自身のnpmパッケージ版数bump・gitタグ・GitHub Release作成専用。由来: Issue #196、ADR-0005）が `.agent-skill-chain/templates/github/.github/workflows/`（配布元テンプレート）配下に置かれていたため、`init`/`upgrade`/`setup github`を実行したあらゆるconsumerプロジェクトへそのまま展開されていた（Issue #344、2026-08-02に実機検証で確認された実害報告）。このワークフローは`src/**`・`AGENTS.md`・`package.json`等、consumerプロジェクトでも日常的に変更されるパスをトリガに持ち、発火するとconsumer自身の`package.json`を無人でversion bumpし、gitタグ・GitHub Releaseを作成しようとする。加えて`secrets.RELEASE_MAIN_PAT`（techbeansjp-free/AGENTS.md自身のadmin merge権限を持つ専用PAT。ADR-0005で導入）を要求するため、secret未設定のconsumerではCIが恒常的に赤くなる。

この誤配布は、単一ファイルの配置ミスではなく、「`.agent-skill-chain/templates/github/.github/workflows/`に置くべきファイル」と「本体リポジトリの`.github/workflows/`でのみ直接管理すべきファイル」を判定する基準が、ADR-0005にもAGENTS.mdにも明文化されていなかったことに起因する。ADR-0005は版数体系・main反映方式・marketplace廃止を決定したが、当該ワークフローの配置先ディレクトリについては何も決定しておらず、実装時に他の（本来配布対象である）ワークフロー群と同じ`templates/`配下へ暗黙に置かれた。

同種の判断は本Issueが初出ではない。Issue #290では、agent-skill-chain CLI自身のテストスイートを実行する自己テストジョブが誤って配布テンプレート側に混入していたことが発覚し、`.github/workflows/agent-skill-chain-self-test.yml`として本体リポジトリ専用ファイルへ分離された。同ファイルのヘッダコメントには既に「配布テンプレートには含めない——consumerはagent-skill-chain自身のsrc/testを保有せず、このジョブがconsumer環境で意味を持たないため（Issue #290）」という判断理由が記載されている。しかしこの判断は個別ファイルのコメントに留まり、今後同種のワークフローを追加する際に参照できる一般原則としては確立されていなかった。ADR-0007（root-cleanup自動化）もまた、ADR-0005の`secrets.RELEASE_MAIN_PAT`を「新規credentialを追加せず既存PATを再利用する」利点として踏襲したが、`agent-skill-chain-root-cleanup.yml`自体が配布物（consumerも利用する汎用ガバナンス機能）であるという事実は当該ADRのContextで検討されておらず、consumer側にとってこのシークレット名が何を意味するか・未設定時どうなるかは文書化されていなかった。

## Decision

**配布境界の分離基準**: `.agent-skill-chain/templates/github/.github/workflows/`（配布対象）と本体リポジトリの`.github/workflows/`のみで直接管理するファイル（配布対象外）の判定は、ワークフローの発火条件（trigger paths）ではなく、**操作対象（何のリポジトリ状態を書き換えるか）**で行う。

- **配布対象**（`.agent-skill-chain/templates/github/.github/workflows/`に置く）: Issue駆動ガバナンスとしてconsumerプロジェクトが独立に必要とする汎用機能。操作対象はconsumer自身のリポジトリ状態（ゲート判定・reconcile・risk labeling・CI検査・root直下混入成果物の掃除等）であり、agent-skill-chain本体固有の値（本体のバージョン・本体のみが保有するsrc/test等）を一切参照・書き換えない。
- **本体専用**（本体リポジトリの`.github/workflows/`でのみ直接管理し、`.agent-skill-chain/templates/github/.github/workflows/`には置かない）: agent-skill-chain自身のnpmパッケージ・リポジトリのライフサイクル運用を操作対象とするワークフロー（例: 自身のバージョンbump・タグ・GitHub Release作成、自身のsrc/testを対象にした自己テストスイート実行）。トリガのpathパターンが`src/**`のように一般的に見えても、書き換える対象がagent-skill-chain本体のpackage.json・リポジトリそのものである限り本体専用に分類する。トリガの汎用性は配布可否の判断材料にしない。

この基準はIssue #290（自己テストジョブの分離、`.github/workflows/agent-skill-chain-self-test.yml`ヘッダコメント参照）で既に一度適用されていた判断を一般原則として明文化したものであり、新規の判断枠組みを発明するものではない。

**`agent-skill-chain-release.yml`の配布除外**: `.agent-skill-chain/templates/github/.github/workflows/agent-skill-chain-release.yml`を削除し、`.github/workflows/agent-skill-chain-release.yml`（本体リポジトリ直接管理）としてのみ存在させる。`verify-template-sync`（`src/lib/template-sync.ts`の`computeTemplateSyncDiffs`）は配布元→展開先の一方向差分検査（配布元に存在するファイルが展開先に存在し内容一致するかのみを検査し、展開先にのみ存在するファイルは検査対象に含めない）であるため、本体側だけに存在するファイルがあっても未同期として誤検知されない。この一方向検査の挙動は、既に本体専用ファイルとして分離済みの`agent-skill-chain-self-test.yml`が現に配布テンプレート側に存在しないままCIが緑であり続けている事実によって実証済みであり、本Issueのために`computeTemplateSyncDiffs`のロジックを変更する必要はない。

**`agent-skill-chain-root-cleanup.yml`のシークレット依存**: `secrets.RELEASE_MAIN_PAT`という名称は変更しない。この名称はADR-0007のDecision本文（accepted、本文は書き換え不可）に明記されており、改名するにはADR-0007をsupersedeする新ADRでその全文を再掲する必要がある。root-cleanupはconsumer側の任意機能（`main.json`のrequired status checksに含まれず、未設定でもPRマージ可否に影響しない）であり、改名によって得られる明確化の便益は、ADR-0007全文再掲という手続き上のコストに見合わない。代わりに、当該シークレットの要求内容・未設定時の挙動・対処方法を`.agent-skill-chain/standards/SECURITY_POLICY.md`（配布物、consumerへ`init`/`upgrade`で展開される）へ追記し、ドキュメント化のみでconsumer側の自己完結した理解を担保する。

加えて、`agent-skill-chain-root-cleanup.yml`のヘッダコメントは現状、シークレット再利用の由来として`agent-skill-chain-release.yml`をファイル名で名指ししている。上記の配布除外決定により、このファイルは今後すべてのconsumer配布物から消えるため、当該コメントを放置すると「配布物内に存在しないファイルを名指しする記述」が恒久的に残り、consumer側の自己完結した理解を損なう。ジョブ定義・トリガー・シークレット名・ステップ構成・`permissions`は一切変更せず、当該コメント中の`agent-skill-chain-release.yml`への名指し参照のみをファイル名に依存しない表現へ書き換える。これはSPEC.mdが定める「root-cleanup.ymlの内容変更（シークレット名以外）は対象外」の対象外条項が想定する運用ロジックの改変には該当しない、release.yml削除決定自体の不可避的な帰結である。

## Consequences

- `agent-skill-chain-release.yml`が今後の`init`/`upgrade`/`setup github`実行では一切配布されなくなり、consumerプロジェクトのCIへ本体専用のバージョンbump・タグ・GitHub Release作成ロジックが混入する実害が再発しなくなる。
- 配布境界の判定基準が本ADRに一般原則として確立されたことで、将来`.github/workflows/`へ新規ワークフローを追加する際に、都度個別判断するのではなく本ADRの基準（操作対象がconsumer自身のリポジトリ状態か、agent-skill-chain本体固有のライフサイクルか）を参照して機械的に配置先を決定できる。
- `verify-template-sync`・`computeTemplateSyncDiffs`のロジックは無変更のため、既存の同期検査の回帰リスクを負わない。本体リポジトリ自身の`agent-skill-chain / release`ワークフローも`.github/workflows/`に存在し続けるため、本体自身のリリース自動化に変更はない。
- 既に`init`/`upgrade`を実行済みで`agent-skill-chain-release.yml`を保有しているconsumerプロジェクトからの遡及的な削除は行わない（Issue #344 SPEC.mdのスコープ外）。当該consumerは本ADR適用後も手動で削除するまで当該ファイルを保持し続ける。
- `secrets.RELEASE_MAIN_PAT`という名称を`agent-skill-chain-root-cleanup.yml`に残したままにするため、名称単体からは「本体専用のように見えるがconsumerも独自にこの名前でPATを登録すればroot-cleanup機能を有効化できる」という誤解が完全には解消されない。この残余の分かりにくさは`SECURITY_POLICY.md`への追記で緩和するが、将来consumerからの実際の混乱報告が蓄積した場合は、ADR-0007をsupersedeする改名ADRを別途起票する余地を残す。
- `agent-skill-chain-root-cleanup.yml`ヘッダコメント中の`agent-skill-chain-release.yml`への名指し参照を書き換えることで、配布後のconsumerが当該コメントを読んでも存在しないファイルを参照する記述に遭遇しなくなる。ジョブ定義・トリガー・シークレット名・ステップ構成は無変更のため、この修正自体が新たな回帰リスクを持ち込むことはない。
