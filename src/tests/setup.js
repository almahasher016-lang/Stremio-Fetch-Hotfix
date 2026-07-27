process.env.NODE_ENV ||= 'test';
process.env.ENCODING_PROXY_SECRET ||= 'test-only-proxy-secret-32-bytes-minimum';
process.env.ADMIN_TOKEN ||= 'test-only-admin-token-32-bytes-minimum';
if (!process.env.RUN_LIVE_PROVIDER_TESTS) {
  process.env.OPENSUBTITLES_API_KEY ||= 'test-only-provider-key';
  process.env.SUBDL_API_KEY ||= 'test-only-provider-key';
}
