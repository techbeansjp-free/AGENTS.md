import fs from "node:fs";
import path from "node:path";

const output = path.resolve("dist");
if (fs.existsSync(output)) fs.rmSync(output, { recursive: true });
