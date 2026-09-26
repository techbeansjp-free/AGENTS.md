/**
 * **feature fileとstep定義fileの対応を静的に導出する**（REQ-WF-040）。
 *
 * Cucumberはstep定義を全feature共通の大域表として読み込むため、featureは
 * step定義fileへ構文上結び付いていない。影響集合（`impact-set.ts`）が
 * 「影響を受けたstep定義fileを使うfeature」を選ぶには、featureのstep本文を
 * step定義のpatternへ実際に照合するしかない。
 *
 * **照合の誤りは「featureを多く選ぶ」側へ倒す。** 変換できない構文は広い正規表現へ
 * 置き換え、どのpatternにも一致しないstepは`unmatched`として返す。
 * 呼び出し側はunmatchedを「どのstep定義を使うか分からないfeature」として扱う。
 */
const STEP_KEYWORD = /^(?:Given|When|Then|And|But|\*)\s+(.*)$/u;
const OUTLINE_KEYWORD = /^(?:Scenario Outline|Scenario Template):/u;
const BLOCK_KEYWORD = /^(?:Feature|Rule|Background|Scenario|Example|Scenario Outline|Scenario Template):/u;
const EXAMPLES_KEYWORD = /^(?:Examples|Scenarios):/u;
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&");
}
const PARAMETER_SOURCES = Object.freeze({
    string: `(?:"[^"]*"|'[^']*')`,
    int: "-?\\d+",
    float: "-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?",
    word: "[^\\s]+",
    "": ".*",
});
/** alternationを含まない1語をregex sourceへ変換する。 */
function convertExpressionFragment(fragment) {
    let output = "";
    for (let index = 0; index < fragment.length; index += 1) {
        const character = fragment[index];
        if (character === "\\" && index + 1 < fragment.length) {
            output += escapeRegex(fragment[index + 1]);
            index += 1;
            continue;
        }
        if (character === "{") {
            const end = fragment.indexOf("}", index);
            if (end < 0) {
                output += escapeRegex(character);
                continue;
            }
            const name = fragment.slice(index + 1, end);
            /** 独自parameter typeは実定義を読めないため、任意列として広く一致させる */
            output += PARAMETER_SOURCES[name] ?? ".*";
            index = end;
            continue;
        }
        if (character === "(") {
            const end = fragment.indexOf(")", index);
            if (end < 0) {
                output += escapeRegex(character);
                continue;
            }
            output += `(?:${convertExpressionFragment(fragment.slice(index + 1, end))})?`;
            index = end;
            continue;
        }
        output += escapeRegex(character);
    }
    return output;
}
/** 未escapeの`/`で区切る。`{}`と`()`の内側は区切らない。 */
function splitAlternation(word) {
    const parts = [];
    let current = "";
    let depth = 0;
    for (let index = 0; index < word.length; index += 1) {
        const character = word[index];
        if (character === "\\" && index + 1 < word.length) {
            current += character + word[index + 1];
            index += 1;
            continue;
        }
        if (character === "{" || character === "(")
            depth += 1;
        if ((character === "}" || character === ")") && depth > 0)
            depth -= 1;
        if (character === "/" && depth === 0) {
            parts.push(current);
            current = "";
            continue;
        }
        current += character;
    }
    parts.push(current);
    return parts;
}
/**
 * Cucumber Expressionを行全体へ一致するregex sourceへ変換する。
 *
 * alternation（`a/b`）の境界はCucumber Expressionsの文法と同じく、左が空白・`}`・
 * 先頭、右が空白・`{`・末尾である。したがって空白を持たない日本語の
 * `結果は{int}件/個`は`結果は` + 整数 + (`件`|`個`)になる。
 */
export function cucumberExpressionSource(expression) {
    let output = "";
    let run = "";
    const flush = () => {
        if (run === "")
            return;
        const alternatives = splitAlternation(run);
        output +=
            alternatives.length === 1
                ? convertExpressionFragment(run)
                : `(?:${alternatives.map(convertExpressionFragment).join("|")})`;
        run = "";
    };
    for (let index = 0; index < expression.length; index += 1) {
        const character = expression[index];
        if (character === "\\" && index + 1 < expression.length) {
            run += character + expression[index + 1];
            index += 1;
            continue;
        }
        if (/\s/u.test(character)) {
            flush();
            output += escapeRegex(character);
            continue;
        }
        if (character === "{") {
            const end = expression.indexOf("}", index);
            if (end >= 0) {
                flush();
                output += convertExpressionFragment(expression.slice(index, end + 1));
                index = end;
                continue;
            }
        }
        run += character;
    }
    flush();
    return `^${output}$`;
}
/** 照合の前段で候補を絞るための、patternが必ず持つ字面の先頭。 */
function literalPrefix(pattern) {
    if (pattern.kind === "regex")
        return "";
    const match = /^[^\\{(/]*/u.exec(pattern.source);
    const prefix = match?.[0] ?? "";
    /** alternationは空白境界まで遡るため、最後の空白より前だけを確定字面とする */
    return pattern.source.slice(prefix.length).startsWith("/")
        ? prefix.slice(0, prefix.search(/\S*$/u))
        : prefix;
}
function compilePattern(path, pattern) {
    const prefix = literalPrefix(pattern);
    try {
        return {
            path,
            prefix,
            regex: pattern.kind === "regex"
                ? new RegExp(pattern.source, pattern.flags.replace(/[gy]/gu, ""))
                : new RegExp(cucumberExpressionSource(pattern.source), "u"),
        };
    }
    catch {
        /** 解釈できないpatternは全stepへ一致させ、featureを多く選ぶ側へ倒す */
        return { path, prefix: "", regex: /^/u };
    }
}
/**
 * feature本文からstep本文を取り出す。Scenario OutlineはExamplesの各行で展開する。
 * 英語以外の`# language:`指定は解釈しない（`undefined`を返す）。
 */
export function parseFeatureSteps(text) {
    const lines = text.split(/\r?\n/u);
    const steps = [];
    let docString;
    let outlineSteps;
    let exampleHeader;
    let inExamples = false;
    const cells = (line) => line
        .trim()
        .replace(/^\||\|$/gu, "")
        .split("|")
        .map((cell) => cell.trim());
    for (const raw of lines) {
        const line = raw.trim();
        if (docString !== undefined) {
            if (line.startsWith(docString))
                docString = undefined;
            continue;
        }
        if (line.startsWith('"""') || line.startsWith("```")) {
            docString = line.slice(0, 3);
            continue;
        }
        const language = /^#\s*language\s*:\s*(\S+)/u.exec(line);
        if (language !== null && language[1] !== "en")
            return undefined;
        if (line === "" || line.startsWith("#") || line.startsWith("@"))
            continue;
        if (EXAMPLES_KEYWORD.test(line)) {
            inExamples = true;
            exampleHeader = undefined;
            continue;
        }
        if (BLOCK_KEYWORD.test(line)) {
            if (outlineSteps !== undefined && !inExamples)
                steps.push(...outlineSteps);
            outlineSteps = OUTLINE_KEYWORD.test(line) ? [] : undefined;
            inExamples = false;
            exampleHeader = undefined;
            continue;
        }
        if (line.startsWith("|")) {
            if (!inExamples || outlineSteps === undefined)
                continue;
            if (exampleHeader === undefined) {
                exampleHeader = cells(line);
                continue;
            }
            const values = cells(line);
            for (const step of outlineSteps)
                steps.push(exampleHeader.reduce((current, name, index) => current.split(`<${name}>`).join(values[index] ?? ""), step));
            continue;
        }
        const step = STEP_KEYWORD.exec(line);
        if (step === null)
            continue;
        if (outlineSteps !== undefined) {
            if (inExamples) {
                /** Examplesの後に続くstepは別blockの誤記とみなし、そのまま照合する */
                steps.push(step[1]);
                continue;
            }
            outlineSteps.push(step[1]);
            continue;
        }
        steps.push(step[1]);
    }
    if (outlineSteps !== undefined && !inExamples)
        steps.push(...outlineSteps);
    return steps;
}
/**
 * 全featureのstepを全step定義へ照合し、featureごとの利用step定義fileを返す。
 */
export function bindFeaturesToStepDefinitions(input) {
    const compiled = input.definitions.flatMap((definition) => definition.patterns.map((pattern) => compilePattern(definition.path, pattern)));
    const byFirstCharacter = new Map();
    const unprefixed = [];
    for (const pattern of compiled) {
        if (pattern.prefix === "") {
            unprefixed.push(pattern);
            continue;
        }
        const key = pattern.prefix[0];
        const bucket = byFirstCharacter.get(key) ?? [];
        bucket.push(pattern);
        byFirstCharacter.set(key, bucket);
    }
    const cache = new Map();
    const matchStep = (step) => {
        const cached = cache.get(step);
        if (cached !== undefined)
            return cached;
        const candidates = [
            ...(byFirstCharacter.get(step[0] ?? "") ?? []),
            ...unprefixed,
        ];
        const paths = new Set();
        for (const candidate of candidates) {
            if (!step.startsWith(candidate.prefix))
                continue;
            candidate.regex.lastIndex = 0;
            if (candidate.regex.test(step))
                paths.add(candidate.path);
        }
        const result = [...paths].sort();
        cache.set(step, result);
        return result;
    };
    const byFeature = {};
    const unmatchedFeatures = [];
    const unparsedFeatures = [];
    for (const feature of [...input.features].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)) {
        const steps = parseFeatureSteps(feature.text);
        if (steps === undefined) {
            unparsedFeatures.push(feature.path);
            continue;
        }
        const paths = new Set();
        let unmatched = false;
        for (const step of steps) {
            const matched = matchStep(step);
            if (matched.length === 0)
                unmatched = true;
            for (const path of matched)
                paths.add(path);
        }
        byFeature[feature.path] = Object.freeze([...paths].sort());
        if (unmatched)
            unmatchedFeatures.push(feature.path);
    }
    return Object.freeze({
        byFeature: Object.freeze(byFeature),
        unmatchedFeatures: Object.freeze(unmatchedFeatures),
        unparsedFeatures: Object.freeze(unparsedFeatures),
    });
}
//# sourceMappingURL=cucumber-binding.js.map