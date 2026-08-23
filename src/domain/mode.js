const QUESTIONS = Array.from({ length: 8 }, (_, index) => `Q-${String(index + 1).padStart(2, '0')}`);

/** @param {Record<string, {answer?: boolean | 'unknown', evidence?: string}>} answers */
export function classifyMode(answers) {
  const reasons = [];
  for (const id of QUESTIONS) {
    const item = answers?.[id];
    if (!item) reasons.push(`${id}: 未回答`);
    else if (item.answer !== true) reasons.push(`${id}: ${item.answer === 'unknown' || item.answer == null ? '不明' : String(item.answer)}`);
    else if (typeof item.evidence !== 'string' || item.evidence.trim() === '') reasons.push(`${id}: 根拠なし`);
  }
  return { mode: reasons.length === 0 ? 'quick' : 'full', reasons };
}

/** @param {string[]} changedFiles */
export function detectQuickDisqualifiers(changedFiles) {
  const reasons = new Set();
  for (const file of changedFiles) {
    const normalized = file.replaceAll('\\', '/');
    if (/(^|\/)(package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements.*\.txt|pyproject\.toml|Cargo\.toml)$/.test(normalized)) reasons.add('dependency');
    if (/(^|\/)(public-api|api\/|openapi|contracts?\/|exports?\.)/i.test(normalized)) reasons.add('public-api');
    if (/(^|\/)(migrations?|schema\/)/i.test(normalized)) reasons.add('data-migration');
    if (/(^|\/)(auth|security|secrets?)(\/|\.)/i.test(normalized)) reasons.add('security-boundary');
    if (/(^|\/)(\.github\/workflows|infra\/|Dockerfile|terraform)/i.test(normalized)) reasons.add('infrastructure');
  }
  return [...reasons];
}

export { QUESTIONS };
