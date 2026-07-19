// config/agent-skill-chain.yaml の worktree.timestamp.format（strftime風、例: "%Y%m%d_%H%M%S"）を
// 検証用の正規表現へ変換する。この用途に限定した最小実装であり汎用strftimeパーサではない。
const TOKEN_PATTERNS: Record<string, string> = {
  '%Y': '\\d{4}',
  '%m': '\\d{2}',
  '%d': '\\d{2}',
  '%H': '\\d{2}',
  '%M': '\\d{2}',
  '%S': '\\d{2}',
};

export function formatToRegex(format: string): RegExp {
  let pattern = '';
  let i = 0;
  while (i < format.length) {
    const token = format.slice(i, i + 2);
    if (TOKEN_PATTERNS[token]) {
      pattern += TOKEN_PATTERNS[token];
      i += 2;
    } else {
      pattern += format[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${pattern}$`);
}
