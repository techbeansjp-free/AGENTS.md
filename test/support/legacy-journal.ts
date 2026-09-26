import fs from "node:fs";

/**
 * 手書きのjournal行を旧journal（hash chainなし、REQ-WF-036以前の形）として追記する。
 *
 * `issue create`はStep 0行から`previousEntryDigest`を書き、chain付きjournalはchainの無い
 * 後続行を拒否する。手書き行でStepを記録済みにするfixtureは旧journalの互換経路を
 * 検査対象にしているため、追記の前に既存行のchainを外してjournal全体を旧形式へ揃える。
 * **chain付きjournalの検査はCLIの追記経路（`appendWorkflowJournalEntry`）で作る。**
 */
export function appendLegacyJournal(file: string, text: string): void {
  fs.writeFileSync(file, `${unchainedJournalText(file)}${text}`);
}

/** 既存行から`previousEntryDigest`を除いた本文。他のfieldと順序は変えない。 */
export function unchainedJournalText(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line) => {
      if (line.trim() === "") return line;
      const value = JSON.parse(line) as Record<string, unknown>;
      if (!("previousEntryDigest" in value)) return line;
      delete value.previousEntryDigest;
      return JSON.stringify(value);
    })
    .join("\n");
}
