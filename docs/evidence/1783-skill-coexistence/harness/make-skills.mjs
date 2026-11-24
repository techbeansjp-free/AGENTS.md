// Generates non-confidential synthetic Skills that compete for the Skill listing budget.
// Usage: node make-skills.mjs <skills-dir> <count> <description-chars> [prefix] [--competitors]
// Each Skill has name/description frontmatter and a short body. Descriptions are padded to a fixed length.
import fs from 'node:fs';
import path from 'node:path';
const [dir, countArg, charsArg, prefix = 'ext', ...flags] = process.argv.slice(2);
const count = Number(countArg), chars = Number(charsArg);
const topics = ['pdf-forms', 'slide-decks', 'spreadsheet-cleanup', 'image-resize', 'calendar-digest', 'email-drafts', 'meeting-notes', 'sql-tuning', 'k8s-manifests', 'terraform-plan', 'log-search', 'api-mocking', 'i18n-strings', 'css-tokens', 'chart-builder', 'release-notes', 'changelog', 'docker-compose', 'regex-helper', 'cron-schedules', 'csv-import', 'json-schema', 'graphql-schema', 'openapi-docs', 'feature-flags', 'a11y-audit', 'seo-meta', 'svg-icons', 'video-captions', 'podcast-notes', 'recipe-scaler', 'travel-plans', 'budget-sheet', 'resume-polish', 'blog-outline', 'tweet-thread', 'press-release', 'grant-proposal', 'lesson-plan', 'quiz-maker', 'flashcards', 'translation-memory', 'glossary', 'style-guide', 'brand-voice', 'color-palette', 'font-pairing', 'wireframes', 'user-personas', 'survey-design', 'ab-test-stats', 'sales-email', 'crm-notes', 'invoice-draft', 'contract-summary', 'okr-draft', 'retro-board', 'standup-notes', 'onboarding-docs', 'faq-builder'];
// Competitors overlap with ASC purposes (development start, review, issue writing, research, audit, migration).
const competitors = [
  ['dev-kickoff', 'Plan the first steps of a new development task: break the ticket into steps, propose a branch name and a checklist before coding.'],
  ['code-review-helper', 'Review a diff or recent commits and list problems by severity with suggested fixes.'],
  ['ticket-drafter', 'Draft a ticket or issue for a tracker from a short request: title, background, acceptance criteria.'],
  ['tech-compare', 'Compare libraries or services for a technical choice and summarize pros and cons.'],
  ['dep-scanner', 'Scan dependencies for known vulnerabilities and print a table of findings.'],
  ['db-migrator', 'Help move an application between databases or frameworks with a step list.'],
];
const filler = ' Use it when the user asks for this kind of output; it covers drafting, checking, formatting and exporting, keeps the user\'s wording, and asks before sending anything outside the workspace. Typical requests mention the file, the audience, the deadline and the preferred format.';
const pad = (s) => { let t = s; while (t.length < chars) t += filler; return t.slice(0, chars).replace(/\s+\S*$/, '.'); };
fs.mkdirSync(dir, {recursive: true});
const made = [];
const entries = flags.includes('--competitors') ? competitors.map(([n, d]) => [n, d]) : [];
for (let i = 0; entries.length < count; i++) {
  const t = topics[i % topics.length], round = Math.floor(i / topics.length);
  entries.push([`${prefix}-${t}${round ? '-' + (round + 1) : ''}`, `Work with ${t.replace(/-/g, ' ')}: create, check and improve ${t.replace(/-/g, ' ')} artifacts for the user.`]);
}
for (const [name, base] of entries.slice(0, count)) {
  const desc = pad(base);
  fs.mkdirSync(path.join(dir, name), {recursive: true});
  fs.writeFileSync(path.join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n\nSynthetic Skill for listing-budget evaluation. Reply with a short plan for the request and do not read other files.\n`);
  made.push({name, chars: desc.length});
}
console.log(JSON.stringify({dir: path.basename(dir), count: made.length, chars: made.reduce((a, m) => a + m.chars, 0)}));
