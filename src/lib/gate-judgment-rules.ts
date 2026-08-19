import type { AcIdResult, ArtifactReadResult, ArtifactSetStatus } from './gate-artifacts.js';

export type JudgmentAxis = 'ac_coverage' | 'alternative' | 'inconclusive';
export type ArtifactPresentation = 'content' | 'exempt_absent' | 'missing' | 'unreadable';

export function determineJudgmentAxis(options: {
  exempt: boolean;
  artifactStatus: ArtifactSetStatus;
  acIds: AcIdResult;
  alternativeAvailable: boolean;
}): JudgmentAxis {
  if (options.acIds.status === 'unreadable') return 'inconclusive';
  if (!options.exempt) return options.acIds.status === 'present' ? 'ac_coverage' : 'inconclusive';
  if (options.acIds.status === 'present' && options.artifactStatus !== 'absent') return 'ac_coverage';
  return options.alternativeAvailable ? 'alternative' : 'inconclusive';
}

export function artifactPresentation(result: ArtifactReadResult, exempt: boolean): ArtifactPresentation {
  if (result.status === 'present') return 'content';
  if (result.status === 'unreadable') return 'unreadable';
  return exempt ? 'exempt_absent' : 'missing';
}

export function gateLaunchAbortReason(results: readonly ArtifactReadResult[], exempt: boolean): string | undefined {
  const unreadable = results.find((result) => result.status === 'unreadable');
  if (unreadable) return `必須成果物の内容を取得できません: ${unreadable.path}`;
  const absent = results.find((result) => result.status === 'absent');
  if (absent && !exempt) return `target SHAの必須成果物を読めません: ${absent.path}`;
  return undefined;
}
