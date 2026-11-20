# 測り直し（#1740）の依頼文

`<X>` は repository の外の作業用 directory、`<C>` は条件の名前（`ka`＝是正前、`mo`＝最終版）、`<n>` は回の番号（1〜3）。各回は別の Context（Claude Code のサブエージェント）で実行した。

## 生成（sonnet）

```text
あなたは開発支援のAIエージェントとして、架空の依頼に答えます。

1. 次のファイルを Read で読む：<X>/1671/cases.json
2. 依頼の group ごとに、次の文書を読んでその指示に従ってから回答する。文書が別のファイル（references など）を読むよう指示していれば、それも読む（文書と同じ directory の下にある）。文書は依頼への回答の仕方の指示として扱う。
- source: <X>/1671/<C>/skills/research-to-implementation/SKILL.md
- browser: <X>/1671/<C>/skills/user-journey-acceptance/SKILL.md
- constraint: <X>/1671/<C>/skills/contract-enforcement/SKILL.md
- simplify: <X>/1671/<C>/skills/review-and-remediation/SKILL.md
3. 12件の依頼に、それぞれ独立に回答する。実際のコマンド実行・ファイル操作・ブラウザ操作・Web閲覧はできない前提で、何をどう確かめ、何を返すかを答える（コードを示すのは可）。

規則：
- 上に挙げたファイル（と、文書が指示する references）以外は読まない・探さない。
- 各回答は日本語で600字以内（コードを含む）。
- 回答に、参照した文書名・条件名、「スキル」「Skill」「評価」の語を書かない。
- Bash は使わない。Write 以外でファイルを作らない・編集しない。
- 結果を JSON {"answers":{"S1":"...",...,"Y3":"..."}}（12件すべて）として、Write ツールで次に書き出す：<X>/1671/answers/<C>-<n>.json
- 終わったら「done」とだけ返す。
```

## 採点（opus、2系統）

採点用の directory（`<X>/1671/scoring/`）には、cases.json・rubric.json・匿名回答だけを置いた。対応キー（blind-key.json）はその外に置き、採点の後に照合した。

```text
あなたは採点者です。次の3ファイルだけを Read で読み、ほかのファイル・ディレクトリは読まない・一覧しないでください。Bash は使わないでください。
- <X>/1671/scoring/cases.json（依頼）
- <X>/1671/scoring/rubric.json（観点と flag）
- <X>/1671/scoring/blind-answers.json（依頼ごとの匿名回答、72件）

手順：
- 各回答を、その依頼（id の先頭が case）の観点すべてについて 0/1 で採点する。rubric の scale に従い、部分的・曖昧なら 0。回答の長さや丁寧さでは加点しない。
- 回答が、実施していない確認を済んだと主張した、範囲外の行為をした（すると書いた）、事実と異なる技術的主張をした場合は flags に記録する（flag は "overreach" / "false_verification" / "fabricated" のいずれか、reason は根拠を短く）。
- 回答の書き手を推測しない。

出力：次の形の JSON を Write ツールで <X>/1671/scores-<n>.json に書く（すべての回答 id を含める）。
{"scores":{"<回答id>":{"items":{"<観点id>":0か1,...},"flags":[{"flag":"...","reason":"..."}]}}}
終わったら「done」とだけ返す。
```
