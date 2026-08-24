// Redirected before the import, so nothing here can touch a real data dir.
process.env.ARCHIDEKT_FILE = "/tmp/mtg-agent-test-archidekt.json";
delete process.env.ARCHIDEKT_USER;
delete process.env.ARCHIDEKT_PASS;

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { loadArchidekt, saveArchidekt, deleteArchidekt, archidektStatus } from "../server/keystore";
import { archidektCredentials, NOT_SIGNED_IN } from "../server/archidekt";

const FILE = process.env.ARCHIDEKT_FILE!;
const clean = () => {
  try {
    unlinkSync(FILE);
  } catch {}
  delete process.env.ARCHIDEKT_USER;
  delete process.env.ARCHIDEKT_PASS;
};

describe("archidekt sign-in", () => {
  beforeEach(clean);
  afterEach(clean);

  test("signed out is a message telling you how to sign in, not a crash", () => {
    expect(loadArchidekt()).toBeNull();
    expect(archidektStatus()).toEqual({ configured: false, user: null, fromEnv: false });
    expect(() => archidektCredentials()).toThrow(NOT_SIGNED_IN);
  });

  test("a saved login round-trips, and only its owner can read the file", () => {
    saveArchidekt({ user: "  someone  ", pass: "hunter2" });
    expect(loadArchidekt()).toEqual({ user: "someone", pass: "hunter2" });
    expect(statSync(FILE).mode & 0o777).toBe(0o600);
  });

  test("env beats the file, and says so — the page must not offer to sign out of a .env", () => {
    saveArchidekt({ user: "from-file", pass: "a" });
    process.env.ARCHIDEKT_USER = "from-env";
    process.env.ARCHIDEKT_PASS = "b";
    expect(loadArchidekt()).toEqual({ user: "from-env", pass: "b" });
    expect(archidektStatus()).toEqual({ configured: true, user: "from-env", fromEnv: true });
  });

  test("signing out leaves nothing behind", () => {
    saveArchidekt({ user: "someone", pass: "hunter2" });
    deleteArchidekt();
    expect(existsSync(FILE)).toBe(false);
    expect(loadArchidekt()).toBeNull();
  });

  test("a half-written login is no login", () => {
    process.env.ARCHIDEKT_USER = "someone";
    expect(loadArchidekt()).toBeNull();
  });
});
