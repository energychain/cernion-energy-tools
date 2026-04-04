# Security Policy

## Supported Versions

We provide security updates for the latest minor release series.

| Version | Supported |
|---------|-----------|
| 0.20.x  | ✅ Yes |
| 0.19.x  | ✅ Yes (security patches only) |
| 0.18.x  | ❌ No |
| < 0.18  | ❌ No |

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

As of `0.20.0`, one high-severity advisory remains open for `xlsx` (SheetJS),
with **no upstream fix available** in the current dependency line.

- Advisory IDs: `GHSA-4r6h-8v6p-xvw6`, `GHSA-5pgg-2g8v-p4x9`
- Status: accepted temporary risk until upstream fix/replacement is available
- Mitigation: keep parsing/export paths constrained to trusted in-process data;
	avoid ingesting untrusted workbook payloads from external users.

CI policy:

- **Blocking gate**: `npm audit --audit-level=critical`
- **Advisory report**: `npm audit --audit-level=high`

## Response Process

We aim to acknowledge reports within 5 business days and provide an initial assessment within 10 business days. Timelines may vary depending on severity and complexity.

## Disclosure Policy

We follow coordinated disclosure. We will work with you on a reasonable disclosure timeline and publish fixes as soon as possible.
