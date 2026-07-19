#!/usr/bin/env bash
# PostToolUse.sh — ツール実行後の証跡確認フック
# 配置: .claude/hooks/（setup が enforcement/claude/ からコピー）／plugin 経由は .agent-skill-chain/source/enforcement/claude/ を直接呼ぶ。
# 責務: 証跡が workflow.db 本則・memo 過渡的・例外であること、および memo の YYYYMMDD_HHMMSS_ プレフィックス規約を案内する。
# 限界: 作成されたファイルのプレフィックス形式を本フック内で検証するには環境依存のため、厳密な検証は CI（audit.sh）に委ねる。
#
# 実機契約への整合: 実機 Claude Code は hook の stdin に JSON を渡す。本フックは案内主体であり、
#   stdin を読んでも読まなくても結果に影響しない。set +e（fail-safe）で stdin 読込・パイプ起因の
#   非 0 終了を避け、案内を出して必ず exit 0 する。

set +e
# stdin に JSON が来ても読み捨てて無害化（ブロックしないよう非端末時のみ・失敗は握りつぶす）。
if [[ ! -t 0 ]]; then
  cat >/dev/null 2>&1
fi

# 証跡の規約案内。証跡は本則 workflow.db。memo は過渡的・例外のみ。
echo "[PostToolUse:info] Evidence: workflow.db is canonical; memo is transitional/exception only. Memo files must use YYYYMMDD_HHMMSS_ prefix (JST). Do not omit workflow log. / 証跡は workflow.db が正本、memo は過渡的・例外のみ。memo は YYYYMMDD_HHMMSS_（JST）prefix 必須。workflow ログを省略しないこと。" >&2
exit 0
