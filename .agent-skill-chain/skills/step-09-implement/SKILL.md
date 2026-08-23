# ステップ9: 専用worktreeでの実装

入力は検証済みトラッカーと明示した基点。成果物は専用ブランチ・worktree、失敗するGherkinの証拠、最小コード、合格したプロジェクトテスト一式、必要な`docs/specs/`変更。作業元の変更状態を検査して同一に保持し、暗黙のstash・reset・checkout・clean・deleteをしない。テストは一時リポジトリ・模擬処理だけを使い、実リモート・他のworktreeを変更しない。
