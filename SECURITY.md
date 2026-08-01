# Security Policy

## Supported version

Only the code currently deployed from the `main` branch is supported. Operators should deploy from the committed `package-lock.json` with `npm ci` and keep the Railway deployment synchronized with `main`.

## Reporting a vulnerability

Use GitHub's **Security** tab and private vulnerability reporting for this repository. Do not publish working exploits, administrator tokens, provider credentials, signed subtitle URLs, or Railway environment values in a public issue.

Include the affected route or component, the observed impact, reproduction steps that avoid real secrets, and the commit SHA or deployed version. Public issues may be used for non-sensitive hardening suggestions only.

## Secret handling

`ADMIN_TOKEN` and `ENCODING_PROXY_SECRET` must be distinct random values of at least 32 bytes and must exist only in the deployment environment. Values shown in `.env.example` are empty placeholders.
