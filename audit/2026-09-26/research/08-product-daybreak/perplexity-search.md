# Perplexity challenge pass

Accessed: 2026-09-26.

The search challenged the dependency-advisory result for exact locked npm versions.
It found [MAL-2026-2307](https://osv.dev/vulnerability/MAL-2026-2307) for `axios`.
The search excerpt incorrectly suggested that all `1.*` versions were affected.

The direct OSV record lists only `0.30.4` and `1.14.1`.
The locked version is `1.20.0`.
The direct exact-version query returned `{}`.
The complete lockfile OSV batch returned zero affected versions.
The npm advisory API also returned `{}`.

The Perplexity result was useful source discovery.
It was not sufficient evidence for an affected dependency.
