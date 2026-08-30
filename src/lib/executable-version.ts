import { run } from "./process.js";

export interface ExecutableVersionObservation {
  command: string;
  minimumVersion: string;
  version: string | null;
  supported: boolean;
  diagnostic: string | null;
}

export const MINIMUM_GIT_VERSION = "2.38.0";
export const MINIMUM_GH_VERSION = "2.13.0";

function versionTuple(value: string): [number, number, number] | null {
  const match =
    /(?:^|\s)v?(\d+)\.(\d+)(?:\.(\d+))?(?!\.\d)(?=$|[^\p{L}\p{N}])/u.exec(
      value,
    );
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? "0")];
}

function versionAtLeast(
  actual: [number, number, number],
  minimum: [number, number, number],
): boolean {
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index]! > minimum[index]!) return true;
    if (actual[index]! < minimum[index]!) return false;
  }
  return true;
}

export function inspectExecutableVersion(
  command: string,
  args: string[],
  cwd: string,
  minimumVersion: string,
): ExecutableVersionObservation {
  const minimum = versionTuple(minimumVersion);
  if (!minimum) throw new Error(`最低version ${minimumVersion}が不正です`);
  const result = run(command, args, cwd, { allowFailure: true });
  if (result.status !== 0)
    return {
      command,
      minimumVersion,
      version: null,
      supported: false,
      diagnostic: `${command} ${minimumVersion}以上を確認できません: ${result.stderr.trim() || `終了値${result.status}`}`,
    };
  return inspectExecutableVersionOutput(
    command,
    `${result.stdout}\n${result.stderr}`,
    minimumVersion,
  );
}

export function inspectExecutableVersionOutput(
  command: string,
  output: string,
  minimumVersion: string,
): ExecutableVersionObservation {
  const minimum = versionTuple(minimumVersion);
  if (!minimum) throw new Error(`最低version ${minimumVersion}が不正です`);
  const actual = versionTuple(output);
  if (!actual)
    return {
      command,
      minimumVersion,
      version: null,
      supported: false,
      diagnostic: `${command}のversionを判定できません`,
    };
  const version = actual.join(".");
  const supported = versionAtLeast(actual, minimum);
  return {
    command,
    minimumVersion,
    version,
    supported,
    diagnostic: supported
      ? null
      : `${command} ${minimumVersion}以上が必要です: 観測値=${version}`,
  };
}

export function assertMinimumExecutableVersion(
  command: string,
  args: string[],
  cwd: string,
  minimumVersion: string,
): ExecutableVersionObservation {
  const observed = inspectExecutableVersion(command, args, cwd, minimumVersion);
  if (!observed.supported)
    throw new Error(observed.diagnostic ?? `${command}のversionが不正です`);
  return observed;
}
