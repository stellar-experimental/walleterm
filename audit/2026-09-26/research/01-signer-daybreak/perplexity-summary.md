# Perplexity challenge summary

Date: 2026-09-26

Status: passed

The search used primary-source domain filters.

The main results were RFC 9987, RFC 8709, and OpenSSH `PROTOCOL.agent`.

RFC 9987 defines requests 11 and 13, with responses 12 and 14.

It defines the sign request as a key blob, data string, and flags.

RFC 8709 defines the `ssh-ed25519` signature wrapper and 64-byte signature.

Sources:

- https://www.rfc-editor.org/rfc/rfc9987.html
- https://www.rfc-editor.org/rfc/rfc8709.html
- https://github.com/openssh/libopenssh/blob/master/ssh/PROTOCOL.agent

Visible usage and cost were not reported.
