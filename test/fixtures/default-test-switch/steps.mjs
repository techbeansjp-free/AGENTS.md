import { Given } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import fs from "node:fs";

Given("fixture succeeds", () => {
  assert.equal(fs.readFileSync("compiled", "utf8"), "yes");
  assert.equal(fs.existsSync("inject-failure"), false);
});
