# Security policy

Tresorpost handles secrets: encryption keys, ciphertext, and delete tokens.
If you find a way to break the confidentiality or integrity guarantees
described in the [README](README.md#security), please report it privately
rather than opening a public issue.

## Reporting a vulnerability

Open a [GitHub security advisory](../../security/advisories/new) on this
repository (Security tab → "Report a vulnerability"). That's private
between you and the maintainer.

If that isn't available to you, email the address listed on the maintainer's
GitHub profile with a subject line starting `[tresorpost security]`.

Please include:

- what you found and why it matters (impact, not just the bug),
- steps or a proof of concept to reproduce it,
- the version or commit you tested against.

You'll get an acknowledgement within a few days. There's no bug bounty —
this is an open-source side project — but reporters are credited in the
fix's release notes / changelog unless they'd rather stay anonymous.

## Scope

In scope:

- the client-side crypto (key generation, XChaCha20-Poly1305 usage, nonce
  handling) in `frontend/src`,
- the server (`src/`): auth, rate limiting, the delete-token flow, the S3
  presigned-URL flow, anything that could leak ciphertext, keys, or admin
  data,
- the Docker image and deployment configuration in this repository.

Out of scope:

- a specific hosted instance's operational security (TLS config, hosting
  provider, DNS) unless it stems from a bug in this codebase,
- denial-of-service by brute-force volume alone (the rate limiters are
  documented as best-effort and per-process — see the README's Security
  section),
- vulnerabilities in third-party dependencies that already have an
  upstream advisory and no available fix — please report those upstream
  instead, or open a normal issue here if this project's use of the
  dependency makes it exploitable.

## Supported versions

Only the latest tagged release and the `main` branch receive fixes. There's
no long-term support branch.
