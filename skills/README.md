# 目的別Skillの選び方

繰り返す開発作業を、依頼の目的ごとに選んで使う。全Skillの一括読込みや固定工程への自動起動は行わない。各descriptionと対象の要求から必要なSkillを選び、詳細はそのSkillが案内するreferenceだけを読む。

| 依頼・状況 | Skill | 成果と適用境界 |
| --- | --- | --- |
| Issueの開発を始める・再開する、PR提出・許可されたmergeまで進める | [asc](asc/SKILL.md) | Goal・権限・Evidenceに沿った実行。通常開発へASCを強制しない |
| 新規基盤を整える、既存基盤の考慮漏れを点検する | [project-foundation](project-foundation/SKILL.md) | 先行決定・機械検査・再現性。通常の局所修正では使わない |
| 機能設計の案を比較する、提案前に前提や過剰設計を問い直す | [engineering-judgment](engineering-judgment/SKILL.md) | 要求・単純さ・利用者負担に基づく判断。誤字修正や決定済みの機械的変更には使わない |
| 見積・納期・保守範囲・継続費用と管理責任を判断する | [estimate-and-scope](estimate-and-scope/SKILL.md) | 契約と調査に基づく見積・回答案。過去案件の商慣行を一律に適用しない |
| CIが重い、重複検査・並列化・結果再利用を見直す | [verification-optimization](verification-optimization/SKILL.md) | 保証を維持した同等性確認と計測。単なるテスト実行とは分ける |
| 言語・DB・基盤を段階移行・置換する、併存や移行完了を点検する | [migration-assurance](migration-assurance/SKILL.md) | 受入・データ・構築・運用経路の継承。製品本体だけで完了にしない |
| 利用者が画面から一連の操作を完了できるか確かめる、デモを見せる | [user-journey-acceptance](user-journey-acceptance/SKILL.md) | 実操作・実接続・保存・失敗回復。見た目の確認だけとは分ける |
| 脆弱性監査・SBOM・監査Summaryを整備または点検する | [security-evidence](security-evidence/SKILL.md) | 対象実体と原始結果・評価の対応。通常変更に一律scanを要求しない |
| 技術を比較・実証して採用判断と実装計画へつなぐ | [research-to-implementation](research-to-implementation/SKILL.md) | 根拠・反証・受入・未決の接続。単なる事実質問とは分ける |
| 実行が止まった、待機理由や所有者が不明で再開したい | [execution-recovery](execution-recovery/SKILL.md) | 所有者の同定・原因診断・安全な復旧。通常の長時間処理とは分ける |
| 規約を検査に結び付ける、検査の抜け道を塞ぐ | [contract-enforcement](contract-enforcement/SKILL.md) | 規約と強制点、許可例・反例、local/CIの一致。新規思想を強制しない |
| サブエージェントのモデル・推論設定・費用を判断する | [subagent-model-selection](subagent-model-selection/SKILL.md) | 利用可能性と許可を分け、仕事に必要な能力・切替え条件を選ぶ。委譲や別Host利用を強制しない |
| 担当・依存・書込み先を調整する、引継ぎ文や確認事項を整理する | [work-coordination](work-coordination/SKILL.md) | 作業割当・現物照合・未完了と統合検証の引継ぎ。Agent起動を必須にしない |
| 変更をレビューする、指摘の是正・再確認を進める | [review-and-remediation](review-and-remediation/SKILL.md) | 対象と指摘と検証を対応付ける。レビューのみでは編集しない |

`asc`以外はASC CLI・特定Host・固定Stepに依存しない。Claude CodeでもCodexでも、対象プロジェクトの権限・通常の実行環境・レビュー手順に従う。`agents/openai.yaml`は任意のCodex用表示情報であり、他Hostの前提ではない。

同じ作業に複数が必要な場合も、目的と成果を分けて既存の証拠を共有する。例えば移行では`migration-assurance`が保証の継承を扱い、実測した検証の律速を改善するときだけ`verification-optimization`を追加する。基盤全般のチェック項目を、専門Skillのたびに繰り返さない。

`engineering-judgment`は設計案を選ぶ基準と自己反証を扱い、採用理由・見直し条件を示す。開発思想の全項目を毎回実行するチェックリストではなく、判断が未決の場面に限定する。個人用Skillが持つ会話の好み・本人への助言・個別契約の慣行を、そのままチーム共通の規則にするものではない。基盤の網羅点検は`project-foundation`、技術調査・実証から実装への接続は`research-to-implementation`、変更の独立レビューと是正管理は`review-and-remediation`が扱う。共通の権限・品質契約を追加定義せず、判断に必要なときだけ組み合わせる。

配布パッケージにはこの一覧と各Skillの全ファイルを含める。`project-assets --apply`でプロジェクトの`.agent-skill-chain/skills/`へ配置し、Codex用の`--register-skill`で`.agents/skills/`へ、Claude Code用の`--register-claude-skill`で`.claude/skills/`へ全配布Skillの薄い入口を配置する。両方指定できる。入口のdescriptionで選択され、入口の指示に従って共有本文と必要なreferencesを読む。隔離環境にも入口・本文・referencesを一緒に配置する。既存の同名fileや利用者編集は競合として保護する。配置はHostでの認識・実行の証明ではなく、外部操作の許可も与えない。

Skillの採否は、配布の成立と実務上の効果を分けて判断する。ファイル一致・リンク・登録の検査は呼出しや判断品質の証明ではない。同じ課題で有無を比較し、不要な呼出し、成果の正しさ、手間・時間も確認する。実行失敗や欠測は不発火や合格へ変換しない。個人版と配布版が同名なら、利用先の登録元と本文を照合してから評価し、異なる版の結果を混ぜない。

起票・課題分割を依頼された場合は[tracker起票](tracker-issue-writing/SKILL.md)で重複・受入・field・作成後照合を扱う。作業調整だけでtracker書込みを始めない。複数モデル協議は通常登録へ含めず、[任意の明示導入](../v05/USAGE.md)へ分離する。
