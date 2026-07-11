# RELEASE / publish 手順（メンテナ向け・正本）

本ドキュメントは `agent-skill-chain`（unscoped public・CLI コマンド名は `agents-md`）の **npm publish / marketplace 公開手順の詳細正本**である。README §リリース手順は入口リンクと要約のみを持ち、詳細はここに一本化する（重複させない）。

> **重要（実 publish はユーザー承認前提）**
>
> - **現在 自動リリースは無効化（dormant）されており、実 publish は発火しない**（再開手順は §5）。再開後の実 publish（`npm publish` 本実行・再開後の main push 起点の CI publish 発火）は、必ずユーザーの明示承認を得てから行う。承認なしに publish しない。
> - 実 publish には **`NPM_TOKEN`（npmjs の Automation トークン）が必須**。CI の Secrets に設定したときのみ publish step が発火する。ローカルから実 publish しない（publish は CI 上でのみ行う）。
> - **検証フェーズ（pack / `--dry-run` / CLI 起動確認）では実 publish を行わない。** 検証はすべて read-only / dry-run であり、配布物・npm レジストリを書き換えない。

---

## 0. 前提

| 前提 | 内容 |
| ---- | ---- |
| npm | `>=7`（`npm pack --dry-run --json` が必要）。検証時の実測例: npm 10.x。 |
| node | `>=20`（`package.json` の `engines.node`）。 |
| 認証 | 実 publish は CI の `NPM_TOKEN` secret で行う。ローカル検証（dry-run）は**認証不要**。 |
| 配布範囲 | `.npmignore` は無く、配布対象は [`package.json`](../../package.json) の `files` のみで制御する。 |

前提確認:

```bash
npm -v   # >=7
node -v  # >=20
```

不足時は検証・publish を成立させられない。スキップせず前提不足として明示的に止めること。

---

## 0.1. パッケージ名と将来の組織移管（unscoped）

本パッケージは **unscoped public** 名 `agent-skill-chain` で公開する（過去に検討した scoped 名は廃止）。CLI コマンド名 `agents-md` はパッケージ名と独立であり据え置く（後方互換のため改名しない）。

- **初回公開前の確認**: 初回 publish の直前に `npm view agent-skill-chain version` を実行し、**404（未公開）であること**を確認する。既に同名が存在する場合は別名を検討する（unscoped 名はグローバル一意のため）。
- **将来の組織移管（名前は不変）**: 個人/組織アカウント間で公開済みパッケージを移す場合は、**npm の所有権移管（npm owner / npm access）で行い、パッケージ名は変更しない**。unscoped 名はアカウントに紐付かず**名前を保ったまま owner（メンテナ/Team）を付け替えられる**ため、移管時に利用者の `npx agent-skill-chain` 参照は壊れない。
  - 手順の骨子: ①移管先アカウント/Org を用意 → ②`npm owner add <new-owner> agent-skill-chain`（または Org への `npm access grant`）で権限付与 → ③旧 owner を外す（`npm owner rm <old-owner> agent-skill-chain`）。**名前そのものの改名（unpublish→republish）はしない**（バージョン履歴・dist-tag・依存解決の継続性のため）。
  - 移管は高リスク操作であり、ユーザーの明示承認後にのみ実施する（実 publish と同様）。

---

## 1. version 同期（package.json ⇔ plugin.json）

version の正本は `package.json` 1 か所。Claude プラグイン正本 [`.agent-skill-chain/source/platforms/claude/plugin.json`](../../.agent-skill-chain/source/platforms/claude/plugin.json) を一致させる。ロジックの正本は [`.agent-skill-chain/source/scripts/sync-version.sh`](../../.agent-skill-chain/source/scripts/sync-version.sh)。

```bash
bash .agent-skill-chain/source/scripts/sync-version.sh --check   # 一致を検証（CI ゲートと同じ。不一致なら exit 1）
bash .agent-skill-chain/source/scripts/sync-version.sh --write   # package.json の version を plugin.json へ注入して揃える
```

**期待結果**: `--check` が `[sync-version] OK: version 一致（X.Y.Z）` を出し exit 0。

> CI（[`.github/workflows/release.yml`](../../.github/workflows/release.yml)）は再開後、bump 後の `package.json`・`plugin.json` の version 一致を検証する（タグ起点の三者一致比較は撤去済み。日時タグはリリースの目印であり semver と独立）。**現在は dormant のため発火しない**（§5 参照）。

---

## 1.5. publish 前ビルド（生成 bin の同梱）

配布 `bin/agents-md.js` は `src/agents-md.ts` から `tsc` で生成する **非追跡（`.gitignore`）の生成物**である（正本として追跡するのは `src/agents-md.ts` のみ）。`prepack` を再導入しない（pack の lifecycle script 副作用が node_modules 無しのクリーン clone を壊す地雷を避ける）。`npm publish`/`npm pack` は**作業ツリー**をパックするため、publish 直前に `npm ci && npm run build` で作業ツリーへ bin を生成すれば、非追跡でも tarball に最新の生成 bin が同梱される（使用前 build 方式）。

```bash
npm ci                                   # devDependencies(typescript,@types/node) を導入
npm run build                            # src -> bin を生成（作業ツリーに bin を用意。shebang/実行権限付与）
```

**期待結果**: `npm run build` が exit 0 で `bin/agents-md.js`（`#!/usr/bin/env node`・実行権限付き）を生成する。bin は非追跡のため `git diff` / `git status` には現れない（src を変更しても未ビルド bin がコミットされる事故が原理的に起きない）。同梱の最終確認は §2 の `verify-npm-pack.sh`（必須物 `bin/agents-md.js` あり・src/map/lock/tsconfig 漏れ無し）で行う。

> CI（[`.github/workflows/release.yml`](../../.github/workflows/release.yml)）の npm publish ジョブも publish 前に `npm ci && npm run build` を実行し、生成 bin を含めて配布する。`self-enforce.yml` の step「CLI typecheck & build」も同様に build 前置で REPO_ROOT/bin を後続 step（pack・E2E）へ供給する。bin 非追跡化により未ビルド配布の防止は「使用前 build＋`verify-npm-pack.sh` の必須物検査」で担保し、旧方式の「追跡 bin の差分ゼロ検証」は廃止した。

---

## 2. pack 同梱物検査（リーク / 必須物）

配布 tarball にリポ固有物（`.agent-skill-chain/project/`・`docs/maintainer/`・`workflow.db`・`.adapters/`・`.agent-skill-chain/runtime/` issue）が混入せず、必須の正本配布物がすべて含まれることを機械判定する。ロジックの正本は [`.agent-skill-chain/source/scripts/verify-npm-pack.sh`](../../.agent-skill-chain/source/scripts/verify-npm-pack.sh)（CI とローカルの単一正本。ロジックを二重化しない）。

```bash
bash .agent-skill-chain/source/scripts/verify-npm-pack.sh
```

**期待結果**: exit 0。`[OK] 禁止パターン … は含まれていません。` と `[OK] 必須の正本配布物 … はすべて含まれています。` が出る。違反時は exit 1（LEAK/MISSING を列挙）、npm/node 不在時は exit 2。

---

## 3. publish dry-run（健全性検査）

実公開せずに publish の警告/エラー・公開対象・access を確認する。**認証不要**（dry-run）。

```bash
npm publish --dry-run
```

**期待結果**:

- exit 0。
- 末尾に `… with tag latest and public access (dry-run)` が出る（`publishConfig.access=public` が反映されている）。
- 解決すべき警告（不正な `files`・欠落フィールド等）が無い。`This command requires you to be logged in …（dry-run）` は dry-run 時の定型表示であり、解決すべき警告ではない（実 publish は CI が `NODE_AUTH_TOKEN` で認証する）。

---

## 4. CLI 同梱・起動性確認（任意・強く推奨）

`npm pack` の tarball を `mktemp -d` 隔離環境へ展開し、同梱 CLI（`bin/agents-md.js`）の shebang・実行権限・起動を確認する（公開後の `npx` 相当を擬似確認）。**本リポを汚さないため必ず `mktemp -d` で行い、後始末する。**

```bash
tmp="$(mktemp -d)"
tgz="$(npm pack --pack-destination "$tmp" | tail -n1 | tr -d '\r')"
tar -xzf "$tmp/$tgz" -C "$tmp"
head -n1 "$tmp/package/bin/agents-md.js"          # => #!/usr/bin/env node
ls -l   "$tmp/package/bin/agents-md.js"           # => -rwxr-xr-x（実行権限）
node "$tmp/package/bin/agents-md.js" version       # => version 文字列 / exit 0
node "$tmp/package/bin/agents-md.js" help | head   # => usage / exit 0
rm -rf "$tmp"                                       # 後始末（必須）
```

**期待結果**: shebang `#!/usr/bin/env node` と実行権限が保持され、`version`/`help` が exit 0 で起動する。

---

## 5. 自動リリースの現状（dormant）と再開手順

> **現在 npm 公開は今後の課題として保留中であり、自動リリースは無効化（dormant）されている。** 自動リリース（[`.github/workflows/release.yml`](../../.github/workflows/release.yml)）は `on:` から `push: branches:[main]` を撤去し手動 `workflow_dispatch` のみとし、両 job（`release-npm`/`release-marketplace`）の `if:` に `vars.RELEASE_ENABLED == 'true'` ゲートを付与している。**main マージ・タグ push のいずれでも自動 publish/marketplace 公開は発火しない。** 案C の step 本体・SHA ピン・無限ループ防止策・`NPM_TOKEN` ゲートは資産として保持しており（削除でなく可逆な無効化）、本ドキュメントが再開手順の詳細正本である（README は要約＋リンク）。

> **このステップはユーザーの明示承認を得てから実施する。** §1〜§4 がすべて期待どおりであることを前提とする。再開後の実 publish と marketplace 公開はローカルからは行わず、**main への push（マージ）** をトリガに CI（[`.github/workflows/release.yml`](../../.github/workflows/release.yml)）が実行する（タグ push は発火条件ではない。日時タグはリリース後に CI が作る目印）。

### 5.1. 再開手順（最小 2 手＋前提）

1. **配布方法の確定**: 公開の配布方法（unscoped public 等）を確定する。
2. **`NPM_TOKEN` 登録（npm publish を行う場合）**: リポジトリ Secrets に `NPM_TOKEN`（npmjs の Automation トークン）を設定する。未設定だと publish step は skip される（marketplace 公開は影響を受けない）。
3. **起点の復活**: `release.yml` の `on:` に `push: branches:[main]` を戻す（dormant コメントを撤去し `workflow_dispatch` と併存させてよい）。
4. **ゲートの開放**: リポジトリ変数 `RELEASE_ENABLED=true` を設定する（Repository variables）。未設定/その他の値では両 job が skip されたままになる。

> 手順 3・4 の**両方**を満たしたときのみ自動リリースが再開する（起点除去＋ゲートの多層防御）。片方だけでは発火しない。

### 5.2. 再開後に CI が実行する内容（[`release.yml`](../../.github/workflows/release.yml)）

main への push（マージ）を契機に、`version` 同期検証 → `bash .agent-skill-chain/source/scripts/sync-version.sh --write` 相当の bump → 公開前検証 → 実 publish/marketplace 公開の順で進む。

- **npm publish ジョブ**: bump 後 version の `package.json`/`plugin.json` 一致検証 → `npm ci && npm run build`（非追跡 bin を作業ツリーに生成。`prepack` の代替＝使用前 build）→ `verify-npm-pack.sh`（リーク/必須物検査。必須物 `bin/agents-md.js` を確認）→ `NPM_TOKEN` ゲート → `npm publish --access public`。`NPM_TOKEN` 未設定なら publish を skip。
- **marketplace ジョブ**: 正本 `.agent-skill-chain/source/` から `build-adapters.sh` で生成物を build し、決定性（再生成 diff ゼロ）を検証して `release/marketplace` ブランチへ commit/push する。

> push（main への push を含む）は高リスク操作であり、ユーザーが明示したときのみ行う。実 publish は CI の `NPM_TOKEN` 設定時に限られ、ローカルからは実 publish しない（§冒頭の安全弁）。

---

## 6. 参照

- [`.agent-skill-chain/source/scripts/sync-version.sh`](../../.agent-skill-chain/source/scripts/sync-version.sh) — version 同期（正本）
- [`.agent-skill-chain/source/scripts/verify-npm-pack.sh`](../../.agent-skill-chain/source/scripts/verify-npm-pack.sh) — pack 同梱物検査（CI/ローカル単一正本）
- [`.github/workflows/release.yml`](../../.github/workflows/release.yml) — main への push（マージ）起点の publish/marketplace CI（**現在 dormant＝無効化中**。再開手順は §5）
- [`README.md`](../../README.md) §リリース手順（メンテナ向け） — 入口リンク・要約
- [`package.json`](../../package.json)（`files`・`bin`・`publishConfig.access=public`）、[`LICENSE`](../../LICENSE)（MIT）、[`bin/agents-md.js`](../../bin/agents-md.js)
- [`docs/maintainer/adapters.md`](./adapters.md) — アダプタ生成方式（marketplace 生成物の解説）
