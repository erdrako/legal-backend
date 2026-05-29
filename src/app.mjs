export function createApp(approvedBundle) {
  validateApprovedBundle(approvedBundle);

  const overviewById = new Map(
    approvedBundle.readModels.legalItemOverviews.map((overview) => [overview.id, overview])
  );

  return {
    handle(request) {
      const url = new URL(request.url, "http://localhost");

      if (request.method !== "GET") {
        return json(405, { error: "METHOD_NOT_ALLOWED" });
      }

      if (url.pathname === "/legal-items") {
        return json(200, {
          dataset: datasetStatusFor(approvedBundle),
          items: [...overviewById.values()]
        });
      }

      if (url.pathname === "/dataset/status") {
        return json(200, datasetStatusFor(approvedBundle));
      }

      if (url.pathname === "/search") {
        const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();

        if (!query) {
          return json(422, { error: "MISSING_QUERY" });
        }

        const items = [...overviewById.values()].filter((item) =>
          [item.title, item.summaryPlainLanguage, item.status, item.type]
            .join(" ")
            .toLowerCase()
            .includes(query)
        );

        return json(200, { items });
      }

      const overviewMatch = url.pathname.match(/^\/legal-items\/([^/]+)\/overview$/);
      if (overviewMatch) {
        const id = decodeURIComponent(overviewMatch[1]);
        const overview = overviewById.get(id);

        if (!overview) {
          return json(404, { error: "LEGAL_ITEM_NOT_FOUND" });
        }

        return json(200, overview);
      }

      const freshnessMatch = url.pathname.match(/^\/legal-items\/([^/]+)\/freshness$/);
      if (freshnessMatch) {
        const id = decodeURIComponent(freshnessMatch[1]);
        const overview = overviewById.get(id);

        if (!overview) {
          return json(404, { error: "LEGAL_ITEM_NOT_FOUND" });
        }

        return json(200, overview.freshness);
      }

      return json(404, { error: "NOT_FOUND" });
    }
  };
}

function datasetStatusFor(approvedBundle) {
  const dataset = approvedBundle.dataset ?? {
    mode: "HUMAN_REVIEWED",
    generatedAt: approvedBundle.approvedAt,
    disposable: false
  };

  return {
    ...dataset,
    approvedAt: approvedBundle.approvedAt,
    approvedBy: approvedBundle.approvedBy,
    counts: {
      legalItems: approvedBundle.legalItems?.length ?? 0,
      provisions: approvedBundle.provisions?.length ?? 0,
      citations: approvedBundle.citations?.length ?? 0,
      relationships: approvedBundle.relationships?.length ?? 0,
      rules: approvedBundle.rules?.length ?? 0,
      concepts: approvedBundle.concepts?.length ?? 0,
      snapshots: approvedBundle.snapshots?.length ?? 0
    },
    validationSummary: approvedBundle.validationSummary
  };
}

function validateApprovedBundle(bundle) {
  assertObject(bundle, "approvedBundle");
  assertObject(bundle.readModels, "approvedBundle.readModels");
  assert(Array.isArray(bundle.readModels.legalItemOverviews), "readModels.legalItemOverviews must be an array");
}

function json(status, body) {
  return {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "content-type": "application/json; charset=utf-8"
    },
    body
  };
}

function assertObject(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
