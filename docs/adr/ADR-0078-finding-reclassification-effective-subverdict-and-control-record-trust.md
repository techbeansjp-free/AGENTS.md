# ADR

```yaml
id: ADR-0078
status: proposed
title: 最終ラウンド後のfinding分類を有効sub-verdict経由で判定へ反映し、制御レコードの投稿者を証跡と同一の信頼境界へ束縛する
tags: [gate-review, round-budget, trust-boundary, evidence]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

ゲートの最終ラウンド後に、限定4類型（既出blocking未是正・Issue目的の直接阻害・test/build失敗または回帰・データ喪失またはセキュリティ低下）に該当しない finding を warning へ分類する運用を導入するにあたり、分類された finding がゲート判定へどう届くかが確定していなかった。

レビュアへ配布する立証・反証ルーブリックは、blocking finding を付与するとき同じ観点の sub-verdict を fail とすることを求めている。したがって blocking finding は原則として fail の sub-verdict を伴って提出される。一方で判定の集約は、レビュアが提出した sub-verdict の fail と blocking finding の存在との論理和で `rejected` を決める。分類が finding の severity だけを差し替える限り、4類型外の finding だけが残った最終ラウンドでも sub-verdict の fail が残り、`rejected` が確定する。この状態は `approved` でも `human_required` でもないため進行役に許された次手が無く、有限の判断で次のセグメントへ進むという目的が達成できない。

逆に、分類後の blocking が0件になったことだけを根拠に判定値と `inconclusive` を上書きする実装も試みたが、これはレビュアが判定不能を表明した attempt までも承認へ倒す。判定不能を承認や成功へ倒さないという既存の安全側ラチェットの回帰であり、採用できない。すなわち「分類を判定へ届かせない」と「分類だけで判定を上書きする」の双方が不適格であって、両者の中間にある受理条件を決定として確定する必要がある。

さらに、分類がゲート判定を動かせるようになると、分類記録そのものが信頼境界の対象になる。最終ラウンド事前宣言と finding 分類記録は Coordination Backend の Issue コメントへ耐久化されるが、採否は marker・対象 Issue・対象ゲート・作成時刻・canonical digest だけで決まり、投稿者を検査していなかった。digest は秘密鍵なしに再計算でき、照合に必要な値はすべて Issue と PR 上で公開されている。したがって Issue へコメントできる任意のアクターが制御レコードを成立させ、blocking finding を warning へ差し替えて、上限到達時の人間判断への昇格を無効化できる。同じ判定を動かす PR review evidence は登録済み review policy の trusted recorder 一覧で投稿者を束縛しており、新設した経路だけが未束縛という非対称が生じていた。

投稿者検査に失敗した記録の扱いには2案がある。全体を不正として停止させる案は、Issue へコメントできる任意のアクターが1件投稿するだけで当該ゲートを恒久的に人間判断へ固定でき、機密性側の攻撃面を塞ぐ代わりに可用性側の攻撃面を新設する。採用しない（存在しないものとして扱う）案は、宣言なし・分類なしの既存帰結へ落ちるだけで新たな停止条件を作らない。

## Decision

1. 分類はレビュアが提出した `conformance`・`falsification`・`inconclusive` を書き換えない。これらは raw 値として保持する。
2. 判定の集約は raw 値ではなく有効 sub-verdict を入力とする。有効 sub-verdict は、レビュアごとに次の4条件がすべて成立する場合に限り raw の `fail` を `pass` として扱い、1つでも欠ければ raw をそのまま使う。(a) 当該ゲート・当該 attempt の最終ラウンド事前宣言が成立している。(b) 当該レビュアの raw `inconclusive` が false である。(c) 当該 attempt の blocking finding が1件残らず有効な分類記録で warning へ差し替えられている。(d) 当該レビュアが blocking finding を1件以上提出しており、その `fail` が finding に裏付けられている。
3. `rejected` は有効 sub-verdict の `fail`、または分類後に残る blocking から決める。`approved` は、全レビュアの有効 sub-verdict が両観点 `pass`、全レビュアの raw `inconclusive` が false、分類後 blocking が0件、事前宣言が成立、のすべてを満たす場合に限る。いずれにも収束しない場合は `human_required` とする。分類の有無や blocking 件数だけを理由に判定値や `inconclusive` を直接代入する分岐は設けない。
4. 判定へ用いた有効 sub-verdict をゲート結果の `conformance`・`falsification` へ記録し、raw 値は同じ記録内へ、導出が起きた場合にだけ併記する。`approved` に対し両観点 `pass` を要求する既存の整合検査と、元の判断を現行記録だけから復元できるという要求の双方を満たすため、単一フィールドの再利用ではなく併記とする。
5. Coordination Backend 上の制御レコード（最終ラウンド事前宣言・finding 分類記録）は、PR review evidence と同一の trusted recorder 一覧で投稿者を束縛する。新しい設定項目・別の actor 一覧・署名鍵は導入しない。
6. 投稿者が trusted recorder でない制御レコードは採用しない。全体を不正として停止させることはしない。作成側の重複検査と解決側の件数検査は、投稿者で絞った後の同一集合に対して行う。
7. trusted recorder が投稿した制御レコードに対する既存の構造検査（canonical digest、直前 attempt の一致、作成順序、上書き検知、source review への結線、元 severity と raw evidence の一致）は変更せず、投稿者の束縛をその前段に置く。ローカルモードの制御レコードは Git 管理下にあり writer lease と当該変更のレビューが束縛するため、別の actor 一覧を新設しない。
8. ラウンド値の導出元、cutoff の閾値、ラウンド値を解決できない場合の通常差し戻し fallback は変更しない。有効 sub-verdict の導出結果をラウンド導出へ戻さない。

## Consequences

- 4類型外の finding だけが残った最終ラウンドは `approved` へ収束し、warning は原文 evidence と follow-up Issue の追跡を保ったままゲート後の進行を妨げない。4類型の blocking が残る最終ラウンドは `rejected` ではなく `human_required` へ収束する。最終ラウンド後は進行役の裁量による差し戻しが残らないため、`rejected` は最終ラウンド以外のラウンドの帰結に限られる。いずれの場合も進行役に次手が無い停止状態は生じない。
- 未分類の blocking が1件でも残る場合、またはレビュアが判定不能を表明した場合は条件が崩れて raw の `fail` が維持されるため、判定不能を承認へ倒す回帰は起きない。
- 有効 sub-verdict は4類型の該当性を自ら判定せず、分類記録が保持する「4類型のいずれにも該当しない」旨の申告に依拠する。誤った申告を成立させられるのは trusted recorder に限られ、元 severity と raw evidence は不変のまま残るため事後監査で申告の当否を検証できる。この監査は自動化されず、trusted recorder の説明責任に依存する。
- 事前宣言・分類記録のいずれも無い経路、およびラウンド値を解決できない経路では条件が成立せず、判定は本決定の導入前と同一になる。
- 制御レコードを偽造しても採用されないため、上限到達時の人間判断への昇格を第三者が無効化できない。非 trusted の投稿は無視されるだけで、ゲートを停止させる手段にもならない。
- ゲート結果のスキーマに raw sub-verdict の併記フィールドが1つ増える。任意フィールドとするため既存の記録は移行なしで有効である。
