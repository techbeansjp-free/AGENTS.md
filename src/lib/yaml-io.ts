import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse, stringify } from 'yaml';

export function readYamlFile<T = unknown>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf8');
  return parse(raw) as T;
}

export function tryReadYamlFile<T = unknown>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  return readYamlFile<T>(filePath);
}

/** 中断・競合時に壊れたファイルを残さないよう、tmpファイル書込み+rename で原子的に書き込む。 */
export function writeYamlFileAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmpPath, stringify(data), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

/**
 * OS提供の排他的ファイル作成（`O_CREAT|O_EXCL|O_WRONLY`相当の `wx` フラグ）で書き込む。
 * 既存ファイルが存在すれば例外を投げずに `false` を返し、成功時は `true` を返す
 * （呼び出し元がread-check-then-writeを介さず、真のcompare-and-setとして扱えるようにするため。
 * ISSUE-176 DESIGN.md §ローカルモードの原子性強化）。`EEXIST` 以外の例外は呼び出し元へ再送出する。
 */
export function writeYamlFileExclusive(filePath: string, data: unknown): boolean {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(filePath, stringify(data), { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

export { stringify as toYamlString };
