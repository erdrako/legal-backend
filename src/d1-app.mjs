import {
  getProposal,
  getProposalDiffs,
  listProposalOverviews,
  searchProposalOverviews
} from "./change-proposals.mjs";
import { handleProcessingRoute, isProcessingRoute } from "./processing-queue.mjs";

export function createD1App(env) {
  return {
    async handle(request) {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return json(204, {});
      }

      if (isProcessingRoute(url.pathname)) {
        return handleProcessingRoute(request, env, json);
      }

      if (request.method !== "GET") {
        return json(405, { error: "METHOD_NOT_ALLOWED" });
      }

      if (url.pathname === "/change-proposals") {
        return json(200, {
          proposals: listProposalOverviews()
        });
      }

      const proposalMatch = url.pathname.match(/^\/change-proposals\/([^/]+)$/);
      if (proposalMatch) {
        const proposal = getProposal(decodeURIComponent(proposalMatch[1]));

        if (!proposal) {
          return json(404, { error: "CHANGE_PROPOSAL_NOT_FOUND" });
        }

        return json(200, proposal);
      }

      const proposalDiffsMatch = url.pathname.match(/^\/change-proposals\/([^/]+)\/diffs$/);
      if (proposalDiffsMatch) {
        const proposalId = decodeURIComponent(proposalDiffsMatch[1]);
        const diffs = getProposalDiffs(proposalId);

        if (!diffs) {
          return json(404, { error: "CHANGE_PROPOSAL_NOT_FOUND" });
        }

        return json(200, { proposalId, diffs });
      }

      if (url.pathname === "/search") {
        const query = (url.searchParams.get("q") ?? "").trim();

        if (!query) {
          return json(422, { error: "MISSING_QUERY" });
        }

        const proposals = searchProposalOverviews(query);

        if (!env?.DB) {
          return json(200, {
            query,
            proposals,
            items: [],
            itemsUnavailable: {
              error: "D1_BINDING_MISSING",
              message: "Cloudflare D1 binding DB is required for legal item search."
            }
          });
        }

        const dataset = await datasetStatus(env.DB);
        const policy = datasetServingPolicy(env, dataset);

        if (!policy.canServePublicRead) {
          return json(200, {
            query,
            proposals,
            items: [],
            itemsUnavailable: {
              error: "DATASET_NOT_APPROVED",
              dataset: {
                mode: dataset.mode,
                disposable: Boolean(dataset.disposable),
                warning: dataset.warning
              },
              servingPolicy: policy
            }
          });
        }

        return json(200, {
          query,
          proposals,
          items: await searchOverviews(env.DB, query)
        });
      }

      if (!env?.DB) {
        return d1BindingMissing();
      }

      if (url.pathname === "/dataset/status") {
        const dataset = await datasetStatus(env.DB);

        return json(200, {
          ...dataset,
          servingPolicy: datasetServingPolicy(env, dataset)
        });
      }

      if (url.pathname === "/legal-items") {
        const dataset = await datasetStatus(env.DB);
        const guard = guardDatasetForPublicRead(env, dataset);

        if (guard) {
          return guard;
        }

        const items = await listOverviews(env.DB);

        return json(200, { dataset, items });
      }

      const overviewMatch = url.pathname.match(/^\/legal-items\/([^/]+)\/overview$/);
      if (overviewMatch) {
        const dataset = await datasetStatus(env.DB);
        const guard = guardDatasetForPublicRead(env, dataset);

        if (guard) {
          return guard;
        }

        const overview = await getOverview(env.DB, decodeURIComponent(overviewMatch[1]));

        if (!overview) {
          return json(404, { error: "LEGAL_ITEM_NOT_FOUND" });
        }

        return json(200, overview);
      }

      const freshnessMatch = url.pathname.match(/^\/legal-items\/([^/]+)\/freshness$/);
      if (freshnessMatch) {
        const dataset = await datasetStatus(env.DB);
        const guard = guardDatasetForPublicRead(env, dataset);

        if (guard) {
          return guard;
        }

        const overview = await getOverview(env.DB, decodeURIComponent(freshnessMatch[1]));

        if (!overview) {
          return json(404, { error: "LEGAL_ITEM_NOT_FOUND" });
        }

        return json(200, overview.freshness);
      }

      return json(404, { error: "NOT_FOUND" });
    }
  };
}

function d1BindingMissing() {
  return json(503, {
    error: "D1_BINDING_MISSING",
    message: "Cloudflare D1 binding DB is required."
  });
}

function guardDatasetForPublicRead(env, dataset) {
  const policy = datasetServingPolicy(env, dataset);

  if (policy.canServePublicRead) {
    return undefined;
  }

  return json(409, {
    error: "DATASET_NOT_APPROVED",
    message: "This dataset is not approved for public read models.",
    dataset: {
      mode: dataset.mode,
      disposable: Boolean(dataset.disposable),
      warning: dataset.warning
    },
    servingPolicy: policy
  });
}

function datasetServingPolicy(env, dataset) {
  const mode = dataset.mode ?? "UNKNOWN";
  const isApprovedMode = mode === "HUMAN_REVIEWED" || mode === "PRODUCTION_APPROVED";
  const isDevelopmentDataset = mode === "DEV_STRUCTURAL" || dataset.disposable === true;
  const allowsDevelopmentDataset = env?.ALLOW_DEV_STRUCTURAL_DATASET === "true";

  return {
    canServePublicRead: isApprovedMode || (isDevelopmentDataset && allowsDevelopmentDataset),
    requiresApprovedDataset: !allowsDevelopmentDataset,
    allowsDevelopmentDataset,
    reason: isApprovedMode
      ? "APPROVED_DATASET"
      : isDevelopmentDataset && allowsDevelopmentDataset
        ? "TECHNICAL_PREVIEW_OVERRIDE"
        : "DEVELOPMENT_DATASET_BLOCKED"
  };
}

async function datasetStatus(db) {
  const row = await db.prepare("SELECT value_json FROM dataset_status WHERE id = ?").bind("current").first();

  if (!row) {
    return {
      mode: "UNKNOWN",
      disposable: false,
      warning: "Dataset status has not been loaded into D1.",
      counts: {
        legalItems: 0,
        provisions: 0,
        citations: 0,
        relationships: 0,
        rules: 0,
        concepts: 0,
        snapshots: 0
      }
    };
  }

  return JSON.parse(row.value_json);
}

async function listOverviews(db) {
  const result = await db
    .prepare("SELECT overview_json FROM legal_item_overviews ORDER BY title ASC")
    .all();

  return rows(result).map((row) => JSON.parse(row.overview_json));
}

async function searchOverviews(db, query) {
  const like = `%${query.toLowerCase()}%`;
  const result = await db
    .prepare(
      [
        "SELECT overview_json FROM legal_item_overviews",
        "WHERE lower(title) LIKE ?",
        "OR lower(summary_plain_language) LIKE ?",
        "OR lower(type) LIKE ?",
        "OR lower(status) LIKE ?",
        "ORDER BY title ASC"
      ].join(" ")
    )
    .bind(like, like, like, like)
    .all();

  return rows(result).map((row) => JSON.parse(row.overview_json));
}

async function getOverview(db, id) {
  const row = await db
    .prepare("SELECT overview_json FROM legal_item_overviews WHERE id = ?")
    .bind(id)
    .first();

  return row ? JSON.parse(row.overview_json) : undefined;
}

function rows(result) {
  return result?.results ?? [];
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type, x-processor-id",
      "content-type": "application/json; charset=utf-8"
    }
  });
}
