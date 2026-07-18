# 進捗ステータス（セッション再開用メモ・過渡的スクラッチ）

最終更新: 2026-07-18（Phase 4 PR作成完了時点）

## 全体像
fableによる`.agent-skill-chain`フレームワーク徹底レビュー(112件) → 独立検証(opus, 7領域) → 採用68/採用(要設計判断)39/見送り5で確定 → 見送り除く107件を6パッケージに分割 → 各パッケージGitHub Issue化 → 設計+実装前レビュー(全て承認済み) → **実装まで完了** → **7件のPR作成完了(#149〜#155)**。**残りはレビュー対応〜マージ〜close移動**。

## 完了フェーズ
- [x] Phase 0: fable7領域レビュー → opus独立検証 → `02_対応方針.md`確定
- [x] Phase 1: 6サブissue起票 + GitHub Issue化(#143〜#148) + frontmatter書き戻し
- [x] Phase 2: 6パッケージ設計+実装前レビュー(`02_設計.md`) → ユーザーが全15件の要確認ポイントを「推奨案どおり進める」で承認済み
- [x] Phase 3: 6パッケージ並列実装 → 各専用worktree/ブランチで実装・自己レビュー・コミット完了
- [x] Phase 4a: 7ブランチ全てpush + PR作成完了(下表参照)
- [ ] Phase 4b: CIチェック・CodeRabbit等レビュー対応 → ユーザー確認のうえマージ（**未着手**）
- [ ] Phase 5: 親issue(`docs/maintainer/workflow/20260718_025331_fableシステムレビュー/`)をclose/へ移動（**未着手**）

## 作成済みPR一覧
| PR | 対応Issue | 内容 |
|---|---|---|
| [#149](https://github.com/techbeansjp-free/AGENTS.md/pull/149) | Closes #143 | 起動契約・コマンド・ワークフロー・スキル整合(39件) |
| [#150](https://github.com/techbeansjp-free/AGENTS.md/pull/150) | Closes #144 | enforcement機構の実効性強化(9件) |
| [#151](https://github.com/techbeansjp-free/AGENTS.md/pull/151) | Closes #145 | 台帳・記録(ledger/scribe)の整合強化(19件、HEARTBEAT.md共有あり) |
| [#152](https://github.com/techbeansjp-free/AGENTS.md/pull/152) | Closes #146 | 運用スクリプトのバグ修正(14件) |
| [#153](https://github.com/techbeansjp-free/AGENTS.md/pull/153) | Closes #147 | プロジェクト固有上書き・モデル選定方針の整合(14件) |
| [#154](https://github.com/techbeansjp-free/AGENTS.md/pull/154) | Closes #148 | 自己拡張ワークフロー.mdの構造是正(12件) |
| [#155](https://github.com/techbeansjp-free/AGENTS.md/pull/155) | (issue紐付けなし) | レビュー記録一式(親issue+6サブissueドキュメント) |

## HEARTBEAT.md共有編集の検証結果(2026-07-18)
- PR #149(A-17)とPR #151(D-15)は同一ファイル`HEARTBEAT.md`の**非隣接行**を編集(#149: 3行目・47行目、#151: 11〜37行目・末尾追記)。
- `git merge-tree --write-tree --merge-base=483fbfe d72366b 289fd57`で自動マージを事前検証済み → **競合なし、クリーンにマージ可能**。
- よって**手動rebaseは不要**。どちらを先にマージしても後発側は無変更でマージ可能な見込み。念のためGitHub上のmergeable状態も確認してから進める。

## レビュー・トラッキング用worktree（実装ではなくドキュメント管理）
- パス: `/home/adachi/projects/AGENTS.md/.worktree/chore/20260718_025331-fableシステムレビュー/`
- ブランチ: `chore/20260718_025331-fableシステムレビュー`
- 最新commit: `f28a824`（本ファイル更新分含む）
- 内容: `docs/maintainer/workflow/20260718_025331_fableシステムレビュー/` 配下に親issue(00/01/02/90_issues.md) + 6サブissue(各00/02/03/04)
- **push・PR #155 作成済み**

## 6パッケージの実装worktree（各mainから新規ブランチ、実装・自己レビュー・コミット・push・PR作成済み）

| # | GitHub Issue | 実装worktreeパス | ブランチ | commit | 件数 |
|---|---|---|---|---|---|
| 1 | [#143](https://github.com/techbeansjp-free/AGENTS.md/issues/143) 起動契約・コマンド・ワークフロー・スキル整合 | `.worktree/chore/20260718_092843-起動契約コマンドワークフロー整合/` | `chore/20260718_092843-起動契約コマンドワークフロー整合` | `d72366b` | 39件(A-1〜10,12〜19,B-1〜21) |
| 2 | [#144](https://github.com/techbeansjp-free/AGENTS.md/issues/144) enforcement機構の実効性強化 | `.worktree/bugfix/20260718_092843-enforcement機構実効性強化/` | `bugfix/20260718_092843-enforcement機構実効性強化` | `549bd13` | 9件(C-1〜9) |
| 3 | [#145](https://github.com/techbeansjp-free/AGENTS.md/issues/145) 台帳・記録(ledger/scribe)の整合強化 | `.worktree/bugfix/20260718_092843-台帳記録整合強化/` | `bugfix/20260718_092843-台帳記録整合強化` | `289fd57` | 19件(D-1〜7,9,10,13〜16,18,E-2,3,10,14,20) |
| 4 | [#146](https://github.com/techbeansjp-free/AGENTS.md/issues/146) 運用スクリプトのバグ修正 | `.worktree/bugfix/20260718_092843-運用スクリプトバグ修正/` | `bugfix/20260718_092843-運用スクリプトバグ修正` | `b2c4783` | 14件(E-1,4〜7,9,11〜13,15〜19) |
| 5 | [#147](https://github.com/techbeansjp-free/AGENTS.md/issues/147) プロジェクト固有上書き・モデル選定方針の整合 | `.worktree/chore/20260718_092843-プロジェクト上書きモデル選定整合/` | `chore/20260718_092843-プロジェクト上書きモデル選定整合` | `8d844ea` | 14件(F-1〜12,D-11,12) |
| 6 | [#148](https://github.com/techbeansjp-free/AGENTS.md/issues/148) 自己拡張ワークフロー.mdの構造是正 | `.worktree/chore/20260718_092843-自己拡張ワークフロー構造是正/` | `chore/20260718_092843-自己拡張ワークフロー構造是正` | `0ab882a` | 12件(G-1〜12) |

## 既知の要注意事項（次フェーズで対応）
1. **HEARTBEAT.md共有**: PR #149(A-17)とPR #151(D-15)が同ファイルを別行で編集。`git merge-tree`で自動マージ検証済み・競合なし（上記参照）。手動rebaseは不要見込みだが、GitHub上のmergeable状態は念のため確認する。
2. 各PRの本文に`Closes #<対応するIssue番号>`を含めた（自己拡張ワークフロー.md §6 PRトレーラ規約）。PR #155(レビュー記録)はissue紐付けなし。
3. **マージはユーザー確認のうえ進行役が実行**（ブランチ保護blocked時は`--admin`使用、標準運用として承認済み）。
4. 7件全てpush・PR作成済み。次はCIステータス・CodeRabbit等のレビュー指摘の確認。

## 次回セッションで最初にやること
1. `gh pr checks <PR番号>`または`gh pr view <PR番号>`で各PR(#149〜#155)のCI・mergeable状態を確認。
2. CodeRabbit等のレビュー指摘があれば対応し、ユーザー確認のうえマージ（推奨順: #149→#151の順でHEARTBEAT.md競合を避ける。他は順不同）。
3. 全マージ後、親issueをclose/へ移動。
