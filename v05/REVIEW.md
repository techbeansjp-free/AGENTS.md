# v0.5 本体統合レビュー

このディレクトリは別リポジトリで開発したGoal・Contract・Evidence駆動ハーネスを、本体でレビューするための移植です。元の標準CLI・v0.4の配布・PR #1577は変更しません。正式切替とリリースは未完了です。

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

移植先でLinux隔離・cgroupを含むNode 195テストが成功しました（106.06秒、skip 0）。本体ESLintへの適合としてNode globalsを宣言し、未使用引数と空catchを整理しています。元hashと移植時変更後hashを分けて記録しています。

## 未達

本体の既存品質チェックとの統合、正式配布入口の切替、OS別whole-Agent隔離、最終PR/CI性能比較、外部レビュー製品との品質比較は完了していません。Draftのまま検分し、merge/releaseしないでください。
