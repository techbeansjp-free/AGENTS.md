# SPEC: 配布CIテンプレート agent-skill-chain-root-cleanup.yml の npm ビルド前提を条件付きにする

- Issue: `ISSUE-686`
- 作成者: `spec_worker`
- 対象ブランチ: `bugfix/686-root-cleanup-npm-prereq`

## 目的・背景

agent-skill-chain は、対象リポジトリ（以下 consumer）へ GitHub Actions ワークフローを配布する。配布正本は `.agent-skill-chain/templates/github/.github/workflows/` に置かれ、`init`・`setup github`・`upgrade` によって consumer の `.github/workflows/` へ展開される。配布されるワークフローのひとつ `agent-skill-chain-root-cleanup.yml` は、main への push を契機に、リポジトリ root 直下へ混入した Issue セグメント成果物（`SPEC.md`・`DESIGN.md`・`PLAN.md`・`VALIDATION.md`）を短命ブランチ上の削除コミット・PR・admin merge で main から除去し、その後 root が clean であることを検証する。

このワークフローは現在、Node.js プロジェクト専用の前提（`npm ci` と `npm run build`）を無条件のステップとして実行する。しかし consumer は Node.js プロジェクトとは限らず、`package.json` や lockfile を持たない consumer では `npm ci` が必ず異常終了し、root-cleanup が main への push ごとに恒常的に失敗する。実測では、ある非 Node.js consumer において導入以降の root-cleanup 実行がすべて同一原因で失敗し、成功例が存在しない。

この結果、(1) root 直下のセグメント成果物が除去されず main に恒久残留して、リポジトリ root 直下の構成制約が破れたままになる、(2) 常に赤いワークフローが 1 本存在する状態が既定になり、後から発生する本物の失敗が埋没する、という 2 つの害が生じる。

同種の欠陥は姉妹ファイル `agent-skill-chain-ci.yml` で既に解消されている。そこでは、npm 前提の成立可否を検査する判定ステップの出力を `npm ci`・`npm run build` の実行条件とし、さらに npm 手順をスキップした場合でも検査スクリプトが必要とする agent-skill-chain CLI を確実に用意する保証ステップを併せて持つ。root-cleanup ワークフローだけがこの是正を受け取っていない。

なお root-cleanup ワークフローが呼び出すスクリプト（root 直下成果物の除去処理、root clean 検証）は、いずれも agent-skill-chain CLI への薄いラッパーであり、CLI を 3 経路（リポジトリ内のビルド成果物、`node_modules` 配下の実行ファイル、`PATH` 上のコマンド）で解決できなければ日本語エラーで停止する。したがって npm 手順を単に削除するだけでは、失敗ポイントが CLI 未検出へ移動するだけであり、CLI の存在保証を伴わなければ問題は解決しない。

由来・根拠の補助情報: GitHub Issue #686（本 Issue）、Issue #536（同種欠陥の先行是正）、Issue #677（CLI 解決処理の共有実装化）、Issue #208 と ADR-0007（root-cleanup 自動化の設計）。

## 要求 → 要件 → 受入条件

要求から要件、そして機械検証可能な受入条件（AC-ID）まで一意に追跡できる形で記述する。AC-ID は `AC-1` のように `^AC-[0-9]+$` の形式に従う。

### 要求

`package.json`・lockfile・`build` script を持たない consumer に配布された root-cleanup ワークフローが、npm 前提の不成立を理由に失敗しないこと。かつ、その回避によって agent-skill-chain CLI 未検出という別の失敗が沈黙して後続へ伝播しないこと——CLI を解決できない場合は、除去処理・root clean 検証を CLI 不在のまま実行させず、CLI 保証の時点で非ゼロ終了による明示的な失敗として顕在化させる。ここで要求するのは失敗の顕在化までであり、「CLI を必ず用意できること」自体は本要求に含めない。npm 前提を満たす consumer（agent-skill-chain 自身の開発リポジトリを含む）では従来どおり動作すること。

### 要件

- 配布正本の root-cleanup ワークフローは、`npm ci` を「`package.json` が存在し、かつ `package-lock.json` または `npm-shrinkwrap.json` のいずれかが存在する」場合にのみ実行する。
- 同ワークフローは、`npm run build` を「`npm ci` の実行条件（`package.json` が存在し、かつ `package-lock.json` または `npm-shrinkwrap.json` のいずれかが存在する）が成立し、**かつ** `package.json` の `scripts.build` が有効に定義されている」場合にのみ実行する。ここで「有効に定義されている」とは、値が空でない文字列であることを指し、空文字列・空白のみの文字列・`null`・文字列以外の型はキー未定義と同一に扱う。`npm ci` の実行条件を `npm run build` の実行条件へ合成するのは、依存を導入しないまま build script を実行すると devDependencies 未導入により典型的に失敗し、失敗箇所が `npm ci` から `npm run build` へ移動するだけで「npm 前提の不成立を理由に失敗しない」という要求を満たせないためである。
- 上記の前提検査そのものは、前提が成立しない場合でも異常終了せず、後続ステップの実行条件として利用できる判定結果を出力する。判定は「`npm ci` 実行可否」と「`scripts.build` が有効に定義されているか」を別々に評価したうえで、`npm run build` 実行可否をその両者がともに成立する場合にのみ「可」とする形で導く。これにより、lockfile 不在の構成では build も実行されず、かつ lockfile を持ち `scripts.build` のみを欠く構成では build だけがスキップされることを、それぞれ区別して判定できる。
- 同ワークフローは、root 直下成果物の除去処理および root clean 検証を実行する前に、agent-skill-chain CLI が 3 経路のいずれかで解決可能な状態であることを保証する。保証処理は、ラッパースクリプト群と同一の共有 CLI 解決実装を用い、CLI 解決ロジックの重複実装を作らない。
- root-cleanup の既存の振る舞い（実行契機、`[skip ci]` ガード、同時実行制御、root 直下成果物の除去、ローカルチェックアウトの main 同期、root clean 検証、使用する認証情報）は変更しない。新しい認証情報・シークレットを追加しない。
- 配布正本と、本リポジトリ自身の `.github/workflows/` に展開されたワークフローは同一内容を保つ。

### 受入条件（Acceptance Criteria）

各 AC には、散文形式の Given/When/Then による受け入れシナリオを添える（構造化マーカーの強制は `bdd.profile: strict` の場合のみ。`.agent-skill-chain/config/agent-skill-chain.yaml` 参照）。検証方法見込みは `automated`・`manual`・`hybrid` のいずれか1語で記す。

#### AC-1: npm 前提を持たない構成では npm 手順がスキップされる

- Given: 次の 2 種類の作業ディレクトリ。(a) `package.json`・lockfile・`build` script のいずれも持たない作業ディレクトリ（非 Node.js consumer の構成）。(b) `package.json` を持たず、lockfile（`package-lock.json` または `npm-shrinkwrap.json`）のみが存在する作業ディレクトリ
- When: 配布正本の root-cleanup ワークフローが持つ npm 前提判定ステップの実体を、それぞれの作業ディレクトリで実行する
- Then: いずれの作業ディレクトリでも、判定ステップ自体は正常終了し、`npm ci` 実行可否・`npm run build` 実行可否のいずれも「不可」を示す判定結果を出力する（lockfile が単独で存在することは `npm ci` 実行可否を「可」にしない）。かつ、ワークフロー定義上の `npm ci` ステップと `npm run build` ステップは、それぞれ対応する判定結果が「可」であることを実行条件として持つため実行されない。加えて、実行に用いる判定ステップの実体は、配布正本ワークフロー YAML 内の当該ステップ定義から機械的に抽出したものであり、抽出結果が抽出元の記述と一致することを検証手順自身が確認する
- 検証方法見込み: `automated`

#### AC-2: npm 手順をスキップしても CLI 未検出へ失敗が移動しない

- Given: 配布正本の root-cleanup ワークフロー定義
- When: ステップ構成を検査する
- Then: root 直下成果物の除去処理を呼ぶステップおよび root clean 検証を呼ぶステップより前に、agent-skill-chain CLI の存在を保証するステップが存在し、そのステップはラッパースクリプト群と同一の共有 CLI 解決実装を用いる。かつ、そのステップは npm 手順の実行有無にかかわらず（実行条件なしで）実行される
- 検証方法見込み: `automated`

#### AC-3: npm 前提を満たす構成では従来どおり npm 手順が実行される

- Given: `package.json`・lockfile・`build` script をすべて持つ作業ディレクトリ（agent-skill-chain 自身の開発リポジトリと同じ構成）
- When: 配布正本の root-cleanup ワークフローが持つ npm 前提判定ステップの実体を、その作業ディレクトリで実行する
- Then: 判定ステップは正常終了し、`npm ci` 実行可否・`npm run build` 実行可否のいずれも「可」を示す判定結果を出力する。これによりワークフロー定義上の両ステップの実行条件が成立する。加えて、実行に用いる判定ステップの実体は、配布正本ワークフロー YAML 内の当該ステップ定義から機械的に抽出したものであり、抽出結果が抽出元の記述と一致することを検証手順自身が確認する
- 検証方法見込み: `automated`

#### AC-4: root-cleanup の既存の振る舞いが変更されない

- Given: 変更後の配布正本 root-cleanup ワークフロー
- When: 実行契機・`[skip ci]` ガード・同時実行制御・権限・使用する認証情報・root 直下成果物の除去処理呼び出し・ローカルチェックアウトの main 同期・root clean 検証呼び出しを、変更前と比較する
- Then: 比較対象は When が列挙した項目に限定し、そのいずれにも変更前との差分が無い。npm 前提判定ステップと CLI 保証ステップの追加、および既存の `npm ci` ステップ・`npm run build` ステップへ判定結果を実行条件として付与することは、要件が求める変更であり許容差分として比較対象に含めない。かつ、本リポジトリの自動テストスイート全体（`npm test` が起動する全テスト）が成功する。対象テストを「root-cleanup 関連」等の名目で部分集合へ絞り込むことは許さない
- 検証方法見込み: `automated`

#### AC-5: 配布正本と展開先の同期が保たれる

- Given: 配布正本と本リポジトリ自身の `.github/workflows/` の両方を更新した状態
- When: テンプレート同期検査を実行する
- Then: 検査が成功し、配布正本と展開先の root-cleanup ワークフローが同一内容であることが確認される
- 検証方法見込み: `automated`

#### AC-6: lockfile はあるが build script が無い構成では npm ci のみ実行される

- Given: `package.json` と lockfile（`package-lock.json` または `npm-shrinkwrap.json` のいずれか）を持つが、`package.json` の `scripts.build` が有効に定義されていない作業ディレクトリ。「有効に定義されていない」とは、`scripts` 自体が無い場合、`scripts.build` キーが無い場合、および値が非正常値（空文字列、空白のみの文字列、`null`、文字列以外の型）である場合を指し、これらをすべて含む
- When: 配布正本の root-cleanup ワークフローが持つ npm 前提判定ステップの実体を、上記のそれぞれの作業ディレクトリで実行する
- Then: いずれの場合も判定ステップは正常終了し、`npm ci` 実行可否と `npm run build` 実行可否を別個の2つの判定結果として出力する。前者は「可」、後者は「不可」となる（非正常値はキー未定義と同一に扱う）。すなわち `npm ci` 実行可否が「可」であっても `scripts.build` が有効に定義されていなければ `npm run build` 実行可否は「不可」となり、build script の有無が独立の判定入力として機能することが示される。これによりワークフロー定義上の `npm ci` ステップのみ実行条件が成立し、`npm run build` ステップは実行されない。加えて、実行に用いる判定ステップの実体は、配布正本ワークフロー YAML 内の当該ステップ定義から機械的に抽出したものであり、抽出結果が抽出元の記述と一致することを検証手順自身が確認する
- 検証方法見込み: `automated`

#### AC-7: lockfile が無い構成では build script があっても npm 手順が実行されない

- Given: `package.json` を持ち、その `scripts.build` が有効に定義されているが、`package-lock.json`・`npm-shrinkwrap.json` のいずれも持たない作業ディレクトリ
- When: 配布正本の root-cleanup ワークフローが持つ npm 前提判定ステップの実体を、その作業ディレクトリで実行する
- Then: 判定ステップは正常終了し、`npm ci` 実行可否と `npm run build` 実行可否を別個の2つの判定結果として出力する。`npm ci` 実行可否は lockfile 不在により「不可」となり、`npm run build` 実行可否は `scripts.build` が有効に定義されていても `npm ci` 実行可否が成立しないため「不可」となる。これによりワークフロー定義上の `npm ci` ステップ・`npm run build` ステップのいずれも実行条件が成立せず、依存を導入しないままの build 実行は発生しない。加えて、実行に用いる判定ステップの実体は、配布正本ワークフロー YAML 内の当該ステップ定義から機械的に抽出したものであり、抽出結果が抽出元の記述と一致することを検証手順自身が確認する
- 検証方法見込み: `automated`

#### AC-8: CLI が解決可能な構成では CLI 保証ステップが成功し CLI が使える状態になる

- Given: agent-skill-chain CLI を 3 経路（リポジトリ内のビルド成果物、`node_modules` 配下の実行ファイル、`PATH` 上のコマンド）のうち少なくとも 1 経路で解決できる模擬作業ディレクトリ
- When: 配布正本の root-cleanup ワークフローが持つ CLI 保証ステップの実体を、その作業ディレクトリで実行する。実行に用いるステップの実体は、配布正本ワークフロー YAML 内の当該ステップ定義から機械的に抽出したものであり、抽出結果が抽出元の記述と一致することを検証手順自身が確認する
- Then: ステップは終了コード 0 で正常終了し、実行後の同作業ディレクトリにおいて agent-skill-chain CLI が 3 経路のいずれかで解決可能な状態である
- 検証方法見込み: `automated`

#### AC-9: CLI を用意できない構成では CLI 保証ステップが非ゼロ終了で明示的に失敗する

- Given: 3 経路のいずれでも agent-skill-chain CLI を解決できず、かつネットワーク経由の自動導入も成立しない模擬作業ディレクトリ
- When: 配布正本の root-cleanup ワークフローが持つ CLI 保証ステップの実体を、その作業ディレクトリで実行する。実行に用いるステップの実体は、配布正本ワークフロー YAML 内の当該ステップ定義から機械的に抽出したものであり、抽出結果が抽出元の記述と一致することを検証手順自身が確認する
- Then: ステップは沈黙して続行せず、非ゼロの終了コードで終了し、CLI を用意できなかったことを示すメッセージを出力する。すなわち CLI 未検出が後続の除去処理・root clean 検証ステップへ黙って伝播することはなく、ワークフロー実行はその時点で明示的な失敗として顕在化する
- 検証方法見込み: `automated`

## スコープ外

- 非公開の実 consumer リポジトリ上で GitHub Actions を実際に起動しての最終確認。本 Issue の検証は、ワークフロー定義の構造検査と、ステップ実体をローカルの模擬構成で実行する自動テストによって代替する。
- `agent-skill-chain-ci.yml` の変更。同ファイルは既に同種の是正を受け取っており、本 Issue では変更しない。
- `agent-skill-chain-risk.yml` の変更。同ファイルは npm に依存しないため本件の影響を受けない。
- root-cleanup が除去対象とするファイル集合の変更、除去処理そのもののロジック変更、admin merge・シークレット運用の変更。
- agent-skill-chain CLI の解決経路・自動導入ロジック自体の仕様変更、および「ネットワーク経由の自動導入が実環境で成立すること」の是正・保証。本 Issue は既存の共有 CLI 解決実装を呼び出すのみとする。本 Issue が保証するのは次の 2 点に限る。(1) npm 前提の不成立を理由に root-cleanup が失敗しないこと。(2) CLI を用意できない場合に、CLI 保証ステップが沈黙して続行せず非ゼロ終了で明示的に失敗し、失敗ポイントが後続ステップへ黙って移動しないこと。「非 Node.js consumer において CLI が必ず用意できること」は本 Issue では保証しない。この境界を採る理由は、自動導入経路そのものの不成立は本 Issue の変更対象（root-cleanup ワークフロー定義）の外側にある独立した欠陥であり、ワークフロー定義側の修正では解消できないためである。よって本 Issue では、npm 前提判定ステップと同じく CLI 保証ステップについても実体を模擬構成で実行する振る舞い検証を課したうえで、その判定対象を「解決可能な場合の成功」と「解決不能な場合の明示的失敗」に限定する。由来・根拠の補助情報: GitHub Issue #683（自動導入経路そのものの是正を担当する別 Issue）。
- 配布済み consumer への遡及適用手段（`upgrade` 実行の代行など）の提供。
