---
name: step-04-issue-sync
description: 検証済み要求・要件を事前確認後に同じ耐久トラッカーへ同期し、読み取りで一致を検証する。
---

# ステップ4: 耐久トラッカー同期

`workflow record --step=4`の`--evidence`には、読み戻しで一致した64桁のhex digestと`sync`語を含める。

入力は検証済み`quick`または`poc`の00、あるいは開始可能性確認済み`full`の00/01、正確なリポジトリ・トラッカー、事前表示、承認。`poc`はPoCであること、期限、停止点を保持し、正式開発やreleaseのトラッカーとして同期しない。成果物は同じ耐久Issue・トラッカーと書き込み後読み取り検証。本文は`issue sync --generate-body --staging-path=<同じstaging> --checkpoint=4`で検証済み成果物から生成する。project policyが`staging.issueBody=pointer`を宣言するprojectでは、生成本文は成果物全文の連結ではなく、目的・受け入れ条件・成果物の配置（repository相対path）とdigestだけになる。pointerは`staging.tracked=true`の版管理下stagingにだけ許され、計画文書の全文はそのstagingをcommitしたものが正本になる。宣言rootへ移行する前に既定rootへ作ったstagingは全文を同期する。読み戻し検証と`sync-verified`の判定方法は変わらない。quickとpocでは一致したbody digest、tracker、同期時刻、checkpoint 4をstaging記録へ原子的に保存して再読取し、`sync-verified`とする。通常のfullでは生成入力としてstagingとcheckpointを渡してもStep 4を最終同期証拠にせず、`local-active`を保持する。quick/pocから昇格した`promotion-active`では保存済みtrackerと対象Issueの一致を外部副作用前に強制し、同期記録を更新せず`promotion-active / checkpoint=4`を維持する。同期確認後に`workflow record --step=4`でtrackerをartifact、digest一致をevidenceとしてjournalへ追記する。CLIアダプターを使い、このスキルから`gh`を呼ばない。GitHub不在時は現在のセッションでローカル継続できるが、別セッションから再開可能と報告しない。

**canonical Issueを作ってよい時点は[起票時点と計画単位](../../docs/01_開発ワークフロー.md#起票時点と計画単位)が定める。** 本Stepは既存Issueへ同期する工程であり、規律の本文をここへ複製しない。

**同期は本文を全面置換する。** 既存Issueにチェックリストや進捗記録がある場合は、`agent-skill-chain issue read --issue=<番号> --repo=<owner/name>`で更新前本文と`bodySha256`を取得し、**保全すべき内容を新しい本文へ取り込むか、別の場所へ退避してから同期する。** `issue read`は読み取り専用で`--apply`も`--authorize`も要らず、`repository read`だけで成立する。**この経路があるため、本skillから`gh`を呼ばずに既存本文を保全できる。**

同期前の構造検証には`agent-skill-chain issue validate --path=<directory> --stage=requirements`を使う。fullではStep 4時点の`00_要求定義.md`と`01_要件定義.md`だけを要求し、quickとpocでは00へ集約した全内容を従来どおり検証する。段階にかかわらずGherkin scenario IDを必須とする。

同期確認後、trusted project policyに`issueProject`が設定されている場合は、同じcanonical Issueとstagingを指定して`issue start --dry-run`を確認し、書き込み承認を得た`--apply --authorize=approved`でProject追加と着手Status更新を行う。`started`のread-backまでをIssue着手とし、未設定時の`not-configured`はprovider callなしで従来運用を維持する。候補branchの設定を当該操作のauthorityにせず、このskillから`gh`を直接呼ばない。

## テンプレート契約

直接使用するテンプレートはない。このステップは、各modeの前工程でテンプレートに従って検証済みとなった成果物を内容正本として同期し、別構成へ再生成しない。
