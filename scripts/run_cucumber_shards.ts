import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfiguration, loadSources } from "@cucumber/cucumber/api";
import { isExecutionEntry } from "../src/lib/entrypoint.js";

/**
 * 全Cucumberをscenario単位で複数processへ分配して並列に実行する（Issue #1508）。
 *
 * **cucumberの`--parallel`は使わない。** cucumber 13はworker_threads方式であり、1 processから
 * 全workerの子processをforkするため短縮せず（直列13m23sに対し13m38s）、`process.umask()`を
 * 変えるscenarioが失敗する。ここではshardごとに独立したprocessを起動する。
 *
 * **cucumberの終了値だけを信用しない。** 位置指定が一致しなければcucumberは0件を実行して
 * 成功を返しうる。各shardのmessage記録から実際に実行したscenario位置を導き、割当と完全一致
 * することを成功の条件に含める。
 *
 * 純関数とmainを1 fileに置くのは、品質gateのtest選択に使う時点で保護対象へ加える閉包を
 * このfileだけに限るためである。
 */

/** shard数を上書きする環境変数。 */
export const SHARD_COUNT_ENV = "ASC_TEST_SHARDS";

/**
 * shard数を決める。環境変数があればその値、無ければ実行環境の並列度を使い、scenario数を
 * 上限とする。空shardを作らないためである。
 *
 * @param envValue 環境変数`ASC_TEST_SHARDS`の値
 * @param parallelism 実行環境の並列度
 * @param scenarioCount 全scenario数
 */
export function resolveShardCount(
  envValue: string | undefined,
  parallelism: number,
  scenarioCount: number,
): number {
  let requested = parallelism;
  if (envValue !== undefined) {
    if (!/^[1-9][0-9]*$/u.test(envValue))
      throw new Error(
        `${SHARD_COUNT_ENV}は1以上の10進整数が必要です: ${JSON.stringify(envValue)}`,
      );
    requested = Number(envValue);
  }
  return Math.max(1, Math.min(requested, scenarioCount));
}

/**
 * scenario位置をshardへround-robinで分配する。
 *
 * 同じfileの隣接scenarioは所要時間が近いため、round-robinにすると各shardの所要時間が揃う。
 * 位置が重複すると同じscenarioを2回実行するか、照合で片方を見失うため、実行前に拒否する。
 *
 * @param locations `uri:line`形式のscenario位置
 * @param shardCount shard数（`resolveShardCount`の結果）
 */
export function partitionScenarios(
  locations: readonly string[],
  shardCount: number,
): string[][] {
  if (locations.length === 0)
    throw new Error("実行するscenarioが0件です。設定のpathsを確認してください");
  if (!Number.isInteger(shardCount) || shardCount < 1)
    throw new Error(`shard数は1以上の整数が必要です: ${shardCount}`);
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const location of locations) {
    if (seen.has(location)) duplicates.add(location);
    seen.add(location);
  }
  if (duplicates.size > 0)
    throw new Error(
      `scenario位置が重複しています: ${[...duplicates].sort().join(", ")}`,
    );
  const count = Math.min(shardCount, locations.length);
  const shards = Array.from({ length: count }, (): string[] => []);
  locations.forEach((location, index) => shards[index % count].push(location));
  return shards;
}

type Envelope = Record<string, unknown>;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nodeLine(
  node: Record<string, unknown> | undefined,
): number | undefined {
  const line = record(node?.location)?.line;
  return typeof line === "number" ? line : undefined;
}

/**
 * gherkinDocumentのscenarioとExamples行について、AST node IDから行番号への対応を作る。
 * Rule配下のscenarioも辿る。
 */
function collectAstLines(
  children: unknown[],
  lines: Map<string, number>,
): void {
  for (const child of children) {
    const entry = record(child);
    const rule = record(entry?.rule);
    if (rule) collectAstLines(list(rule.children), lines);
    const scenario = record(entry?.scenario);
    if (!scenario) continue;
    const id = scenario.id;
    const line = nodeLine(scenario);
    if (typeof id === "string" && line !== undefined) lines.set(id, line);
    for (const examples of list(scenario.examples))
      for (const row of list(record(examples)?.tableBody)) {
        const rowRecord = record(row);
        const rowLine = nodeLine(rowRecord);
        if (typeof rowRecord?.id === "string" && rowLine !== undefined)
          lines.set(rowRecord.id, rowLine);
      }
  }
}

/**
 * cucumberのmessage記録（ndjson）から、開始して完了したscenarioの位置を導く。
 *
 * 位置は`loadSources`と同じく、Scenario Outlineの例はExamples行、それ以外はScenario行とする。
 * 再試行されるtest caseの途中の完了は数えない。
 *
 * @param ndjson `--format message:<file>`の内容
 */
export function executedLocations(ndjson: string): string[] {
  const astLines = new Map<string, number>();
  const pickles = new Map<string, { uri: string; astNodeIds: string[] }>();
  const testCasePickle = new Map<string, string>();
  const startedTestCase = new Map<string, string>();
  const executed = new Set<string>();
  const finished: string[] = [];
  for (const line of ndjson.split("\n")) {
    if (line.trim() === "") continue;
    const envelope = JSON.parse(line) as Envelope;
    const document = record(envelope.gherkinDocument);
    if (document)
      collectAstLines(list(record(document.feature)?.children), astLines);
    const pickle = record(envelope.pickle);
    if (
      pickle &&
      typeof pickle.id === "string" &&
      typeof pickle.uri === "string"
    )
      pickles.set(pickle.id, {
        uri: pickle.uri,
        astNodeIds: list(pickle.astNodeIds).filter(
          (id): id is string => typeof id === "string",
        ),
      });
    const testCase = record(envelope.testCase);
    if (
      testCase &&
      typeof testCase.id === "string" &&
      typeof testCase.pickleId === "string"
    )
      testCasePickle.set(testCase.id, testCase.pickleId);
    const started = record(envelope.testCaseStarted);
    if (
      started &&
      typeof started.id === "string" &&
      typeof started.testCaseId === "string"
    )
      startedTestCase.set(started.id, started.testCaseId);
    const done = record(envelope.testCaseFinished);
    if (
      done &&
      typeof done.testCaseStartedId === "string" &&
      done.willBeRetried !== true
    )
      finished.push(done.testCaseStartedId);
  }
  for (const startedId of finished) {
    const testCaseId = startedTestCase.get(startedId);
    const pickleId =
      testCaseId === undefined ? undefined : testCasePickle.get(testCaseId);
    const pickle = pickleId === undefined ? undefined : pickles.get(pickleId);
    const nodeId = pickle?.astNodeIds.at(-1);
    const nodeLineNumber =
      nodeId === undefined ? undefined : astLines.get(nodeId);
    if (pickle && nodeLineNumber !== undefined)
      executed.add(`${pickle.uri}:${nodeLineNumber}`);
  }
  return [...executed].sort();
}

/** 1 shardの実行結果。`executed`が`null`ならmessage記録を読めなかった。 */
export interface ShardResult {
  index: number;
  assigned: readonly string[];
  exitCode: number | null;
  signal: string | null;
  executed: readonly string[] | null;
  elapsedSeconds: number;
}

/** 集約の結果。`lines`はshard別と全体の要約行。 */
export interface ShardAggregate {
  passed: boolean;
  lines: string[];
}

/**
 * shard結果を集約する。1 shardでも失敗すれば全体を失敗とする。
 *
 * shardの失敗は、非0終了、signal終了、message記録の欠落、割当と実行集合の不一致のいずれか
 * である。終了値0でも実行集合が割当と一致しなければ失敗とする。
 *
 * @param results 全shardの結果
 */
export function aggregateShardResults(
  results: readonly ShardResult[],
): ShardAggregate {
  const lines: string[] = [];
  let passed = results.length > 0;
  let assignedTotal = 0;
  let executedTotal = 0;
  for (const result of results) {
    const problems: string[] = [];
    if (result.signal !== null) problems.push(`signal ${result.signal}で終了`);
    else if (result.exitCode !== 0)
      problems.push(`終了値${String(result.exitCode)}`);
    assignedTotal += result.assigned.length;
    if (result.executed === null) {
      problems.push("message記録を読めません");
    } else {
      executedTotal += result.executed.length;
      const executed = new Set(result.executed);
      const assigned = new Set(result.assigned);
      const missing = result.assigned.filter((item) => !executed.has(item));
      const unexpected = result.executed.filter((item) => !assigned.has(item));
      if (missing.length > 0)
        problems.push(`未実行のscenario位置: ${missing.join(", ")}`);
      if (unexpected.length > 0)
        problems.push(`割当外のscenario位置: ${unexpected.join(", ")}`);
    }
    if (problems.length > 0) passed = false;
    lines.push(
      `shard ${result.index + 1}/${results.length}: 割当${result.assigned.length}件 実行${result.executed?.length ?? "不明"}件 ${result.elapsedSeconds.toFixed(0)}s ${problems.length === 0 ? "成功" : `失敗（${problems.join("。")}）`}`,
    );
  }
  lines.push(
    `全体: ${results.length} shard、割当${assignedTotal}件、実行${executedTotal}件、${passed ? "成功" : "失敗"}`,
  );
  return { passed, lines };
}

function optionValue(
  args: readonly string[],
  name: string,
): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

/**
 * 列挙に使った設定から、shardの実行設定を導く。
 *
 * **shardの実行設定を別fileから読まない。** 保護されていない設定を読むと、候補がそこへ
 * `dryRun`などを加えて全scenarioを実行したことにできる。保護対象の列挙設定から`paths`だけを
 * 空にした設定を一時directoryへ書き、位置引数と合算されないようにする。
 */
async function prepareRun(
  configFile: string,
  workDirectory: string,
): Promise<{ locations: string[]; runConfig: string }> {
  const { useConfiguration, runConfiguration } = await loadConfiguration({
    file: configFile,
  });
  const { plan, errors } = await loadSources(runConfiguration.sources);
  /**
   * **構文errorのfeatureを落として続行しない。** 直列実行ではparse errorで失敗するfeatureが、
   * 列挙の結果から消えるだけで成功へ変わる。
   */
  if (errors.length > 0)
    throw new Error(
      `featureを読み込めません: ${errors
        .map((error) => `${error.uri}:${error.location.line} ${error.message}`)
        .join("; ")}`,
    );
  /** JSON設定は最上位keyをprofile名として読むため、既定profile`default`へ置く。 */
  const runConfig = path.join(workDirectory, "run-config.json");
  fs.writeFileSync(
    runConfig,
    `${JSON.stringify({ default: { ...useConfiguration, paths: [] } })}\n`,
  );
  return {
    locations: plan.map((item) => `${item.uri}:${item.location.line}`),
    /** cucumberは`--config`の絶対pathもcwdへ連結して読むため、cwdからの相対pathで渡す。 */
    runConfig: path.relative(process.cwd(), runConfig),
  };
}

interface RunningShard {
  child: ReturnType<typeof spawn>;
  output: () => string;
}

function runShard(
  index: number,
  assigned: readonly string[],
  runConfig: string,
  workDirectory: string,
  running: RunningShard[],
): Promise<{ result: ShardResult; output: string }> {
  const messageFile = path.join(workDirectory, `shard-${index}.ndjson`);
  const started = Date.now();
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "./node_modules/@cucumber/cucumber/bin/cucumber.js",
        "--config",
        runConfig,
        "--format",
        `message:${messageFile}`,
        ...assigned,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    running.push({ child, output: () => output });
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const finish = (exitCode: number | null, signal: string | null): void => {
      if (settled) return;
      settled = true;
      let executed: string[] | null;
      try {
        executed = executedLocations(fs.readFileSync(messageFile, "utf8"));
      } catch {
        executed = null;
      }
      resolve({
        result: {
          index,
          assigned,
          exitCode,
          signal,
          executed,
          elapsedSeconds: (Date.now() - started) / 1000,
        },
        output,
      });
    };
    child.on("error", (error) => {
      output += `${error.message}\n`;
      finish(null, null);
    });
    child.on("close", (code, signal) => finish(code, signal));
  });
}

/**
 * 停止signalを受けたら、子processへ転送し、それまでの出力を書き出し、一時directoryを消して
 * 失敗で終える。CI jobの時間切れでも、どのshardが何を実行していたかを残すためである。
 */
function stopOnSignal(
  running: readonly RunningShard[],
  workDirectory: string,
): () => void {
  const handler = (signal: NodeJS.Signals): void => {
    for (const [index, shard] of running.entries()) {
      shard.child.kill(signal);
      process.stdout.write(
        `\n===== shard ${index + 1}（${signal}で中断） =====\n${shard.output()}`,
      );
    }
    fs.rmSync(workDirectory, { recursive: true, force: true });
    process.exit(1);
  };
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
}

async function main(args: readonly string[]): Promise<number> {
  const configFile = optionValue(args, "config") ?? "cucumber.mjs";
  const workDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "asc-cucumber-shards-"),
  );
  const running: RunningShard[] = [];
  const release = stopOnSignal(running, workDirectory);
  try {
    const { locations, runConfig } = await prepareRun(
      configFile,
      workDirectory,
    );
    const shardCount = resolveShardCount(
      process.env[SHARD_COUNT_ENV],
      os.availableParallelism(),
      locations.length,
    );
    const shards = partitionScenarios(locations, shardCount);
    process.stdout.write(
      `${locations.length}件のscenarioを${shards.length} shardで実行します\n`,
    );
    const runs = await Promise.all(
      shards.map((assigned, index) =>
        runShard(index, assigned, runConfig, workDirectory, running).then(
          (run) => {
            process.stdout.write(
              `\n===== shard ${index + 1}/${shards.length} =====\n${run.output}`,
            );
            return run;
          },
        ),
      ),
    );
    const aggregate = aggregateShardResults(runs.map((run) => run.result));
    process.stdout.write(`\n${aggregate.lines.join("\n")}\n`);
    return aggregate.passed ? 0 : 1;
  } finally {
    release();
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
}

if (isExecutionEntry(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    },
  );
}
