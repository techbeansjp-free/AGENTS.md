---
name: step-04-issue-sync
description: 検証済み要求・要件を事前確認後に同じ耐久トラッカーへ同期し、読み取りで一致を検証する。
---

# ステップ4: 耐久トラッカー同期

入力は検証済み`quick`または`poc`の00、あるいは開始可能性確認済み`full`の00/01、正確なリポジトリ・トラッカー、事前表示、承認。`poc`はPoCであること、期限、停止点を保持し、正式開発やreleaseのトラッカーとして同期しない。成果物は同じ耐久Issue・トラッカーと書き込み後読み取り検証。quickとpocでは一致したbody digest、tracker、同期時刻、checkpoint 4をstaging記録へ原子的に保存して再読取し、`sync-verified`とする。fullではStep 4を最終同期証拠にせず、`local-active`を保持する。**このためfullのStep 4では`issue sync`へ`--staging-path`と`--checkpoint`を渡さない。**渡すと最終同期として記録しようとして拒否される。同期確認後に`workflow record --step=4`でtrackerをartifact、digest一致をevidenceとしてjournalへ追記する。CLIアダプターを使い、このスキルから`gh`を呼ばない。GitHub不在時は現在のセッションでローカル継続できるが、別セッションから再開可能と報告しない。

同期前の構造検証には`agent-skill-chain issue validate --path=<directory> --stage=requirements`を使う。fullではStep 4時点の`00_要求定義.md`と`01_要件定義.md`だけを要求し、quickとpocでは00へ集約した全内容を従来どおり検証する。段階にかかわらずGherkin scenario IDを必須とする。

## テンプレート契約

直接使用するテンプレートはない。このステップは、各modeの前工程でテンプレートに従って検証済みとなった成果物を内容正本として同期し、別構成へ再生成しない。
