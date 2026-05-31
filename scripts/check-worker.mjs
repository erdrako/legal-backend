import { createD1App } from "../src/d1-app.mjs";

const overview = {
  id: "ar-law-example-001",
  title: "Norma argentina de ejemplo",
  type: "LAW",
  status: "DESCONOCIDO",
  summaryPlainLanguage: "Item legal de ejemplo para validar D1.",
  affectedSubjects: [],
  currentEffects: {
    obligations: 0,
    prohibitions: 0,
    rights: 0,
    sanctions: 0
  },
  relationshipsSummary: {
    modifications: 0,
    regulations: 0,
    caseLaw: 0,
    doctrine: 0,
    administrativeCriteria: 0,
    pendingBills: 0
  },
  freshness: {
    status: "UPDATED",
    pendingValidationCount: 1
  }
};

const dataset = {
  mode: "DEV_STRUCTURAL",
  disposable: true,
  counts: {
    legalItems: 1,
    provisions: 1,
    citations: 1,
    relationships: 0,
    rules: 0,
    concepts: 0,
    snapshots: 0
  }
};

const app = createD1App({
  ALLOW_DEV_STRUCTURAL_DATASET: "true",
  DB: fakeD1({
    dataset,
    overviews: [overview]
  })
});

const blockedApp = createD1App({
  DB: fakeD1({
    dataset,
    overviews: [overview]
  })
});

await assertResponse(app, "/dataset/status", 200, async (body) => body.mode === "DEV_STRUCTURAL" && body.servingPolicy.allowsDevelopmentDataset);
await assertResponse(blockedApp, "/legal-items", 409, async (body) => body.error === "DATASET_NOT_APPROVED");
await assertResponse("/legal-items", 200, async (body) => body.items.length === 1 && body.dataset.counts.legalItems === 1);
await assertResponse("/legal-items/ar-law-example-001/overview", 200, async (body) => body.id === overview.id);
await assertResponse("/legal-items/ar-law-example-001/freshness", 200, async (body) => body.status === "UPDATED");
await assertResponse("/search?q=ejemplo", 200, async (body) => body.items.length === 1);
await assertResponse("/legal-items/missing/overview", 404, async (body) => body.error === "LEGAL_ITEM_NOT_FOUND");

console.log("Worker D1 checks passed.");

async function assertResponse(appOrPath, pathOrStatus, statusOrPredicate, maybePredicate) {
  const appUnderTest = typeof appOrPath === "string" ? app : appOrPath;
  const path = typeof appOrPath === "string" ? appOrPath : pathOrStatus;
  const expectedStatus = typeof appOrPath === "string" ? pathOrStatus : statusOrPredicate;
  const predicate = typeof appOrPath === "string" ? statusOrPredicate : maybePredicate;
  const response = await appUnderTest.handle(new Request(`https://api.example.test${path}`));
  const body = await response.json();

  if (response.status !== expectedStatus) {
    fail(`${path} expected ${expectedStatus}, got ${response.status}`);
  }

  if (!(await predicate(body))) {
    fail(`${path} returned unexpected body: ${JSON.stringify(body)}`);
  }
}

function fakeD1({ dataset, overviews }) {
  return {
    prepare(sql) {
      const statement = {
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async first() {
          if (sql.includes("dataset_status")) {
            return { value_json: JSON.stringify(dataset) };
          }

          if (sql.includes("legal_item_overviews")) {
            const id = this.values[0];
            const found = overviews.find((item) => item.id === id);
            return found ? { overview_json: JSON.stringify(found) } : null;
          }

          return null;
        },
        async all() {
          if (sql.includes("WHERE lower")) {
            const query = this.values[0].replaceAll("%", "").toLowerCase();
            return {
              results: overviews
                .filter((item) => [item.title, item.summaryPlainLanguage, item.type, item.status].join(" ").toLowerCase().includes(query))
                .map((item) => ({ overview_json: JSON.stringify(item) }))
            };
          }

          return {
            results: overviews.map((item) => ({ overview_json: JSON.stringify(item) }))
          };
        }
      };

      return statement;
    }
  };
}

function fail(message) {
  console.error(`Worker check failed: ${message}`);
  process.exit(1);
}
