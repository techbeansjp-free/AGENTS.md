# capability: map-experience

**目的**: frame-experience（フェーズ1）の前提の上で、情報設計（IA）・ユーザーフロー・体験ジャーニーを設計し、02_設計.md §7.2 に記録する（体験設計フェーズ2）。

---

## 手順

1. §7.1（frame-experience の出力）を読み、体験の前提（ビジネス目的・ユーザー・課題）を確認する。
2. 情報設計（IA）を設計する（情報の構造化・分類・ナビゲーション。観点シード:「情報構造は誰の意思決定順に並んでいるか／削っても誰も困らない情報はどれか」）。
3. ユーザーフロー（CTA・タッチポイント）を一人称ナラティブで記述する。失敗時の画面／出力（CLI エラー・生成 Markdown 含む）を先に設計する（観点シード:「失敗時の画面／出力を先に設計したか」）。
4. 体験ジャーニーを描く。
5. 却下案（採らなかった導線案）を 1 件以上記述する。
6. 02_設計.md §7.2 に IA・ユーザーフロー・体験ジャーニー・却下案を記録する。

---

## 制約・禁止

- フェーズ1（frame-experience）の前提を無視して流れを描かない。
- UI/ビジュアルの具体化に踏み込まない（detail-experience の責務）。
- architecture の責務境界を確定しない（define-boundaries の責務）。

---

## 成果物の形式

- **IN**: 02_設計.md §7.1（frame-experience の出力）。
- **OUT**: 02_設計.md §7.2（IA・ユーザーフロー・体験ジャーニー・却下案）。
- 出力は次フェーズ detail-experience の入力となる。

---

## 参照

- CONCEPTS、RULES、IO_CONTRACT.md
- .agent-skill-chain/runtime/templates/02_設計.md §7
- skills/experience/README.md（判断基準優先順位・fresh サブ分割・規模比例統合）
- skills/experience/frame-experience/（前フェーズの出力）
- commands/design-feature.md（発動条件・委譲手順）
