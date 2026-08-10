<!--
正本: AGENTS.md §プロジェクト固有ポリシー
このファイルは `agent-skill-chain init` が `.agent-skill-chain/project/RULES.md` として
一度だけ生成する雛形である（対応する manifest.yaml が既に存在する場合は再生成しない）。
以下は記述例であり、自プロジェクトの実際の追加規約に書き換えて使うこと。
-->

# プロジェクト固有の追加規約

## 目的と対象

本規約は、agent-skill-chain の共通規約（AGENTS.md）を補う、このプロジェクト固有の追加プロセス規約を記述する。agent-skill-chain の不変条件（I1〜I8）・4 セグメント・4 ゲート・writer lease・Check Run 承認・禁止語・secret スキャンは、本ファイルの記述で上書きできない。

## 追加規約（記述例）

- ここにプロジェクト固有の追加ルールを自然文で書く（例: 特定ディレクトリの変更には追加レビューを要求する、特定の外部システムとの連携時の手順を定める等）。
- 1 項目 = 1 箇条書きを目安にし、機械的な矛盾検査ができるよう具体的に書く。
- `.agent-skill-chain/project/manifest.yaml` の `documents.common`（全 role 共通）または `documents.roles.<role>`（role 固有）に登録した文書だけが規範として扱われる。本ファイルを追加・改名した場合は manifest.yaml も同じ変更で更新する。

## 対象外（記述例）

- ここに、本規約が意図的に扱わない事項を書く（例: 他プロジェクトの固有ポリシーをこのリポジトリへ取り込むこと）。
