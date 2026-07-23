<!--
正本: AGENTS.md §4セグメント・4ゲート
このファイルは Issue 毎に複製して使う雛形である（セグメント: design、成果物: DESIGN.md（PLAN.md は別ファイル）、ゲート: design-gate）。
-->

# DESIGN: 診断: Issue #208マージ後にrelease/root-cleanupワークフローが起動しない原因調査

- Issue: `ISSUE-211`
- 対応する SPEC: `SPEC.md`

## 目的・対象範囲（要約）

本設計は、SPEC.md が定義する診断実験（`.github/workflows/` 配下を一切変更せず、かつ agent-skill-chain / release ワークフローの `on.push.paths` に最低1件一致する変更を実装し、`gh pr merge --admin --squash` でマージした上でワークフロー起動有無を実地観測する）のうち、実装セグメントが担う「具体的な変更内容の確定」を行う。マージ後の起動観測（AC-2）・原因切り分けの結論記録（AC-3）は本設計の対象外であり、検証セグメント（VALIDATION.md）の責務とする。

## 用語

- **path フィルタ一致変更**: `.github/workflows/agent-skill-chain-release.yml` の `on.push.paths` に列挙されたパターン（`src/**`・`.agent-skill-chain/**`・`AGENTS.md`・`CLAUDE.md`・`docs/GLOSSARY.md`・`package.json`・`package-lock.json`・`tsconfig.json`・`tsconfig.test.json`）のいずれかにマッチするファイルパスへの変更。
- **副作用のない変更**: 実行時の入出力・判定結果・生成物を一切変えない変更（コメント追加・ドキュメントの字句修正等）。本設計ではこれを「シェルスクリプトのコメント行追加」に限定する。

## 要件 → 設計要素の対応表

| 要件 / AC-ID | 対応する設計要素 | 備考 |
|---|---|---|
| AC-1 | `.agent-skill-chain/scripts/doctor.sh` へのコメント行1行追加 | `.agent-skill-chain/**` に一致し、かつ `.github/workflows/` 配下を含まない |
| 要件1 | 「選定した変更内容」節・「制約」節 | 実装コード（`src/`）・`.github/workflows/`・SPEC.md 承認済み内容には一切触れない |
| AC-2・AC-3 | 対象外（検証セグメントの責務） | 本設計はマージ実行・観測・結論記録を行わない。実装セグメントは変更をcommit・pushするところまでを完了条件とする |

## 選定した変更内容

- **対象ファイル**: `.agent-skill-chain/scripts/doctor.sh`
- **変更内容**: 既存のヘッダコメント（3行目「環境診断（...）を検査する。」の直後）に、`本スクリプトは読み取り専用の診断であり、リポジトリの状態を変更しない。` という1行のコメントを追加する。
- **変更しないもの**: `set -euo pipefail` 以降の実行ロジック（CLI解決・`exec` 呼び出し）は一切変更しない。シェルコメント行の追加は解釈・実行結果に影響しないため、スクリプトの入出力・終了コード・副作用は変更前後で完全に同一である。
- **選定理由**:
  1. `.agent-skill-chain/**` 配下であり、要件1（`.github/workflows/` 配下を含まないこと）を満たす。
  2. `.agent-skill-chain/**` は agent-skill-chain / release ワークフローの `on.push.paths` に含まれるため、AC-1 の path フィルタ一致条件を満たす。
  3. 追加するコメント内容は `doctor.sh` の実装（`exec "${CLI[@]}" doctor "$@"` のみで、ファイル書込み・git操作・外部API呼び出しを一切行わない）と整合しており、事実として正しい恒久的なドキュメンテーションであり、診断実験のためだけの一時的な記述ではない。
  4. コメント追加はシェルスクリプトの実行内容を一切変えない、既知の副作用ゼロな変更である。

## 却下した代替案

- **案A: `.agent-skill-chain/standards/*.md` の誤字修正。** 目視確認の結果、現行の `GIT_CONVENTIONS.md`・`SECURITY_POLICY.md`・`TEST_POLICY.md` に修正すべき誤字は見当たらなかった。実在しない誤字を捏造して修正する体裁を取ることは成果物の正確性を損なうため却下する。
- **案B: 実装コード（`src/`）へのコメント追加。** SPEC.md 対象外（要件5相当の趣旨、実装コード自体には触れない）であり、また本 Issue の設計判断が実装ロジックの変更可否を判断する必要がある種類の変更ではないため、より安全な `.agent-skill-chain/**` 内のスクリプトコメントを選定した。
- **案C: `AGENTS.md`/`CLAUDE.md`（root直下、path フィルタにも一致）への変更。** いずれも本システムの憲法・ランタイム設定であり、診断目的のためだけに恒久文書へ手を入れることは变更の重みに見合わない。`.agent-skill-chain/**` 配下の非中核ファイルの方がリスクが低い。

## 制約

- 実装セグメントが加える変更は `.agent-skill-chain/scripts/doctor.sh` のコメント行1行追加のみとし、他のファイルには一切触れない。
- `.github/workflows/` 配下は一切変更しない。
- `src/` 配下の実装コードは変更しない。
- SPEC.md の承認済み内容（目的・要求・要件・受入条件・スコープ外）は変更しない。
- ADR は作成しない（恒久的な設計判断を伴わない、単発の診断実験であるため）。

## 完了条件

- `.agent-skill-chain/scripts/doctor.sh` に上記1行のコメントが追加され、実装セグメントによって commit・push される。
- 追加後も `doctor.sh` の構文が正しいこと（`bash -n .agent-skill-chain/scripts/doctor.sh` が成功すること）。
- PR の差分が `.github/workflows/` 配下を含まないこと、かつ `.agent-skill-chain/**` に一致する変更を含むこと（AC-1 の機械チェック対象）。

## 検証方法見込み（SPEC.md AC-IDとの対応）

- AC-1: `automated`。PR差分に対し (1) `.github/workflows/` 配下の変更が0件であること、(2) `.agent-skill-chain/scripts/doctor.sh` の変更が含まれること、の2点を機械的に確認する。
- AC-2・AC-3: 本設計の対象外。SPEC.md の定義通り `manual` とし、検証手順・実行者・証跡は VALIDATION.md（検証セグメント）で確定する。

## 未決事項

- なし（本設計の範囲内では未決事項は生じない。AC-2・AC-3 の実地観測結果と原因切り分けの結論は検証セグメントで確定する）。

## 対象外

- マージ実行（`gh pr merge --admin --squash`）そのもの。
- マージ後のワークフロー起動観測（AC-2）。
- 原因切り分けの結論記録（AC-3）。
- 原因判明後の恒久対策の設計・実装（SPEC.md スコープ外により本設計でも対象外）。
