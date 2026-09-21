# Security policy

## Supported version

Security fixes are applied to the latest code on the default branch. Older
commits, forks, and modified deployments are not independently supported.

## Report a vulnerability privately

Please use GitHub Private Vulnerability Reporting:

<https://github.com/zhangpanmz-cell/pagepal-reading-camp/security/advisories/new>

Do not open a public Issue for a suspected vulnerability. In the report,
include the affected commit or version, impact, reproduction steps, and a
minimal proof of concept when safe. Do not include real API keys, login
credentials, private book text, reading notes, or other personal data; use
redacted or synthetic examples.

Please allow time to investigate and coordinate a fix before publishing
details. This project is maintained on a best-effort basis and does not promise
a specific response or remediation time.

## Current security boundary

The current release is a single-user local application. Its server binds to
`127.0.0.1` and is not designed to be exposed directly to a LAN or the public
internet. It does not yet provide user authentication, tenant isolation,
cloud persistence, or a hardened production build.

Keep DeepSeek and WeRead credentials only in the ignored local configuration
paths described in the README. Never commit them, paste them into an Issue, or
place them in browser storage. A public or multi-user deployment requires a
separate security review and additional authentication, authorization,
persistence, rate-limiting, monitoring, and secret-management controls.
