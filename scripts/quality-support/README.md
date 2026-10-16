# base品質検査の互換依存

このディレクトリは`check_project_quality.ts`と`check_source_quality.ts`が使用する最小の旧検査依存を保持する。v0.5の実行モデル、CLI、利用者向けSkillではない。npm配布物には含めない。

candidateが自分の品質・権限契約を緩和したことを自己承認しないため、既存base CIとの移行を完了するまで保持する。検査契約を変更する場合はtrusted側の登録・独立レビューと照合する。旧Step runtimeを再導入する入口として使用しない。

旧データ形式に結び付く関数も含むため、単に削除して検査を通過させない。不要な依存の削減とbase契約の移行は未完了である。

`legacy-policy-metadata.json`は旧policy schemaを解釈する互換検査専用メタデータである（origin/mainの0.4.4-managed-by-tagから抽出）。製品versionはroot package.jsonだけが所有する。
