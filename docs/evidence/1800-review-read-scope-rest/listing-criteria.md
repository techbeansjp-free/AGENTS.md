# Claude Code経路の一覧所属の判定基準（測定前に固定）

起動先を対象worktreeにする案（以下W）が、現行（起動先は主要checkout、以下P）の一覧所属を保つかを、次の5項目で判定する。全項目でPと同じ結果なら「保てる」、1つでも劣れば「保てない」とする。

1. 完了時の改名（`済: 自動: …`）が`host-session`と同じ手順で成功する。
2. 主要checkoutから、実行IDで`--resume`できる。
3. 主要checkoutから、表示名（`済: 自動: …`）で`--resume`できる。
4. 対象worktreeを`git worktree remove`で削除した後も、2と3が成り立つ（ASCはmerge後にworktreeを削除する）。
5. sessionの保存先project（Hostがproject単位で一覧を作る単位）が主要checkoutである。

測定は合成fixtureだけで行い、modelはhaikuを使う。保存されたsessionは測定後に`claude purge <fixtureのpath>`で削除する。
