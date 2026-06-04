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
await assertResponse(
  "/change-proposals",
  200,
  async (body) =>
    body.proposals.length === 3 &&
    body.proposals[0]?.id === "ley-hojarasca" &&
    body.proposals.every((proposal) => proposal.chamber === "SENATE")
);
await assertResponse(
  "/change-proposals/ley-hojarasca",
  200,
  async (body) => body.id === "ley-hojarasca" && body.diffs.length === 0 && body.dataKind === "REAL_AGENDA_ITEM"
);
await assertResponse(
  "/change-proposals/ley-hojarasca/diffs",
  200,
  async (body) => body.proposalId === "ley-hojarasca" && body.diffs.length === 0
);
await assertResponse(
  blockedApp,
  "/search?q=biocombustibles",
  200,
  async (body) =>
    body.proposals[0]?.id === "biocombustibles" &&
    Array.isArray(body.proposals[0].matchedDiffIds) &&
    body.items.length === 0 &&
    body.itemsUnavailable.error === "DATASET_NOT_APPROVED"
);
await assertResponse("/legal-items", 200, async (body) => body.items.length === 1 && body.dataset.counts.legalItems === 1);
await assertResponse("/legal-items/ar-law-example-001/overview", 200, async (body) => body.id === overview.id);
await assertResponse("/legal-items/ar-law-example-001/freshness", 200, async (body) => body.status === "UPDATED");
await assertResponse(
  "/search?q=santa%20cruz",
  200,
  async (body) =>
    body.proposals[0]?.id === "parque-marino-monte-leon" &&
    body.proposals[0]?.matchedTopicIds.includes("santa-cruz")
);
await assertResponse("/search?q=ejemplo", 200, async (body) => body.items.length === 1);
await assertResponse("/legal-items/missing/overview", 404, async (body) => body.error === "LEGAL_ITEM_NOT_FOUND");
await assertResponse("/change-proposals/missing", 404, async (body) => body.error === "CHANGE_PROPOSAL_NOT_FOUND");

const processingDb = fakeD1({ dataset, overviews: [] });
const processingApp = createD1App({
  DB: fakeD1({ dataset, overviews: [overview] }),
  PROCESSING_DB: processingDb,
  PROCESSOR_ENROLLMENT_TOKEN: "enroll-token",
  PROCESSOR_ADMIN_TOKEN: "admin-token"
});

await assertRequest(
  processingApp,
  {
    path: "/processing-queue"
  },
  200,
  async (body) => body.counts.PENDING === 0 && Array.isArray(body.processors)
);
await assertRequest(
  processingApp,
  {
    path: "/detected-projects"
  },
  200,
  async (body) => Array.isArray(body.projects) && body.counts.total === 0
);
await assertRequest(
  processingApp,
  {
    path: "/processing-review"
  },
  200,
  async (body) => body.queue.counts.PENDING === 0 && Array.isArray(body.review.candidates)
);
await assertRequest(
  processingApp,
  {
    method: "POST",
    path: "/processing-review/affected-items/resolve-current-sources",
    token: "admin-token",
    body: { limit: 5 }
  },
  200,
  async (body) => body.status === "COMPLETED" && body.counters.selected === 0
);

const enrollment = await requestJson(processingApp, {
  method: "POST",
  path: "/processors/enroll",
  token: "enroll-token",
  body: {
    displayName: "PC local de prueba",
    tier: 2,
    capabilities: ["PDF_TEXT", "OCR", "LEGAL_REFERENCES", "LEGAL_DIFF_CANDIDATES"],
    modelName: "gemma3:1b",
    processorVersion: "0.1.0"
  }
});

if (enrollment.response.status !== 201 || !enrollment.body.processor?.id || !enrollment.body.processorSecret) {
  fail(`/processors/enroll returned unexpected body: ${JSON.stringify(enrollment.body)}`);
}

const processorId = enrollment.body.processor.id;
const processorSecret = enrollment.body.processorSecret;

await assertRequest(
  processingApp,
  {
    method: "POST",
    path: "/processors/heartbeat",
    processorId,
    token: processorSecret,
    body: { status: "ONLINE", currentJobId: null }
  },
  200,
  async (body) => body.processor.id === processorId && body.processor.status === "ONLINE"
);

const createdJob = await requestJson(processingApp, {
  method: "POST",
  path: "/processing-queue/jobs",
  token: "admin-token",
  body: {
    jobType: "GENERATE_DIFF_CANDIDATES",
    priority: 10,
    sourceLabel: "Expediente de prueba",
    sourceUrl: "https://example.test/proyecto.pdf",
    requiredCapabilities: ["PDF_TEXT", "LEGAL_DIFF_CANDIDATES"],
    input: {
      agendaItem: { id: "agenda-1", title: "Proyecto de prueba" },
      documentSources: []
    }
  }
});

if (createdJob.response.status !== 201 || createdJob.body.job.status !== "PENDING") {
  fail(`/processing-queue/jobs returned unexpected body: ${JSON.stringify(createdJob.body)}`);
}

const claimedJob = await requestJson(processingApp, {
  method: "POST",
  path: "/processors/jobs/claim",
  processorId,
  token: processorSecret,
  body: { maxLeaseSeconds: 300 }
});

if (claimedJob.response.status !== 200 || claimedJob.body.job?.id !== createdJob.body.job.id) {
  fail(`/processors/jobs/claim returned unexpected body: ${JSON.stringify(claimedJob.body)}`);
}

await assertRequest(
  processingApp,
  {
    method: "POST",
    path: `/processors/jobs/${createdJob.body.job.id}/progress`,
    processorId,
    token: processorSecret,
    body: { message: "Extrayendo texto", progress: { step: "EXTRACT_PDF_TEXT" } }
  },
  200,
  async (body) => body.job.status === "PROCESSING"
);

await assertRequest(
  processingApp,
  {
    method: "POST",
    path: `/processors/jobs/${createdJob.body.job.id}/result`,
    processorId,
    token: processorSecret,
    body: {
      status: "COMPLETED",
      result: {
        diffCandidates: [
          {
            title: "Cambio candidato",
            changeType: "MODIFIED",
            confidence: "LOW",
            reviewStatus: "NEEDS_REVIEW",
            validationWarnings: []
          }
        ]
      },
      artifacts: [
        {
          artifactType: "NORMALIZED_TEXT",
          content: { text: "texto normalizado" },
          contentHash: "sha256-test",
          sourceUrl: "https://example.test/proyecto.pdf"
        }
      ]
    }
  },
  200,
  async (body) => body.job.status === "COMPLETED"
);

await assertRequest(
  processingApp,
  {
    path: "/processing-queue"
  },
  200,
  async (body) => body.counts.COMPLETED === 1 && body.jobs[0]?.status === "COMPLETED"
);
await assertRequest(
  processingApp,
  {
    method: "POST",
    path: `/processing-queue/jobs/${createdJob.body.job.id}/retry`,
    token: "admin-token"
  },
  200,
  async (body) => body.job.status === "PENDING"
);

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

async function assertRequest(appUnderTest, requestOptions, expectedStatus, predicate) {
  const { response, body } = await requestJson(appUnderTest, requestOptions);

  if (response.status !== expectedStatus) {
    fail(`${requestOptions.path} expected ${expectedStatus}, got ${response.status}`);
  }

  if (!(await predicate(body))) {
    fail(`${requestOptions.path} returned unexpected body: ${JSON.stringify(body)}`);
  }
}

async function requestJson(appUnderTest, { method = "GET", path, body, token, processorId }) {
  const headers = new Headers();
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }
  if (processorId) {
    headers.set("x-processor-id", processorId);
  }
  if (body) {
    headers.set("content-type", "application/json");
  }

  const response = await appUnderTest.handle(
    new Request(`https://api.example.test${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    })
  );

  return {
    response,
    body: await response.json()
  };
}

function fakeD1({ dataset, overviews }) {
  const state = {
    processors: [],
    jobs: [],
    attempts: [],
    artifacts: [],
    affectedLegalItems: [],
    extractedProvisions: [],
    changeOperations: [],
    diffCandidates: []
  };

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

          if (sql.includes("processor_nodes WHERE id")) {
            return state.processors.find((processor) => processor.id === this.values[0]) ?? null;
          }

          if (sql.includes("processing_jobs WHERE id")) {
            return state.jobs.find((job) => job.id === this.values[0]) ?? null;
          }

          if (sql.includes("processing_jobs WHERE dedupe_key")) {
            return state.jobs.find((job) => job.dedupe_key === this.values[0]) ?? null;
          }

          if (sql.includes("FROM processing_jobs") && sql.includes("status = 'PENDING'")) {
            return (
              state.jobs
                .filter((job) => job.status === "PENDING")
                .sort((left, right) => right.priority - left.priority || left.created_at.localeCompare(right.created_at))[0] ?? null
            );
          }

          if (sql.includes("legal_item_overviews")) {
            const id = this.values[0];
            const found = overviews.find((item) => item.id === id);
            return found ? { overview_json: JSON.stringify(found) } : null;
          }

          return null;
        },
        async all() {
          if (sql.includes("FROM processor_nodes")) {
            return { results: state.processors };
          }

          if (sql.includes("COUNT(*) AS count FROM processing_jobs")) {
            const counts = new Map();
            for (const job of state.jobs) {
              counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
            }
            return {
              results: [...counts.entries()].map(([status, count]) => ({ status, count }))
            };
          }

          if (sql.includes("FROM processing_jobs") && sql.includes("ORDER BY priority")) {
            return {
              results: [...state.jobs].sort((left, right) => right.priority - left.priority || left.created_at.localeCompare(right.created_at))
            };
          }

          if (sql.includes("FROM agenda_items ai")) {
            return { results: [] };
          }

          if (sql.includes("FROM generated_diff_candidates gdc")) {
            return { results: [] };
          }

          if (sql.includes("FROM affected_legal_items")) {
            return { results: [] };
          }

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
        },
        async run() {
          if (sql.includes("INSERT INTO processor_nodes")) {
            state.processors.push({
              id: this.values[0],
              display_name: this.values[1],
              status: "ONLINE",
              secret_hash: this.values[2],
              tier: this.values[3],
              capabilities_json: this.values[4],
              current_job_id: null,
              model_name: this.values[5],
              processor_version: this.values[6],
              last_seen_at: this.values[7],
              created_at: this.values[8],
              updated_at: this.values[9]
            });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("UPDATE processor_nodes SET status = ?")) {
            const processor = state.processors.find((item) => item.id === this.values[8]);
            Object.assign(processor, {
              status: this.values[0],
              current_job_id: this.values[1],
              tier: this.values[2],
              capabilities_json: this.values[3],
              model_name: this.values[4],
              processor_version: this.values[5],
              last_seen_at: this.values[6],
              updated_at: this.values[7]
            });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("UPDATE processor_nodes SET current_job_id = ?, status = 'ONLINE'")) {
            const processor = state.processors.find((item) => item.id === this.values[3]);
            Object.assign(processor, {
              current_job_id: this.values[0],
              status: "ONLINE",
              last_seen_at: this.values[1],
              updated_at: this.values[2]
            });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("UPDATE processor_nodes SET current_job_id = NULL")) {
            const processor = state.processors.find((item) => item.id === this.values[2]);
            Object.assign(processor, {
              current_job_id: null,
              last_seen_at: this.values[0],
              updated_at: this.values[1]
            });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("INSERT OR IGNORE INTO processing_jobs")) {
            const dedupeKey = this.values[7];
            if (dedupeKey && state.jobs.some((job) => job.dedupe_key === dedupeKey)) {
              return { success: true, meta: { changes: 0 } };
            }
            state.jobs.push({
              id: this.values[0],
              job_type: this.values[1],
              status: "PENDING",
              priority: this.values[2],
              input_json: this.values[3],
              result_json: null,
              error_json: null,
              required_capabilities_json: this.values[4],
              source_label: this.values[5],
              source_url: this.values[6],
              dedupe_key: dedupeKey,
              lease_owner_id: null,
              lease_until: null,
              attempts: 0,
              progress_json: null,
              created_at: this.values[8],
              updated_at: this.values[9],
              completed_at: null,
              failed_at: null
            });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("UPDATE processing_jobs") && sql.includes("status = 'LEASED'")) {
            const job = state.jobs.find((item) => item.id === this.values[3]);
            Object.assign(job, {
              status: "LEASED",
              lease_owner_id: this.values[0],
              lease_until: this.values[1],
              attempts: job.attempts + 1,
              updated_at: this.values[2]
            });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("UPDATE processing_jobs SET status = 'PROCESSING'")) {
            const job = state.jobs.find((item) => item.id === this.values[2]);
            Object.assign(job, {
              status: "PROCESSING",
              progress_json: this.values[0],
              updated_at: this.values[1]
            });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("UPDATE processing_jobs") && sql.includes("result_json") && !sql.includes("result_json = NULL")) {
            const job = state.jobs.find((item) => item.id === this.values[4]);
            Object.assign(job, {
              status: this.values[0],
              result_json: this.values[1],
              lease_owner_id: null,
              lease_until: null,
              updated_at: this.values[2],
              completed_at: this.values[3]
            });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("UPDATE processing_jobs") && sql.includes("error_json") && !sql.includes("error_json = NULL")) {
            const job = state.jobs.find((item) => item.id === this.values[3]);
            Object.assign(job, {
              status: "FAILED",
              error_json: this.values[0],
              lease_owner_id: null,
              lease_until: null,
              updated_at: this.values[1],
              failed_at: this.values[2]
            });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("UPDATE processing_jobs") && sql.includes("status = 'PENDING'")) {
            const job = state.jobs.find((item) => item.id === this.values[1]);
            Object.assign(job, {
              status: "PENDING",
              lease_owner_id: null,
              lease_until: null,
              updated_at: this.values[0]
            });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("INSERT INTO processing_job_attempts")) {
            state.attempts.push({
              id: this.values[0],
              job_id: this.values[1],
              processor_id: this.values[2],
              status: this.values[3],
              message: this.values[4],
              metadata_json: this.values[5],
              created_at: this.values[6]
            });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("INSERT INTO processing_artifacts")) {
            state.artifacts.push({
              id: this.values[0],
              job_id: this.values[1],
              processor_id: this.values[2],
              artifact_type: this.values[3],
              content_json: this.values[4],
              content_hash: this.values[5],
              source_url: this.values[6],
              created_at: this.values[7]
            });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("INSERT OR REPLACE INTO affected_legal_items")) {
            state.affectedLegalItems.push({ id: this.values[0] });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("INSERT OR REPLACE INTO extracted_provisions")) {
            state.extractedProvisions.push({ id: this.values[0] });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("INSERT OR REPLACE INTO change_operations")) {
            state.changeOperations.push({ id: this.values[0] });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("INSERT OR REPLACE INTO generated_diff_candidates")) {
            state.diffCandidates.push({ id: this.values[0] });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("DELETE FROM generated_diff_candidates")) {
            state.diffCandidates = state.diffCandidates.filter((item) => item.job_id !== this.values[0]);
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("DELETE FROM change_operations")) {
            state.changeOperations = [];
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("DELETE FROM affected_legal_items")) {
            state.affectedLegalItems = [];
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("DELETE FROM extracted_provisions")) {
            state.extractedProvisions = [];
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("DELETE FROM processing_artifacts")) {
            state.artifacts = [];
            return { success: true, meta: { changes: 1 } };
          }

          return { success: true, meta: { changes: 0 } };
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
