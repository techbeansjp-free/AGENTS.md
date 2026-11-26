# merge許可の細則

[許可されたmerge](../SKILL.md#許可されたmerge)と[進め方の原則](../SKILL.md#進め方の原則)の2の細則。mergeの前と、auto-merge等があり得るDraftの提出で読む。許可を広げない。記録された「常に許可」とその取消しは[merge許可の記録と取消し](merge-grant.md)。

## 起動する構成の判定

次の2つの判定は同じ手順で行う。

- **merge→release**：mergeがrelease・本番反映を自動で起動するか（マージ先branchへの自動deploy等）。証跡は、マージ先branchのCI定義、repository内の設定file、読める範囲のrepositoryの設定、マージ先branchの最近のmerge commitに付いたdeployment・commit status・check run。
- **提出→merge**：PRの提出やDraftの解除がauto-merge・merge bot等でmergeを起動するか。証跡は、merge botの設定file・auto-mergeの設定等。

(a) Agentが読める証跡に起動の痕跡があれば、起動する構成とする。利用者が起動しないと述べても証跡を採り、食い違いを報告する。

(b) 痕跡がなく、証跡を読めた場合（merge→releaseではCI定義と最近のmerge commitの記録をどちらも読めた場合）、または利用者が現在の会話で起動しないと明示した場合（「自動release・本番反映はない」等）は、起動しない構成とする。merge→releaseでは、確かめた範囲と読めなかった項目を報告に書く。

(c) それ以外は確認できない場合とし、起動する構成として扱う。merge→releaseでは未確認であることを報告する。提出→mergeではDraftのままにする（[Draftとauto-merge](#draftとauto-merge)）。

compactionで原文を確かめられない利用者の明示は、どちらの判定にも使わない。

## Draftとauto-merge

提出→mergeが起動する構成（確認できない場合を含む）では、そのPRをDraftのまま提出し、mergeの許可があってもDraftの解除は行わず、利用者へ報告する。解除によるmergeでは期待HEAD拘束を使えず、確認の後に他者がpushした未確認のHEADがmergeされ得るためである。この構成ではmergeの許可を求めない。

報告には、確認済みのHEADと、利用者がDraftを解除すればmergeされること（確認できなかった場合はmergeされ得ることと読めなかった項目）を書く。mergeがrelease・本番反映を起動するかも[起動する構成の判定](#起動する構成の判定)のとおり決め、起動する構成ではその旨を、確認できない場合は起動し得ることと未確認の項目を書く。

## mergeとreleaseの問い方

後で必要になるmerge・releaseの許可を他の問いと同じ回にまとめて求めるとき（Draftの解除がmergeを起動する構成のmergeを除く）は、その問いの前にmerge→releaseを[判定](#起動する構成の判定)する。

- 問いの中に、対象と段階（Issueごと・常に許可）と、release・本番反映を含めるかを書く。
- 一覧への一括の回答（「全部推奨どおり」等）で認めるのは、問いに書いた対象のIssueごとのmergeまでとする。release・本番反映を含めることと「常に許可」は、利用者がその問いに個別に答えた場合だけ許可とする。
- これらの問いの推奨案は、release・本番反映を含めない・Issueごとの段階とする。
- merge→releaseが起動する構成では、release・本番反映を含めるかを同じ1回の問いで聞く。release・本番反映を含めない回答ではmergeせずPRの提出で止めることを問いに書き、release・本番反映を含めるmergeの許可を個別に答えられる形にする。
- 未決事項としての「リリースの可否」「本番反映の可否」が一括の回答で決まっても、release・本番反映の操作の許可にはせず、その許可は上の個別の回答で得る。Agentはこれらの未決事項の推奨案に、release・本番反映を行う案を置かない。
