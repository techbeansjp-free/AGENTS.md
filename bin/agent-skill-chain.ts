#!/usr/bin/env node
import { main } from "../src/cli.js";
import { serializeDiagnostic } from "../src/domain/enforcement.js";

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    const diagnostic = {
      ruleId: "ASC-CLI-VALIDATION-001",
      purpose: "CLI入力を安全に検証する",
      risk: "path",
      reasons: [error instanceof Error ? error.message : String(error)],
      scope: ["cli"],
      checks: ["command、path、scopeを検証した"],
      autoFixes: [],
      next: "入力、scope、authorityを確認して再実行してください",
      requiredAuthority: "不要",
      rollback: "状態を変更せず保持する",
    };
    process.stdout.write(
      `${JSON.stringify(serializeDiagnostic({ allowed: false, code: "ASC-CLI-VALIDATION-001", diagnostic }))}\n`,
    );
    process.exitCode = 1;
  });
