export interface RequiredStatusCheck {
  context?: unknown;
  integration_id?: unknown;
}

export interface RepositoryRuleset {
  id?: unknown;
  name?: unknown;
  target?: unknown;
  enforcement?: unknown;
  conditions?: {
    ref_name?: {
      include?: unknown;
      exclude?: unknown;
    };
  };
  rules?: {
    type?: unknown;
    parameters?: {
      required_status_checks?: unknown;
    };
  }[];
}

export interface DedicatedAppBackend {
  kind: 'dedicated_app';
  appId: number;
  rulesetIds: number[];
}

const GITHUB_ACTIONS_APP_ID = 15_368;

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function protectsMain(ruleset: RepositoryRuleset): boolean {
  const refName = ruleset.conditions?.ref_name;
  if (!refName || !Array.isArray(refName.include) || !Array.isArray(refName.exclude)) return false;
  const include = refName.include.filter((entry): entry is string => typeof entry === 'string');
  const exclude = refName.exclude.filter((entry): entry is string => typeof entry === 'string');
  const included = include.includes('refs/heads/main') || include.includes('~DEFAULT_BRANCH');
  return included && !exclude.includes('refs/heads/main') && !exclude.includes('~DEFAULT_BRANCH');
}

/**
 * mergeを実際に強制するactive rulesetだけを信頼する。Check名の一致だけでなく、
 * 全gate contextが同じ専用App integration IDへ固定されているrulesetを要求する。
 */
export function resolveDedicatedAppBackend(options: {
  appId: number;
  checkNames: string[];
  rulesets: RepositoryRuleset[];
}): DedicatedAppBackend {
  const appId = positiveInteger(options.appId);
  if (!appId || appId === GITHUB_ACTIONS_APP_ID) {
    throw new Error('専用GitHub App IDが未設定または標準GitHub Actions Appです');
  }
  if (
    options.checkNames.length === 0 ||
    new Set(options.checkNames).size !== options.checkNames.length ||
    options.checkNames.some((name) => name.length === 0)
  ) {
    throw new Error('required gate Check名が空または重複しています');
  }
  const enforcingIds: number[] = [];
  for (const ruleset of options.rulesets) {
    const id = positiveInteger(ruleset.id);
    if (
      !id ||
      ruleset.target !== 'branch' ||
      ruleset.enforcement !== 'active' ||
      !protectsMain(ruleset) ||
      !Array.isArray(ruleset.rules)
    ) {
      continue;
    }
    const checks = ruleset.rules
      .filter((rule) => rule.type === 'required_status_checks')
      .flatMap((rule) =>
        Array.isArray(rule.parameters?.required_status_checks)
          ? rule.parameters.required_status_checks as RequiredStatusCheck[]
          : [],
      );
    const complete = options.checkNames.every((name) =>
      checks.some((check) => check.context === name && check.integration_id === appId),
    );
    if (complete) enforcingIds.push(id);
  }
  if (enforcingIds.length === 0) {
    throw new Error('mainの全gate Checkを専用App sourceへ固定するactive rulesetがありません');
  }
  return { kind: 'dedicated_app', appId, rulesetIds: enforcingIds.sort((left, right) => left - right) };
}

