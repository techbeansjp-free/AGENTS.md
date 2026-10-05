import {
  assertReleaseIntegrity,
  remoteDefaultTip,
} from "./check_file_audit.js";

// PR証跡の配置はPR CIが検査する。配布では実際のmerge結果を検査する。
const root = process.cwd();
assertReleaseIntegrity(root, remoteDefaultTip(root));
process.stdout.write("release merge integrity: passed\n");
