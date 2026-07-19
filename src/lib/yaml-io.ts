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

export { stringify as toYamlString };
