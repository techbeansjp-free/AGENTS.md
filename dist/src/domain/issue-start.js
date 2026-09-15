export function planIssueStart(observation) {
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
    if (!item)
        return { state: "pending", operations: ["add-item"] };
    if (item.statusOptionId === observation.startedOptionId)
        return { state: "started", itemId: item.id, operations: [] };
    return { state: "pending", itemId: item.id, operations: ["set-status"] };
}
//# sourceMappingURL=issue-start.js.map