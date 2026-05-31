import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "../src/app.mjs";

const approvedBundle = JSON.parse(readFileSync(resolve("examples/approved-bundle.example.json"), "utf8"));
const app = createApp(approvedBundle);

assertResponse("/legal-items", 200, (body) => Array.isArray(body.items) && body.items.length === 1);
assertResponse("/dataset/status", 200, (body) => body.counts.legalItems === 1);
assertResponse(
  "/change-proposals",
  200,
  (body) =>
    Array.isArray(body.proposals) &&
    body.proposals.length === 8 &&
    body.proposals[0]?.id === "ley-hojarasca" &&
    body.proposals.every((proposal) => proposal.dataKind === "REAL_AGENDA_ITEM")
);
assertResponse(
  "/change-proposals/ley-hojarasca",
  200,
  (body) => body.id === "ley-hojarasca" && body.diffs.length === 0 && body.sourceLinks.officialAgendaSourceUrl
);
assertResponse(
  "/change-proposals/ley-hojarasca/diffs",
  200,
  (body) => body.proposalId === "ley-hojarasca" && body.diffs.length === 0
);
assertResponse("/legal-items/ar-law-example-001/overview", 200, (body) => body.id === "ar-law-example-001");
assertResponse("/legal-items/ar-law-example-001/freshness", 200, (body) => body.status === "UPDATED");
assertResponse(
  "/search?q=hojarasca",
  200,
  (body) =>
    Array.isArray(body.proposals) &&
    body.proposals[0]?.id === "ley-hojarasca" &&
    Array.isArray(body.proposals[0].matchedDiffIds)
);
assertResponse(
  "/search?q=super%20rigi",
  200,
  (body) =>
    body.proposals[0]?.id === "super-rigi" &&
    Array.isArray(body.proposals[0]?.matchedTopicIds) &&
    body.proposals[0]?.matchSummary
);
assertResponse(
  "/search?q=pesca%20ilegal",
  200,
  (body) => body.proposals[0]?.id === "acuerdo-pesca-ilegal" && body.proposals[0]?.matchedTopicIds.includes("pesca")
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
