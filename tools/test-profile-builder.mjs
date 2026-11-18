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
  code: "0x4400"
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
assert.ok(bad({ mib_file: "/tmp/it's.ini" }), "quote in MIB path is rejected");
assert.ok(bad({ mib_file: "/ptconf/8311/profile.ini" }), "a plain /ptconf path is rejected");
assert.ok(bad({ mib_file: "../../etc/profile.ini" }), "a path that escapes /etc/mibs is rejected");
assert.ok(!bad({ mib_file: "../../ptconf/8311/profile.ini" }), "the ../../ptconf form is accepted");
assert.ok(!bad({ mib_file: "/etc/mibs/profile.ini" }), "an /etc/mibs path is accepted");
assert.ok(bad({ iop_mask: 128 }), "iop mask above 127 is rejected");
assert.ok(bad({ omcc: "0x80" }), "OMCC version below 0x82 is rejected");
assert.ok(bad({ internet_vlan: 36, services_vlan: 36 }), "equal VLANs are rejected");
assert.ok(bad({ fsan: "ABCD1234" }), "eight-character PON serial is rejected");
assert.ok(bad({ iphost_mac: "AA:BB:CC:DD:EE" }), "short IP host MAC is rejected");

assert.equal(core.validate(identity).errors.length, 0, "the default identity validates");
const tenWarnings = core.validate({ ...identity, slot: 10, equipment: "SHORT" });
assert.equal(tenWarnings.errors.length, 0, "non-default slot and length still validate");
assert.equal(tenWarnings.warnings.length, 5, "each deviation warns");

const tagged = core.validate({ ...identity, internet_vlan: 201 });
assert.ok(
  tagged.warnings.some((w) => w.includes("Internet VLAN is tagged")),
  "a tagged Internet VLAN warns about the router tag"
);
const noFix = core.validate({ ...identity, fix_vlans: "0" });
assert.ok(
  noFix.warnings.some((w) => w.includes("Fix VLANs is not 1")),
  "disabled VLAN fixes warn"
);

// ---- the helper script ----

const withPath = core.buildApplyScript(identity, "../../ptconf/8311/profile.ini");
assert.ok(withPath.includes("fwenv_set 8311_vendor_id 'AAAA'"), "script sets the vendor ID");
assert.ok(withPath.includes("fwenv_set 8311_equipment_id 'BBBBBBBBBB'"), "script sets the equipment ID");
assert.ok(withPath.includes("fwenv_set 8311_pon_slot 8"), "script sets the slot");
assert.ok(withPath.includes("fwenv_set 8311_mib_file '../../ptconf/8311/profile.ini'"), "script sets the pointer");
assert.ok(withPath.startsWith("#!/bin/sh\n"), "script has a shebang");
assert.ok(withPath.includes("set -e"), "script stops on error");
assert.ok(withPath.includes("writes each value to both environment copies"), "script explains the two copies");
assert.ok(withPath.includes("fwenv_set 8311_pon_mode 'xgspon'"), "script sets the PON mode");
assert.ok(withPath.includes("fwenv_set 8311_iop_mask 18"), "script sets the interoperability mask");
assert.ok(withPath.includes("fwenv_set 8311_cp_hw_ver_sync 1"), "script syncs the circuit pack by default");
assert.ok(withPath.includes("fwenv_set 8311_fix_vlans '1'"), "script keeps VLAN fixes on");
assert.ok(withPath.includes("fwenv_set 8311_internet_vlan 0"), "script sets the Internet VLAN to untagged");
assert.ok(withPath.includes("fwenv_set 8311_services_vlan 36"), "script sets the Services VLAN default");
assert.ok(withPath.includes("/dev/mtd1"), "script reads the first environment copy");
assert.ok(withPath.includes("/dev/mtd2"), "script reads the second environment copy");

const noPath = core.buildApplyScript(identity, "");
assert.ok(!noPath.includes("fwenv_set 8311_mib_file /"), "script leaves the pointer out when no path is given");
assert.ok(noPath.includes("# fwenv_set 8311_mib_file <path-on-the-module>"), "script explains the missing pointer");

const full = {
  ...identity,
  fsan: "ABCD12345678",
  hw_ver: "C6500XK",
  omcc: "0x9A",
  sw_a: "01.02.03.04",
  sw_b: "05.06.07.08",
  reg_id: "001122334455",
  loid: "user@example.net",
  lpwd: "secret",
  iphost_mac: "AA:BB:CC:DD:EE:FF",
  iphost_hostname: "ont",
  iphost_domain: "example.net",
  override_active: "B",
  override_commit: "B",
  fw_match: "^v(\\d+)$",
  fw_match_num: 2,
  mib_file: "../../ptconf/8311/profile.ini"
};
const fullScript = core.buildApplyScript(full);
assert.ok(fullScript.includes("fwenv_set 8311_gpon_sn 'ABCD12345678'"), "script sets the PON serial");
assert.ok(fullScript.includes("fwenv_set 8311_hw_ver 'C6500XK'"), "script sets the hardware version");
assert.ok(fullScript.includes("fwenv_set 8311_omcc_version '0x9A'"), "script sets the OMCC version");
assert.ok(fullScript.includes("fwenv_set 8311_sw_verA '01.02.03.04'"), "script sets software A");
assert.ok(fullScript.includes("fwenv_set 8311_reg_id_hex '001122334455'"), "script sets the registration ID");
assert.ok(fullScript.includes("fwenv_set 8311_iphost_mac 'AA:BB:CC:DD:EE:FF'"), "script sets the IP host MAC");
assert.ok(fullScript.includes("fwenv_set 8311_override_active 'B'"), "script sets the active bank");
assert.ok(fullScript.includes("fwenv_set --8311 --base64 fw_match '^v(\\d+)$'"), "script base64-encodes the firmware match");
assert.ok(fullScript.includes("fwenv_set 8311_fw_match_num 2"), "script sets the firmware match number");

// ---- OMCC version rewriting ----

const omcc = core.buildBody(base, { ...identity, omcc: "0x9A" });
assert.ok(
  omcc.includes('257 0x0000 "BBBBBBBBBB" 0x9a 0x4400'),
  "the ONU2-G OMCC version follows the input"
);
assert.ok(
  omcc.includes('257 0x0000 "BBBBBBBBBB" 0xa3 0x4400') === false,
  "the default OMCC version is replaced"
);

// ---- hardware version rewriting ----

const synced = core.buildBody(base, { ...identity, hw_ver: "EXAMPLE1", cp_sync: true });
assert.ok(synced.includes('256 0 "AAAA" "EXAMPLE1"'), "ONU-G hardware version follows the input");
assert.equal((synced.match(/"EXAMPLE1"/g) || []).length, 3, "ONU-G and both circuit packs carry the version");

const unsynced = core.buildBody(base, { ...identity, hw_ver: "EXAMPLE1", cp_sync: false });
assert.ok(unsynced.includes('256 0 "AAAA" "EXAMPLE1"'), "ONU-G hardware version still follows the input");
assert.equal((unsynced.match(/"EXAMPLE1"/g) || []).length, 1, "circuit packs stay on the model string when sync is off");

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
