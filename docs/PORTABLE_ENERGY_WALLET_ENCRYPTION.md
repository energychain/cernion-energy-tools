# Portable Energy Wallet Encryption

Issue #167 is limited to an offline, user/operator-owned wallet JSON file. It is not a custodial wallet, cloud wallet, production signing service, token minting service, external connector, HITL workflow, Personal Agent shortcut, or dossier hydration action.

## Threat Model Boundary

Protected assets:

- Private signing keys, mnemonics, import refresh tokens, device credentials, and personal Anlage or NAP credentials.
- Wallet passphrases and derived encryption keys.
- Evidence references that can reveal personal asset ownership when combined with external data.

Allowed MVP boundary:

- The wallet is a local JSON envelope controlled by the user or operator.
- Private key material exists only inside the encrypted payload or transient local memory during an explicit encrypt, decrypt, or rotate call.
- Public verification keys, public fingerprints, evidence reference hashes, and provenance references may remain in the clear envelope.
- Node `crypto` primitives are used for passphrase-based key derivation and authenticated encryption.

Forbidden for this issue:

- No central wallet database or long-term server-side private-key storage.
- No cloud custody, production signing endpoint, HSM abstraction, or token minting service.
- No decrypted wallet payload, passphrase, mnemonic, private key, derived key, raw credential, or sensitive decrypted metadata in prompts, receipts, logs, traces, telemetry, screenshots, OpenAPI examples, fixtures, support bundles, or LLM context.
- No MaKo, billing, settlement, tariff, device-control, HITL, or external connector action.

## Wallet Envelope Contract

Cleartext envelope fields:

- `version`: wallet envelope version. Version `1` is the only supported version in this MVP.
- `walletId`: stable wallet identity, preserved during passphrase rotation.
- `createdAt` and `updatedAt`: ISO timestamps for envelope lifecycle.
- `keyDerivation`: KDF metadata, currently `scrypt` parameters and salt.
- `cipher`: authenticated encryption metadata, currently `aes-256-gcm` IV and auth tag.
- `publicVerificationKeys`: public keys or public fingerprints that are safe to expose.
- `evidenceIndex`: references and hashes for datapoint, OEMetadata, grid-connection, or VDMI evidence.
- `provenanceRefs`: non-secret provenance references.
- `encryptedPayload`: base64 ciphertext for the sensitive wallet payload.

Encrypted payload fields:

- Private signing keys.
- Mnemonics.
- Import refresh tokens.
- Device credentials.
- Personal Anlage, MaStR, NAP, or operator credentials.
- Sensitive asset metadata that should not be inspectable in the clear wallet file.

The authenticated encryption AAD covers the clear envelope metadata. Tampering with clear evidence references, KDF parameters, IV, timestamps, or wallet identity fails closed during decrypt.

## Crypto Helper

`src/wallet-crypto.js` exposes local helper functions only:

- `encryptWalletPayload(payload, passphrase, options)`
- `decryptWalletPayload(envelope, passphrase)`
- `rotateWalletPassphrase(envelope, oldPassphrase, newPassphrase, options)`
- `fingerprintPublicKey(publicKey)`

The helper uses `scrypt` plus `aes-256-gcm`. Derived keys are never serialized. Decrypt failures return redacted errors and no partial payload. Unsupported versions, malformed KDF metadata, wrong passphrases, tampered ciphertext, tampered auth tags, and tampered authenticated metadata fail closed.

## Import, Export, Rotate, Verify

Export:

1. Build public envelope metadata from wallet identity, public verification keys, evidence references, and provenance references.
2. Put private signing keys and sensitive credentials only in the payload object.
3. Encrypt the payload locally with a passphrase.
4. Serialize only the envelope.

Import:

1. Validate envelope shape, version, KDF, cipher metadata, and reference structure.
2. Decrypt locally with the passphrase.
3. Fail closed on wrong passphrase or tampering.
4. Do not log decrypted payloads or include them in receipts.

Rotate:

1. Decrypt locally with the old passphrase.
2. Re-encrypt with a new salt, IV, auth tag, and ciphertext.
3. Preserve `walletId`, `createdAt`, public fingerprints, evidence references, and provenance references.
4. Update `updatedAt`.

Verify:

1. Use clear public keys, fingerprints, and evidence references for planning or display.
2. Do not decrypt unless the user explicitly imports or opens the wallet locally.
3. Do not expose sensitive fields through dossier hydration or broker execution.

## Future Work Requires Separate Review

A future service wrapper, UI import/export flow, custody model, production signing endpoint, connector, or Personal Agent workflow requires a separate security review. The next review must prove that decrypted wallet material cannot reach LLM prompts, receipts, logs, traces, telemetry, screenshots, support bundles, or external systems.
