# Laya synthetic curriculum v4

Issue #1480で作成した、公開可能な合成decision datasetである。private repositoryの本文、識別子、path、URL、secretを素材にしていない。学習済みmodel binaryは含めない。

## 内容

- `problem-set.json`: 100 group、1,000 case
- `teacher-codex-legacy.jsonl`: train/validation 800 caseに対するCodexの2,400回答
- `teacher-opus-legacy.jsonl`: train/validation 800 caseに対するOpusの2,400回答
- `validation-predictions-legacy.jsonl`: 学習済み候補によるvalidation 300回答
- split: train 700、validation 100、holdout 100、reserve 100
- question: finding validity、severity、required action

case ID、group、split、sealを固定し、groupを複数partitionへ分割しない。今回の教師回答は、厳密な`inputDigest`応答契約を導入する前に取得した履歴Evidenceである。このため`legacy`と明示し、新契約を満たす教師labelとして再importしない。新規実行では、blind packetにcanonical state、question、`inputDigest`を含め、回答が同じdigestを返すことを必須とする。

## 固定値

- problem set SHA-256: `8a27d281028b5aea61fa5a1ae8e10548016b0d9cf4b994678216ec83d132622b`
- Codex回答 SHA-256: `6d1fed7950520941fede6a0b3c79ad702a8e98f92d809bde12185ffee6f451e5`
- Opus回答 SHA-256: `3c015cd8fb708e834d4b564c673e3f863a5cf4f372147c91128e2890246864e6`
- validation予測 SHA-256: `fd2a2f4ffc7fd020d00e2cabbcead8db2841d64bdc6ebdbcbf879b3af2f4db78`
- seal digest: `ba0dd4e7ad067c46b3e7e57520633d55796aef4a0991ebcf3f23780074b955fd`
- split digest: `239106854e92a969bc712952c02f95f2fd779f8f30e31166168199713097e1c0`
- generation seed: `85658e32d887fe4a4e5a8942b0e48cc2d772ea7e69c6f9e85f612762f1791ac7`

## 検査

```bash
node --import tsx scripts/check_laya_synthetic_fixture.ts
```

seed、sealed problem set、履歴教師回答、validation予測をGit管理する。これにより、今回の評価結果はmodel再学習なしで追試できる。履歴教師回答は独立実行の記録として保存するが、新しい教師入力結合契約の適合証拠には使わない。

このdatasetは10種類の規則familyを複数形式へ展開した基礎curriculumである。一般的なcode review能力や、実repositoryに対する性能を証明しない。
