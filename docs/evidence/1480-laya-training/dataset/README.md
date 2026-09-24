# Laya synthetic curriculum v4

Issue #1480で作成した、公開可能な合成decision datasetである。private repositoryの本文、識別子、path、URL、secretを素材にしていない。学習済みmodel binaryは含めない。

## 内容

- `problem-set.json`: 100 group、1,000 case
- `teacher-labels.json`: train/validation 800 caseに対するCodex・Opus各2,400回答
- split: train 700、validation 100、holdout 100、reserve 100
- question: finding validity、severity、required action

各teacher回答は、teacherが読んだcanonical stateとquestionの`inputDigest`へ結合される。case ID、group、split、sealも固定し、groupを複数partitionへ分割しない。

## 固定値

- problem set SHA-256: `8a27d281028b5aea61fa5a1ae8e10548016b0d9cf4b994678216ec83d132622b`
- teacher labels SHA-256: `a0cae0f3b5f4fa50a38e4d0a514b0d6633749ec7748aa44e308d632ee0442ba6`
- seal digest: `ba0dd4e7ad067c46b3e7e57520633d55796aef4a0991ebcf3f23780074b955fd`
- split digest: `239106854e92a969bc712952c02f95f2fd779f8f30e31166168199713097e1c0`
- generation seed: `85658e32d887fe4a4e5a8942b0e48cc2d772ea7e69c6f9e85f612762f1791ac7`

## 検査

```bash
node --import tsx scripts/check_laya_synthetic_fixture.ts
```

seedとsealed problem setをGit管理する。teacher回答は独立実行の記録なので再生成せず、Git管理した正本を使う。

このdatasetは10種類の規則familyを複数形式へ展開した基礎curriculumである。一般的なcode review能力や、実repositoryに対する性能を証明しない。
