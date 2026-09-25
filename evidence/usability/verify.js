// Independent Ed25519 check: node verify.js G... <digest hex> <sig hex>
const { Keypair } = require('@stellar/stellar-sdk');
const [k, d, s] = process.argv.slice(2);
const ok = Keypair.fromPublicKey(k).verify(Buffer.from(d, 'hex'), Buffer.from(s, 'hex'));
console.log(JSON.stringify({ public_key: k, digest: d, independent_verify: ok }));
process.exit(ok ? 0 : 1);
