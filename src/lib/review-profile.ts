export type ReviewRisk = 'unclassified' | 'normal' | 'high';
export type ReviewAutonomy = 'gated' | 'full';
export type ReviewProfile = 'standard' | 'strict';

/** risk/autonomy の危険信号を安全側のレビュープロファイルへ写像する。 */
export function resolveReviewProfile(risk: ReviewRisk, autonomy: ReviewAutonomy): ReviewProfile {
  return risk !== 'normal' || autonomy === 'full' ? 'strict' : 'standard';
}
