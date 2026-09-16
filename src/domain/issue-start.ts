export interface IssueProjectConnection {
  owner: string;
  number: number;
  statusField: string;
  startedStatus: string;
}

export interface IssueProjectItem {
  id: string;
  statusOptionId: string | null;
  statusName: string | null;
}

export interface IssueProjectObservation {
  repository: string;
  issue: number;
  issueId: string;
  projectId: string;
  projectNumber: number;
  statusFieldId: string;
  startedOptionId: string;
  viewerCanUpdate: boolean;
  items: IssueProjectItem[];
  complete: boolean;
}

export type IssueStartPlan =
  | { state: "rejected"; reason: string; operations: [] }
  | { state: "started"; itemId: string; operations: [] }
  | { state: "pending"; operations: ["add-item"] }
  | { state: "pending"; itemId: string; operations: ["set-status"] };

export function planIssueStart(
  observation: IssueProjectObservation,
): IssueStartPlan {
  if (!observation.viewerCanUpdate)
    return {
      state: "rejected",
      reason: "GitHub Projectのwrite authorityを確認できません",
      operations: [],
    };
  if (!observation.complete)
    return {
      state: "rejected",
      reason: "Project itemの全件性を確認できません",
      operations: [],
    };
  if (observation.items.length > 1)
    return {
      state: "rejected",
      reason: "対象IssueのProject itemが複数あります",
      operations: [],
    };
  const item = observation.items[0];
  if (!item) return { state: "pending", operations: ["add-item"] };
  if (item.statusOptionId === observation.startedOptionId)
    return { state: "started", itemId: item.id, operations: [] };
  return { state: "pending", itemId: item.id, operations: ["set-status"] };
}
