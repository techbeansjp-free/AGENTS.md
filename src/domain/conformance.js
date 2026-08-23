import fs from 'node:fs';
import { resolveContained } from '../lib/security.js';

const IDS = Array.from({ length: 12 }, (_, index) => `I${index + 1}`);
const CONTRACT_FIELDS = ['id', 'name', 'statement', 'sourceHook', 'enforcementHooks', 'evidenceHooks', 'rollback'];
const BINDING_FIELDS = ['id', 'sourcePaths', 'enforcement', 'counterexampleScenarios'];

/** @param {unknown} value */
function text(value) { return typeof value === 'string' && value.trim().length > 0; }
/** @param {unknown} value */
function strings(value) { return Array.isArray(value) && value.length > 0 && value.every(text) && new Set(value).size === value.length; }

/** @param {any} contract */
export function validateConformanceContract(contract) {
  const errors = [];
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return { valid: false, errors: ['contractはobjectでなければなりません'], invariants: [] };
  for (const key of Object.keys(contract)) if (!['schemaVersion', 'invariants'].includes(key)) errors.push(`contract.${key}は未知fieldです`);
  if (contract.schemaVersion !== 'agent-skill-chain/conformance/v1') errors.push('conformance schemaVersionが不正です');
  if (!Array.isArray(contract.invariants)) errors.push('invariantsは配列でなければなりません');
  else {
    const ids = contract.invariants.map((/** @type {any} */ item) => item?.id);
    if (contract.invariants.length !== 12) errors.push('invariantsはexact 12件でなければなりません');
    for (const id of IDS) if (ids.filter((/** @type {any} */ item) => item === id).length !== 1) errors.push(`${id}は重複なく1件必要です`);
    for (const id of ids) if (!IDS.includes(id)) errors.push(`${id ?? 'unknown'}は未知invariantです`);
    for (const item of contract.invariants) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push('invariantはobjectでなければなりません'); continue; }
      for (const field of CONTRACT_FIELDS) if (item[field] === undefined) errors.push(`${item.id ?? 'unknown'}.${field}が必要です`);
      for (const field of Object.keys(item)) if (!CONTRACT_FIELDS.includes(field)) errors.push(`${item.id ?? 'unknown'}.${field}は未知fieldです`);
      for (const field of ['name', 'statement', 'sourceHook', 'rollback']) if (!text(item[field])) errors.push(`${item.id ?? 'unknown'}.${field}は空でない文字列でなければなりません`);
      for (const field of ['enforcementHooks', 'evidenceHooks']) if (!strings(item[field])) errors.push(`${item.id ?? 'unknown'}.${field}は重複のない非空文字列配列でなければなりません`);
    }
  }
  return { valid: errors.length === 0, errors, invariants: contract.invariants ?? [] };
}

/** Validate the project-owned binding structure without resolving repository paths or evidence. @param {any} binding */
export function validateProjectConformanceBinding(binding) {
  const errors = [];
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return { valid: false, errors: ['bindingはobjectでなければなりません'] };
  for (const key of Object.keys(binding)) if (!['schemaVersion', 'bindings'].includes(key)) errors.push(`binding.${key}は未知fieldです`);
  if (binding.schemaVersion !== 'agent-skill-chain/project-conformance/v1') errors.push('binding schemaVersionが不正です');
  const bindings = Array.isArray(binding.bindings) ? binding.bindings : [];
  if (bindings.length !== 12) errors.push('bindingsはexact 12件でなければなりません');
  const ids = bindings.map((/** @type {any} */ item) => item?.id);
  for (const id of IDS) if (ids.filter((/** @type {any} */ item) => item === id).length !== 1) errors.push(`binding ${id}は重複なく1件必要です`);
  for (const id of ids) if (!IDS.includes(id)) errors.push(`binding ${id ?? 'unknown'}は未知invariantです`);
  for (const item of bindings) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push('binding itemはobjectでなければなりません'); continue; }
    for (const field of BINDING_FIELDS) if (item[field] === undefined) errors.push(`${item.id ?? 'unknown'}.${field}が必要です`);
    for (const field of Object.keys(item)) if (!BINDING_FIELDS.includes(field)) errors.push(`${item.id ?? 'unknown'}.${field}は未知fieldです`);
    if (!strings(item.sourcePaths)) errors.push(`${item.id}.sourcePathsが不正です`);
    if (!strings(item.counterexampleScenarios) || item.counterexampleScenarios.some((/** @type {string} */ id) => !/^SCN-[A-Z0-9-]+$/.test(id))) errors.push(`${item.id}.counterexampleScenariosが不正です`);
    if (!Array.isArray(item.enforcement) || item.enforcement.length === 0) errors.push(`${item.id}.enforcementが必要です`);
    for (const point of item.enforcement ?? []) {
      if (!point || typeof point !== 'object' || Array.isArray(point)) { errors.push(`${item.id}.enforcement itemが不正です`); continue; }
      for (const key of Object.keys(point)) if (!['path', 'export'].includes(key)) errors.push(`${item.id}.enforcement.${key}は未知fieldです`);
      if (!text(point.path) || !text(point.export)) errors.push(`${item.id}.enforcementはpathとexportが必要です`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** @param {string} file @param {string} name */
function hasExport(file, name) {
  const source = fs.readFileSync(file, 'utf8');
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`export\\s+(?:async\\s+)?(?:function|const|class)\\s+${escaped}\\b|export\\s*\\{[^}]*\\b${escaped}\\b`, 'u').test(source);
}

/** @param {string} root @param {any} contract @param {any} binding @param {{tool?: string, passedScenarioIds?: string[]}} evidence */
export function validateRepositoryConformance(root, contract, binding, evidence) {
  const contractResult = validateConformanceContract(contract);
  const bindingResult = validateProjectConformanceBinding(binding);
  const errors = [...contractResult.errors, ...bindingResult.errors];
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return { valid: false, errors };
  const bindings = Array.isArray(binding.bindings) ? binding.bindings : [];
  const passed = new Set(evidence?.passedScenarioIds ?? []);
  if (!text(evidence?.tool)) errors.push('成功証拠toolが必要です');
  for (const item of bindings) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push('binding itemはobjectでなければなりません'); continue; }
    for (const relative of item.sourcePaths ?? []) {
      try { const file = resolveContained(root, relative); if (!fs.statSync(file).isFile()) errors.push(`${item.id}のsourceがfileではありません: ${relative}`); } catch { errors.push(`${item.id}のsourceが実在しません: ${relative}`); }
    }
    for (const point of item.enforcement ?? []) {
      try { const file = resolveContained(root, point.path); if (!text(point.export) || !hasExport(file, point.export)) errors.push(`${item.id}のenforcement exportが実在しません: ${point.path}#${point.export}`); } catch { errors.push(`${item.id}のenforcement pathが実在しません: ${point.path}`); }
    }
    for (const scenario of item.counterexampleScenarios ?? []) if (!passed.has(scenario)) errors.push(`${item.id}のcounterexampleに成功証拠がありません: ${scenario}`);
  }
  return { valid: errors.length === 0, errors, checked: IDS, evidenceTool: evidence?.tool };
}
