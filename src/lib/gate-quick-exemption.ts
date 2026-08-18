import { gh, git } from './exec.js';
import { stateFilePath, type CoordinationBackend } from './local-state.js';
import { GUARDRAIL_PATHS } from './self-reference-guardrail.js';
import { tryReadYamlFile } from './yaml-io.js';

export type Resolution<T> =
  | { status: 'resolved'; value: T }
  | { status: 'unresolved'; reason: string };

export interface QuickSignals {
  size: Resolution<'quick' | 'standard'>;
  risk: Resolution<'normal' | 'other'>;
  /** 既存の必須成果物検査が表示・判定してきた二値へ畳み込んだ値。 */
  legacy: {
    size: 'quick' | 'standard';
    risk: 'normal' | 'high' | 'unclassified';
  };
}

export interface GateQuickExemption {
  size: QuickSignals['size'];
  risk: QuickSignals['risk'];
  guardrail: Resolution<'included' | 'not_included'>;
  exempt: boolean;
}

function resolveSingleSignal<T>(
  values: string[],
  allowed: readonly string[],
  defaultValue: T,
  map: (value: string) => T,
  name: string,
): Resolution<T> {
  if (values.length === 0) return { status: 'resolved', value: defaultValue };
  if (values.length !== 1) return { status: 'unresolved', reason: `${name} が複数指定されています` };
  if (!allowed.includes(values[0])) return { status: 'unresolved', reason: `${name} が値域外です` };
  return { status: 'resolved', value: map(values[0]) };
}

function signalsFromValues(sizeValues: string[], riskValues: string[]): QuickSignals {
  return {
    size: resolveSingleSignal(sizeValues, ['quick', 'standard'], 'standard', (value) => value as 'quick' | 'standard', 'size シグナル'),
    risk: resolveSingleSignal(
      riskValues,
      ['normal', 'high', 'unclassified'],
      'other',
      (value) => value === 'normal' ? 'normal' : 'other',
      'risk シグナル',
    ),
    legacy: {
      size: sizeValues.includes('quick') ? 'quick' : 'standard',
      risk: riskValues.includes('high')
        ? 'high'
        : riskValues.includes('normal')
          ? 'normal'
          : 'unclassified',
    },
  };
}

function unresolvedSignals(reason: string): QuickSignals {
  return {
    size: { status: 'unresolved', reason },
    risk: { status: 'unresolved', reason },
    legacy: { size: 'standard', risk: 'unclassified' },
  };
}

function changedPathsFromNameStatus(output: string): string[] | undefined {
  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  const paths: string[] = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!status) return undefined;
    if (/^[RC][0-9]{1,3}$/.test(status)) {
      const oldPath = fields[index++];
      const newPath = fields[index++];
      if (!oldPath || !newPath) return undefined;
      paths.push(oldPath, newPath);
    } else if (/^[ADMUTXB]$/.test(status)) {
      const changedPath = fields[index++];
      if (!changedPath) return undefined;
      paths.push(changedPath);
    } else {
      return undefined;
    }
  }
  return paths;
}

/** Coordination Backend の一次情報から size/risk を三値で解決する。 */
export function readQuickSignals(root: string, issueNumber: string, backend: CoordinationBackend): QuickSignals {
  if (backend === 'github') {
    const result = gh(['issue', 'view', issueNumber, '--json', 'labels'], root);
    if (result.status !== 0) return unresolvedSignals('Issue ラベルを取得できません');
    try {
      const payload = JSON.parse(result.stdout) as { labels?: ({ name?: unknown } | string)[] };
      if (!Array.isArray(payload.labels)) return unresolvedSignals('Issue ラベル応答を解釈できません');
      const names = payload.labels.map((label) => typeof label === 'string' ? label : label.name);
      if (names.some((name) => typeof name !== 'string')) return unresolvedSignals('Issue ラベル応答を解釈できません');
      const labels = names as string[];
      return signalsFromValues(
        labels.filter((name) => name.startsWith('size:')).map((name) => name.slice('size:'.length)),
        labels.filter((name) => name.startsWith('risk:')).map((name) => name.slice('risk:'.length)),
      );
    } catch {
      return unresolvedSignals('Issue ラベル応答を解釈できません');
    }
  }

  // Issue #741: 状態ファイルが壊れている・ディレクトリである等の読み取り失敗は例外にせず
  // 未解決として畳む。未解決時は quick 免除も上流閉包も適用しないため、安全側で停止する。
  let state: { size?: unknown; risk?: unknown } | undefined;
  try {
    state = tryReadYamlFile<{ size?: unknown; risk?: unknown }>(stateFilePath(root, issueNumber));
  } catch {
    return unresolvedSignals('Issue 状態ファイルを解釈できません');
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return unresolvedSignals('Issue 状態ファイルを取得できません');
  }
  const sizeValues = state.size === undefined ? [] : typeof state.size === 'string' ? [state.size] : ['<invalid>'];
  const riskValues = state.risk === undefined ? [] : typeof state.risk === 'string' ? [state.risk] : ['<invalid>'];
  return signalsFromValues(sizeValues, riskValues);
}

/** base/target SHA に固定した差分から、ゲート判定用の quick 免除を解決する。 */
export function resolveGateQuickExemption(options: {
  root: string;
  issueNumber: string;
  backend: CoordinationBackend;
  baseSha?: string;
  targetSha: string;
}): GateQuickExemption {
  const signals = readQuickSignals(options.root, options.issueNumber, options.backend);
  let guardrail: GateQuickExemption['guardrail'];
  if (!options.baseSha) {
    guardrail = { status: 'unresolved', reason: 'base SHA が指定されていません' };
  } else {
    const result = git(
      ['diff', '--name-status', '-z', '--find-renames', `${options.baseSha}...${options.targetSha}`],
      options.root,
    );
    if (result.status !== 0) {
      guardrail = { status: 'unresolved', reason: '変更差分を取得できません' };
    } else {
      const paths = changedPathsFromNameStatus(result.stdout);
      guardrail = paths === undefined
        ? { status: 'unresolved', reason: '変更差分を解釈できません' }
        : {
            status: 'resolved',
            value: GUARDRAIL_PATHS.some((entry) => paths.some(entry.test)) ? 'included' : 'not_included',
          };
    }
  }
  return {
    ...signals,
    guardrail,
    exempt:
      signals.size.status === 'resolved' && signals.size.value === 'quick' &&
      signals.risk.status === 'resolved' && signals.risk.value === 'normal' &&
      guardrail.status === 'resolved' && guardrail.value === 'not_included',
  };
}
