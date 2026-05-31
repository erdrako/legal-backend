import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "../src/app.mjs";

const approvedBundle = JSON.parse(readFileSync(resolve("examples/approved-bundle.example.json"), "utf8"));
const app = createApp(approvedBundle);

assertResponse("/legal-items", 200, (body) => Array.isArray(body.items) && body.items.length === 1);
assertResponse("/dataset/status", 200, (body) => body.counts.legalItems === 1);
assertResponse("/change-proposals", 200, (body) => Array.isArray(body.proposals) && body.proposals.length === 1);
assertResponse(
  "/change-proposals/reforma-laboral-mvp-2026",
  200,
  (body) => body.id === "reforma-laboral-mvp-2026" && body.diffs.length === 5
);
assertResponse(
  "/change-proposals/reforma-laboral-mvp-2026/diffs",
  200,
  (body) => body.proposalId === "reforma-laboral-mvp-2026" && body.diffs.length === 5
);
assertResponse("/legal-items/ar-law-example-001/overview", 200, (body) => body.id === "ar-law-example-001");
assertResponse("/legal-items/ar-law-example-001/freshness", 200, (body) => body.status === "UPDATED");
assertResponse(
  "/search?q=reforma%20laboral",
  200,
  (body) => Array.isArray(body.proposals) && body.proposals[0]?.id === "reforma-laboral-mvp-2026"
);
assertResponse("/search?q=ejemplo", 200, (body) => Array.isArray(body.items) && body.items.length === 1);
assertResponse("/search?q=", 422, (body) => body.error === "MISSING_QUERY");
assertResponse("/legal-items/missing/overview", 404, (body) => body.error === "LEGAL_ITEM_NOT_FOUND");
assertResponse("/change-proposals/missing", 404, (body) => body.error === "CHANGE_PROPOSAL_NOT_FOUND");

console.log("API handler checks passed.");

function assertResponse(url, expectedStatus, predicate) {
  const response = app.handle({
    method: "GET",
    url
  });

  if (response.status !== expectedStatus) {
    fail(`${url} expected ${expectedStatus}, got ${response.status}`);
  }

  if (!predicate(response.body)) {
    fail(`${url} returned unexpected body: ${JSON.stringify(response.body)}`);
  }
}

function fail(message) {
  console.error(`API check failed: ${message}`);
  process.exit(1);
}
