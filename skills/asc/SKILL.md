---
name: asc
description: ASC v0.5で開発を実行・再開・レビューするとき、owner入力と配布済みCLIを結び付ける。通常の開発にASCの導入や固定工程を強制しない。
---

# ASCの実行入口

Goal・許可範囲・プロジェクト契約に従い、現在のHostで開発する。Claude CodeならClaude Code、CodexならCodexを使い、別Hostは利用者の明示選択時だけ使う。固定Step、工程ごとのAgent、毎回の要求・設計・ADR生成は不要。

相対リンクはこのSkillのディレクトリ基準。CLIは配布パッケージ内の`../../bin/asc-v05.mjs`をHostのNodeで起動する。解決できなければ導入先を確認し、PATH上の別版・旧`workflow advance`へfallbackしない。

## 作業場所と実装

`start <project-directory>`は作業場所と規約参照を返す（Agentは起動しない）。Git管理済みなら専用worktree、未管理なら通常フォルダーを使う。repo・Issue・branch・baseを照合し、別Issueや未保存の成果を保護する。新規worktree、非Git、複数repoの統合親、既存worktreeの再開では操作前に[作業場所](references/workspace.md)を読む。Git初期化・commit・公開を暗黙に許可せず、未管理ファイルを無断で追加・削除しない。

新規worktreeは`.worktrees/<YYYYMMDD_HHMMSS>-<Issue番号>-<slug>`、branchは`<type>/<Issue番号>-<slug>`が標準。プロジェクト固有規約を優先し、標準作成には`worktree-create`を使う。既存名だけで拒否・改名せず、同じworktreeでの継続に作成手順の再読込みは不要。

入力が確定した独立の読取り・検証は同じtool呼出しにまとめ、各結果を確認する。結果依存の調査、編集、commit、承認、依存する検証は順序を保つ。確認自体は省略しない。

編集前に対象箇所と関連テストを確認する。既存設定・回帰条件を保ち、小変更のためにテスト全体や実行方式を作り直さない。現在のworktreeとHostで、プロジェクトの依存・検証コマンドを使って実テストする。導入はlockfileとHost権限に従い、既存pnpm workspace・store・リンクを使う。標準経路にsnapshotやハッシュ付き依存コピーを要求せず、依存不足の検証を将来のCIへ先送りして合格にしない。

任意の`worktree-verify <worktree> <base> <owner-contract.json>`はcommit済み差分の許可範囲と実検証を対応付ける。成功だけで独立レビューや提出権限は成立しない。

UI・API・業務ルール・永続化・入力境界を変更する場合は分担・実装前に[利用者操作と入力境界](references/implementation.md)を読む。機能は画面単体でなく、要求された一連の操作と失敗からの回復で完成を判断する。適用が不明なら参照し、振る舞いを変えない誤字等に詳細の再読込みは強制しない。

## プロジェクト固有ルール

`start`の`context`（参照・digest・notices）を確認する。予定と実差分の全pathを`--path src/example.ts`（複数可）で指定し、仕様だけの変更も含める。未確定なら省略できるが、全manifest scopeだけが候補になり入れ子のAGENTS.md/CLAUDE.mdは未探索なので、対象確定後・実装前に全対象pathで再実行する。`appliesTo`はpath prefixの選択であり意味的関連性を保証しない。関連が疑われる規約も確認する。

適用規約を読み、同じpath・hash・適用条件を実装担当とReviewerへ渡す。本文の複製や確認済み同一内容の再読込みを避ける。CLIが探索しない親ディレクトリやHostの規約も守る。旧project-policy・索引未設定のnoticeは参照先と適用内容を確認し、旧設定だけで旧CLIの強制機構が動くとは扱わない。

範囲拡張・再開・最終レビュー前に`start`を更新し、規約の追加・削除・hash変更が影響する判断とレビューを更新する。設定で権限を拡張せず、矛盾や未知の必須設定を黙って省略しない。専用Agent・確認文書を増やさない。参照取得だけでは遵守の証明にならず、Reviewerが要求と実装への適合を確認する。

## 独立レビューと提出

現在のHostの新規Contextへ依頼し、実装者の会話・自己評価を継承しない。Codexで選択できる`fork_turns`は`none`。独立Contextがなければ未完了とし、別Hostへ勝手に切り替えない。

依頼には以下を渡す。本文や差分全文を複製せず、実体への参照を使う。

- このSkill基準の`references/review.md`の所在と「この手順を読んでレビューする」という指示。Reviewerは既知の要求・Git状態・差分と一括で読んでよい。進行役は実装判断にも必要な場合以外、本文を先読み・転記しない。
- 元要求・受入条件・許可範囲・適用規約。
- 確認済みworktree・base/HEAD・実差分・実コマンドと結果。非Gitなら対象ファイルと変更内容。
- 実体・関連経路・不足シナリオを独立確認し、指摘・未確認事項・判定対象を返す依頼。

独立性はContextの分離。同じ対象を読取り専用で確認し、実テストもその依存環境を使う。レビューだけのために別worktree/snapshotを作らず、Hostが作った別worktreeのHEADも同一と仮定しない。指定commitを確認できなければ未完了。

妥当な指摘を修正し、影響する検証・レビューを更新する。レビュー後にcommit・未commit差分・結果の適用条件を照合する。要求・コード・検証設定・依存が不変で指摘/実行異常もなければ、進行役の差分全文再読込み・同じテスト再実行は不要。Reviewerの独立確認と必須CIは維持し、影響が不明なら確認範囲を広げる。

許可されたDraft PR提出・CI確認を行い、要求・対象commit・実コマンドと結果・指摘と是正を残す。現在のHost境界を使い、Controllerの隔離や署名済みEvidenceを実施したとは記録しない。

## 分担・再開・マージ後

複数Issue、並列worktree、Context交代・中断再開、PR後修復では[調整と引継ぎ](references/coordination.md)を読む。担当範囲・依存・終了状態を確認し、未commit成果を保護する。親会話全文や別Issueのログを複製しない。

許可されたPRのmerge後は毎回[同期と整理](references/post-merge.md)を実施する。実際のマージ先を確認し、別Issue・未保存成果を保護する。開発中のローカル統合やPR作成までの依頼には適用しない。

## モデル選択

進行役はユーザー指定・予算を優先し、難度・リスク・独立性・利用可能性・費用から委譲モデルを選ぶ。単純な作業は必要十分な軽量モデル、難しい判断は必要な推論能力を使い、品質を安価さと交換しない。工程名で高価なモデルを固定したり、親モデルを無条件継承したりしない。

Claude CodeのFableとCodexのAstraは、ユーザーがそのサブエージェント利用を明示指定した場合だけ使う。親での選択・一般的な自走許可・難度を許可とみなさず、自動fallbackしない。Hostがモデル指定できなければその制約を明示する。委譲の目的・範囲・完了条件とともにモデルと短い選択理由を既存記録に残す（専用文書・Agentは不要）。モデル変更だけではレビューの独立性にならず、Controllerの単一model指定も自動ルーティングではない。

## 任意のController

ownerがControllerの自動実行を明示選択したときだけ[Controllerの入口と再開](references/controller.md)を読む。`run`系は`--snapshot`必須。通常の開発依頼をsnapshotの選択と解釈せず、current-hostから自動fallbackや暗黙の権限拡張をしない。
