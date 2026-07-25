# PLAN: trusted gate recordingとreport materialization

- Issue: `ISSUE-283`
- 対応する DESIGN: `DESIGN.md`

## 実装順序・変更単位

| # | 変更単位 | 内容 | 対応 AC-ID | 依存 |
|---|---|---|---|---|
| 1 | v3連携 | #274のattempt/evidence/report型をtrusted recorderから再利用する | AC-1, AC-3 | なし |
| 2 | trusted record CLI | actor・PR・SHA・gate・ruleset・App・artifactを検証してCheckを二段階更新する | AC-1〜AC-3 | #1 |
| 3 | durable output | report/evidence digest/provenanceをCheck outputへ保存し、発行後に再読取する | AC-1〜AC-3 | #2 |
| 4 | materialize CLI | same-App最新runだけを再検証し、成功reportを非正本cacheへ復元する | AC-1, AC-2 | #3 |
| 5 | ADR finalization連携 | GitHubモードでcache欠落時にtrusted materializeを要求しdigest照合を維持する | AC-1 | #4 |
| 6 | workflow・配布 | repository_dispatch workflow、local dispatch、template/root同期を実装する | AC-1, AC-4 | #2 |
| 7 | 反証テスト | stale、gate、権限、attempt、App、旧success fallback、artifact改変を検証する | AC-1〜AC-4 | #1〜#6 |
| 8 | bootstrap証跡 | #274固定SHAのowner承認・review・CI・実行情報を耐久記録する | AC-5 | 全検証 |

## テスト設計

- unit: gate/profile/permission enum、latest attempt、canonical evidence digest、latest Check選択、report encoding。
- integration: GitHub API stubで正常success、rejected/action_required、stale SHA、不正gate、read権限、wrong Appを検証。
- regression: 同一SHAのsuccess後にfailure/action_requiredを追加し、materializeが旧successを拒否する。
- distribution: root workflowとテンプレート同期、setup/upgrade後の存在、AI/API secret参照不在を検査する。
- hybrid: #274固定SHA・Sol/xhigh最終判定・requiredでないCI・owner承認・admin merge結果をPRへ記録する。

## 実装順序の見直し

順序だけの変更はPLANを更新する。信頼境界、Check正本、bootstrap対象を変える場合はDESIGNとdesign gateを更新する。
