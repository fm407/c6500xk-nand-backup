#!/usr/bin/env node
// Builds docs/profile-builder/index.html from tools/profile-builder.template.html
// and the published sample profile. Run from the repository root:
//
//   node tools/build-profile-builder.mjs
//
// The sample keeps its own explanatory header in the repository. The builder
// page embeds only the data body, because the page writes a header of its own
// that records the values the visitor chose.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SAMPLE = "profiles/c6500xk-sample.ini";
const TEMPLATE = "tools/profile-builder.template.html";
const OUTPUT = "docs/profile-builder/index.html";
const START_MARKER = "#LOID Authentication";

function die(message) {
  console.error("build-profile-builder: " + message);
  process.exit(1);
}

const sample = readFileSync(SAMPLE, "utf8").replace(/\r\n/g, "\n");
const lines = sample.split("\n");

const start = lines.findIndex((line) => line.trim() === START_MARKER);
if (start < 0) {
  die("cannot find the body marker " + JSON.stringify(START_MARKER) + " in " + SAMPLE);
}
for (let i = 0; i < start; i += 1) {
  const line = lines[i];
  if (line.trim() !== "" && line.trim().charAt(0) !== "#") {
    die("unexpected data line above the body marker at line " + (i + 1) + ": " + line);
  }
}

const body = lines.slice(start).join("\n").replace(/\n+$/, "") + "\n";

const counts = {
  vendor: (body.match(/"XXXX"/g) || []).length,
  equipment: (body.match(/XXXXXXXXXX/g) || []).length,
  scriptClose: (body.match(/<\/script/gi) || []).length,
  commentOpen: (body.match(/<!--/g) || []).length
};

if (counts.vendor !== 3) {
  die("expected 3 vendor rows in the body, found " + counts.vendor);
}
if (counts.equipment !== 7) {
  die("expected 7 equipment rows in the body, found " + counts.equipment);
}
if (counts.scriptClose !== 0 || counts.commentOpen !== 0) {
  die("the body contains markup that cannot sit inside a script element");
}

const template = readFileSync(TEMPLATE, "utf8").replace(/\r\n/g, "\n");
const placeholder = "{{BASE_PROFILE}}";
if (template.split(placeholder).length !== 2) {
  die("the template must contain " + placeholder + " exactly once");
}

const html = template.replace(placeholder, body);

if (!html.includes(body)) {
  die("splice failed: the body is not present in the output");
}
if (html.includes(placeholder)) {
  die("placeholder left in the output");
}

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, html, "utf8");

const rows = body.split("\n").filter((line) => /^[?!0-9]/.test(line)).length;
console.log(
  [
    "wrote " + OUTPUT,
    "  body bytes : " + Buffer.byteLength(body),
    "  page bytes : " + Buffer.byteLength(html),
    "  ME rows    : " + rows,
    "  vendor rows: " + counts.vendor,
    "  equip rows : " + counts.equipment
  ].join("\n")
);
