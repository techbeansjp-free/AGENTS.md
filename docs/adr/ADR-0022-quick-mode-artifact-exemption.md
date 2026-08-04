# ADR

```yaml
id: ADR-0022
status: proposed   # proposed | accepted | superseded | deprecated
title: quickモードの成果物免除シグナルを成果物非依存の調整状態へ置く
tags: [process, gate, artifacts, guardrail]
supersedes: []          # 例: [ADR-0007]（accepted 後は不変）
superseded-by: null      # 遷移時のみ書込可
deprecated-reason: null  # deprecated への遷移時のみ書込（1行）
```

## Context

全 Issue に対し4セグメント（要求・要件／設計・実装計画／実装／独立検証）それぞれの成果物ファイル
（`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`）の作成を一律に要求する運用は、誤字修正・
1行の設定変更・既存動作を変えない資料修正といった軽微な変更に対して不釣り合いである。軽量な変更向けに
これらの作成義務を免除する「quick」を正式に導入する必要が生じた。

免除の可否を機械的に判定するには「この Issue は quick か」というシグナルが必要になる。この設計には
過去に失敗例がある。本リポジトリが再設計以前に持っていた別のスキルチェーン方式にも同名の概念
（`mode: quick`）が存在したが、その機械可読な正本は要求定義ファイルの frontmatter に置かれており、
欠落時は standard 扱い（安全側）とされていた。結果として「要求定義ファイルを作らない軽量モード」を
成立させるために要求定義ファイルを作って frontmatter を書く必要があるという循環定義になり、
免除は原理的に一度も発動できなかった。独立レビューでこの欠陥が指摘されている。

同時に、免除の適用範囲が無制限であることも旧方式の欠陥だった。免除が判定規則そのもの（セグメント定義・
不変条件の正本・スキーマ）にまで及ぶと、quick を使って自身の規律を緩める自己参照的な悪用が成立してしまう。
また、ADR を要する判断は定義上「詳細に設計するほどでもない変更」ではない。

検討したトレードオフは次のとおり。

- シグナルを成果物ファイル内に置く案：他の記述と同居でき追加の調整状態を増やさない一方、上記の循環定義に
  そのまま該当するため採らない。
- シグナルを設定ファイル（`.agent-skill-chain/config/agent-skill-chain.yaml`）に置く案：Issue 単位ではなく
  リポジトリ単位の値になり、1 Issue = 1 判定という粒度を表現できないため採らない。
- シグナルを Coordination Backend のプリミティブに置く案：Issue ラベル（GitHub モード）と `state.yaml`
  （ローカルモード）はいずれも Issue 起票時点・worktree 作成時点、すなわちいかなる成果物の作成よりも
  前に確定できる。調整状態の正本は Coordination Backend にのみ存在するという既存の原則とも一致する。

## Decision

quick シグナルを、免除対象である成果物に一切依存しない調整状態のプリミティブにのみ置く。

- GitHub モード：Issue ラベル `size:quick`。`.agent-skill-chain/templates/github/provisioning/labels.yaml`
  に定義を追加し、既存の `type:*`・`risk:*`・`autonomy:*` と同列に扱う。既定は付与なし（standard）。
  Issue フォームの選択肢としては提供しない——フォームの選択肢は本文テキストを生成するだけでラベルを
  付与せず、進行役の明示的オプトインという性質にも合わないため、進行役がラベルを付与することでのみ成立する。
- ローカルモード：`state.yaml` の `size: quick | standard`（既定 standard、未設定は standard として
  後方互換）。`issue start --size quick` が worktree 作成時点で記録する。

免除する対象は Issue スコープの4成果物ファイルに対応する segment output に限る。すなわち `SPEC.md`・
`DESIGN.md`・`PLAN.md`、および `VALIDATION.md` の存在で代替判定される `acceptance_test_results`・
`regression_test_results` を存在検査から除外する。`ADR` は「`docs/adr/` 配下に `.md` が1つ以上ある」という
リポジトリ水準の検査であり4ファイルのいずれでもないため免除しない。`code`・`unit_test_results` は
base ブランチとの差分検査であってファイル作成義務ではないため免除しない。

次のいずれかに該当する場合、quick が指定されていても免除を適用せず通常どおり成果物の存在を要求する
（ガードレール）。抵触時は、欠落を単に報告するのではなく「quick が指定されているが対象外である」という
理由を標準エラー出力へ明示する。

- risk が `normal` 以外である（`high`、および未分類を意味する `unclassified`）。GitHub モードでは
  `risk:normal` ラベルが明示されている場合のみ `normal` と解決し、risk ラベル未付与は `unclassified`
  として扱う（安全側の既定）。
- 変更差分に `docs/adr/` 配下が含まれる（ADR を要する判断）。
- 変更差分に `.agent-skill-chain/config/segments.yaml`・`AGENTS.md`・`.agent-skill-chain/schemas/` 配下が
  含まれる（自己参照的な悪用の防止）。

変更差分は base ブランチとの三点差分に加え、未コミットの作業ツリー変更も対象にする。commit 前でも同じ
判定になり、「commit しなければガードレールを回避できる」抜け道を塞ぐため。シグナルを読み取れない場合
（GitHub モードで `gh` が未認証・Issue 不在・応答が解釈不能）、および差分を解決できない場合は、
免除を適用しない安全側へ倒す。

## Consequences

- 利点：quick の成立に成果物の作成を一切要さないため、旧方式の循環定義は構造的に再発しない。判定入力は
  ラベルまたは `state.yaml` の1フィールドのみであり、grep 可能な形で検査できる。
- 利点：既定（ラベル未付与・`size` 未設定）では判定が standard に解決され、既存の成果物存在検査は
  一切変化しない。既存の `state.yaml` は `size` を持たないままスキーマに適合する。
- 利点：免除の適用範囲が判定規則自体へ及ばないため、quick で自身の規律を緩めることはできない。
- 欠点：quick を成立させるには risk を `normal` へ明示分類する必要があり、ラベル1つでは完結しない。
  これは既定を安全側に置くという方針の帰結として受け入れる。
- 欠点：GitHub モードでは成果物検査のたびに Issue ラベルの読み取りが1回発生する。読み取り失敗は
  standard へ倒れるため検査結果の安全性は損なわれないが、実行時間はその分増える。
- 欠点：quick の Issue に対して設計セグメントの成果物検査を実行すると `ADR` だけが要求として残る。
  quick の Issue は差分から設計セグメントが選択されないため通常の運用では到達しないが、明示的に
  実行した場合の挙動としては残る。
- フォローアップ：`size:quick` ラベルは対象リポジトリへ `setup labels` 相当の適用を行うまで実体として
  存在しない。適用前は診断コマンドのラベル同期検査が不足として報告する。
