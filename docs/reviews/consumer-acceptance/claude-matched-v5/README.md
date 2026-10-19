# Claude固定比較 v5

最新runtimeを共通にし、baseline alpha.25は旧alpha.21のSkill、candidate alpha.24は重複確認抑制と条件付きworkspace手順を含むSkillとした。baselineにも未使用のworkspace参照を残して同一runtime inventoryを維持し、差分はSkillの4ファイルだけであることを確認。Sonnet・medium・fixture・oracle・実行順B,C,C,B,B,C,C,B,B,Cを固定。実装介入・失敗置換なしで10試行を完了した。

[集計](summary.json)の判定は不合格。品質・usage照合は全件成功。中央値は時間約9.3%、processed tokens約2.7%減少したが、最大時間107.58→138.11秒、最大tokens417,756→583,799となった。前回v4は別条件の結果として保持し、まとめて有利な試行だけを選ばない。

7試行目（合成PR111）の親は272,251 tokens、Reviewerは311,548 tokens・14 assistant messagesだった。親がAgentにisolation=worktreeを指定し、レビュー手順の参照を渡さず、対象commitがなければ現在ファイルへfallbackする不適切な指示も付けていた。Reviewerは実際には指定commitをgit showで取得したが、一時コピーでのテストを複数回試みた。提出対象の固定oracle・独立レビューは成功したものの、この余計なコピーと再試行を性能上無視しない。

後続修正ではレビュー依頼の入口に、独立性はContextの分離であること、確認済み対象worktreeとレビュー手順を渡すこと、別worktreeのHEADを代用しないことを明記する。この修正の実モデル効果は本比較に含まれない。時間はモデル開始から評価用HostによるDraft PR/CIまで。任意の複雑Goal・全OS・実請求額の保証ではない。
