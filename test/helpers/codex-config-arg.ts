import assert from 'node:assert/strict';

/**
 * Codex adapter が組み立てる `-c key=<value>` は、消費側の `/bin/bash -c` による shell 層の
 * 再解釈と、Codex 側による TOML 層の解釈という別々の2層を通る。片方だけを検証しても、
 * 引用符・空白・バックスラッシュを含む値が壊れる経路を検出できない。
 *
 * ここでは Codex stub が実際に受け取った argv（shell 層通過後）を入力とし、TOML basic string
 * として厳密に復号して元の値と突き合わせる。復号できない値は不正な TOML であり失敗とする。
 */

/** stub が1行1引数で記録した argv ログを配列へ戻す。記録側が付ける末尾改行だけを取り除く。 */
export function readStubArgv(contents: string): string[] {
  const normalized = contents.endsWith('\n') ? contents.slice(0, -1) : contents;
  return normalized === '' ? [] : normalized.split('\n');
}

/**
 * TOML basic string リテラルを復号する。TOML が basic string で定義する escape のうち、
 * adapter が生成しうる `\\` と `\"` だけを受理し、それ以外の裸の `"` やバックスラッシュは
 * 不正な TOML として失敗させる。
 */
export function decodeTomlBasicString(literal: string): string {
  assert.ok(
    literal.length >= 2 && literal.startsWith('"') && literal.endsWith('"'),
    `TOML basic string リテラルとして引用符で囲まれていること (received=${JSON.stringify(literal)})`,
  );
  const body = literal.slice(1, -1);
  let decoded = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '\\') {
      assert.notEqual(ch, '"', `終端前に escape されていない " があり TOML として不正 (received=${JSON.stringify(literal)})`);
      decoded += ch;
      continue;
    }
    const escaped = body[i + 1];
    assert.ok(
      escaped === '\\' || escaped === '"',
      `adapter が生成しない escape sequence を検出 (received=${JSON.stringify(literal)})`,
    );
    decoded += escaped;
    i += 1;
  }
  return decoded;
}

/**
 * argv から `<key>=<TOML basic string>` の形の config 引数を1つ取り出し、値を復号して返す。
 * 該当引数が無い場合は失敗させる（起動列から欠落する退行も検出するため）。
 */
export function decodeCodexConfigValue(argv: string[], key: string): string {
  const prefix = `${key}=`;
  const matched = argv.filter((arg) => arg.startsWith(prefix));
  assert.equal(matched.length, 1, `${key} の config 引数がちょうど1つ届くこと (argv=${JSON.stringify(argv)})`);
  return decodeTomlBasicString(matched[0].slice(prefix.length));
}

/**
 * 起動列に手書きのバックスラッシュが残っていないことを、静的な config 引数の実測値で確かめる。
 * Issue #744: `-c 'approval_policy=\"never\"'` のような手書き escape は、消費側の再解釈段数が
 * 変わると余分なバックスラッシュを Codex へ渡し、不正な TOML になる。
 */
export const CODEX_REVIEWER_STATIC_CONFIG_ARGS = [
  'approval_policy="never"',
  'shell_environment_policy.inherit="none"',
  'shell_environment_policy.include_only=["PATH"]',
  'default_permissions="review"',
  'permissions.review.filesystem={":workspace_roots"={"."="read"},"/home"="deny","/Users"="deny","/root"="deny"}',
] as const;
