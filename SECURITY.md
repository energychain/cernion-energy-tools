# Security Policy

## Supported Versions

We provide security updates for the latest minor release series. Earlier
release series are unsupported — please upgrade before reporting an issue
against an old version.

| Version | Supported |
|---------|-----------|
| 0.99.x  | ✅ Yes |
| < 0.99  | ❌ No |

## Reporting a Vulnerability

Please report security issues privately by opening a GitHub Security Advisory for this repository. If Security Advisories are not available, open an issue with minimal details and request a private contact channel.

When reporting, please include:

- A description of the vulnerability
- Steps to reproduce
- Impact assessment
- Any known mitigations

## Automated Security Monitoring

This repository uses automated security checks:

- **Dependabot** for dependency and GitHub Actions updates
- **CodeQL** for static code security analysis
- **npm audit** in CI for dependency vulnerability detection

## Known Dependency Exceptions

None currently. `npm audit` reports 0 known vulnerabilities as of `0.99.0`.

Note on `xlsx` (SheetJS): the npm registry build of `xlsx` had two
high-severity advisories (`GHSA-4r6h-8v6p-xvw6`, `GHSA-5pgg-2g8v-p4x9`) with
no fix published to the npm registry. SheetJS ships patched releases only via
their own CDN, so this project installs `xlsx` from a version-pinned
`cdn.sheetjs.com` tarball (see the `xlsx` entry in `package.json`
`dependencies`) instead of the npm registry. Keep that pinned URL up to date
when bumping `xlsx`.

CI policy:

- **Blocking gate**: `npm audit --audit-level=critical`
- **Advisory report**: `npm audit --audit-level=high`

## Response Process

We aim to acknowledge reports within 5 business days and provide an initial assessment within 10 business days. Timelines may vary depending on severity and complexity.

## Disclosure Policy

We follow coordinated disclosure. We will work with you on a reasonable disclosure timeline and publish fixes as soon as possible.
