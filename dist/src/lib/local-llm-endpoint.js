const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
/**
 * ローカルLLM endpointの信頼境界。trusted project policy由来であっても、
 * 実行直前に再検証する多層防御としてschema検証（呼出し元）とは独立に使う。
 *
 * `src/lib/security.ts`のtrusted品質契約保護対象には**含めない**。この関数は
 * security.ts内の既存機能から独立しており、保護対象へ加えると変更のたびに
 * governance proposalの事前登録が必要になる（Issue #1426 CI指摘）。
 */
export function assertLoopbackEndpoint(endpoint) {
    let url;
    try {
        url = new URL(endpoint);
    }
    catch {
        throw new Error("ローカルLLM endpointが不正なURLです");
    }
    if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname))
        throw new Error("ローカルLLM endpointはhttp://127.0.0.1またはhttp://localhostだけを許可します");
    return url;
}
//# sourceMappingURL=local-llm-endpoint.js.map