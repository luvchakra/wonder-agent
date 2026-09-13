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
    const ciphertext = await encryptSecret("another-secret");
    const [iv, tag, data] = ciphertext.split(".");
    const tampered = [iv, tag, data.slice(0, -2) + (data.at(-1) === "A" ? "B" : "A") + "="].join(
      ".",
    );
    await expect(decryptSecret(tampered)).rejects.toThrow();
  });

  it("rejects a malformed payload", async () => {
    await expect(decryptSecret("not-a-valid-payload")).rejects.toThrow(
      "Malformed encrypted secret payload",
    );
  });
});
