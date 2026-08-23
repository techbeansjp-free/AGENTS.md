import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const packageMetadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
const policyNamespace = 'agent-skill-chain/project-policy/v';

if (typeof packageMetadata.version !== 'string' || !/^0\.3\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(packageMetadata.version)) throw new Error('package.json.versionは0.3.x SemVerでなければなりません');
if (typeof packageMetadata.agentSkillChain?.policySchemaVersion !== 'string' || !/^0\.3\.\d+$/u.test(packageMetadata.agentSkillChain.policySchemaVersion)) throw new Error('package.jsonのpolicySchemaVersionが不正です');
if (!Array.isArray(packageMetadata.agentSkillChain?.compatiblePolicySchemaVersions) || packageMetadata.agentSkillChain.compatiblePolicySchemaVersions.some((/** @type {unknown} */ version) => typeof version !== 'string' || !/^0\.3\.\d+$/u.test(version))) throw new Error('package.jsonのcompatiblePolicySchemaVersionsが不正です');

export const PACKAGE_VERSION = packageMetadata.version;
export const CURRENT_POLICY_SCHEMA_VERSION = `${policyNamespace}${packageMetadata.agentSkillChain.policySchemaVersion}`;
export const COMPATIBLE_POLICY_SCHEMA_VERSIONS = packageMetadata.agentSkillChain.compatiblePolicySchemaVersions.map((/** @type {string} */ version) => `${policyNamespace}${version}`);
export const SUPPORTED_POLICY_SCHEMA_VERSIONS = [...COMPATIBLE_POLICY_SCHEMA_VERSIONS, CURRENT_POLICY_SCHEMA_VERSION];
