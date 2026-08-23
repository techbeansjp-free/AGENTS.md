import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_TEMPLATE_LINKS = new Map([
  ['step-00-stage', []],
  ['step-01-request', ['../../templates/issue/00_要求定義_full.md', '../../templates/issue/00_要求定義_quick.md']],
  ['step-02-requirements', ['../../templates/issue/01_要件定義.md']],
  ['step-03-requirements-review', ['../../templates/issue/04_レビュー.md']],
  ['step-04-issue-sync', []],
  ['step-05-design', ['../../templates/issue/02_設計.md']],
  ['step-06-plan', ['../../templates/issue/03_実装計画.md']],
  ['step-07-design-review', ['../../templates/issue/04_レビュー.md']],
  ['step-08-design-sync', []],
  ['step-09-implement', ['../../templates/specs/00_仕様書構成/00_仕様書索引.md', '../../templates/specs/00_仕様書構成/01_記入・分割ルール.md']],
  ['step-10-review', ['../../templates/issue/04_レビュー.md']],
  ['step-11-pr', ['../../templates/issue/11_プルリクエスト事前確認.md', '../../templates/issue/11_プルリクエスト本文.md']],
]);

const EXPECTED_OUTPUT_MARKERS = new Map([
  ['step-00-stage', '.agent-skill-chain/tmp/issues/'],
  ['step-01-request', '00_要求定義.md'],
  ['step-02-requirements', '01_要件定義.md'],
  ['step-03-requirements-review', '04_レビュー.md'],
  ['step-04-issue-sync', '書き込み後読み取り検証'],
  ['step-05-design', '02_設計.md'],
  ['step-06-plan', '03_実装計画.md'],
  ['step-07-design-review', '04_レビュー.md'],
  ['step-08-design-sync', '書き込み後読み取り検証'],
  ['step-09-implement', 'docs/specs/'],
  ['step-10-review', '04_レビュー.md'],
  ['step-11-pr', 'waiting_for_human_review'],
]);

/** @param {string[]} values */
const uniqueSorted = (values) => [...new Set(values)].sort();

/** @param {string} root */
export function checkSkillTemplateContracts(root = process.cwd()) {
  const errors = [];
  const skillsRoot = path.resolve(root, '.agent-skill-chain/skills');
  const templatesRoot = path.resolve(root, '.agent-skill-chain/templates');
  const actualSkills = fs.existsSync(skillsRoot)
    ? fs.readdirSync(skillsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
    : [];
  const expectedSkills = [...EXPECTED_TEMPLATE_LINKS.keys()].sort();
  if (JSON.stringify(actualSkills) !== JSON.stringify(expectedSkills)) errors.push(`Step skill集合が0〜11の正規集合と一致しません: ${actualSkills.join(',')}`);
  const workflowFile = path.resolve(root, '.agent-skill-chain/docs/01_開発ワークフロー.md');
  if (!fs.existsSync(workflowFile)) errors.push('01_開発ワークフロー.mdがありません');
  else {
    const workflow = fs.readFileSync(workflowFile, 'utf8');
    if (!/各ステップの開始前[^。]*SKILL\.md[^。]*全文/u.test(workflow)) errors.push('開発ワークフローにStep skillの開始前全文読取義務がありません');
    const workflowLinks = uniqueSorted([...workflow.matchAll(/\]\(\.\.\/skills\/([^/]+)\/SKILL\.md\)/gu)].map((match) => match[1]));
    if (JSON.stringify(workflowLinks) !== JSON.stringify(expectedSkills)) errors.push(`開発ワークフローからStep skillへの対応が不正です: ${workflowLinks.join(',')}`);
  }

  for (const skill of expectedSkills) {
    const skillFile = path.join(skillsRoot, skill, 'SKILL.md');
    if (!fs.existsSync(skillFile)) { errors.push(`${skill}/SKILL.mdがありません`); continue; }
    const markdown = fs.readFileSync(skillFile, 'utf8');
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(markdown)?.[1];
    if (!frontmatter) errors.push(`${skill}/SKILL.mdにYAML frontmatterがありません`);
    else {
      const declaredName = /^name:\s*(\S+)\s*$/mu.exec(frontmatter)?.[1];
      const description = /^description:\s*(.+)\s*$/mu.exec(frontmatter)?.[1];
      if (declaredName !== skill) errors.push(`${skill}/SKILL.mdのnameがdirectory名と一致しません`);
      if (!description) errors.push(`${skill}/SKILL.mdのdescriptionがありません`);
    }
    if (!markdown.includes('## テンプレート契約')) errors.push(`${skill}/SKILL.mdにテンプレート契約がありません`);
    const links = uniqueSorted([...markdown.matchAll(/\]\((\.\.\/\.\.\/templates\/[^)\s]+)\)/gu)].map((match) => match[1]));
    const expectedLinks = uniqueSorted(EXPECTED_TEMPLATE_LINKS.get(skill) ?? []);
    if (JSON.stringify(links) !== JSON.stringify(expectedLinks)) errors.push(`${skill}/SKILL.mdのテンプレート対応が不正です: expected=${expectedLinks.join(',')} actual=${links.join(',')}`);
    if (expectedLinks.length > 0 && !/作業開始前[^。]*全文/u.test(markdown)) errors.push(`${skill}/SKILL.mdに作業開始前の全文読取義務がありません`);
    if (expectedLinks.length === 0 && !markdown.includes('直接使用するテンプレートはない')) errors.push(`${skill}/SKILL.mdにテンプレート非適用理由がありません`);
    const outputMarker = EXPECTED_OUTPUT_MARKERS.get(skill);
    if (!outputMarker || !markdown.includes(outputMarker)) errors.push(`${skill}/SKILL.mdに正規成果物${outputMarker ?? ''}がありません`);

    for (const relativeLink of links) {
      const resolved = path.resolve(path.dirname(skillFile), relativeLink);
      if (!resolved.startsWith(`${templatesRoot}${path.sep}`)) { errors.push(`${skill}/SKILL.mdのリンクがtemplates境界外です: ${relativeLink}`); continue; }
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) { errors.push(`${skill}/SKILL.mdのリンク先がありません: ${relativeLink}`); continue; }
      const real = fs.realpathSync(resolved);
      if (!real.startsWith(`${fs.realpathSync(templatesRoot)}${path.sep}`)) errors.push(`${skill}/SKILL.mdのリンク先がsymlinkでtemplates境界外です: ${relativeLink}`);
    }
  }
  return { valid: errors.length === 0, errors, skills: expectedSkills.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = checkSkillTemplateContracts();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}
