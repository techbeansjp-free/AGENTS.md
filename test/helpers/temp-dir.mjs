import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
// Create a new temporary directory and return its real path. On macOS os.tmpdir() is under /var, a symlink to
// /private/var, and product code compares canonical paths. Tests create temporary directories only through this
// helper; test_temp_dir.mjs rejects direct mkdtempSync calls.
export function tempDir(prefix){return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),prefix)));}
