import { Given } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import fs from "node:fs";

fs.writeFileSync("cucumber-started", "yes");

Given("fixture succeeds", () => {
  if (fs.existsSync("conformance-mode"))
    assert.match(
      fs.readFileSync("dist/bin/agent-skill-chain.js", "utf8"),
      /fresh-source/u,
    );
  assert.equal(fs.readFileSync("compiled", "utf8"), "yes");
  assert.equal(fs.existsSync("inject-failure"), false);
});
