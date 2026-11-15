import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
// Create a new temporary directory and return its real path. On macOS os.tmpdir() is under /var, a symlink to
// /private/var, and product code compares canonical paths. Tests create temporary directories only through this
// helper; test_temp_dir.mjs rejects direct mkdtempSync calls. `parent` selects another base, such as a shared /var/tmp.
export function tempDir(prefix,parent=os.tmpdir()){return fs.realpathSync(fs.mkdtempSync(path.join(parent,prefix)));}
