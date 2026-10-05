# Coding Engineeringの隔離評価

評価時だけ使う手順であり、taskごとの成果物や新しいGateではない。

## 比較条件

BeforeのStep 9とAfterのStep 9をそれぞれ入口にする。Afterへ本文やLensを事前投入せず、選んだ経路と実際の読取を観測する。同じ開始commitまたは同一fixture、要求、model・設定、利用tool、Verification Setを固定し、隔離copyと独立contextでBefore（既存入力だけ）とAfter（Step 9の軽量routingと必要時だけ本skillを展開）を実行する。入力や検証をAfterだけ軽くしない。実行順を交替させ、通常taskのmedianを述べるには複数task・複数回の標本を使う。小fixtureの1組だけで通常Step 9の短縮を断定しない。

## 観測と判定

既存logからelapsed time、input/output token、tool call、file read、search、selected Lens、targeted/full verification、autonomous repair、repair loop、不要な再読を比較する。未取得は未計測として残し、文字数をtokenと称さない。diffと同じ検証を使って欠陥・regression・scope外変更を比較し、実際のStep 10がない隔離fixtureでは独立確認の結果をStep 10 findingsと称さない。

判定は次の区分で報告し、「実用上の成功」と「4軸同時改善」を区別する。

| 判定 | 必要な観測 |
|---|---|
| 非劣化（Non-regression） | Quality（品質）・Autonomy（自律完了率）が悪化していない。valid Critical/Highとescaped regressionも悪化していない |
| 効率改善（Efficiency improvement） | Token Efficiency（input/output token消費）・Step 9 Lead Time（所要時間）の両方が改善している |
| 実用上の成功（Overall Success / Efficiency success） | 非劣化と効率改善の両方が成立している |
| 4軸同時改善（Full success / Full 4-axis Improvement） | 実用上の成功に加え、Quality・Autonomyにも改善があり、4軸すべてのstrict improvementを観測している |

品質・自律性が同等でtoken・時間だけが改善した場合は「実用上の成功（効率改善・品質非劣化）」であり、4軸同時改善とは呼ばない。欠陥0件や自律完了率100%を維持した場合も、効率改善があれば実用上の成功として扱い、改善不能な軸のstrict improvementを必須にしない。効率改善だけでは品質・自律性の非劣化を意味せず、各区分の成立を別々に確認する。finding数の増加自体を品質改善としない。

未計測や標本不足の軸は未立証とし、その軸を必要とする判定も未立証とする。悪化を隠さず探索・test・subagent調整・repairなどへ原因を分類する。実taskの通常median大幅短縮は実taskの標本で別途確かめる。

## 反例fixtureの選択

| 入力 | 確認する振る舞い |
|---|---|
| 既存pattern内のlow-risk/localなhelper・naming修正 | 本文・索引・Lens読取0で近傍実装と関連testから進める |
| 300行class、類似code2箇所、raw 1px、pure function、CRUD | それだけで新規layer・framework・hard gate・停止を作らない |
| risky/cross-boundaryに該当しないboundedで境界とriskが既知の変更 | 短い索引だけから開始し、未解決論点がなければ0 Lensにする |
| type error、failing unit、null guard不足、validator再利用漏れ、local duplicate、retry二重insert、error handling不足 | scope内で診断・修正・関連test再実行する |
| 影響が小さくてもriskyなauth・migration、境界/risk不明の変更 | 本文の経路を優先し、boundedを理由に必要な確認を省かない |
| domain rule変更、write/retry、UI状態、auth境界 | 変更に必要なLensだけを選択し、関係のないLensを読まない |
| AC・invariant・公開contract変更、security境界拡大、不可逆操作、scope外大規模変更、authority不足 | 新ルールを作らずStep 9の既存処理へ渡す |

探索では候補件数・直接読取件数・終了理由を既存logから観測し、soft budget内で判断できたか、具体的なriskに応じて拡張したかを確認する。単なる上限超過を失敗や停止としない。

全反例を毎task実施する必要はない。評価の目的に対応するfixtureを選び、実際の入力・出力・観測可能な結果を保持する。
