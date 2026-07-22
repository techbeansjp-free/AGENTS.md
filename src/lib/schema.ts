import path from 'node:path';
import { Ajv, type ValidateFunction } from 'ajv';
import { readYamlFile } from './yaml-io.js';
import { resolveAsset } from './paths.js';

// スキーマ側が schema_version（非標準の注記キー）を宣言しているため strict:false で許容する。
const ajv = new Ajv({ strict: false, allErrors: true });
// lease.schema.yaml が使う format: date-time はここでは形式検証しない（ajv-formats
// 依存追加を避けるための簡易許容）。値の妥当性は new Date().toISOString() 生成元で担保する。
ajv.addFormat('date-time', true);
const compiled = new Map<string, ValidateFunction>();

export type SchemaName =
  | 'config'
  | 'state'
  | 'gate-report'
  | 'validation-report'
  | 'worker-report'
  | 'integration'
  | 'lease'
  | 'segments'
  | 'project-policy';

function loadSchemaDoc(name: SchemaName, root?: string): Record<string, unknown> {
  const filePath = resolveAsset(path.join('schemas', `${name}.schema.yaml`), root);
  return readYamlFile<Record<string, unknown>>(filePath);
}

export function getValidator(name: SchemaName, root?: string): ValidateFunction {
  const cacheKey = `${name}::${root ?? ''}`;
  let validator = compiled.get(cacheKey);
  if (!validator) {
    const schema = loadSchemaDoc(name, root);
    validator = ajv.compile(schema);
    compiled.set(cacheKey, validator);
  }
  return validator;
}

export interface ValidationOutcome {
  valid: boolean;
  errors: string[];
}

export function validateAgainstSchema(name: SchemaName, data: unknown, root?: string): ValidationOutcome {
  const validator = getValidator(name, root);
  const valid = validator(data) as boolean;
  if (valid) return { valid: true, errors: [] };
  const errors = (validator.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim());
  return { valid: false, errors };
}
