import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 呼び出し元moduleが実行entryかどうかを判定する。
 *
 * **symlink経由の起動では単純な完全一致が偽になる。** Node.jsのESM loaderが解決する
 * `import.meta.url`は実体pathであるのに対し、`process.argv[1]`は起動時のsymlink pathを
 * 保持するためである。**判定を誤ると検査本体が実行されないまま終了値0で終わり、失敗では
 * なく無言の合格として現れる。**
 *
 * 双方をrealpathへ正規化してから比較する。解決できない場合は正規化前の値で比較する。
 * 判定を1箇所へ集約するのは、同じ形が独立に書かれるたびに正規化が抜け落ちるためである。
 *
 * @param moduleUrl 呼び出し元の`import.meta.url`
 */
export function isExecutionEntry(moduleUrl: string): boolean {
  const argv = process.argv[1];
  if (!argv) return false;
  const resolve = (target: string): string => {
    try {
      return fs.realpathSync(target);
    } catch {
      return target;
    }
  };
  return resolve(path.resolve(argv)) === resolve(fileURLToPath(moduleUrl));
}
