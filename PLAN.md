# PLAN: コア監査のモデル選択を Sol xhigh 必須へ更新する

- Issue: `ISSUE-271`
- 対応する DESIGN: `DESIGN.md`

## 目的・入力・出力

入力は承認対象の `SPEC.md` と本 branch の既存 policy・gate・adapter・workflow 実装である。出力は、登録済み model policy、分類器、adapter guard、backend marker、配布同期、テスト、検証証跡である。各変更単位は完了後に依存先へ進み、設計要素や責務を変更する必要が生じた場合は実装を止めて DESIGN を更新する。

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存する変更単位 |
|---|---|---|---|---|
| 1 | 規範と schema | manifest の構造化 model policy、登録済みモデル文書、project/state schema、監査 label を更新 | AC-1, AC-4, AC-6, AC-7 | なし |
| 2 | 分類器 | manifest 読み込み、audit marker、Git 差分、core path、分類不能の安全側判定を実装 | AC-1, AC-2, AC-5 | #1 |
| 3 | context と launcher | 判定結果を KEY=VALUE 化し、strict と未解決を起動前検査して adapter へ渡す | AC-2, AC-5 | #2 |
| 4 | adapter guard | Codex exact mapping と Claude model/attestation/probe、非コア互換を実装 | AC-3, AC-4, AC-5, AC-6 | #3 |
| 5 | GitHub 配布 | label/base/subject を workflow へ結線し、コア認証欠如を action_required 化して正本と展開先を同期 | AC-2, AC-5, AC-7 | #1, #3 |
| 6 | 自動テスト | policy/classifier/context/launcher/adapter/workflow/回帰テストを追加・更新 | AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7 | #1〜#5 |
| 7 | 独立検証 | 適用性判断、全検査ログ、AC ごとの証跡を `VALIDATION.md` に記録 | AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7 | #6 |

## checkpoint と writer lease

- design: `DESIGN.md`、`PLAN.md`、proposed ADR を commit/push。
- implementation: policy/schema/code/workflow/test を commit/push。
- validation: 保存済みテストログと純粋 YAML の `VALIDATION.md` を commit/push。
- segment 切替時に現 lease を解放して次の writer lease を取得し、同時 writer を作らない。

## テスト適用性

- 常時必須: lint/format、型検査、単体テスト、変更範囲の結合テスト、SAST、依存関係・secret scan。
- API・サービス境界: 非該当。外部 API request schema は変更しない。
- 認証・認可: adapter の credential 検査は変更するため、認証欠如と権限境界の結合テストを実施。
- 性能・DB・画面: 非該当。
- デプロイ・運用: workflow と配布同期を静的・結合検査。
- 外部連携: 実モデル API は hermetic test で起動 command と fail-safe を検査し、モデル可用性の実呼び出しは gate 実行環境へ委ねる。
- リリース単位: 全体 E2E と release rollback は本 Issue では実行せず、通常のリリース工程で行う。

## 完了条件・障害時

全 AC の自動証跡、全必須検査成功、3つの後続 checkpoint push、Draft PR の追跡が揃えば完了する。実装中に policy と provider CLI の表現を安全に結線できない場合は弱い設定へ降格せず、`human_required` を維持したまま blocked 報告する。

## 実装順序の見直しについて

作業順序だけの変更は本ファイルを更新する。設計要素・責務・境界、provider mapping、backend 正本を変更する場合は DESIGN.md も更新し、設計ゲート再通過の対象にする。
