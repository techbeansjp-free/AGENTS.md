# v0.5 本体統合レビュー

Goal・Contract・Evidence駆動のv0.5実装はルートの`src/`、CLIは`bin/`、テストは`test/`にあります。本体の標準CLIと配布対象はv0.5へ切り替え済みで、v0.4を呼び出すfallbackはありません。旧品質契約との接続用資産がリポジトリに残りますが、旧runtimeを配布・実行するものではありません。PR #1577は凍結を維持します。必須CI契約はv0.5の`linux`とbase validatorへ切り替え済みです。正式リリース判定は、受入記録の最終照合中です。

repositoryルートの`README.md`、`src/controller.mjs`、`src/workflow.mjs`、Goal/Issue関連実装、対応する`test/test_*.mjs`、`v05/MIGRATION_PLAN.md`を参照してください。固定Step列を再現せず、必要な作業と独立レビューを選択します。

`IMPORT_PROVENANCE.json` は移植元commitと各fileのSHA256です。非公開の生ログや認証情報は含めません。`RELEASE_READINESS.json` は公開用の検証サマリーです。移植した過去の設計・利用文書にある実験Evidence参照や絶対パスは当時の検証環境を指し、このcheckoutに存在するとは限りません。

## 検証

```sh
# repositoryルートで実行
npm run quality
# Linuxのcgroup/systemd境界も検証できる環境では
ASC_TEST_CGROUP=1 npm test
# 未承認の正式名tarball候補を作る（公開しない）
node scripts/pack-candidate.mjs /absolute/existing/output-directory
```

Node 20以上。Linuxの隔離テストはbubblewrap等を必要とします。macOS/Windowsの構造テストで `ASC_TEST_ISOLATION=0` を使うことは隔離受入成功を意味しません。

初回移植時にはLinux隔離・cgroupを含むNode 195テストが成功しました（106.06秒、skip 0）。本体ESLintへの適合としてNode標準機能を明示的にimportし、未使用引数と空catchを整理しています。元hashと移植時変更後hashを分けて記録しています。

## 未達

CI切替は完了しています。小規模Draft PR/CI、複数Work Unitの統合、Issue競合後の復旧、移行、性能測定の既存結果は、RELEASE_READINESS.jsonの`acceptanceEvidenceReuse`に対象と適用範囲を記録しています。画面提案・古い文書検出の歴史的試行は実Agentによるものですが、そのDelivery/CIはtest doubleであり、実行時の製品treeを固定した証拠ではありません。現在の実装・テストとの対応確認を含めて最終判定し、過去の成功を現行HEADの実走と表示しません。外部レビュー製品との比較はowner承認で将来課題へ変更しています。各試験の対象HEAD・成功・失敗・限定はRELEASE_READINESS.jsonを参照してください。Draftを維持し、merge/releaseしないでください。

## レビュー品質の評価用fixture

`evaluation/`には既存PoCから再利用した計算・認可・重大度前提・指示混入・SQLite永続化の合成fixtureを置きます。`test/test_review_corpus.mjs`でbaselineと21候補の期待結果・具体的な失敗理由を検証します。単なる非zero終了を欠陥検出と扱いません。重大度・指示混入の群は認可mutationを再利用するため、21種類の独立した欠陥という意味ではありません。

これは評価器の正しさの確認であり、AI ReviewerのPrecision/RecallやCodeRabbit等との同等性の証明ではありません。比較時は同じ候補・Intent・oracleを使用し、oracleと期待ラベルをReviewerへ渡さず、指摘を独立に裁定してください。環境失敗を欠陥の正検出に数えず、欠測をゼロにしません。通常の製品配布にこの評価用ディレクトリは含めません。

## 過去の統合実測（aa64d9e3）

Ubuntu24 CIは207成功・失敗0・skip0。新規公開合成fixtureのDraft PR/CIまで83.48秒・2 Agentで完走しました。setupは時間から除外し、旧private fixtureとの速度比較には使用しません。公開対象は新規合成5ファイルのみでprivate履歴・生ログは含めません。

既知欠陥・正常対照17試行の独立裁定はTP9/TN8/FP0/FN0でした。7種類の欠陥変異であり、指示混入群は認可変異を再利用しています。正解oracleはReviewerに渡していません。指摘はstatic-analysisで、実行再現は評価器と裁定者が担当しました。合成単発評価の範囲外の品質・外部製品同等性は未証明です。詳細な計数と制限はRELEASE_READINESS.jsonを参照してください。
