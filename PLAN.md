# PLAN: quickモード(size:quick)で4成果物ファイルの作成義務を免除する

- Issue: `ISSUE-425`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

DESIGN.md で定義した設計要素を、実際に本Issueのcommit（`8b8fcda5`）内で行った順序どおりに記述する。

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | ADR-0022の起票 | `docs/adr/ADR-0022-quick-mode-artifact-exemption.md`を`status: proposed`で新規作成し、シグナル置き場所の設計判断（成果物非依存の調整状態のみに置く）とガードレールの根拠を記録する | 要件全体の設計根拠 | なし |
| 2 | schema/labelsへ`size`シグナルを追加 | `.agent-skill-chain/schemas/state.schema.yaml`へ`size: quick\|standard`（既定standard）を追加、`.agent-skill-chain/templates/github/provisioning/labels.yaml`へ`size:quick`ラベル定義を追加 | シグナル置き場所 | `#1` |
| 3 | `quick-mode.ts`本体の実装 | `src/lib/quick-mode.ts`を新規作成し、`QUICK_SIZE_LABEL`・`QUICK_EXEMPT_OUTPUTS`・`GUARDRAIL_PATHS`・`riskFromLabels`・`readSignalFromGitHub`/`readSignalFromLocalState`・`changedPaths`/`pathsFromPorcelainLine`・`resolveQuickMode`・`quickBlockedNotice`を実装する | 免除される成果物、ガードレール、commit前差分の合算 | `#2` |
| 4 | `verify.ts`への統合 | `src/commands/verify.ts`の`artifacts()`内で`resolveQuickMode()`を呼び、`quick.exempt`のとき`def.outputs`から`QUICK_EXEMPT_OUTPUTS`を除外してから存在検査する。免除対象外時は`quickBlockedNotice()`を標準エラーへ出力する | 免除される成果物、既定挙動の非変更 | `#3` |
| 5 | `issue.ts`への`--size`オプション追加 | `src/commands/issue.ts`の`parseStartArgs`/`start()`へ`--size`オプションを追加し、`quick\|standard`以外は`CliError`、未指定時は`state.yaml`へフィールド自体を書かない（既定standardとの後方互換） | ローカルモードのシグナル記録 | `#2` |
| 6 | AGENTS.mdへの追記 | AGENTS.md §4セグメント・4ゲート に quick の定義・免除条件・ガードレールを2行で追記する（150行上限内） | 規範文書としての追跡可能性 | `#1〜#5` |
| 7 | テストの追加 | `test/helpers/gh-stub.ts`へラベル読み取りのstub拡張、`test/integration/issue-lifecycle.test.ts`へ`--size`オプションの検証、`test/integration/verify.test.ts`へ (a) 既定（ラベル無し・size未設定）では免除されないこと、(b) `size:quick`かつ`risk:normal`かつガードレール非抵触で免除されること、(c) `risk`が`normal`以外・ADR差分・segments.yaml等の差分いずれかで免除されないことを固定化するテストを追加する | 完了条件の自動テスト化 | `#4, #5` |
| 8 | design segment検出によるDESIGN.md/PLAN.md追加 | `docs/adr/*`を含む差分により`detect-changed-segments.sh`が`design`セグメントを検出し`verify-artifacts.sh`がDESIGN.md/PLAN.mdを要求するため、実施済みの設計・実装内容を事後的にDESIGN.md/PLAN.mdへ記述して追加する | I1追跡可能性 | `#1〜#7` |

<!-- 変更単位を追加する場合は # を連番で追加する -->

## 実装順序の見直しについて

実装中に作業順序（上記の変更単位の並び）のみを見直す場合は、本ファイルのみを更新すればよい。設計要素・責務・境界そのものを変更する場合は、DESIGN.md の更新（および設計ゲートの再通過）が必要になる点に注意する。

なお本Issueでは、design-gate通過後にverify-artifacts CI（PR差分に`docs/adr/*`が含まれることで`design`セグメントが検出され、`DESIGN.md`・`PLAN.md`の存在が必須成果物として要求される検査）の失敗を受け、本ファイルおよび`DESIGN.md`をコード実装（`#1`〜`#7`）の完了後に追加で作成した（Issue #354のPLAN.mdと同種の事後transcription）。これは実装順序自体の変更ではなく、実施済みの設計・実装内容をDESIGN.md/PLAN.mdへ事後的に記述したものである。
