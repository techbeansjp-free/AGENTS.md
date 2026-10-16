# v0.5 本体統合レビュー

このディレクトリはGoal・Contract・Evidence駆動のv0.5実装です。本体の標準CLIと配布対象はv0.5へ切り替え済みで、v0.4を呼び出すfallbackはありません。旧実装は移行・回帰確認用にリポジトリへ残っていますが、標準配布・標準テストの実行対象ではありません。PR #1577は凍結を維持します。リポジトリの必須CI契約移行と正式リリース判定は未完了です。

読む順序は README.md、src/controller.mjs、src/workflow.mjs、Goal/Issue関連実装、対応するtest_*.mjs、MIGRATION_PLAN.md です。固定Step列を再現せず、必要な作業と独立レビューを選択します。

`IMPORT_PROVENANCE.json` は移植元commitと各fileのSHA256です。非公開の生ログや認証情報は含めません。`RELEASE_READINESS.json` は公開用の検証サマリーです。移植した過去の設計・利用文書にある実験Evidence参照や絶対パスは当時の検証環境を指し、このcheckoutに存在するとは限りません。

## 検証

```sh
cd v05
npm test
# Linuxのcgroup/systemd境界も検証できる環境では
ASC_TEST_CGROUP=1 npm test
# 未承認の正式名tarball候補を作る（公開しない）
node scripts/pack-candidate.mjs /absolute/existing/output-directory
```

Node 20以上。Linuxの隔離テストはbubblewrap等を必要とします。macOS/Windowsの構造テストで `ASC_TEST_ISOLATION=0` を使うことは隔離受入成功を意味しません。

移植先でLinux隔離・cgroupを含むNode 195テストが成功しました（106.06秒、skip 0）。本体ESLintへの適合としてNode標準機能を明示的にimportし、未使用引数と空catchを整理しています。元hashと移植時変更後hashを分けて記録しています。

## 未達

旧品質チェックからLinux版の必須CI契約への移行、複雑ケースの完走・競合後の復旧、最終版の同条件性能受入が残っています。標準配布物の小規模Draft PR/CI完走とLinux隔離には実測がありますが、複雑ケース全体の合格には拡張しません。外部レビュー製品との比較はowner承認で将来課題へ変更しています。各試験の対象HEAD・成功・失敗・限定はRELEASE_READINESS.jsonを参照してください。Draftを維持し、merge/releaseしないでください。

## レビュー品質の評価用fixture

`evaluation/`には既存PoCから再利用した計算・認可・重大度前提・指示混入・SQLite永続化の合成fixtureを置きます。`test_review_corpus.mjs`でbaselineと21候補の期待結果・具体的な失敗理由を検証します。単なる非zero終了を欠陥検出と扱いません。重大度・指示混入の群は認可mutationを再利用するため、21種類の独立した欠陥という意味ではありません。

これは評価器の正しさの確認であり、AI ReviewerのPrecision/RecallやCodeRabbit等との同等性の証明ではありません。比較時は同じ候補・Intent・oracleを使用し、oracleと期待ラベルをReviewerへ渡さず、指摘を独立に裁定してください。環境失敗を欠陥の正検出に数えず、欠測をゼロにしません。通常の製品配布にこの評価用ディレクトリは含めません。

## 過去の統合実測（aa64d9e3）

Ubuntu24 CIは207成功・失敗0・skip0。新規公開合成fixtureのDraft PR/CIまで83.48秒・2 Agentで完走しました。setupは時間から除外し、旧private fixtureとの速度比較には使用しません。公開対象は新規合成5ファイルのみでprivate履歴・生ログは含めません。

既知欠陥・正常対照17試行の独立裁定はTP9/TN8/FP0/FN0でした。7種類の欠陥変異であり、指示混入群は認可変異を再利用しています。正解oracleはReviewerに渡していません。指摘はstatic-analysisで、実行再現は評価器と裁定者が担当しました。合成単発評価の範囲外の品質・外部製品同等性は未証明です。詳細な計数と制限はRELEASE_READINESS.jsonを参照してください。
