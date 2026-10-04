# Coding Engineeringの隔離評価

評価時だけ使う手順であり、taskごとの成果物や新しいGateではない。

## 比較条件

同じ開始commitまたは同一fixture、要求、model・設定、利用tool、Verification Setを固定し、隔離copyと独立contextでBefore（既存入力だけ）とAfter（本skillを追加）を実行する。入力や検証をAfterだけ軽くしない。実行順を交替させ、通常taskのmedianを述べるには複数task・複数回の標本を使う。小fixtureの1組だけで通常Step 9の短縮を断定しない。

## 観測と判定

既存logからelapsed time、input/output token、tool call、file read、search、selected Lens、targeted/full verification、autonomous repair、repair loop、不要な再読を比較する。未取得は未計測として残し、文字数をtokenと称さない。diffと同じ検証を使って欠陥・regression・scope外変更を比較し、実際のStep 10がない隔離fixtureでは独立確認の結果をStep 10 findingsと称さない。

品質・自律完了率が同等以上でtoken・時間が低下し、valid Critical/Highやescaped regressionが悪化しないことを成功とする。finding数の増加自体を成功としない。未計測や標本不足なら成功未立証とし、悪化を隠さず探索・test・subagent調整・repairなどへ原因を分類する。実taskの通常median大幅短縮は実taskの標本で別途確かめる。

## 反例fixtureの選択

| 入力 | 確認する振る舞い |
|---|---|
| helper追加、300行class、類似code2箇所、raw 1px、pure function、CRUD、内部naming | それだけで新規layer・framework・hard gate・停止を作らない |
| type error、failing unit、null guard不足、validator再利用漏れ、local duplicate、retry二重insert、error handling不足 | scope内で診断・修正・関連test再実行する |
| domain rule変更、write/retry、UI状態、auth境界 | 変更に必要なLensだけを選択し、関係のないLensを読まない |
| AC・invariant・公開contract変更、security境界拡大、不可逆操作、scope外大規模変更、authority不足 | 新ルールを作らずStep 9の既存処理へ渡す |

全反例を毎task実施する必要はない。評価の目的に対応するfixtureを選び、実際の入力・出力・観測可能な結果を保持する。
