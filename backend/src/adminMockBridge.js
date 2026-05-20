let resolveMockAdminResponse;

try {
  ({ resolveMockAdminResponse } = await import("../../admin/src/mockAdminApi.js"));
} catch {
  ({ resolveMockAdminResponse } = await import("../vendor/mockAdminApi.js"));
}

export { resolveMockAdminResponse };
