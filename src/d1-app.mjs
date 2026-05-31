export function createD1App(env) {
  if (!env?.DB) {
    return {
      async handle() {
        return json(503, {
          error: "D1_BINDING_MISSING",
          message: "Cloudflare D1 binding DB is required."
        });
      }
    };
  }

  return {
    async handle(request) {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return json(204, {});
      }

      if (request.method !== "GET") {
        return json(405, { error: "METHOD_NOT_ALLOWED" });
      }

      if (url.pathname === "/dataset/status") {
        return json(200, await datasetStatus(env.DB));
      }

      if (url.pathname === "/legal-items") {
        const [dataset, items] = await Promise.all([
          datasetStatus(env.DB),
          listOverviews(env.DB)
        ]);

        return json(200, { dataset, items });
      }

      if (url.pathname === "/search") {
        const query = (url.searchParams.get("q") ?? "").trim();

        if (!query) {
          return json(422, { error: "MISSING_QUERY" });
        }

        return json(200, {
          items: await searchOverviews(env.DB, query)
        });
      }

      const overviewMatch = url.pathname.match(/^\/legal-items\/([^/]+)\/overview$/);
      if (overviewMatch) {
        const overview = await getOverview(env.DB, decodeURIComponent(overviewMatch[1]));

        if (!overview) {
          return json(404, { error: "LEGAL_ITEM_NOT_FOUND" });
        }

        return json(200, overview);
      }

      const freshnessMatch = url.pathname.match(/^\/legal-items\/([^/]+)\/freshness$/);
      if (freshnessMatch) {
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
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
      "content-type": "application/json; charset=utf-8"
    }
  });
}

