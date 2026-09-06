---
name: step-06-plan
description: 承認対象の設計を、risk比例のVerification Setから最小実装・仕様更新・独立レビューへ進む03実装計画へ変換する。
---

# ステップ6: 実装計画

入力は設計、Requirement ID、Acceptance Criteria ID、変更種別、risk、影響境界、Impact Analysisである。Impact Analysisはsecurity関連、data loss可能性、不可逆操作、外部契約変更、並行振る舞変更を明示する。これらの構造化JSONを`workflow verification-set --input=<JSON>`へ渡し、決定論的に選択されたVerification Setと入力の対応を記録する。

成果物はBDD例と受け入れ条件、上記入力に応じたVerification Set、最小実装、仕様更新、独立review、delivery policy終端の順にした`03_実装計画.md`。受け入れ条件をproject policyが選択した検証方法と結果へ対応させ、project所有のコマンドだけを使う。TDDは有効な変更で選べる技法とし、全taskへ強制しない。

## routing入力契約

実装taskごとに6 roleを記すrole欄、許可path・操作、必要証拠、能力tier、provider欄、model設定欄、fallback欄、独立性証拠欄を計画する。providerとmodel設定はproject choiceから受け取る入力であり、汎用skillは固有のmodel slugを既定しない。要求能力を満たす解決が不能な場合はfallback欄へ安全な停止・再開条件を置き、implementerとreviewerが異なるidentity・contextであることを独立性証拠欄で検証できるようにする。coordinatorへproduct実装taskを割り当てない。

## テンプレート契約

作業開始前に[成果物用語と責務境界](../../docs/01_開発ワークフロー.md#成果物用語と責務境界)を全文読み、実装計画へ新しい要求・要件・設計判断を暗黙追加しない。実装中の発見は事実と対処を03へ追記し、契約変更時だけ影響する上流成果物を再確定する。

[ドメイン用語台帳](../../docs/01_開発ワークフロー.md#ドメイン用語台帳)を作業開始前に全文読み、用語差分の耐久台帳・仕様変更履歴への反映と、実装・test表現の整合確認をtask化する。

作業開始前に[ユースケース単位の設計と詳細化](../../docs/01_開発ワークフロー.md#ユースケース単位の設計と詳細化)を全文読み、実装完了の単位を今回のユースケースの事後条件で定義する。受付や画面操作の成功を完了条件にしない。

作業開始前に[03_実装計画.md](../../templates/issue/03_実装計画.md)を全文読み、その見出し構造と必須欄を使って`03_実装計画.md`を作る。計画項目を独自の自由形式へ置き換えない。

project choicesを読み、作業開始前に[脅威・対策・監査](../../templates/specs/10_セキュリティ/02_脅威・対策・監査.md)、[非機能要件一覧](../../templates/specs/11_非機能/00_非機能要件一覧.md)、[監視・障害対応](../../templates/specs/12_運用保守/01_監視・障害対応.md)、[コーディング標準](../../templates/specs/14_開発・品質/01_コーディング標準.md)、[テスト標準](../../templates/specs/14_開発・品質/02_テスト標準.md)を全文読む。UIまたはtoken capabilityが`not-applicable`でない場合は[デザイントークン](../../templates/specs/17_デザイン/00_デザイントークン.md)と[レイアウトトークン](../../templates/specs/18_レイアウト/00_レイアウトトークン.md)も全文読み、各DC行へtask・SCN・検証コマンドを割り当てる。
