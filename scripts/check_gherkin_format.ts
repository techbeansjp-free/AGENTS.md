import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const featureRoot = path.join(root, "test", "features");
const layers = new Set(["unit", "integration", "e2e"]);
const japanese = /[\u3040-\u30ff\u3400-\u9fff]/u;
const header =
  /^\s*(Feature|Scenario(?: Outline)?|Given|When|Then|And|But):?\s+(.+?)\s*$/u;
const scenarioPattern =
  /^\s*Scenario(?: Outline)?:\s+(SCN-[A-Z0-9-]+)\s+(.+?)\s*$/u;
const step = /^\s*(Given|When|Then|And|But)\s+(.+?)\s*$/u;

interface ScenarioRecord {
  id: string;
  file: string;
  line: number;
  keywords: Set<string>;
}

function walk(directory: string, suffix: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const current = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(current, suffix);
    return entry.isFile() && entry.name.endsWith(suffix) ? [current] : [];
  });
}

const relative = (file: string): string =>
  path.relative(root, file).replaceAll(path.sep, "/");

export function checkGherkinFormat(): string[] {
  const files = walk(featureRoot, ".feature").sort();
  if (files.length === 0) return ["test/features配下に.featureがありません"];
  const errors: string[] = [];
  const scenarios: ScenarioRecord[] = [];
  const layerCounts = new Map([...layers].map((layer) => [layer, 0]));
  for (const file of files) {
    const selectedLayers = path
      .relative(featureRoot, file)
      .split(path.sep)
      .filter((part) => layers.has(part));
    if (selectedLayers.length !== 1)
      errors.push(
        `${relative(file)}: unit/integration/e2eのいずれか1 layer配下に置いてください`,
      );
    else
      layerCounts.set(
        selectedLayers[0]!,
        (layerCounts.get(selectedLayers[0]!) ?? 0) + 1,
      );
    let current: ScenarioRecord | undefined;
    let featureSeen = false;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      const stripped = line.trim();
      if (stripped.length === 0 || /^[#@|]/u.test(stripped)) continue;
      if (stripped.startsWith("Feature:")) featureSeen = true;
      const headerMatch = header.exec(line);
      if (headerMatch && !japanese.test(headerMatch[2]!))
        errors.push(
          `${relative(file)}:${index + 1}: ${headerMatch[1]}の説明本文を日本語で記述してください`,
        );
      const scenarioMatch = scenarioPattern.exec(line);
      if (scenarioMatch) {
        current = {
          id: scenarioMatch[1]!,
          file,
          line: index + 1,
          keywords: new Set(),
        };
        scenarios.push(current);
        continue;
      }
      const stepMatch = step.exec(line);
      if (stepMatch && current) current.keywords.add(stepMatch[1]!);
    }
    if (!featureSeen) errors.push(`${relative(file)}: Featureがありません`);
  }
  const seen = new Map<string, ScenarioRecord>();
  for (const scenario of scenarios) {
    const first = seen.get(scenario.id);
    if (first)
      errors.push(
        `${relative(scenario.file)}:${scenario.line}: SCN ID ${scenario.id}が重複しています (最初の定義: ${relative(first.file)}:${first.line})`,
      );
    else seen.set(scenario.id, scenario);
    for (const keyword of ["Given", "When", "Then"])
      if (!scenario.keywords.has(keyword))
        errors.push(
          `${relative(scenario.file)}:${scenario.line}: ${scenario.id}に${keyword}がありません`,
        );
  }
  for (const [layer, count] of [...layerCounts].sort())
    if (count === 0) errors.push(`${layer} layerに.featureがありません`);
  for (const file of walk(path.join(root, "test"), ".test.js"))
    errors.push(
      `${relative(file)}: Node test起票を残さずGherkin .featureへ移行してください`,
    );
  return errors;
}

const errors = checkGherkinFormat();
if (errors.length > 0) {
  process.stderr.write(
    `Gherkin形式検査: 失敗\n${errors.map((error) => `- ${error}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else
  process.stdout.write(
    "Gherkin形式検査: 合格（英語keyword・日本語説明、一意のSCN ID、全テスト層）\n",
  );
