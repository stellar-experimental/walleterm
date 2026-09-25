#!/usr/bin/env python3
"""Attach one verified Walleterm signature to a reviewed V1 envelope."""

import argparse
import base64
import json
import os
import re
import subprocess
from pathlib import Path


HEX_32 = re.compile(r"[0-9a-f]{64}\Z")
HEX_64 = re.compile(r"[0-9a-f]{128}\Z")
# Python has no built-in Ed25519. Node.js is already required by this skill.
VERIFY = (
    "const c = require('node:crypto'); const [k, d, s] = process.argv.slice(1);"
    "const key = c.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519',"
    " x: Buffer.from(k, 'hex').toString('base64url') }, format: 'jwk' });"
    "process.exit(c.verify(null, Buffer.from(d, 'hex'), key, Buffer.from(s, 'hex')) ? 0 : 1);"
)


def stellar(*arguments, input_text=None):
    result = subprocess.run(
        ["stellar", *arguments],
        input=input_text,
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )
    if result.returncode:
        raise ValueError(f"stellar {' '.join(arguments[:2])} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def envelope(text):
    value = json.loads(stellar("tx", "decode", input_text=text + "\n"))
    tx = value.get("tx")
    if not isinstance(tx, dict) or not isinstance(tx.get("tx"), dict):
        raise ValueError("Use this helper only for a V1 transaction envelope.")
    if not isinstance(tx.get("signatures"), list):
        raise ValueError("The V1 signature list is missing.")
    return value


def digest(text, passphrase):
    value = stellar("tx", "hash", "--network-passphrase", passphrase, input_text=text + "\n")
    if not HEX_32.fullmatch(value):
        raise ValueError("Stellar CLI returned an invalid transaction hash.")
    return value


def verify(public_key_hex, digest_hex, signature_hex):
    result = subprocess.run(["node", "-e", VERIFY, public_key_hex, digest_hex, signature_hex],
                            capture_output=True, timeout=30, check=False)
    if result.returncode:
        raise ValueError("The signature does not verify for the expected key and hash.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--unsigned", required=True, type=Path)
    parser.add_argument("--signature", required=True, type=Path)
    parser.add_argument("--expected-public-key", required=True)
    parser.add_argument("--network-passphrase", required=True)
    parser.add_argument("--expected-hash", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    if not HEX_32.fullmatch(args.expected_hash):
        raise ValueError("The expected hash must contain 64 lowercase hexadecimal characters.")
    if not re.fullmatch(r"G[A-Z2-7]{55}", args.expected_public_key):
        raise ValueError("Use the selected full G-address as the expected public key.")
    if args.output == args.unsigned or args.output.exists():
        raise ValueError("Use a new output path. Never overwrite the unsigned XDR.")
    unsigned = args.unsigned.read_text().strip()
    if len(unsigned) > 1_500_000:
        raise ValueError("The XDR is too large.")
    base64.b64decode(unsigned, validate=True)
    result = json.loads(args.signature.read_text())
    if (result.get("ok") is not True or result.get("verified") is not True
            or result.get("digest") != args.expected_hash
            or result.get("public_key") != args.expected_public_key
            or not isinstance(result.get("public_key"), str)
            or not isinstance(result.get("signature"), str)
            or not HEX_64.fullmatch(result["signature"])):
        raise ValueError("The Walleterm result does not match the reviewed hash.")
    if digest(unsigned, args.network_passphrase) != args.expected_hash:
        raise ValueError("The unsigned XDR hash changed.")

    raw_key = json.loads(stellar("strkey", "decode", result["public_key"]))
    public_key_hex = raw_key.get("public_key_ed25519")
    if not isinstance(public_key_hex, str) or not HEX_32.fullmatch(public_key_hex):
        raise ValueError("The signer is not a canonical Ed25519 G-address.")
    verify(public_key_hex, args.expected_hash, result["signature"])

    document = envelope(unsigned)
    tx = document["tx"]
    body = json.loads(json.dumps(tx["tx"]))
    signatures = tx["signatures"]
    original_signatures = json.loads(json.dumps(signatures))
    if len(signatures) >= 20:
        raise ValueError("The envelope already has 20 signatures.")
    if any(item.get("signature") == result["signature"] for item in signatures):
        raise ValueError("The envelope already has this signature.")
    signatures.append({"hint": public_key_hex[-8:], "signature": result["signature"]})
    signed = stellar("tx", "encode", input_text=json.dumps(document) + "\n")
    if len(signed) > 1_500_000:
        raise ValueError("The signed XDR is too large.")
    check = envelope(signed)["tx"]
    if check["tx"] != body or check["signatures"] != original_signatures + [signatures[-1]]:
        raise ValueError("Encoding changed the transaction body or signatures.")
    if digest(signed, args.network_passphrase) != args.expected_hash:
        raise ValueError("The signed XDR hash changed.")

    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w") as output:
            output.write(signed + "\n")
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        args.output.unlink(missing_ok=True)
        raise
    print(json.dumps({"ok": True, "hash": args.expected_hash,
                      "public_key": result["public_key"], "signature_count": len(signatures),
                      "output": str(args.output)}))


if __name__ == "__main__":
    main()
