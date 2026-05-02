import { describe, expect, it } from "vitest";
import {
	decryptIfEncrypted,
	decryptSecret,
	encryptOptional,
	encryptSecret,
	isEncrypted,
} from "../../src/auth/secret-envelope.js";

describe("secret envelope", () => {
	it("round-trips a plaintext secret through encrypt → decrypt", () => {
		const plain = "v^1.1#i^1#r^0#p^1#I^3#f^0#t^H4sIAAAA…";
		const enc = encryptSecret(plain);
		expect(enc.startsWith("enc:v1:")).toBe(true);
		expect(enc).not.toContain(plain);
		expect(decryptSecret(enc)).toBe(plain);
	});

	it("identifies enveloped vs plaintext via the prefix tag", () => {
		expect(isEncrypted("enc:v1:abc:def")).toBe(true);
		expect(isEncrypted("v^1.1#i^1#")).toBe(false);
		expect(isEncrypted("")).toBe(false);
	});

	it("decryptIfEncrypted passes plaintext through unchanged (legacy rows)", () => {
		expect(decryptIfEncrypted("legacy-plain-token")).toBe("legacy-plain-token");
		expect(decryptIfEncrypted(null)).toBe(null);
		expect(decryptIfEncrypted(undefined)).toBe(null);
	});

	it("decryptIfEncrypted unwraps enveloped values", () => {
		const enc = encryptSecret("hello");
		expect(decryptIfEncrypted(enc)).toBe("hello");
	});

	it("encryptOptional is idempotent on already-enveloped values", () => {
		const enc = encryptSecret("foo");
		const twice = encryptOptional(enc);
		expect(twice).toBe(enc);
	});

	it("encryptOptional returns null for null/undefined", () => {
		expect(encryptOptional(null)).toBe(null);
		expect(encryptOptional(undefined)).toBe(null);
		expect(encryptOptional("")).toBe(null);
	});

	it("each encryption produces a fresh IV (no deterministic output)", () => {
		const a = encryptSecret("same");
		const b = encryptSecret("same");
		expect(a).not.toBe(b);
		expect(decryptSecret(a)).toBe(decryptSecret(b));
	});

	it("decrypting a tampered ciphertext throws (GCM auth tag check)", () => {
		const enc = encryptSecret("don't tamper with me");
		// Flip a bit in the ciphertext segment.
		const [, , iv, ct] = enc.split(":");
		const tampered = `enc:v1:${iv}:${ct.slice(0, -2)}AA`;
		expect(() => decryptSecret(tampered)).toThrow();
	});
});
