import fs from 'node:fs';
import path from 'node:path';
import { CURRENT_POLICY_SCHEMA_VERSION, PACKAGE_VERSION, SUPPORTED_POLICY_SCHEMA_VERSIONS } from '../src/lib/version.js';

const required = [
  'bin/agent-skill-chain.js', 'AGENTS.md',
  '.agent-skill-chain/docs/00_運用ポリシー.md',
  '.agent-skill-chain/docs/01_開発ワークフロー.md',
  '.agent-skill-chain/docs/02_品質基準.md',
  '.agent-skill-chain/schemas/project-policy.schema.json', '.agent-skill-chain/policy/default.json',
  '.agent-skill-chain/schemas/project-policy-manifest.schema.json',
  '.agent-skill-chain/schemas/project-choice.schema.json', '.agent-skill-chain/schemas/project-rule.schema.json',
  '.agent-skill-chain/schemas/project-conformance-binding.schema.json',
  '.agent-skill-chain/schemas/conformance-contract.schema.json', '.agent-skill-chain/policy/conformance.json',
];
const missing = required.filter((file) => !fs.existsSync(path.resolve(file)));
if (missing.length) throw new Error(`パッケージ資産が不足しています: ${missing.join(', ')}`);
const packageMetadata = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lockMetadata = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const policySchema = JSON.parse(fs.readFileSync('.agent-skill-chain/schemas/project-policy.schema.json', 'utf8'));
const manifestSchema = JSON.parse(fs.readFileSync('.agent-skill-chain/schemas/project-policy-manifest.schema.json', 'utf8'));
const defaultPolicy = JSON.parse(fs.readFileSync('.agent-skill-chain/policy/default.json', 'utf8'));
const samplePolicy = JSON.parse(fs.readFileSync('.agent-skill-chain/policy/sample.json', 'utf8'));
const releaseVersion = PACKAGE_VERSION.split('-')[0];
if (packageMetadata.version !== PACKAGE_VERSION || lockMetadata.version !== PACKAGE_VERSION || lockMetadata.packages?.['']?.version !== PACKAGE_VERSION) throw new Error('package.jsonとpackage-lock.jsonの製品versionが一致しません');
if (CURRENT_POLICY_SCHEMA_VERSION !== `agent-skill-chain/project-policy/v${releaseVersion}`) throw new Error('製品versionと現行project policy schema versionが一致しません');
if (JSON.stringify(policySchema.properties?.schemaVersion?.enum) !== JSON.stringify(SUPPORTED_POLICY_SCHEMA_VERSIONS)) throw new Error('package.jsonとproject policy schemaの対応versionが一致しません');
for (const [name, version] of [['manifest schema', manifestSchema.properties?.policy?.properties?.schemaVersion?.const], ['default policy', defaultPolicy.schemaVersion], ['sample policy', samplePolicy.schemaVersion]]) if (version !== CURRENT_POLICY_SCHEMA_VERSION) throw new Error(`${name}がpackage.jsonの現行project policy schema versionと一致しません`);
fs.chmodSync(path.resolve('bin/agent-skill-chain.js'), 0o755);
process.stdout.write(`v${releaseVersion}パッケージ資産検査: 合格（製品${PACKAGE_VERSION}、project policy ${CURRENT_POLICY_SCHEMA_VERSION}）\n`);
