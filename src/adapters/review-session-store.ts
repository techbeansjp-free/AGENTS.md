import fs from "node:fs";
import path from "node:path";

import { parseJsonStrict } from "../lib/security.js";
import {
  parseReviewSessionState,
  type ReviewSessionState,
} from "../domain/review-convergence.js";
import { assertWorkflowStaging } from "./workflow-journal.js";

export const REVIEW_SESSION_FILE = "review-session.json";

function assertRegularSessionFile(file: string): void {
  const stat = fs.lstatSync(file);
  if (
    stat.isSymbolicLink() ||
    !stat.isFile() ||
    stat.nlink !== 1 ||
    stat.size > 2 * 1024 * 1024 ||
    fs.realpathSync(file) !== file
  )
    throw new Error(
      "review sessionはsymlink・hardlinkでない2MiB以下の通常fileが必要です",
    );
}

export function readStoredReviewSession(
  stagingInput: string,
): ReviewSessionState | null {
  const staging = assertWorkflowStaging(stagingInput);
  const file = path.join(staging, REVIEW_SESSION_FILE);
  if (!fs.existsSync(file)) return null;
  assertRegularSessionFile(file);
  return parseReviewSessionState(
    parseJsonStrict(fs.readFileSync(file, "utf8"), "review session"),
  );
}
