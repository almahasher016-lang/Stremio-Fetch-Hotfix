const legacyAdminTokenSource = !process.env.ADMIN_TOKEN && process.env.PERSONAL_VAULT_TOKEN
  ? 'PERSONAL_VAULT_TOKEN'
  : (!process.env.ADMIN_TOKEN && process.env.VERSION_REGISTRY_TOKEN ? 'VERSION_REGISTRY_TOKEN' : '');
if (legacyAdminTokenSource) {
  console.warn(`[Config] ${legacyAdminTokenSource} is deprecated; configure ADMIN_TOKEN explicitly.`);
}

await import('./telemetry.js');
await import('./serverCore.js');
