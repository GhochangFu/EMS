import { hasControlChars, readDiscoveryCredentials } from "./discovery-credentials";

/** `F3.24b` (ADR 0103 Amendment 1; security review C1) — what the job takes from a decrypted credential record. */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertCrLfIsAControlChar(): void {
  assert(hasControlChars("pw\r\nCONFIG SET"), "CR LF must count as control characters");
}

export function assertNulAndDelAreControlChars(): void {
  assert(hasControlChars("a\u0000b") && hasControlChars("a\u007fb"), "NUL and DEL must count as control characters");
}

export function assertPrintableIsNotAControlChar(): void {
  assert(!hasControlChars("Pw-7f3a9c !@#$%^&*()"), "a printable password must pass");
}

export function assertControlCharPasswordIsRefused(): void {
  assert(!readDiscoveryCredentials({ username: "u", password: "p\nq" }).ok, "a password with a newline must be refused");
}

export function assertControlCharUsernameIsRefused(): void {
  assert(!readDiscoveryCredentials({ username: "u\r", password: "p" }).ok, "a username with a CR must be refused");
}

export function assertOnlyStringFieldsAreRead(): void {
  const read = readDiscoveryCredentials({ username: 7, password: "p", token: "t" });
  assert(
    read.ok && JSON.stringify(read.credentials) === '{"password":"p"}',
    `only string username and password are read; got ${JSON.stringify(read)}`,
  );
}
