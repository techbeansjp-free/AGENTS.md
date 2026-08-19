# PLAN: Codex ゲートレビュアの起動失敗を安全に診断可能にする

- Issue: `ISSUE-744`
- 対応する DESIGN: `DESIGN.md`

## 実装方針・変更境界

実装は既存の adapter と統合テストへ閉じ、設定スキーマ、gate verdict schema、accepted SPEC / ADR は
変更しない。raw stderr の捕捉と分類を先に完成させ、その出力だけを lifecycle と model 解決へ結線する。
各変更単位で既存の never-approved と cleanup を維持する。

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | bounded stderr sink | 共有隔離 runner に64 KiB上限、超過フラグ、drain、全経路cleanupを追加 | `AC-2, AC-3, AC-8` | なし |
| 2 | 固定分類とenvelope | 4分類、静的code、allowlist検証、4 KiB上限、安全側縮退を追加 | `AC-1, AC-2, AC-3, AC-4` | `#1` |
| 3 | lifecycle 結線 | retryの最後の分類、rc、実試行回数をfail-safeへ渡し成功時は破棄 | `AC-1, AC-4, AC-8` | `#2` |
| 4 | non-core model 解決 | 明示overrideを最優先し、未指定時の`gpt-5.6`をconcrete defaultへ置換 | `AC-5, AC-6` | `#2` |
| 5 | core 境界の回帰防止 | policy値・reasoning・command attestationの既存分岐を維持しテスト固定 | `AC-7, AC-8` | `#4` |
| 6 | 統合テスト | 分類、境界、秘密値、cleanup、retry、timeout、model選択をstubで網羅 | `AC-1`〜`AC-8` | `#1`〜`#5` |

## 変更対象

- `.agent-skill-chain/adapters/claude.sh`: 共有隔離 runner の bounded sink、分類、cleanup、lifecycle 結線。
- `.agent-skill-chain/adapters/codex.sh`: non-core model の優先順位と診断 context。
- `test/integration/gate-adapters.test.ts`: Codex reviewer の診断、model、fail-safe 回帰。
- 必要な場合のみ既存の credential 隔離統合テストへ cleanup / secret 非残存の観測を追加する。

新しい設定項目、provider discovery helper、Claude 固有の分岐、実サービス fixture は追加しない。

## テスト設計

### 診断分類

- model unavailable、authentication failure、timeout、未知の非ゼロを別々の固定 stderr fixture で注入する。
- raw stderr の任意断片が診断へ転載されず、分類・rc・attemptsだけが観測できることを assert する。
- 未知の文面は `EXECUTION_FAILURE` へ縮退し、exit 0 や approved にならないことを assert する。

### 境界と秘密値

- 64 KiBちょうど、64 KiB+1、大量 stderr を注入し、保存上限と超過フラグを検査する。
- 偽token、偽認証JSON、環境由来の偽資格情報を stderr へ混在させ、外部出力と残存ファイルを走査する。
- 診断 envelope の検証失敗を注入し、分類と rc だけへ縮退することを検査する。

### model と既存契約

- 明示 `CODEX_REVIEWER_MODEL` が無改変で reviewer command と evidence metadata へ渡ることを検査する。
- non-core 未指定時に `gpt-5.6` を command へ含めず、concrete default の利用不能を専用codeにする。
- core policy 不一致、command override attestation 不足、認証失敗、timeout、retry、成功 verdict を再検査する。
- 全経路で隔離 root が削除され、成功時の verdict と既存終了コードが変わらないことを検査する。

## 検査順序

1. 変更した統合テストを単独実行し、失敗分類と境界条件を短いサイクルで確認する。
2. `npm run build`、`npm run typecheck`、`npm test` を実行する。
3. secret scan、`lint-vocab.sh`、`lint-references.sh`、ADR・文書長・設計図検査を実行する。
4. `git diff --check` と変更パスを確認し、accepted SPEC / ADR と対象外パスが無変更であることを確認する。

## ロールバック・作業再開

bounded sink、分類、lifecycle 結線、model 既定は分離して実装するが、失敗診断が半端な状態で有効に
ならないよう1つの implementation checkpoint として push する。中断時は最初に変更パスとテスト結果を
確認し、raw stderr が隔離外へ出る中間状態では commit しない。ロールバックは当該 checkpoint 全体を戻す。

## 完了条件・対象外

全ACの自動テスト、build、型検査、全件テスト、secret scan、適用lintが成功し、既存 gate fail-safe と
core attestationに回帰がないことを完了条件とする。実サービス疎通、実資格情報、prompt入力閉包、
verdict stdout検査、Claude固有挙動、provider CLI将来互換は実装計画へ追加しない。

## 実装順序の見直しについて

実装中に順序だけを変更する場合は本ファイルを更新する。責務境界、分類集合、model優先順位、
安全側縮退を変える場合はDESIGN.mdを更新し、設計ゲートを再通過する。
