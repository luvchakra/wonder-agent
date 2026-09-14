// @vitest-environment node
import { describe, expect, it, beforeAll } from "vitest";
import { encryptSecret, decryptSecret } from "./encryptSecret";

beforeAll(() => {
  process.env.SECRET_ENCRYPTION_KEY = "test-only-key-not-for-production-use";
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext value", async () => {
    const plaintext = "sk-test-integration-credential-12345";
    const ciphertext = await encryptSecret(plaintext);
    expect(ciphertext).not.toContain(plaintext);
    const decrypted = await decryptSecret(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext (random IV)", async () => {
    const a = await encryptSecret("same-value");
    const b = await encryptSecret("same-value");
    expect(a).not.toBe(b);
  });

  it("rejects a tampered ciphertext", async () => {
    // QA-P0-04.2's pipeline sweep caught this as flaky: mutating the *last*
    // base64 character of a padded group sometimes changes no actual byte —
    // the final sextet before "=" padding encodes some bits base64 decoding
    // ignores, so occasionally the GCM auth tag still verified and the
    // assertion failed intermittently. Not a security bug (GCM
    // authentication itself works correctly; the tamper method just wasn't
    // always a real mutation). Flipping the *first* character instead is
    // always a complete, un-padded 3-byte group — deterministically changes
    // real ciphertext bytes every run. See
    // docs/design/foundation-agent-backlog-audit.md.
    const ciphertext = await encryptSecret("another-secret");
    const [iv, tag, data] = ciphertext.split(".");
    const tamperedData = (data[0] === "A" ? "B" : "A") + data.slice(1);
    const tampered = [iv, tag, tamperedData].join(".");
    await expect(decryptSecret(tampered)).rejects.toThrow();
  });

  it("rejects a malformed payload", async () => {
    await expect(decryptSecret("not-a-valid-payload")).rejects.toThrow(
      "Malformed encrypted secret payload",
    );
  });
});
