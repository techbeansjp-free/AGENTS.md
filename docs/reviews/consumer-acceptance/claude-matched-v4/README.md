# Claude Code 小規模変更の固定比較

同一fixture・runtime・モデル・effort・oracleでB/Cを5組、順序B,C,C,B,B,C,C,B,B,Cで実行した。全10試行を収録し、失敗の置換・途中の実装修正はない。対象は合成greeting変更。複雑Issueやv0.4全体との比較ではない。

Bはalpha.21、Cはalpha.22の配布Skill。Cには既存テスト・設定を読んで必要な差分を加え、テスト全体を置換しない指示を含む。両者のruntime同一性は各記録のconditionsと集計関数で確認した。試験中のrunnerはsummaryのSHA256で固定。未公開の試験パッケージであり、後続のGoal proposal修正を実走検証したものではない。

**判定は不合格（性能条件）**。全件で実検証・独立レビュー・対象commitのDraft PR/CI・全参加Agentのusage照合が成功したが、時間とtokensの中央値をともに改善する条件は成立しなかった。tokensは約2.6%減、時間は約7.2%増。最大値は両方低下したが、中央値の条件の代替にしない。新しい成功試行を追加してこの結果を置き換えない。

配布Skillの既存テスト保護は観測済みの破壊的書換えへの品質対策として評価し、速度改善とは表示しない。所要時間はモデル起動から評価用HostによるDraft PR/CI確認までであり、利用者の任意案件・外部調整費用を含む総コストの保証ではない。全Agent tokensはcache読取りを含む延べ処理量で、請求額ではない。

各連番JSONは合成PRと対象commitへ対応する。ローカル導入path・会話本文・利用者データは収録しない。[集計](summary.json)は既存summarizeNativePairsで計算した。
