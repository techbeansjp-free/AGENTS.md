import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function publishDirectoryAtomic(
  destination: string,
  writer: (temporary: string) => void,
): void {
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    parent,
    `.pending-${process.pid}-${crypto.randomBytes(8).toString("hex")}`,
  );
  fs.mkdirSync(temporary, { mode: 0o700 });
  try {
    writer(temporary);
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

export function writeFileAtomic(destination: string, contents: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  fs.writeFileSync(temporary, contents, { mode: 0o600, flag: "wx" });
  try {
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}
