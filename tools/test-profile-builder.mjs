#!/usr/bin/env node
// Checks the built profile builder. Run after tools/build-profile-builder.mjs:
//
//   node tools/test-profile-builder.mjs
//
// The page ships as one file with no external requests, so the generator logic
// cannot be imported. It is lifted out of the artifact between the core markers
// and exercised here against the published sample.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAGE = "docs/profile-builder/index.html";
const TEMPLATE = "tools/profile-builder.template.html";
const SAMPLE = "profiles/c6500xk-sample.ini";

const page = readFileSync(PAGE, "utf8");
const template = readFileSync(TEMPLATE, "utf8");
const sample = readFileSync(SAMPLE, "utf8").replace(/\r\n/g, "\n");

// ---- extract the embedded base profile ----

const baseMatch = page.match(/<script type="text\/plain" id="base-profile">([\s\S]*?)<\/script>/);
assert.ok(baseMatch, "base profile block is present");
const base = baseMatch[1].replace(/^\n/, "");

// ---- extract and load the generator core ----

const begin = page.indexOf("// ---- core begin");
const end = page.indexOf("// ---- core end");
assert.ok(begin > 0 && end > begin, "core markers are present");
const coreSource = page.slice(page.indexOf("\n", begin) + 1, end);

const core = new Function(
  coreSource + "\nreturn { buildProfile, buildApplyScript, validate, buildBody, buildHeader };"
)();

// ---- the embedded body must be the published sample body, unchanged ----

const sampleStart = sample.indexOf("#LOID Authentication");
assert.ok(sampleStart > 0, "sample body marker is present");
const sampleBody = sample.slice(sampleStart).replace(/\n+$/, "") + "\n";
assert.equal(base, sampleBody, "embedded body matches the published sample body byte for byte");

// ---- slot 8 reproduces the sample after identity substitution ----

const identity = {
  vendor: "AAAA",
  equipment: "BBBBBBBBBB",
  slot: 8,
  model: "C6500XK",
  code: "0x4400",
  path: ""
};

const expectedBody = sampleBody
  .split('"XXXX"')
  .join('"AAAA"')
  .split('257 0x0000 "XXXXXXXXXX"')
  .join('257 0x0000 "BBBBBBBBBB"')
  .split('"XXXXXXXXXX\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0"')
  .join('"BBBBBBBBBB\\0\\0\\0\\0\\0\\0\\0\\0\\0\\0"');

assert.equal(core.buildBody(base, identity), expectedBody, "slot 8 body equals the substituted sample");
assert.ok(!core.buildBody(base, identity).includes("XXXX"), "no vendor placeholder survives");
assert.ok(!core.buildBody(base, identity).includes("XXXXXXXXXX"), "no equipment placeholder survives");

const profile = core.buildProfile(base, identity);
assert.ok(profile.startsWith("# Profile for a C6500XK identity"), "profile carries a generated header");
assert.ok(profile.includes("\n\n#LOID Authentication\n"), "header is separated from the body");
assert.ok(profile.endsWith("\n"), "profile ends with a newline");
assert.ok(!profile.includes("\u2014"), "generated profile has no em dash");

const lines = profile.split("\n");
assert.equal(lines.filter((l) => /^256 0 /.test(l)).length, 1, "one ONU-G row");
assert.equal(lines.filter((l) => /^257 0x0000 /.test(l)).length, 1, "one ONU2-G row");
assert.equal(
  lines.filter((l) => /^\d+ \S+.*"AAAA"/.test(l)).length,
  3,
  "vendor ID appears on three rows"
);
assert.equal(
  (profile.match(/"BBBBBBBBBB/g) || []).length,
  7,
  "equipment ID appears on seven rows"
);

// ---- a different slot rewrites every slot-bearing field and nothing else ----

const ten = core.buildBody(base, { ...identity, slot: 10 });

assert.equal(ten.match(/^5 0x010a\b/gm).length, 1, "cardholder instance follows the slot");
assert.equal(ten.match(/^6 0x010a\b/gm).length, 1, "circuit pack instance follows the slot");
assert.equal(ten.match(/^11 0x0a01\b/gm).length, 1, "class 11 instance follows the slot");
assert.equal(ten.match(/^264 0x0a01\b/gm).length, 1, "class 264 instance follows the slot");
assert.equal(ten.match(/^277 \S+ 1 0 0 60000 0xffff 0x0a01[0-9a-f]{4} /gm).length, 8, "eight queue rows follow the slot");
assert.equal(ten.match(/^5 0x0180\b/gm).length, 1, "the fixed cardholder is untouched");
assert.equal(ten.match(/^6 0x0180\b/gm).length, 1, "the fixed circuit pack is untouched");

const dataLines = (text) => text.split("\n").filter((l) => /^[?!0-9]/.test(l));
assert.ok(
  dataLines(ten).every((l) => !/0x0108\b/.test(l)),
  "no stale slot 8 instance remains in data rows"
);
assert.ok(
  dataLines(ten).every((l) => !/0x0801\b/.test(l)),
  "no stale slot 8 related-port value remains in data rows"
);

const max = core.buildBody(base, { ...identity, slot: 254 });
assert.ok(max.includes("6 0x01fe "), "slot 254 maps to 0x01fe");
assert.ok(max.includes("264 0xfe01 "), "slot 254 maps to 0xfe01");
assert.ok(max.includes("0xfe010000"), "queue attribute follows slot 254");

// ---- validation ----

const bad = (input) => core.validate({ ...identity, ...input }).errors.length > 0;
assert.ok(bad({ vendor: "ABC" }), "three-character vendor is rejected");
assert.ok(bad({ vendor: "AB-D" }), "non-alphanumeric vendor is rejected");
assert.ok(bad({ equipment: "" }), "empty equipment ID is rejected");
assert.ok(bad({ equipment: "A".repeat(21) }), "twenty-one character equipment ID is rejected");
assert.ok(bad({ equipment: 'BAD"VALUE' }), "quote in equipment ID is rejected");
assert.ok(bad({ slot: 1 }), "slot 1 is rejected");
assert.ok(bad({ slot: 255 }), "slot 255 is rejected");
assert.ok(bad({ slot: 8.5 }), "fractional slot is rejected");
assert.ok(bad({ model: "MODEL WITH A REALLY LONG NAME" }), "overlong model string is rejected");
assert.ok(bad({ code: "4400" }), "product code without 0x is rejected");
assert.ok(bad({ path: "/tmp/it's.ini" }), "quote in path is rejected");

assert.equal(core.validate(identity).errors.length, 0, "the default identity validates");
const tenWarnings = core.validate({ ...identity, slot: 10, equipment: "SHORT" });
assert.equal(tenWarnings.errors.length, 0, "non-default slot and length still validate");
assert.equal(tenWarnings.warnings.length, 2, "both deviations warn");

// ---- the helper script ----

const withPath = core.buildApplyScript(identity, "/ptconf/8311/profile.ini");
assert.ok(withPath.includes("fw_setenv 8311_vendor_id 'AAAA'"), "script sets the vendor ID");
assert.ok(withPath.includes("fw_setenv 8311_equipment_id 'BBBBBBBBBB'"), "script sets the equipment ID");
assert.ok(withPath.includes("fw_setenv 8311_pon_slot 8"), "script sets the slot");
assert.ok(withPath.includes("fw_setenv 8311_mib_file '/ptconf/8311/profile.ini'"), "script sets the pointer");
assert.ok(withPath.startsWith("#!/bin/sh\n"), "script has a shebang");
assert.ok(withPath.includes("set -e"), "script stops on error");

const noPath = core.buildApplyScript(identity, "");
assert.ok(!noPath.includes("fw_setenv 8311_mib_file /"), "script leaves the pointer out when no path is given");
assert.ok(noPath.includes("# fw_setenv 8311_mib_file <path-on-the-module>"), "script explains the missing pointer");

// ---- the artifact itself ----

assert.ok(page.includes("default-src 'none'"), "page declares a restrictive policy");
assert.ok(page.includes("connect-src 'none'"), "page blocks network connections");
assert.ok(!page.includes("\u2014"), "built page has no em dash");
assert.ok(!template.includes("\u2014"), "template has no em dash");
assert.ok(!page.includes("{{BASE_PROFILE}}"), "no build placeholder remains");
assert.ok(!page.includes("localStorage"), "page does not touch local storage");
assert.ok(!page.includes("sessionStorage"), "page does not touch session storage");
assert.ok(!page.includes("document.cookie"), "page does not touch cookies");
assert.ok(!/\bfetch\s*=/.test(page), "page does not replace fetch");

// every inline script must parse
const scriptBlocks = [...page.matchAll(/<script(?![^>]*type="text\/plain")[^>]*>([\s\S]*?)<\/script>/g)];
assert.equal(scriptBlocks.length, 1, "one executable script block");
new Function(scriptBlocks[0][1]);

console.log(
  [
    "profile builder checks passed",
    "  page bytes : " + Buffer.byteLength(page),
    "  body bytes : " + Buffer.byteLength(base),
    "  ME rows    : " + dataLines(base).length
  ].join("\n")
);
