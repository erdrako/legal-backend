const PROCESSING_ROUTES = [
  "/processors/status",
  "/processors/enroll",
  "/processors/heartbeat",
  "/processors/jobs/claim",
  "/processing-queue",
  "/processing-review",
  "/processing-review/affected-items/resolve-current-sources",
  "/processing-review/diffs/resolve",
  "/detected-projects",
  "/processing-queue/jobs",
  "/processing-queue/senate-diff-jobs"
];

const JOB_ACTION_PATTERN = /^\/processors\/jobs\/([^/]+)\/(progress|result|fail|release)$/;
const ADMIN_JOB_ACTION_PATTERN = /^\/processing-queue\/jobs\/([^/]+)\/(retry)$/;
const CLAIMABLE_STATUSES = new Set(["PENDING", "LEASED", "PROCESSING"]);
const TERMINAL_RESULT_STATUSES = new Set(["COMPLETED", "NEEDS_REVIEW", "NOT_COMPARABLE"]);
const DEFAULT_REQUIRED_CAPABILITIES = [
  "PDF_TEXT",
  "LEGAL_REFERENCES",
  "AFFECTED_LEGAL_ITEMS",
  "LEGAL_DIFF_CANDIDATES"
];
const FALLBACK_DIFF_REQUIRED_CAPABILITIES = ["LEGAL_DIFF_FALLBACK"];
const DIFF_RESOLVER_VERSION = "deterministic-diff-resolver@1";

export function isProcessingRoute(pathname) {
  return PROCESSING_ROUTES.includes(pathname) || JOB_ACTION_PATTERN.test(pathname) || ADMIN_JOB_ACTION_PATTERN.test(pathname);
}

export async function handleProcessingRoute(request, env, json) {
  const url = new URL(request.url);
  const db = processingDb(env);

  if (!db) {
    return json(503, {
      error: "PROCESSING_DB_BINDING_MISSING",
      message: "A D1 binding named PROCESSING_DB or DB is required for remote processor coordination."
    });
  }

  if (request.method === "GET" && url.pathname === "/processors/status") {
    return json(200, {
      generatedAt: nowIso(),
      processors: await listProcessors(db)
    });
  }

  if (request.method === "GET" && url.pathname === "/processing-queue") {
    return json(200, await queueStatus(db, Number(url.searchParams.get("limit") ?? 25)));
  }

  if (request.method === "GET" && url.pathname === "/detected-projects") {
    return json(200, await detectedProjects(db, Number(url.searchParams.get("limit") ?? 50)));
  }

  if (request.method === "GET" && url.pathname === "/processing-review") {
    return json(200, await processingReview(db, Number(url.searchParams.get("limit") ?? 50)));
  }

  if (request.method === "POST" && url.pathname === "/processors/enroll") {
    return enrollProcessor(request, env, db, json);
  }

  if (request.method === "POST" && url.pathname === "/processors/heartbeat") {
    const auth = await authenticateProcessor(request, db);
    if (auth.error) {
      return json(auth.status, auth.error);
    }

    return heartbeatProcessor(request, db, auth.processor, json);
  }

  if (request.method === "POST" && url.pathname === "/processors/jobs/claim") {
    const auth = await authenticateProcessor(request, db);
    if (auth.error) {
      return json(auth.status, auth.error);
    }

    return claimJob(request, db, auth.processor, json);
  }

  const jobActionMatch = url.pathname.match(JOB_ACTION_PATTERN);
  if (request.method === "POST" && jobActionMatch) {
    const auth = await authenticateProcessor(request, db);
    if (auth.error) {
      return json(auth.status, auth.error);
    }

    return handleJobAction(request, db, auth.processor, jobActionMatch[1], jobActionMatch[2], json);
  }

  if (request.method === "POST" && url.pathname === "/processing-queue/jobs") {
    const admin = await authenticateAdmin(request, env);
    if (admin.error) {
      return json(admin.status, admin.error);
    }

    return createProcessingJob(request, db, json);
  }

  if (request.method === "POST" && url.pathname === "/processing-queue/senate-diff-jobs") {
    const admin = await authenticateAdmin(request, env);
    if (admin.error) {
      return json(admin.status, admin.error);
    }

    return enqueueSenateDiffJobs(request, db, json);
  }

  if (request.method === "POST" && url.pathname === "/processing-review/affected-items/resolve-current-sources") {
    const admin = await authenticateAdmin(request, env);
    if (admin.error) {
      return json(admin.status, admin.error);
    }

    return resolveAffectedCurrentSources(request, db, json);
  }

  if (request.method === "POST" && url.pathname === "/processing-review/diffs/resolve") {
    const admin = await authenticateAdmin(request, env);
    if (admin.error) {
      return json(admin.status, admin.error);
    }

    return resolveDiffCandidates(request, db, json);
  }

  const adminJobActionMatch = url.pathname.match(ADMIN_JOB_ACTION_PATTERN);
  if (request.method === "POST" && adminJobActionMatch) {
    const admin = await authenticateAdmin(request, env);
    if (admin.error) {
      return json(admin.status, admin.error);
    }

    return retryProcessingJob(db, adminJobActionMatch[1], json);
  }

  return json(405, { error: "METHOD_NOT_ALLOWED" });
}

function processingDb(env) {
  return env?.PROCESSING_DB ?? env?.DB;
}

async function enrollProcessor(request, env, db, json) {
  const expectedToken = env?.PROCESSOR_ENROLLMENT_TOKEN ?? env?.PROCESSOR_ADMIN_TOKEN;
  if (!expectedToken) {
    return json(503, {
      error: "PROCESSOR_ENROLLMENT_NOT_CONFIGURED",
      message: "Set PROCESSOR_ENROLLMENT_TOKEN or PROCESSOR_ADMIN_TOKEN before enrolling processors."
    });
  }

  if (bearerToken(request) !== expectedToken) {
    return json(401, { error: "UNAUTHORIZED" });
  }

  const body = await readJson(request);
  const displayName = stringValue(body.displayName, "Procesador LexMapa");
  const capabilities = stringArray(body.capabilities);
  const processorId = `processor-${crypto.randomUUID()}`;
  const processorSecret = randomSecret();
  const timestamp = nowIso();

  await db
    .prepare(
      [
        "INSERT INTO processor_nodes",
        "(id, display_name, status, secret_hash, tier, capabilities_json, current_job_id, model_name, processor_version, last_seen_at, created_at, updated_at)",
        "VALUES (?, ?, 'ONLINE', ?, ?, ?, NULL, ?, ?, ?, ?, ?)"
      ].join(" ")
    )
    .bind(
      processorId,
      displayName,
      await sha256Hex(processorSecret),
      numberOrNull(body.tier),
      JSON.stringify(capabilities),
      nullableString(body.modelName),
      nullableString(body.processorVersion),
      timestamp,
      timestamp,
      timestamp
    )
    .run();

  const processor = await getProcessor(db, processorId);

  return json(201, {
    processor: toProcessorDto(processor),
    processorSecret
  });
}

async function heartbeatProcessor(request, db, processor, json) {
  const body = await readJson(request);
  const timestamp = nowIso();
  const capabilities = body.capabilities ? stringArray(body.capabilities) : parseArray(processor.capabilities_json);
  const status = ["ONLINE", "DRAINING", "DISABLED"].includes(body.status) ? body.status : "ONLINE";

  await db
    .prepare(
      [
        "UPDATE processor_nodes",
        "SET status = ?, current_job_id = ?, tier = ?, capabilities_json = ?, model_name = ?, processor_version = ?, last_seen_at = ?, updated_at = ?",
        "WHERE id = ?"
      ].join(" ")
    )
    .bind(
      status,
      nullableString(body.currentJobId),
      numberOrNull(body.tier ?? processor.tier),
      JSON.stringify(capabilities),
      nullableString(body.modelName ?? processor.model_name),
      nullableString(body.processorVersion ?? processor.processor_version),
      timestamp,
      timestamp,
      processor.id
    )
    .run();

  return json(200, {
    processor: toProcessorDto(await getProcessor(db, processor.id))
  });
}

async function claimJob(request, db, processor, json) {
  const body = await readJson(request);
  const leaseSeconds = clamp(Number(body.maxLeaseSeconds ?? 900), 60, 3600);
  const timestamp = nowIso();
  const leaseUntil = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  const processorCapabilities = new Set([
    ...parseArray(processor.capabilities_json),
    ...stringArray(body.capabilities)
  ]);

  const candidateRows = await db
    .prepare(
      [
        "SELECT * FROM processing_jobs",
        "WHERE status = 'PENDING'",
        "OR (status IN ('LEASED', 'PROCESSING') AND lease_until IS NOT NULL AND lease_until < ?)",
        "ORDER BY priority DESC, created_at ASC",
        "LIMIT 25"
      ].join(" ")
    )
    .bind(timestamp)
    .all();
  const candidate = rows(candidateRows).find((job) => jobCapabilitiesSatisfied(job, processorCapabilities));

  if (!candidate) {
    await touchProcessorIdle(db, processor.id, timestamp);
    return json(200, {});
  }

  await db
    .prepare(
      [
        "UPDATE processing_jobs",
        "SET status = 'LEASED', lease_owner_id = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?",
        "WHERE id = ? AND (status = 'PENDING' OR (status IN ('LEASED', 'PROCESSING') AND lease_until IS NOT NULL AND lease_until < ?))"
      ].join(" ")
    )
    .bind(processor.id, leaseUntil, timestamp, candidate.id, timestamp)
    .run();

  await db
    .prepare("UPDATE processor_nodes SET current_job_id = ?, status = 'ONLINE', last_seen_at = ?, updated_at = ? WHERE id = ?")
    .bind(candidate.id, timestamp, timestamp, processor.id)
    .run();

  await insertAttempt(db, {
    jobId: candidate.id,
    processorId: processor.id,
    status: "LEASED",
    message: "Job claimed by remote processor.",
    metadata: { leaseUntil }
  });

  const job = await getJob(db, candidate.id);

  return json(200, {
    job: {
      ...toJobDto(job),
      input: parseObject(job.input_json)
    }
  });
}

async function handleJobAction(request, db, processor, jobId, action, json) {
  const job = await getJob(db, jobId);
  if (!job) {
    return json(404, { error: "PROCESSING_JOB_NOT_FOUND" });
  }

  if (job.lease_owner_id && job.lease_owner_id !== processor.id) {
    return json(409, { error: "JOB_LEASED_BY_ANOTHER_PROCESSOR" });
  }

  if (action === "progress") {
    const body = await readJson(request);
    const timestamp = nowIso();
    await db
      .prepare("UPDATE processing_jobs SET status = 'PROCESSING', progress_json = ?, updated_at = ? WHERE id = ?")
      .bind(JSON.stringify(body.progress ?? body), timestamp, jobId)
      .run();
    await db
      .prepare("UPDATE processor_nodes SET current_job_id = ?, last_seen_at = ?, updated_at = ? WHERE id = ?")
      .bind(jobId, timestamp, timestamp, processor.id)
      .run();
    await insertAttempt(db, {
      jobId,
      processorId: processor.id,
      status: "PROCESSING",
      message: stringValue(body.message, "Processor reported progress."),
      metadata: body.progress ?? body
    });
    return json(200, { job: toJobDto(await getJob(db, jobId)) });
  }

  if (action === "result") {
    const body = await readJson(request);
    if (!TERMINAL_RESULT_STATUSES.has(body.status)) {
      return json(422, { error: "INVALID_RESULT_STATUS" });
    }

    const timestamp = nowIso();
    const result = {
      result: body.result ?? {},
      warnings: body.warnings ?? [],
      confidence: body.confidence ?? {}
    };

    await db
      .prepare(
        [
          "UPDATE processing_jobs",
          "SET status = ?, result_json = ?, lease_owner_id = NULL, lease_until = NULL, updated_at = ?, completed_at = ?",
          "WHERE id = ?"
        ].join(" ")
      )
      .bind(body.status, JSON.stringify(result), timestamp, timestamp, jobId)
      .run();

    await db
      .prepare("UPDATE processor_nodes SET current_job_id = NULL, last_seen_at = ?, updated_at = ? WHERE id = ?")
      .bind(timestamp, timestamp, processor.id)
      .run();

    await insertArtifacts(db, jobId, processor.id, body.artifacts ?? []);
    await persistStructuredResult(db, jobId, body.result ?? {}, job);
    await insertAttempt(db, {
      jobId,
      processorId: processor.id,
      status: body.status,
      message: "Processor submitted job result.",
      metadata: { warnings: body.warnings ?? [], confidence: body.confidence ?? {} }
    });

    return json(200, { job: toJobDto(await getJob(db, jobId)) });
  }

  if (action === "fail") {
    const body = await readJson(request);
    const timestamp = nowIso();
    await db
      .prepare(
        [
          "UPDATE processing_jobs",
          "SET status = 'FAILED', error_json = ?, lease_owner_id = NULL, lease_until = NULL, updated_at = ?, failed_at = ?",
          "WHERE id = ?"
        ].join(" ")
      )
      .bind(JSON.stringify(body.error ?? body), timestamp, timestamp, jobId)
      .run();
    await db
      .prepare("UPDATE processor_nodes SET current_job_id = NULL, last_seen_at = ?, updated_at = ? WHERE id = ?")
      .bind(timestamp, timestamp, processor.id)
      .run();
    await insertAttempt(db, {
      jobId,
      processorId: processor.id,
      status: "FAILED",
      message: stringValue(body.message, "Processor failed job."),
      metadata: body.error ?? body
    });
    return json(200, { job: toJobDto(await getJob(db, jobId)) });
  }

  if (action === "release") {
    const timestamp = nowIso();
    await db
      .prepare(
        [
          "UPDATE processing_jobs",
          "SET status = 'PENDING', lease_owner_id = NULL, lease_until = NULL, updated_at = ?",
          "WHERE id = ?"
        ].join(" ")
      )
      .bind(timestamp, jobId)
      .run();
    await db
      .prepare("UPDATE processor_nodes SET current_job_id = NULL, last_seen_at = ?, updated_at = ? WHERE id = ?")
      .bind(timestamp, timestamp, processor.id)
      .run();
    await insertAttempt(db, {
      jobId,
      processorId: processor.id,
      status: "PENDING",
      message: "Processor released job lease.",
      metadata: {}
    });
    return json(200, { job: toJobDto(await getJob(db, jobId)) });
  }

  return json(404, { error: "NOT_FOUND" });
}

async function createProcessingJob(request, db, json) {
  const body = await readJson(request);
  const job = await insertProcessingJob(db, {
    jobType: stringValue(body.jobType, "GENERATE_DIFF_CANDIDATES"),
    priority: Number(body.priority ?? 0),
    input: body.input ?? {},
    requiredCapabilities: body.requiredCapabilities ?? DEFAULT_REQUIRED_CAPABILITIES,
    sourceLabel: nullableString(body.sourceLabel),
    sourceUrl: nullableString(body.sourceUrl),
    dedupeKey: nullableString(body.dedupeKey)
  });

  return json(201, { job: toJobDto(job) });
}

async function enqueueSenateDiffJobs(request, db, json) {
  const body = await readJson(request);
  const limit = clamp(Number(body.limit ?? 25), 1, 100);
  const result = await db
    .prepare(
      [
        "SELECT",
        "ai.id AS agenda_item_id, ai.expedient_number, ai.title, ai.official_description, ai.status AS agenda_status, ai.scheduled_at, ai.committees,",
        "ds.source_role, ds.source_url, ds.source_label, ds.institution, ds.status AS source_status, ds.notes",
        "FROM agenda_items ai",
        "LEFT JOIN document_sources ds ON ds.agenda_item_id = ai.id",
        "WHERE ai.status IN ('needs_review', 'ready_for_validation')",
        "ORDER BY ai.created_at ASC",
        "LIMIT ?"
      ].join(" ")
    )
    .bind(limit * 8)
    .all();

  const grouped = new Map();
  for (const row of rows(result)) {
    if (!grouped.has(row.agenda_item_id)) {
      grouped.set(row.agenda_item_id, {
        agendaItem: {
          id: row.agenda_item_id,
          expedientNumber: row.expedient_number,
          title: row.title,
          officialDescription: row.official_description,
          status: row.agenda_status,
          scheduledAt: row.scheduled_at,
          committees: parseArray(row.committees)
        },
        documentSources: []
      });
    }

    if (row.source_role) {
      grouped.get(row.agenda_item_id).documentSources.push({
        role: row.source_role,
        url: row.source_url,
        label: row.source_label,
        institution: row.institution,
        status: row.source_status,
        notes: row.notes
      });
    }
  }

  let created = 0;
  let skipped = 0;
  let pendingSource = 0;
  const jobs = [];

  for (const item of [...grouped.values()].slice(0, limit)) {
    const dedupeKey = `senate-diff:${item.agendaItem.id}`;
    const existing = await db.prepare("SELECT * FROM processing_jobs WHERE dedupe_key = ?").bind(dedupeKey).first();
    if (existing) {
      skipped += 1;
      continue;
    }

    const proposedSourceUrl = item.documentSources.find(
      (source) => source.role === "PROPOSED_TEXT" && isHttpUrl(source.url)
    )?.url;

    if (!proposedSourceUrl) {
      pendingSource += 1;
      continue;
    }

    const job = await insertProcessingJob(db, {
      jobType: "GENERATE_DIFF_CANDIDATES",
      priority: Number(body.priority ?? 50),
      input: item,
      requiredCapabilities: body.requiredCapabilities ?? DEFAULT_REQUIRED_CAPABILITIES,
      sourceLabel: item.agendaItem.title ?? item.agendaItem.expedientNumber,
      sourceUrl: proposedSourceUrl,
      dedupeKey
    });
    created += 1;
    jobs.push(toJobDto(job));
  }

  return json(201, { created, skipped, pendingSource, jobs });
}

async function insertProcessingJob(db, { jobType, priority, input, requiredCapabilities, sourceLabel, sourceUrl, dedupeKey }) {
  const timestamp = nowIso();
  const id = `job-${crypto.randomUUID()}`;

  await db
    .prepare(
      [
        "INSERT OR IGNORE INTO processing_jobs",
        "(id, job_type, status, priority, input_json, required_capabilities_json, source_label, source_url, dedupe_key, created_at, updated_at)",
        "VALUES (?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?)"
      ].join(" ")
    )
    .bind(
      id,
      jobType,
      priority,
      JSON.stringify(input ?? {}),
      JSON.stringify(stringArray(requiredCapabilities)),
      sourceLabel,
      sourceUrl,
      dedupeKey,
      timestamp,
      timestamp
    )
    .run();

  return dedupeKey
    ? await db.prepare("SELECT * FROM processing_jobs WHERE dedupe_key = ?").bind(dedupeKey).first()
    : await getJob(db, id);
}

async function authenticateAdmin(request, env) {
  const expectedToken = env?.PROCESSOR_ADMIN_TOKEN ?? env?.PROCESSOR_ENROLLMENT_TOKEN;
  if (!expectedToken) {
    return {
      status: 503,
      error: {
        error: "PROCESSOR_ADMIN_TOKEN_NOT_CONFIGURED",
        message: "Set PROCESSOR_ADMIN_TOKEN or PROCESSOR_ENROLLMENT_TOKEN before creating processing jobs."
      }
    };
  }

  if (bearerToken(request) !== expectedToken) {
    return { status: 401, error: { error: "UNAUTHORIZED" } };
  }

  return { ok: true };
}

async function authenticateProcessor(request, db) {
  const processorId = request.headers.get("x-processor-id") ?? "";
  const token = bearerToken(request);

  if (!processorId || !token) {
    return { status: 401, error: { error: "PROCESSOR_AUTH_REQUIRED" } };
  }

  const processor = await getProcessor(db, processorId);
  if (!processor) {
    return { status: 401, error: { error: "PROCESSOR_NOT_FOUND" } };
  }

  if (processor.status === "DISABLED") {
    return { status: 403, error: { error: "PROCESSOR_DISABLED" } };
  }

  const tokenHash = await sha256Hex(token);
  if (tokenHash !== processor.secret_hash) {
    return { status: 401, error: { error: "INVALID_PROCESSOR_SECRET" } };
  }

  return { processor };
}

async function getProcessor(db, id) {
  return db.prepare("SELECT * FROM processor_nodes WHERE id = ?").bind(id).first();
}

async function getJob(db, id) {
  return db.prepare("SELECT * FROM processing_jobs WHERE id = ?").bind(id).first();
}

async function listProcessors(db) {
  const result = await db
    .prepare(
      [
        "SELECT * FROM processor_nodes",
        "ORDER BY",
        "CASE status WHEN 'ONLINE' THEN 0 WHEN 'DRAINING' THEN 1 WHEN 'OFFLINE' THEN 2 ELSE 3 END,",
        "last_seen_at DESC"
      ].join(" ")
    )
    .all();

  return rows(result).map(toProcessorDto);
}

async function queueStatus(db, limit) {
  const [processors, countRows, jobRows] = await Promise.all([
    listProcessors(db),
    db.prepare("SELECT status, COUNT(*) AS count FROM processing_jobs GROUP BY status").all(),
    db
      .prepare("SELECT * FROM processing_jobs ORDER BY priority DESC, created_at ASC LIMIT ?")
      .bind(clamp(limit, 1, 100))
      .all()
  ]);

  return {
    generatedAt: nowIso(),
    processors,
    counts: statusCounts(rows(countRows)),
    jobs: rows(jobRows).map(toJobDto)
  };
}

async function detectedProjects(db, limit, options = {}) {
  const includeRejected = options.includeRejected === true;
  const result = await db
    .prepare(
      [
        "SELECT",
        "ai.id AS agenda_item_id, ai.chamber, ai.scheduled_at, ai.committees, ai.expedient_number, ai.expedient_origin, ai.expedient_type,",
        "ai.title, ai.official_description, ai.status AS agenda_status, ai.created_at, ai.updated_at,",
        "ds.id AS document_source_id, ds.source_role, ds.source_url, ds.source_label, ds.institution, ds.status AS source_status, ds.last_checked_at, ds.notes,",
        "pj.id AS processing_job_id, pj.status AS processing_status, pj.job_type, pj.attempts, pj.updated_at AS job_updated_at",
        "FROM agenda_items ai",
        "LEFT JOIN document_sources ds ON ds.agenda_item_id = ai.id",
        "LEFT JOIN processing_jobs pj ON pj.dedupe_key = ('senate-diff:' || ai.id)",
        includeRejected ? "" : "WHERE ai.status != 'rejected'",
        "ORDER BY ai.created_at DESC, ai.updated_at DESC",
        "LIMIT ?"
      ].join(" ")
    )
    .bind(clamp(limit, 1, 100) * 12)
    .all();

  const grouped = new Map();
  for (const row of rows(result)) {
    if (!grouped.has(row.agenda_item_id)) {
      grouped.set(row.agenda_item_id, {
        id: row.agenda_item_id,
        chamber: row.chamber,
        scheduledAt: row.scheduled_at,
        committees: parseArray(row.committees),
        expedientNumber: row.expedient_number,
        expedientOrigin: row.expedient_origin,
        expedientType: row.expedient_type,
        canonicalExpedient: canonicalExpedient(row.expedient_number),
        title: row.title,
        officialDescription: row.official_description,
        status: row.agenda_status,
        duplicateWarning: duplicateExpedientWarning(row.expedient_number),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        processingJob: row.processing_job_id
          ? {
              id: row.processing_job_id,
              status: row.processing_status,
              jobType: row.job_type,
              attempts: Number(row.attempts ?? 0),
              updatedAt: row.job_updated_at
            }
          : null,
        sourceStatuses: {},
        sources: []
      });
    }

    if (row.document_source_id) {
      const project = grouped.get(row.agenda_item_id);
      project.sources.push({
        id: row.document_source_id,
        role: row.source_role,
        url: row.source_url,
        label: row.source_label,
        institution: row.institution,
        status: row.source_status,
        lastCheckedAt: row.last_checked_at,
        notes: row.notes
      });
      project.sourceStatuses[row.source_role] = row.source_status;
    }
  }

  const projects = [...grouped.values()].slice(0, clamp(limit, 1, 100));
  return {
    generatedAt: nowIso(),
    counts: detectedProjectCounts(projects),
    projects
  };
}

export async function listStagingChangeProposalOverviews(db, limit = 50) {
  const payload = await detectedProjects(db, limit);
  const diffCounts = await resolvedDiffCountsByProposal(db);
  return payload.projects.map((project) => toStagingProposalOverview(project, diffCounts.get(project.id)));
}

export async function getStagingChangeProposal(db, id) {
  const payload = await detectedProjects(db, 100);
  const project = payload.projects.find((item) => item.id === id);
  if (!project) {
    return null;
  }

  const diffs = await getStagingProposalDiffs(db, id);
  return toStagingProposal(project, diffs);
}

export async function getStagingProposalDiffs(db, proposalId) {
  const result = await db
    .prepare(
      [
        "SELECT * FROM resolved_legal_diffs",
        "WHERE proposal_id = ?",
        "ORDER BY CASE public_status WHEN 'DIFF_VALIDATED' THEN 0 WHEN 'DIFF_PARTIAL' THEN 1 WHEN 'DIFF_AI_ASSISTED' THEN 2 ELSE 3 END, updated_at ASC"
      ].join(" ")
    )
    .bind(proposalId)
    .all();
  return rows(result).map(toPublicLegalDiff);
}

export async function searchStagingChangeProposalOverviews(db, query, limit = 50) {
  const terms = queryTerms(query);
  const proposals = await listStagingChangeProposalOverviews(db, limit);
  return proposals
    .map((proposal) => {
      const haystack = normalizeSearchText(
        [
          proposal.title,
          proposal.statusLabelForUsers,
          proposal.summaryPlainLanguage,
          proposal.chamber,
          ...(proposal.committees ?? []),
          ...(proposal.affectedTopics ?? []),
          ...(proposal.affectedGroups ?? [])
        ].join(" ")
      );
      const score = terms.filter((term) => haystack.includes(term)).length;
      return score > 0
        ? {
            ...proposal,
            matchedDiffIds: [],
            matchedTopicIds: [],
            matchedGroupIds: [],
            matchSummary: proposalStatusSummary(proposal),
            score
          }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)
    .map(({ score, ...proposal }) => proposal);
}

async function processingReview(db, limit) {
  const [queue, projects, candidateRows, resolvedRows, affectedRows] = await Promise.all([
    queueStatus(db, Math.min(limit, 50)),
    detectedProjects(db, Math.min(limit, 50), { includeRejected: true }),
    db
      .prepare(
        [
          "SELECT",
          "gdc.id, gdc.job_id, gdc.title, gdc.change_type, gdc.confidence, gdc.review_status, gdc.validation_warnings_json, gdc.updated_at,",
          "pj.source_label, pj.status AS job_status",
          "FROM generated_diff_candidates gdc",
          "LEFT JOIN processing_jobs pj ON pj.id = gdc.job_id",
          "ORDER BY gdc.updated_at DESC",
          "LIMIT ?"
        ].join(" ")
      )
      .bind(clamp(limit, 1, 100))
      .all(),
    db
      .prepare(
        [
          "SELECT rld.*, pj.source_label",
          "FROM resolved_legal_diffs rld",
          "LEFT JOIN processing_jobs pj ON pj.id = rld.job_id",
          "ORDER BY rld.updated_at DESC",
          "LIMIT ?"
        ].join(" ")
      )
      .bind(clamp(limit, 1, 100))
      .all(),
    db
      .prepare(
        [
          "SELECT id, job_id, proposal_id, legal_item_id, title, reference_text, canonical_reference_text, operation_type,",
          "current_source_json, source_status, detection_evidence_json, review_reason, notes, source_resolved_at, updated_at",
          "FROM affected_legal_items",
          "WHERE (source_status IS NULL OR source_status != 'LOADED')",
          "AND (legal_item_type = 'LAW' OR title LIKE 'Ley %' OR reference_text LIKE '%Ley%')",
          "ORDER BY updated_at DESC",
          "LIMIT ?"
        ].join(" ")
      )
      .bind(clamp(limit, 1, 100))
      .all()
  ]);

  const candidates = rows(candidateRows).map((row) => ({
    id: row.id,
    jobId: row.job_id,
    sourceLabel: row.source_label,
    jobStatus: row.job_status,
    title: row.title,
    changeType: row.change_type,
    confidence: row.confidence,
    reviewStatus: row.review_status,
    validationWarnings: parseArray(row.validation_warnings_json),
    updatedAt: row.updated_at
  }));

  const affectedLegalItems = rows(affectedRows).map((row) => ({
    id: row.id,
    jobId: row.job_id,
    proposalId: row.proposal_id,
    legalItemId: row.legal_item_id,
    title: row.title,
    referenceText: row.reference_text,
    canonicalReferenceText: row.canonical_reference_text,
    operationType: row.operation_type,
    currentSource: parseObject(row.current_source_json),
    sourceStatus: row.source_status,
    detectionEvidence: parseObject(row.detection_evidence_json),
    reviewReason: row.review_reason,
    notes: row.notes,
    sourceResolvedAt: row.source_resolved_at,
    updatedAt: row.updated_at
  }));
  const resolvedDiffs = rows(resolvedRows).map(toResolvedDiffDto);

  return {
    generatedAt: nowIso(),
    queue,
    detectedProjects: projects,
    review: {
      pendingJobs: queue.jobs.filter((job) => ["PENDING", "LEASED", "PROCESSING"].includes(job.status)),
      failedJobs: queue.jobs.filter((job) => job.status === "FAILED"),
      needsReviewJobs: queue.jobs.filter((job) => job.status === "NEEDS_REVIEW"),
      notComparableJobs: queue.jobs.filter((job) => job.status === "NOT_COMPARABLE"),
      duplicateProjects: projects.projects.filter((project) => project.duplicateWarning),
      candidates,
      affectedLegalItems,
      resolvedDiffs
    }
  };
}

async function retryProcessingJob(db, jobId, json) {
  const existing = await getJob(db, jobId);
  if (!existing) {
    return json(404, { error: "PROCESSING_JOB_NOT_FOUND" });
  }

  await db.prepare("DELETE FROM resolved_legal_diffs WHERE job_id = ? OR fallback_job_id = ?").bind(jobId, jobId).run();
  await db
    .prepare(
      [
        "DELETE FROM generated_diff_candidates",
        "WHERE job_id = ?",
        "OR operation_id IN (SELECT id FROM change_operations WHERE job_id = ?)",
        "OR affected_legal_item_id IN (SELECT id FROM affected_legal_items WHERE job_id = ?)"
      ].join(" ")
    )
    .bind(jobId, jobId, jobId)
    .run();
  await db.prepare("DELETE FROM change_operations WHERE job_id = ?").bind(jobId).run();
  await db.prepare("DELETE FROM affected_legal_items WHERE job_id = ?").bind(jobId).run();
  await db.prepare("DELETE FROM extracted_provisions WHERE job_id = ?").bind(jobId).run();
  await db.prepare("DELETE FROM processing_artifacts WHERE job_id = ?").bind(jobId).run();

  const timestamp = nowIso();
  await db
    .prepare(
      [
        "UPDATE processing_jobs",
        "SET status = 'PENDING', result_json = NULL, error_json = NULL, progress_json = NULL,",
        "lease_owner_id = NULL, lease_until = NULL, completed_at = NULL, failed_at = NULL, updated_at = ?",
        "WHERE id = ?"
      ].join(" ")
    )
    .bind(timestamp, jobId)
    .run();

  await insertAttempt(db, {
    jobId,
    processorId: null,
    status: "PENDING",
    message: "Job reset by operator for retry.",
    metadata: { action: "retry" }
  });

  return json(200, { job: toJobDto(await getJob(db, jobId)) });
}

async function resolveAffectedCurrentSources(request, db, json) {
  const body = await readJson(request);
  const ids = stringArray(body.affectedLegalItemIds).slice(0, 8);
  const limit = clamp(Number(body.limit ?? 8), 1, 8);
  const items = await listAffectedItemsForCurrentSourceResolution(db, { ids, limit });
  const counters = {
    requested: ids.length || limit,
    selected: items.length,
    resolved: 0,
    pending: 0,
    needsReview: 0,
    failed: 0,
    errors: []
  };

  for (const item of items) {
    const lawNumber = lawNumberFromAffectedItem(item);
    if (!lawNumber) {
      counters.needsReview += 1;
      await markAffectedItemCurrentSource(db, item.id, {
        status: "NEEDS_REVIEW",
        reviewReason: "No se pudo extraer numero de ley desde la referencia detectada.",
        currentSource: {
          status: "NEEDS_REVIEW",
          resolver: "infoleg-current-law@1",
          retrievedAt: nowIso()
        }
      });
      continue;
    }

    try {
      const resolution = await resolveInfolegCurrentLaw(lawNumber);
      if (!resolution) {
        counters.pending += 1;
        await markAffectedItemCurrentSource(db, item.id, {
          status: "PENDING",
          reviewReason: `No se encontro fuente vigente oficial para Ley ${lawNumber}.`,
          currentSource: {
            status: "PENDING",
            lawNumber,
            resolver: "infoleg-current-law@1",
            retrievedAt: nowIso()
          }
        });
        continue;
      }

      await persistAffectedCurrentSource(db, item, resolution);
      counters.resolved += 1;
    } catch (error) {
      counters.failed += 1;
      counters.errors.push({ affectedLegalItemId: item.id, message: readableError(error) });
      await markAffectedItemCurrentSource(db, item.id, {
        status: "NEEDS_REVIEW",
        reviewReason: `Fallo la resolucion de fuente vigente: ${readableError(error)}`,
        currentSource: {
          status: "NEEDS_REVIEW",
          lawNumber,
          resolver: "infoleg-current-law@1",
          retrievedAt: nowIso()
        }
      });
    }
  }

  return json(200, {
    job: "resolve-affected-current-sources",
    generatedAt: nowIso(),
    status: counters.failed > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
    counters
  });
}

async function resolveDiffCandidates(request, db, json) {
  const body = await readJson(request);
  const ids = stringArray(body.candidateIds).slice(0, 25);
  const limit = clamp(Number(body.limit ?? 25), 1, 50);
  const enqueueFallback = body.enqueueFallback !== false;
  const candidates = await listDiffCandidatesForResolution(db, { ids, limit });
  const counters = {
    requested: ids.length || limit,
    selected: candidates.length,
    validated: 0,
    partial: 0,
    assisted: 0,
    unresolved: 0,
    fallbackQueued: 0,
    failed: 0,
    errors: []
  };
  const resolvedDiffs = [];

  for (const candidate of candidates) {
    try {
      const resolution = await resolveSingleDiffCandidate(db, candidate);
      const fallbackJob = enqueueFallback && resolution.publicStatus !== "DIFF_VALIDATED"
        ? await enqueueFallbackDiffJob(db, candidate, resolution)
        : null;
      const persisted = await persistResolvedDiff(db, {
        ...resolution,
        fallbackJobId: fallbackJob?.id ?? resolution.fallbackJobId
      });

      if (fallbackJob) {
        counters.fallbackQueued += 1;
      }
      if (persisted.publicStatus === "DIFF_VALIDATED") {
        counters.validated += 1;
      } else if (persisted.publicStatus === "DIFF_PARTIAL") {
        counters.partial += 1;
      } else if (persisted.publicStatus === "DIFF_AI_ASSISTED") {
        counters.assisted += 1;
      } else {
        counters.unresolved += 1;
      }
      resolvedDiffs.push(persisted);
    } catch (error) {
      counters.failed += 1;
      counters.errors.push({ candidateId: candidate.id, message: readableError(error) });
    }
  }

  return json(200, {
    job: "resolve-diff-candidates",
    generatedAt: nowIso(),
    status: counters.failed > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED",
    counters,
    resolvedDiffs
  });
}

async function listDiffCandidatesForResolution(db, { ids, limit }) {
  const selectSql = [
    "SELECT",
    "gdc.*,",
    "pj.source_label, pj.source_url AS job_source_url,",
    "co.operation_type, co.detected_verb, co.source_provision_id, co.target_provision_id, co.evidence_text, co.confidence AS operation_confidence,",
    "ali.title AS affected_title, ali.reference_text, ali.canonical_reference_text, ali.current_source_json, ali.source_status AS affected_source_status, ali.detection_evidence_json,",
    "ep.provision_label AS source_provision_label, ep.text_original AS source_provision_text, ep.source_url AS source_provision_url,",
    "rld.public_status AS existing_public_status, rld.remote_assisted AS existing_remote_assisted",
    "FROM generated_diff_candidates gdc",
    "LEFT JOIN processing_jobs pj ON pj.id = gdc.job_id",
    "LEFT JOIN change_operations co ON co.id = gdc.operation_id",
    "LEFT JOIN affected_legal_items ali ON ali.id = gdc.affected_legal_item_id",
    "LEFT JOIN extracted_provisions ep ON ep.id = co.source_provision_id",
    "LEFT JOIN resolved_legal_diffs rld ON rld.candidate_id = gdc.id"
  ].join(" ");

  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(", ");
    const result = await db
      .prepare(`${selectSql} WHERE gdc.id IN (${placeholders}) ORDER BY gdc.updated_at DESC LIMIT ?`)
      .bind(...ids, limit)
      .all();
    return rows(result);
  }

  const result = await db
    .prepare(
      [
        selectSql,
        "WHERE rld.candidate_id IS NULL OR rld.public_status != 'DIFF_VALIDATED'",
        "ORDER BY gdc.updated_at DESC",
        "LIMIT ?"
      ].join(" ")
    )
    .bind(limit)
    .all();
  return rows(result);
}

async function resolveSingleDiffCandidate(db, row, hints = {}) {
  const timestamp = nowIso();
  const candidateCurrent = parseObject(row.current_version_json);
  const candidateProposed = parseObject(row.proposed_version_json);
  const currentSource = parseObject(row.current_source_json);
  const detectionEvidence = parseObject(row.detection_evidence_json);
  const operationType = canonicalOperationType(hints.operationType ?? row.operation_type);
  const targetLabel = normalizeTargetLabel(
    hints.targetLabel ??
      row.target_provision_id ??
      extractTargetLabel([row.evidence_text, detectionEvidence.evidenceText, row.title].join(" "))
  );
  const proposedVersion = buildProposedVersion(row, candidateProposed, hints);
  const currentContext = await findCurrentTextContext(db, row, currentSource);
  const currentVersion = buildCurrentVersion(row, candidateCurrent, currentContext, operationType, targetLabel, hints);
  const warnings = unique([
    ...parseArray(row.validation_warnings_json),
    ...arrayValue(hints.validationWarnings),
    ...currentVersion.warnings,
    ...proposedVersion.warnings
  ]);
  const currentRequired = operationRequiresCurrentText(operationType);

  if (operationType === "NOT_COMPARABLE" || operationType === "APPROVAL_ONLY" || operationType === "APPROVE_TREATY" || operationType === "APPROVE_AGREEMENT") {
    warnings.push("NOT_COMPARABLE_OPERATION");
  }
  if (!targetLabel && operationTargetsProvision(operationType)) {
    warnings.push("TARGET_PROVISION_PENDING");
  }
  if (currentRequired && !currentVersion.value?.text) {
    warnings.push("CURRENT_VERSION_PENDING");
  }
  if (!proposedVersion.value?.text) {
    warnings.push("PROPOSED_VERSION_PENDING");
  }

  const hasCurrent = Boolean(currentVersion.value?.text);
  const hasProposed = Boolean(proposedVersion.value?.text);
  const cleanWarnings = normalizeResolutionWarnings(unique(warnings), {
    hasCurrent,
    hasProposed,
    hasCurrentSource: row.affected_source_status === "LOADED" || Boolean(currentContext?.text)
  });
  const remoteAssisted = Boolean(hints.remoteAssisted || row.existing_remote_assisted);
  const publicStatus = diffPublicStatus({
    operationType,
    warnings: cleanWarnings,
    currentRequired,
    remoteAssisted,
    hasCurrent,
    hasProposed
  });

  return {
    id: `resolved-diff-${await sha256Hex(row.id)}`,
    candidateId: row.id,
    jobId: row.job_id,
    proposalId: row.proposal_id,
    operationId: row.operation_id,
    affectedLegalItemId: row.affected_legal_item_id,
    fallbackJobId: hints.fallbackJobId ?? null,
    title: stringValue(hints.title ?? row.title, "Diff legal resuelto"),
    publicStatus,
    changeType: stringValue(hints.changeType ?? row.change_type, "MODIFIED"),
    operationType,
    targetLabel,
    currentVersion: currentVersion.value,
    proposedVersion: proposedVersion.value,
    explanationPlainLanguage: stringValue(
      hints.explanationPlainLanguage ?? row.explanation_plain_language,
      explanationForOperation(operationType, publicStatus)
    ),
    practicalImpact: stringValue(
      hints.practicalImpact ?? row.practical_impact,
      practicalImpactForStatus(publicStatus)
    ),
    confidence: confidenceForResolution(row, cleanWarnings, remoteAssisted),
    validationWarnings: cleanWarnings,
    sourceTrace: {
      resolver: DIFF_RESOLVER_VERSION,
      deterministicPass: hints.remoteAssisted ? "after_remote_fallback" : "initial",
      currentSource,
      currentTextSourceUrl: currentContext?.sourceUrl,
      proposedSourceUrl: proposedVersion.value?.originalSource?.sourceUrl,
      evidenceText: row.evidence_text ?? detectionEvidence.evidenceText,
      detectionEvidence
    },
    resolverVersion: DIFF_RESOLVER_VERSION,
    remoteAssisted,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function buildProposedVersion(row, candidateProposed, hints) {
  const text = stringValue(
    hints.proposedText ?? candidateProposed.text ?? row.source_provision_text,
    ""
  );
  const sourceUrl =
    hints.proposedSourceUrl ??
    candidateProposed.originalSource?.sourceUrl ??
    candidateProposed.source?.sourceUrl ??
    row.source_provision_url ??
    row.job_source_url;
  const warnings = [];
  if (!text) {
    warnings.push("PROPOSED_VERSION_PENDING");
  }
  if (!sourceUrl) {
    warnings.push("PROPOSED_SOURCE_PENDING");
  }

  return {
    warnings,
    value: {
      id: candidateProposed.id ?? `${row.id}-proposed`,
      label: candidateProposed.label ?? "Texto propuesto",
      legalItemId: candidateProposed.legalItemId,
      legalItemTitle: candidateProposed.legalItemTitle ?? row.source_label ?? "Proyecto Senado",
      provisionId: candidateProposed.provisionId ?? row.source_provision_id,
      provisionLabel: candidateProposed.provisionLabel ?? row.source_provision_label ?? "Provision propuesta",
      text,
      status: "PROPUESTO",
      source: candidateProposed.source ?? {
        id: "senado-proposed-text",
        name: "Senado de la Nacion Argentina",
        sourceUrl,
        official: true
      },
      sourceStatus: sourceUrl ? "LOADED" : "PENDING",
      originalSource: candidateProposed.originalSource ?? {
        status: sourceUrl ? "LOADED" : "PENDING",
        label: "Texto propuesto original",
        name: sourceUrl ? "Senado de la Nacion Argentina" : undefined,
        sourceUrl,
        official: Boolean(sourceUrl)
      }
    }
  };
}

function buildCurrentVersion(row, candidateCurrent, currentContext, operationType, targetLabel, hints) {
  const warnings = [];
  const currentSource = parseObject(row.current_source_json);
  const hintedText = stringValue(hints.currentText, "");
  let text = stringValue(candidateCurrent.text ?? hintedText, "");
  let provisionLabel = candidateCurrent.provisionLabel ?? targetLabel;
  let sourceUrl = candidateCurrent.originalSource?.sourceUrl ?? candidateCurrent.source?.sourceUrl ?? currentSource.sourceUrl;

  if (!text && currentContext?.text) {
    if (operationType === "REPEAL_LAW" || !targetLabel) {
      text = clipTextForDisplay(currentContext.text);
      provisionLabel = operationType === "REPEAL_LAW" ? "Ley completa vigente" : "Texto vigente sin articulo matcheado";
      if (currentContext.text.length > text.length) {
        warnings.push("CURRENT_TEXT_TRUNCATED_FOR_DISPLAY");
      }
      if (!targetLabel && operationTargetsProvision(operationType)) {
        warnings.push("TARGET_ARTICLE_NOT_FOUND");
      }
    } else {
      const article = findArticleInText(currentContext.text, targetLabel);
      if (article) {
        text = article.text;
        provisionLabel = article.label;
      } else {
        text = clipTextForDisplay(currentContext.text);
        provisionLabel = "Texto vigente completo (sin articulo matcheado)";
        warnings.push("TARGET_ARTICLE_NOT_FOUND");
        if (currentContext.text.length > text.length) {
          warnings.push("CURRENT_TEXT_TRUNCATED_FOR_DISPLAY");
        }
      }
    }
    sourceUrl = sourceUrl ?? currentContext.sourceUrl;
  }

  if (operationRequiresCurrentText(operationType) && !text) {
    warnings.push("CURRENT_VERSION_PENDING");
  }
  if (operationRequiresCurrentText(operationType) && row.affected_source_status !== "LOADED") {
    warnings.push("CURRENT_SOURCE_NOT_LOADED");
  }

  return {
    warnings,
    value: text
      ? {
          id: candidateCurrent.id ?? `${row.id}-current`,
          label: candidateCurrent.label ?? "Texto vigente",
          legalItemId: candidateCurrent.legalItemId ?? row.legal_item_id,
          legalItemTitle: candidateCurrent.legalItemTitle ?? row.affected_title ?? row.canonical_reference_text,
          provisionId: candidateCurrent.provisionId,
          provisionLabel,
          text,
          status: "VIGENTE",
          source: candidateCurrent.source ?? {
            id: "current-official-text",
            name: currentSource.institution ?? "Fuente oficial vigente",
            sourceUrl,
            official: true
          },
          sourceStatus: sourceUrl ? "LOADED" : "PENDING",
          originalSource: candidateCurrent.originalSource ?? {
            status: sourceUrl ? "LOADED" : "PENDING",
            label: "Texto vigente original",
            name: currentSource.institution ?? "Fuente oficial vigente",
            sourceUrl,
            official: Boolean(sourceUrl)
          }
        }
      : undefined
  };
}

async function findCurrentTextContext(db, row, currentSource) {
  const proposalId = row.proposal_id;
  if (!proposalId) {
    return null;
  }

  const result = await db
    .prepare(
      [
        "SELECT ds.source_url, ds.source_label, dt.normalized_text, dt.extracted_text, dt.content_hash",
        "FROM document_sources ds",
        "LEFT JOIN document_texts dt ON dt.document_source_id = ds.id",
        "WHERE (ds.proposal_id = ? OR ds.agenda_item_id = ?)",
        "AND ds.source_role = 'CURRENT_TEXT'",
        "AND ds.status = 'LOADED'",
        "ORDER BY CASE WHEN ds.source_url = ? THEN 0 ELSE 1 END, ds.updated_at DESC",
        "LIMIT 1"
      ].join(" ")
    )
    .bind(proposalId, proposalId, currentSource?.sourceUrl ?? "")
    .first();

  if (!result) {
    return null;
  }

  const text = stringValue(result.normalized_text ?? result.extracted_text, "");
  return text
    ? {
        text,
        sourceUrl: result.source_url,
        sourceLabel: result.source_label,
        contentHash: result.content_hash
      }
    : null;
}

async function persistResolvedDiff(db, resolution) {
  const timestamp = nowIso();
  await db
    .prepare(
      [
        "INSERT OR REPLACE INTO resolved_legal_diffs",
        "(id, candidate_id, job_id, proposal_id, operation_id, affected_legal_item_id, fallback_job_id, title, public_status, change_type, operation_type, target_label, current_version_json, proposed_version_json, explanation_plain_language, practical_impact, confidence, validation_warnings_json, source_trace_json, resolver_version, remote_assisted, created_at, updated_at)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM resolved_legal_diffs WHERE id = ?), ?), ?)"
      ].join(" ")
    )
    .bind(
      resolution.id,
      resolution.candidateId,
      nullableString(resolution.jobId),
      nullableString(resolution.proposalId),
      nullableString(resolution.operationId),
      nullableString(resolution.affectedLegalItemId),
      nullableString(resolution.fallbackJobId),
      stringValue(resolution.title, "Diff legal resuelto"),
      stringValue(resolution.publicStatus, "DIFF_UNRESOLVED"),
      stringValue(resolution.changeType, "MODIFIED"),
      nullableString(resolution.operationType),
      nullableString(resolution.targetLabel),
      resolution.currentVersion ? JSON.stringify(resolution.currentVersion) : null,
      resolution.proposedVersion ? JSON.stringify(resolution.proposedVersion) : null,
      nullableString(resolution.explanationPlainLanguage),
      nullableString(resolution.practicalImpact),
      stringValue(resolution.confidence, "LOW"),
      JSON.stringify(arrayValue(resolution.validationWarnings)),
      JSON.stringify(resolution.sourceTrace ?? {}),
      stringValue(resolution.resolverVersion, DIFF_RESOLVER_VERSION),
      resolution.remoteAssisted ? 1 : 0,
      resolution.id,
      timestamp,
      timestamp
    )
    .run();

  await db
    .prepare(
      [
        "UPDATE generated_diff_candidates",
        "SET review_status = ?, validation_warnings_json = ?, updated_at = ?",
        "WHERE id = ?"
      ].join(" ")
    )
    .bind(resolution.publicStatus, JSON.stringify(arrayValue(resolution.validationWarnings)), timestamp, resolution.candidateId)
    .run();

  return toResolvedDiffDto({
    id: resolution.id,
    candidate_id: resolution.candidateId,
    job_id: resolution.jobId,
    proposal_id: resolution.proposalId,
    operation_id: resolution.operationId,
    affected_legal_item_id: resolution.affectedLegalItemId,
    fallback_job_id: resolution.fallbackJobId,
    title: resolution.title,
    public_status: resolution.publicStatus,
    change_type: resolution.changeType,
    operation_type: resolution.operationType,
    target_label: resolution.targetLabel,
    current_version_json: resolution.currentVersion ? JSON.stringify(resolution.currentVersion) : null,
    proposed_version_json: resolution.proposedVersion ? JSON.stringify(resolution.proposedVersion) : null,
    explanation_plain_language: resolution.explanationPlainLanguage,
    practical_impact: resolution.practicalImpact,
    confidence: resolution.confidence,
    validation_warnings_json: JSON.stringify(arrayValue(resolution.validationWarnings)),
    source_trace_json: JSON.stringify(resolution.sourceTrace ?? {}),
    resolver_version: resolution.resolverVersion,
    remote_assisted: resolution.remoteAssisted ? 1 : 0,
    created_at: resolution.createdAt,
    updated_at: timestamp
  });
}

async function enqueueFallbackDiffJob(db, candidate, resolution) {
  const dedupeKey = `diff-fallback:${candidate.id}`;
  const existing = await db.prepare("SELECT * FROM processing_jobs WHERE dedupe_key = ?").bind(dedupeKey).first();
  if (existing) {
    return existing;
  }

  return insertProcessingJob(db, {
    jobType: "RESOLVE_DIFF_FALLBACK",
    priority: 30,
    input: {
      candidate: {
        id: candidate.id,
        title: candidate.title,
        changeType: candidate.change_type,
        operationType: candidate.operation_type,
        evidenceText: candidate.evidence_text,
        validationWarnings: parseArray(candidate.validation_warnings_json)
      },
      resolution,
      proposedVersion: resolution.proposedVersion,
      currentVersion: resolution.currentVersion,
      sourceTrace: resolution.sourceTrace
    },
    requiredCapabilities: FALLBACK_DIFF_REQUIRED_CAPABILITIES,
    sourceLabel: `Fallback diff: ${candidate.title}`,
    sourceUrl: candidate.job_source_url,
    dedupeKey
  });
}

async function persistFallbackDiffResult(db, job, result) {
  for (const hint of arrayValue(result.fallbackDiffResolutions)) {
    const candidateId = stringValue(hint.candidateId, "");
    if (!candidateId) {
      continue;
    }
    const rowsToResolve = await listDiffCandidatesForResolution(db, { ids: [candidateId], limit: 1 });
    const candidate = rowsToResolve[0];
    if (!candidate) {
      continue;
    }
    const resolution = await resolveSingleDiffCandidate(db, candidate, {
      ...hint,
      fallbackJobId: job.id,
      remoteAssisted: true
    });
    await persistResolvedDiff(db, resolution);
  }
}

async function listAffectedItemsForCurrentSourceResolution(db, { ids, limit }) {
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(", ");
    const result = await db
      .prepare(
        [
          "SELECT * FROM affected_legal_items",
          `WHERE id IN (${placeholders})`,
          "ORDER BY updated_at DESC",
          "LIMIT ?"
        ].join(" ")
      )
      .bind(...ids, limit)
      .all();
    return rows(result);
  }

  const result = await db
    .prepare(
      [
        "SELECT * FROM affected_legal_items",
        "WHERE source_status IN ('PENDING', 'NEEDS_REVIEW')",
        "AND (legal_item_type = 'LAW' OR title LIKE 'Ley %' OR reference_text LIKE '%Ley%')",
        "ORDER BY updated_at DESC",
        "LIMIT ?"
      ].join(" ")
    )
    .bind(limit)
    .all();
  return rows(result);
}

async function persistAffectedCurrentSource(db, item, resolution) {
  const timestamp = nowIso();
  const currentSource = {
    status: "LOADED",
    role: "CURRENT_TEXT",
    lawNumber: resolution.lawNumber,
    label: `Texto vigente oficial - Ley ${resolution.lawNumber}`,
    institution: "InfoLEG / Ministerio de Justicia",
    sourceUrl: resolution.textUrl,
    sourceKind: resolution.sourceKind,
    infolegId: resolution.infolegId,
    contentHash: resolution.contentHash,
    retrievedAt: timestamp,
    resolver: "infoleg-current-law@1",
    official: true
  };

  await markAffectedItemCurrentSource(db, item.id, {
    status: "LOADED",
    reviewReason:
      "Fuente vigente oficial resuelta automaticamente. Requiere matching articulo por articulo y validacion antes de publicarse.",
    currentSource,
    timestamp
  });

  if (!item.proposal_id) {
    return;
  }

  const documentSourceId = `document-source-current-${await sha256Hex(`${item.proposal_id}\n${resolution.textUrl}`)}`;
  await db
    .prepare(
      [
        "INSERT OR REPLACE INTO document_sources",
        "(id, agenda_item_id, proposal_id, source_role, source_url, source_label, institution, official, mime_type, status, content_hash, last_checked_at, notes, created_at, updated_at)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ].join(" ")
    )
    .bind(
      documentSourceId,
      item.proposal_id,
      item.proposal_id,
      "CURRENT_TEXT",
      resolution.textUrl,
      `Texto vigente oficial - Ley ${resolution.lawNumber}`,
      "InfoLEG / Ministerio de Justicia",
      1,
      "text/html",
      "LOADED",
      resolution.contentHash,
      timestamp,
      `Resuelto on-demand desde affected_legal_items por ${currentSource.resolver}. URL de ficha: ${resolution.normUrl}`,
      timestamp,
      timestamp
    )
    .run();

  await db
    .prepare(
      [
        "INSERT OR REPLACE INTO document_texts",
        "(id, document_source_id, extracted_text, normalized_text, extraction_method, parser_version, extraction_quality, content_hash, created_at, updated_at)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ].join(" ")
    )
    .bind(
      `document-text-${await sha256Hex(documentSourceId)}`,
      documentSourceId,
      resolution.normalizedText,
      resolution.normalizedText,
      "htmlTextExtractor@backend",
      "infoleg-current-law@1",
      "MEDIUM",
      resolution.contentHash,
      timestamp,
      timestamp
    )
    .run();
}

async function markAffectedItemCurrentSource(db, id, { status, reviewReason, currentSource, timestamp = nowIso() }) {
  await db
    .prepare(
      [
        "UPDATE affected_legal_items",
        "SET source_status = ?, current_source_json = ?, review_reason = ?, source_resolved_at = ?, updated_at = ?",
        "WHERE id = ?"
      ].join(" ")
    )
    .bind(status, JSON.stringify(currentSource ?? {}), nullableString(reviewReason), timestamp, timestamp, id)
    .run();
}

function lawNumberFromAffectedItem(item) {
  const text = [item.canonical_reference_text, item.title, item.reference_text, item.legal_item_id]
    .filter(Boolean)
    .join(" ");
  const match = text.match(/\b(?:ley\s*)?(\d{1,3})\.?(\d{3})\b/i);
  if (!match) {
    return null;
  }

  return `${Number(match[1])}${match[2]}`;
}

async function resolveInfolegCurrentLaw(lawNumber) {
  const searchBody = new URLSearchParams({
    tipoNorma: "1",
    numero: lawNumber,
    anioSancion: "",
    texto: "",
    dependencia: "",
    rama: "",
    fechaPublicacion: "",
    fechaPublicacionHasta: ""
  });
  const searchHtml = await fetchTextWithTimeout("https://servicios.infoleg.gob.ar/infolegInternet/buscarNormas.do", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "lexmapa-source-resolver/0.1"
    },
    body: searchBody.toString()
  });
  const infolegId = firstMatch(searchHtml, /verNorma\.do(?:;[^"?]+)?\?id=(\d+)/i);
  if (!infolegId) {
    return null;
  }

  const normUrl = `https://servicios.infoleg.gob.ar/infolegInternet/verNorma.do?id=${infolegId}`;
  const normHtml = await fetchTextWithTimeout(normUrl, {
    headers: { "user-agent": "lexmapa-source-resolver/0.1" }
  });
  const normPath = firstMatch(normHtml, /(anexos\/\d+-\d+\/\d+\/norma\.htm)/i);
  if (!normPath) {
    return null;
  }

  const normaUrl = `https://servicios.infoleg.gob.ar/infolegInternet/${normPath}`;
  const texactUrl = normaUrl.replace(/\/norma\.htm$/i, "/texact.htm");
  const texact = await fetchInfolegDocument(texactUrl);
  const norma = await fetchInfolegDocument(normaUrl);
  const selected = texact.usable ? { ...texact, sourceKind: "TEXTO_ACTUALIZADO" } : { ...norma, sourceKind: "NORMA_ORIGINAL" };
  if (!selected.usable) {
    return null;
  }

  return {
    lawNumber,
    infolegId,
    normUrl,
    textUrl: selected.url,
    sourceKind: selected.sourceKind,
    normalizedText: selected.normalizedText,
    contentHash: await sha256Hex(`infoleg-current-law@1\n${selected.normalizedText}`)
  };
}

async function fetchInfolegDocument(url) {
  try {
    const html = await fetchTextWithTimeout(url, {
      headers: { "user-agent": "lexmapa-source-resolver/0.1" }
    });
    const normalizedText = htmlToVisibleText(html);
    return {
      url,
      normalizedText,
      usable: normalizedText.length > 500 && !/error|no encontrado|not found/i.test(normalizedText.slice(0, 300))
    };
  } catch {
    return { url, normalizedText: "", usable: false };
  }
}

async function fetchTextWithTimeout(url, init = {}, timeoutMs = 25_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function htmlToVisibleText(html) {
  return decodeHtmlEntities(
    String(html ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&aacute;/gi, "a")
    .replace(/&eacute;/gi, "e")
    .replace(/&iacute;/gi, "i")
    .replace(/&oacute;/gi, "o")
    .replace(/&uacute;/gi, "u")
    .replace(/&ntilde;/gi, "n")
    .replace(/&Aacute;/g, "A")
    .replace(/&Eacute;/g, "E")
    .replace(/&Iacute;/g, "I")
    .replace(/&Oacute;/g, "O")
    .replace(/&Uacute;/g, "U")
    .replace(/&Ntilde;/g, "N")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function firstMatch(text, pattern) {
  return String(text ?? "").match(pattern)?.[1] ?? null;
}

function statusCounts(countRows) {
  const counts = {
    PENDING: 0,
    LEASED: 0,
    PROCESSING: 0,
    COMPLETED: 0,
    FAILED: 0,
    NEEDS_REVIEW: 0,
    NOT_COMPARABLE: 0
  };

  for (const row of countRows) {
    if (Object.hasOwn(counts, row.status)) {
      counts[row.status] = Number(row.count ?? 0);
    }
  }

  return counts;
}

function detectedProjectCounts(projects) {
  const counts = {
    total: projects.length,
    needsReview: 0,
    readyForValidation: 0,
    published: 0,
    rejected: 0,
    duplicates: 0,
    proposedTextLoaded: 0,
    currentTextLoaded: 0,
    currentTextPending: 0
  };

  for (const project of projects) {
    if (project.status === "needs_review") {
      counts.needsReview += 1;
    }
    if (project.status === "ready_for_validation") {
      counts.readyForValidation += 1;
    }
    if (project.status === "published") {
      counts.published += 1;
    }
    if (project.status === "rejected") {
      counts.rejected += 1;
    }
    if (project.duplicateWarning) {
      counts.duplicates += 1;
    }
    if (project.sourceStatuses.PROPOSED_TEXT === "LOADED") {
      counts.proposedTextLoaded += 1;
    }
    if (project.sourceStatuses.CURRENT_TEXT === "LOADED") {
      counts.currentTextLoaded += 1;
    }
    if (["PENDING", "NEEDS_REVIEW"].includes(project.sourceStatuses.CURRENT_TEXT)) {
      counts.currentTextPending += 1;
    }
  }

  return counts;
}

async function resolvedDiffCountsByProposal(db) {
  const result = await db
    .prepare("SELECT proposal_id, public_status, COUNT(*) AS count FROM resolved_legal_diffs GROUP BY proposal_id, public_status")
    .all();
  const byProposal = new Map();
  for (const row of rows(result)) {
    if (!byProposal.has(row.proposal_id)) {
      byProposal.set(row.proposal_id, {
        total: 0,
        validated: 0,
        partial: 0,
        assisted: 0,
        unresolved: 0
      });
    }
    const counts = byProposal.get(row.proposal_id);
    const count = Number(row.count ?? 0);
    counts.total += count;
    if (row.public_status === "DIFF_VALIDATED") {
      counts.validated += count;
    } else if (row.public_status === "DIFF_PARTIAL") {
      counts.partial += count;
    } else if (row.public_status === "DIFF_AI_ASSISTED") {
      counts.assisted += count;
    } else {
      counts.unresolved += count;
    }
  }
  return byProposal;
}

function toStagingProposalOverview(project, diffCounts = {}) {
  const full = toStagingProposal(project, []);
  const totalDiffs = Number(diffCounts.total ?? 0);
  return {
    id: full.id,
    title: full.title,
    status: full.status,
    chamber: full.chamber,
    statusLabelForUsers: full.statusLabelForUsers,
    scheduledTreatmentDate: full.scheduledTreatmentDate,
    committees: full.committees,
    summaryPlainLanguage: full.plainLanguageSummary,
    affectedTopics: full.topics.map((topic) => topic.label),
    affectedGroups: full.affectedGroups.map((group) => group.label),
    diffCount: totalDiffs,
    diffStatusSummary: {
      validated: Number(diffCounts.validated ?? 0),
      partial: Number(diffCounts.partial ?? 0),
      assisted: Number(diffCounts.assisted ?? 0),
      unresolved: Number(diffCounts.unresolved ?? 0)
    },
    dataStatus: full.dataStatus,
    dataKind: full.dataKind,
    priority: full.priority,
    sourceStatus: full.sourceStatus,
    sourceLinks: full.sourceLinks,
    source: full.source
  };
}

function toStagingProposal(project, diffs) {
  const sources = project.sources ?? [];
  const officialAgenda = sourceByRole(sources, "OFFICIAL_AGENDA");
  const officialCitation = sourceByRole(sources, "OFFICIAL_CITATION");
  const proposedText = sourceByRole(sources, "PROPOSED_TEXT");
  const currentText = sourceByRole(sources, "CURRENT_TEXT");
  const topics = topicsForProject(project);
  const groups = groupsForProject(project);
  const statusLabel = project.status === "ready_for_validation" ? "Listo para validacion tecnica" : "En revision tecnica";
  const diffSummary = summarizeDiffs(diffs);
  const displayTitle = displayTitleForProject(project);

  return {
    id: project.id,
    title: displayTitle,
    status: "IN_DEBATE",
    jurisdiction: { country: "AR", level: "NATIONAL" },
    chamber: project.chamber ?? "SENATE",
    statusLabelForUsers: statusLabel,
    scheduledTreatmentDate: project.scheduledAt,
    committees: project.committees ?? [],
    officialDescription: project.officialDescription ?? "Descripcion oficial pendiente",
    plainLanguageSummary: plainSummaryForProject(project),
    typeOfChange: "Proyecto detectado desde agenda oficial",
    summary: {
      headline: displayTitle,
      short: plainSummaryForProject(project),
      keyPoints: [
        "Proyecto detectado en staging desde una agenda oficial del Senado.",
        `${diffSummary.validated} diffs validados, ${diffSummary.partial} parciales, ${diffSummary.assisted} asistidos y ${diffSummary.unresolved} no resueltos.`,
        proposedText?.status === "LOADED" ? "Texto propuesto original cargado." : "Texto propuesto original pendiente."
      ],
      whatItMeans: [
        "LexMapa muestra el estado real del procesamiento para no ocultar pendientes.",
        "Las comparaciones pueden estar validadas, parciales, asistidas o no resueltas."
      ],
      limitations: [
        "Dato en staging tecnico; no implica aprobacion legal.",
        "Los diffs con advertencias deben leerse junto con sus fuentes originales."
      ],
      legalAdviceWarning:
        "LexMapa explica cambios legales en lenguaje simple, pero no brinda asesoramiento legal personalizado."
    },
    topics,
    affectedGroups: groups,
    diffs,
    queryExamples: queryExamplesForProject({ ...project, title: displayTitle }),
    source: {
      id: officialAgenda?.id ?? "senate-staging",
      name: officialAgenda?.label ?? officialAgenda?.role ?? "Agenda oficial Senado",
      sourceUrl: officialAgenda?.url,
      retrievedAt: officialAgenda?.lastCheckedAt,
      official: true
    },
    sourceLinks: {
      officialAgendaSourceUrl: officialAgenda?.url,
      officialCitationUrl: officialCitation?.url,
      proposedTextOriginalUrl: proposedText?.url,
      currentLawOriginalUrl: currentText?.url
    },
    sourceStatus: project.sourceStatuses?.PROPOSED_TEXT === "LOADED" ? "LOADED" : "NEEDS_REVIEW",
    priority: priorityForProject(project),
    dataKind: "REAL_AGENDA_ITEM",
    importedFrom: officialAgenda?.url ?? proposedText?.url ?? "",
    importedAt: project.createdAt,
    lastCheckedAt: project.updatedAt,
    originalSources: {
      current: currentText ? loadedOriginalSourceFromDocument(currentText, "Texto vigente original") : pendingOriginalSourceDto("Texto vigente original"),
      proposed: proposedText ? loadedOriginalSourceFromDocument(proposedText, "Texto propuesto original") : pendingOriginalSourceDto("Texto propuesto original")
    },
    dataStatus: "NEEDS_LEGAL_REVIEW",
    updatedAt: project.updatedAt,
    scopeNote: "Proyecto en staging. Puede contener comparaciones parciales, asistidas o pendientes.",
    legalAdviceWarning: "LexMapa no brinda asesoramiento legal personalizado. Verifique siempre la fuente legal aplicable."
  };
}

function toPublicLegalDiff(row) {
  const currentVersion = parseNullableObject(row.current_version_json) ?? pendingLegalVersion("Texto vigente", "Texto vigente pendiente o no matcheado.");
  const proposedVersion = parseNullableObject(row.proposed_version_json) ?? pendingLegalVersion("Texto propuesto", "Texto propuesto pendiente.");
  const warnings = parseArray(row.validation_warnings_json);
  return {
    id: row.id,
    proposalId: row.proposal_id,
    title: row.title,
    changeType: row.change_type,
    affectedTopicIds: ["tema-principal"],
    affectedGroupIds: ["grupo-general"],
    currentVersion,
    proposedVersion,
    explanationPlainLanguage: row.explanation_plain_language ?? explanationForOperation(row.operation_type, row.public_status),
    practicalImpact: row.practical_impact ?? practicalImpactForStatus(row.public_status),
    impactLevel: row.public_status === "DIFF_VALIDATED" ? "MEDIUM" : "UNKNOWN",
    source: {
      id: "resolved-diff-source",
      name: row.remote_assisted ? "Resolver deterministico + procesador remoto" : "Resolver deterministico LexMapa",
      official: false
    },
    dataStatus: row.public_status === "DIFF_VALIDATED" ? "NEEDS_LEGAL_REVIEW" : "NEEDS_LEGAL_REVIEW",
    traceability: {
      notes: `${formatDiffPublicStatus(row.public_status)}. ${warnings.join(", ") || "Sin warnings criticos."}`
    },
    publicStatus: row.public_status,
    validationWarnings: warnings,
    confidence: row.confidence,
    remoteAssisted: Boolean(row.remote_assisted)
  };
}

function pendingLegalVersion(label, text) {
  return {
    id: `pending-${label.toLowerCase().replaceAll(" ", "-")}`,
    label,
    text,
    status: "DESCONOCIDO",
    source: { id: "pending-source", name: "Fuente pendiente", official: false },
    sourceStatus: "PENDING",
    originalSource: pendingOriginalSourceDto(label)
  };
}

function sourceByRole(sources, role) {
  return sources.find((source) => source.role === role);
}

function loadedOriginalSourceFromDocument(source, label) {
  return {
    status: source.status === "LOADED" ? "LOADED" : "NEEDS_REVIEW",
    label,
    name: source.label ?? source.institution ?? "Fuente original",
    sourceUrl: source.url,
    retrievedAt: source.lastCheckedAt,
    official: true,
    note: source.notes
  };
}

function pendingOriginalSourceDto(label) {
  return {
    status: "PENDING",
    label,
    note: "Fuente original pendiente de carga"
  };
}

function topicsForProject(project) {
  const text = normalizeSearchText([project.title, project.officialDescription].join(" "));
  const detected = [];
  if (text.includes("biocombustible") || text.includes("combustible")) {
    detected.push({ id: "energia", label: "Energia", summaryPlainLanguage: "Cambios sobre combustibles, energia o regulacion sectorial." });
  }
  if (text.includes("ambiente") || text.includes("parque") || text.includes("marino")) {
    detected.push({ id: "ambiente", label: "Ambiente", summaryPlainLanguage: "Cambios sobre ambiente, areas protegidas o recursos naturales." });
  }
  if (text.includes("deroga") || text.includes("hojarasca")) {
    detected.push({ id: "simplificacion-normativa", label: "Simplificacion normativa", summaryPlainLanguage: "Derogaciones o limpieza de normas sin uso actual claro." });
  }
  if (detected.length === 0) {
    detected.push({ id: "tema-principal", label: "Tema principal", summaryPlainLanguage: "Tema detectado desde la agenda oficial y pendiente de clasificacion fina." });
  }
  return detected;
}

function groupsForProject(project) {
  const text = normalizeSearchText([project.title, project.officialDescription].join(" "));
  const groups = [{ id: "ciudadanos", label: "Ciudadanos", impactSummary: "Personas alcanzadas directa o indirectamente por el cambio en debate." }];
  if (text.includes("empresa") || text.includes("inversion") || text.includes("combustible")) {
    groups.push({ id: "empresas", label: "Empresas y sectores regulados", impactSummary: "Actores economicos que podrian tener obligaciones, beneficios o reglas nuevas." });
  }
  if (text.includes("estado") || text.includes("administracion")) {
    groups.push({ id: "estado", label: "Estado y administracion publica", impactSummary: "Organismos responsables de aplicar, coordinar o controlar el cambio." });
  }
  return groups;
}

function summarizeDiffs(diffs) {
  return {
    validated: diffs.filter((diff) => diff.publicStatus === "DIFF_VALIDATED").length,
    partial: diffs.filter((diff) => diff.publicStatus === "DIFF_PARTIAL").length,
    assisted: diffs.filter((diff) => diff.publicStatus === "DIFF_AI_ASSISTED").length,
    unresolved: diffs.filter((diff) => diff.publicStatus === "DIFF_UNRESOLVED").length
  };
}

function plainSummaryForProject(project) {
  return stringValue(
    project.officialDescription,
    "Proyecto detectado desde agenda oficial. LexMapa muestra fuentes, estado y comparaciones disponibles."
  );
}

function displayTitleForProject(project) {
  const text = normalizeSearchText([project.title, project.officialDescription, project.expedientNumber].join(" "));
  if (text.includes("hojarasca")) {
    return "Ley Hojarasca";
  }
  if (text.includes("monte leon")) {
    return "Parque Interjurisdiccional Marino Monte Leon";
  }
  if (text.includes("biocombustible")) {
    return `Biocombustibles${project.expedientNumber ? ` - ${project.expedientNumber}` : ""}`;
  }
  return project.title ?? project.expedientNumber ?? "Proyecto detectado";
}

function queryExamplesForProject(project) {
  const title = normalizeSearchText(project.title);
  return [
    `que cambia con ${project.title}`,
    title.includes("biocombustible") ? "que cambia con biocombustibles" : "",
    title.includes("hojarasca") ? "que cambia con la ley hojarasca" : ""
  ].filter(Boolean);
}

function priorityForProject(project) {
  const text = normalizeSearchText([project.title, project.officialDescription].join(" "));
  if (text.includes("hojarasca") || text.includes("transparencia") || text.includes("rigi")) {
    return "HIGH";
  }
  if (text.includes("biocombustible")) {
    return "MEDIUM_HIGH";
  }
  return "MEDIUM";
}

function proposalStatusSummary(proposal) {
  const diffSummary = proposal.diffStatusSummary ?? {};
  return `Encontramos un proyecto en staging con ${Number(diffSummary.validated ?? 0)} diffs validados, ${Number(diffSummary.partial ?? 0)} parciales y ${Number(diffSummary.assisted ?? 0)} asistidos.`;
}

function formatDiffPublicStatus(value) {
  const labels = {
    DIFF_VALIDATED: "Comparacion validada automaticamente",
    DIFF_PARTIAL: "Comparacion parcial",
    DIFF_AI_ASSISTED: "Comparacion asistida por procesador remoto",
    DIFF_UNRESOLVED: "Comparacion no resuelta"
  };
  return labels[value] ?? "Estado de comparacion pendiente";
}

function queryTerms(query) {
  return unique(
    normalizeSearchText(query)
      .split(/[^a-z0-9]+/g)
      .map((term) => term.trim())
      .filter((term) => term.length > 2)
  );
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function toResolvedDiffDto(row) {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    jobId: row.job_id ?? undefined,
    proposalId: row.proposal_id ?? undefined,
    operationId: row.operation_id ?? undefined,
    affectedLegalItemId: row.affected_legal_item_id ?? undefined,
    fallbackJobId: row.fallback_job_id ?? undefined,
    sourceLabel: row.source_label ?? undefined,
    title: row.title,
    publicStatus: row.public_status,
    changeType: row.change_type,
    operationType: row.operation_type ?? undefined,
    targetLabel: row.target_label ?? undefined,
    currentVersion: parseNullableObject(row.current_version_json),
    proposedVersion: parseNullableObject(row.proposed_version_json),
    explanationPlainLanguage: row.explanation_plain_language ?? "",
    practicalImpact: row.practical_impact ?? "",
    confidence: row.confidence,
    validationWarnings: parseArray(row.validation_warnings_json),
    sourceTrace: parseObject(row.source_trace_json),
    resolverVersion: row.resolver_version,
    remoteAssisted: Boolean(row.remote_assisted),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function canonicalOperationType(value) {
  const normalized = String(value ?? "UNKNOWN_OPERATION").toUpperCase();
  const aliases = {
    MODIFY_PROVISION: "MODIFY_ARTICLE",
    ADD_PROVISION: "ADD_ARTICLE",
    REPEAL_PROVISION: "REMOVE_ARTICLE",
    NEW_REGIME: "ADD_NEW_REGIME",
    APPROVAL_ONLY: "APPROVAL_ONLY"
  };
  return aliases[normalized] ?? normalized;
}

function normalizeTargetLabel(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const article = extractTargetLabel(text);
  return article ?? text;
}

function extractTargetLabel(text) {
  const match = String(text ?? "").match(/\bart[íi]culo\s+(\d+[°º]?(?:\s*(?:bis|ter|quater))?)/i);
  if (!match) {
    return null;
  }
  return `Articulo ${match[1].replace(/[°º]/g, "").trim()}`;
}

function operationRequiresCurrentText(operationType) {
  return [
    "MODIFY_ARTICLE",
    "REMOVE_ARTICLE",
    "REPEAL_LAW",
    "REPLACE_LAW",
    "MODIFY_SECTION",
    "REMOVE_SECTION",
    "MODIFY_PARAGRAPH",
    "REMOVE_PARAGRAPH",
    "MODIFY_SUBSECTION",
    "REMOVE_SUBSECTION",
    "REPLACE_TEXT",
    "UPDATE_AMOUNT",
    "UPDATE_PERCENTAGE",
    "UPDATE_DEADLINE",
    "EXTEND_DEADLINE",
    "SUSPEND_EFFECT",
    "RESTORE_EFFECT",
    "ANNEX_CHANGE",
    "TEXT_CORRECTION"
  ].includes(operationType);
}

function operationTargetsProvision(operationType) {
  return [
    "MODIFY_ARTICLE",
    "ADD_ARTICLE",
    "REMOVE_ARTICLE",
    "MODIFY_SECTION",
    "ADD_SECTION",
    "REMOVE_SECTION",
    "MODIFY_PARAGRAPH",
    "ADD_PARAGRAPH",
    "REMOVE_PARAGRAPH",
    "MODIFY_SUBSECTION",
    "ADD_SUBSECTION",
    "REMOVE_SUBSECTION"
  ].includes(operationType);
}

function diffPublicStatus({ operationType, warnings, currentRequired, remoteAssisted, hasCurrent, hasProposed }) {
  if (["NOT_COMPARABLE", "APPROVAL_ONLY", "APPROVE_TREATY", "APPROVE_AGREEMENT"].includes(operationType)) {
    return remoteAssisted ? "DIFF_AI_ASSISTED" : "DIFF_UNRESOLVED";
  }

  const criticalWarnings = warnings.filter((warning) =>
    [
      "CURRENT_VERSION_PENDING",
      "CURRENT_SOURCE_NOT_LOADED",
      "PROPOSED_VERSION_PENDING",
      "TARGET_ARTICLE_NOT_FOUND",
      "TARGET_PROVISION_PENDING"
    ].includes(warning)
  );

  if (remoteAssisted && criticalWarnings.length > 0) {
    return "DIFF_AI_ASSISTED";
  }
  if (currentRequired && (!hasCurrent || !hasProposed)) {
    return remoteAssisted ? "DIFF_AI_ASSISTED" : "DIFF_PARTIAL";
  }
  if (criticalWarnings.length > 0) {
    return remoteAssisted ? "DIFF_AI_ASSISTED" : "DIFF_PARTIAL";
  }
  return "DIFF_VALIDATED";
}

function normalizeResolutionWarnings(warnings, { hasCurrent, hasProposed, hasCurrentSource }) {
  return warnings.filter((warning) => {
    if (warning === "CURRENT_VERSION_PENDING" && hasCurrent) {
      return false;
    }
    if (warning === "PROPOSED_VERSION_PENDING" && hasProposed) {
      return false;
    }
    if (warning === "CURRENT_SOURCE_NOT_LOADED" && hasCurrentSource) {
      return false;
    }
    return true;
  });
}

function explanationForOperation(operationType, publicStatus) {
  const operationLabels = {
    REPEAL_LAW: "El proyecto propone derogar una ley completa.",
    MODIFY_ARTICLE: "El proyecto propone modificar un articulo de una norma vigente.",
    ADD_ARTICLE: "El proyecto propone incorporar un articulo nuevo.",
    REMOVE_ARTICLE: "El proyecto propone eliminar un articulo vigente.",
    ADD_NEW_REGIME: "El proyecto propone crear un regimen nuevo.",
    APPROVAL_ONLY: "El proyecto aprueba un documento o acuerdo y no tiene un antes/despues directo."
  };
  const base = operationLabels[operationType] ?? "El proyecto contiene una operacion legal detectada automaticamente.";
  if (publicStatus === "DIFF_VALIDATED") {
    return `${base} La comparacion fue resuelta automaticamente con fuentes trazables.`;
  }
  if (publicStatus === "DIFF_AI_ASSISTED") {
    return `${base} La comparacion fue asistida por procesador remoto y conserva advertencias visibles.`;
  }
  if (publicStatus === "DIFF_PARTIAL") {
    return `${base} La comparacion es parcial porque falta validar o matchear algun elemento.`;
  }
  return `${base} No se pudo construir una comparacion articulo por articulo completa.`;
}

function practicalImpactForStatus(publicStatus) {
  const labels = {
    DIFF_VALIDATED: "El usuario puede comparar texto vigente y propuesto, revisando siempre las fuentes originales.",
    DIFF_PARTIAL: "El usuario puede ver una comparacion preliminar, pero debe considerar las advertencias antes de interpretarla.",
    DIFF_AI_ASSISTED: "El usuario puede ver una comparacion asistida, pendiente de revision tecnica o legal.",
    DIFF_UNRESOLVED: "El usuario puede ver el motivo por el cual no hay comparacion completa y acceder a las fuentes."
  };
  return labels[publicStatus] ?? labels.DIFF_UNRESOLVED;
}

function confidenceForResolution(row, warnings, remoteAssisted) {
  if (remoteAssisted) {
    return warnings.length > 0 ? "LOW" : "MEDIUM";
  }
  if (warnings.length === 0 && row.confidence === "HIGH") {
    return "HIGH";
  }
  if (warnings.length <= 1 && ["HIGH", "MEDIUM"].includes(row.confidence)) {
    return "MEDIUM";
  }
  return "LOW";
}

function findArticleInText(text, targetLabel) {
  const targetNumber = String(targetLabel ?? "").match(/(\d+)/)?.[1];
  if (!targetNumber) {
    return null;
  }

  const articles = segmentArticles(text);
  return articles.find((article) => article.number === targetNumber) ?? null;
}

function segmentArticles(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const pattern = /(^|\n)\s*(ART[ÍI]CULO|Art\.?)\s+(\d+[°º]?(?:\s*(?:bis|ter|quater))?)\s*[.\-:)]?/gi;
  const matches = [...normalized.matchAll(pattern)];
  if (matches.length === 0) {
    return [];
  }

  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? normalized.length : normalized.length;
    const number = match[3].replace(/[°º]/g, "").trim();
    return {
      number,
      label: `Articulo ${number}`,
      text: normalized.slice(start, end).trim()
    };
  });
}

function clipTextForDisplay(text, limit = 20000) {
  const normalized = String(text ?? "").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}\n\n[Texto truncado para visualizacion. Ver fuente original.]` : normalized;
}

function jobCapabilitiesSatisfied(job, processorCapabilities) {
  const required = parseArray(job.required_capabilities_json);
  return required.every((capability) => processorCapabilities.has(capability));
}

function unique(values) {
  return [...new Set(arrayValue(values).filter(Boolean))];
}

function canonicalExpedient(value) {
  const match = String(value ?? "").match(/\b(C\.?\s*D\.?|CD|S|PE)\s*-?\s*(\d{1,6})\s*\/\s*(\d{2,4})\b/i);
  if (!match) {
    return null;
  }

  const origin = normalizeExpedientOrigin(match[1]);
  const number = Number(match[2]);
  const year = match[3].length === 4 ? match[3].slice(-2) : match[3];
  return `${origin}-${number}/${year}`;
}

function duplicateExpedientWarning(value) {
  const text = String(value ?? "");
  const canonical = canonicalExpedient(text);
  if (!canonical) {
    return null;
  }

  return text !== canonical && !isRepeatedCanonicalExpedient(text, canonical)
    ? `Expediente no canonico: se detecto ${text}, se esperaba ${canonical}.`
    : null;
}

function isRepeatedCanonicalExpedient(value, canonical) {
  const canonicalMatch = canonical.match(/^(CD|S|PE)-(\d{1,6})\/(\d{2,4})$/i);
  if (!canonicalMatch) {
    return false;
  }

  const normalized = String(value ?? "").replace(/\s|\./g, "").toUpperCase();
  const origin = canonicalMatch[1].toUpperCase();
  const number = Number(canonicalMatch[2]);
  const year = canonicalMatch[3].length === 4 ? canonicalMatch[3].slice(-2) : canonicalMatch[3];
  return normalized === `${origin}-${number}/${year}-${number}/${year}`;
}

function normalizeExpedientOrigin(value) {
  const normalized = String(value ?? "").replace(/\s|\./g, "").toUpperCase();
  if (normalized.startsWith("CD")) {
    return "CD";
  }
  if (normalized.startsWith("S")) {
    return "S";
  }
  if (normalized.startsWith("PE")) {
    return "PE";
  }
  return normalized;
}

async function touchProcessorIdle(db, processorId, timestamp) {
  await db
    .prepare("UPDATE processor_nodes SET current_job_id = NULL, last_seen_at = ?, updated_at = ? WHERE id = ?")
    .bind(timestamp, timestamp, processorId)
    .run();
}

async function insertAttempt(db, { jobId, processorId, status, message, metadata }) {
  await db
    .prepare(
      "INSERT INTO processing_job_attempts (id, job_id, processor_id, status, message, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      `attempt-${crypto.randomUUID()}`,
      jobId,
      processorId,
      status,
      message,
      JSON.stringify(metadata ?? {}),
      nowIso()
    )
    .run();
}

async function insertArtifacts(db, jobId, processorId, artifacts) {
  for (const artifact of artifacts) {
    await db
      .prepare(
        [
          "INSERT INTO processing_artifacts",
          "(id, job_id, processor_id, artifact_type, content_json, content_hash, source_url, created_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ].join(" ")
      )
      .bind(
        `artifact-${crypto.randomUUID()}`,
        jobId,
        processorId,
        stringValue(artifact.artifactType, "VALIDATION_REPORT"),
        JSON.stringify(artifact.content ?? {}),
        nullableString(artifact.contentHash),
        nullableString(artifact.sourceUrl),
        nowIso()
      )
      .run();
  }
}

async function persistStructuredResult(db, jobId, result, job = null) {
  const timestamp = nowIso();

  if (job?.job_type === "RESOLVE_DIFF_FALLBACK") {
    await persistFallbackDiffResult(db, job, result);
    return;
  }

  for (const item of arrayValue(result.affectedLegalItems)) {
    await db
      .prepare(
        [
          "INSERT OR REPLACE INTO affected_legal_items",
          "(id, job_id, proposal_id, legal_item_id, title, legal_item_type, reference_text, canonical_reference_text, operation_type,",
          "current_source_json, source_status, affected_provision_ids_json, detection_evidence_json, review_reason, notes, created_at, updated_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ].join(" ")
      )
      .bind(
        item.id ?? `affected-${crypto.randomUUID()}`,
        jobId,
        nullableString(item.proposalId),
        nullableString(item.legalItemId),
        stringValue(item.title, "Norma afectada pendiente"),
        nullableString(item.legalItemType),
        stringValue(item.referenceText, ""),
        nullableString(item.canonicalReferenceText),
        stringValue(item.operationType, "NEEDS_REVIEW"),
        JSON.stringify(item.currentSource ?? {}),
        stringValue(item.sourceStatus, "PENDING"),
        JSON.stringify(arrayValue(item.affectedProvisionIds)),
        JSON.stringify(item.detectionEvidence ?? {}),
        nullableString(item.reviewReason),
        nullableString(item.notes),
        timestamp,
        timestamp
      )
      .run();
  }

  for (const provision of arrayValue(result.extractedProvisions)) {
    await db
      .prepare(
        [
          "INSERT OR REPLACE INTO extracted_provisions",
          "(id, job_id, proposal_id, legal_item_id, provision_label, provision_type, provision_order, text_original, source_url, content_hash, created_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ].join(" ")
      )
      .bind(
        provision.id ?? `provision-${crypto.randomUUID()}`,
        jobId,
        nullableString(provision.proposalId),
        nullableString(provision.legalItemId),
        stringValue(provision.provisionLabel ?? provision.label, "Provision"),
        stringValue(provision.provisionType ?? provision.type, "ARTICLE"),
        Number(provision.provisionOrder ?? provision.order ?? 0),
        stringValue(provision.textOriginal ?? provision.text, ""),
        nullableString(provision.sourceUrl),
        nullableString(provision.contentHash),
        timestamp
      )
      .run();
  }

  for (const operation of arrayValue(result.changeOperations)) {
    await db
      .prepare(
        [
          "INSERT OR REPLACE INTO change_operations",
          "(id, job_id, proposal_id, affected_legal_item_id, operation_type, detected_verb, source_provision_id, target_legal_item_id, target_provision_id, evidence_text, confidence, review_status, created_at, updated_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ].join(" ")
      )
      .bind(
        operation.id ?? `operation-${crypto.randomUUID()}`,
        jobId,
        nullableString(operation.proposalId),
        nullableString(operation.affectedLegalItemId),
        stringValue(operation.operationType, "NEEDS_REVIEW"),
        nullableString(operation.detectedVerb),
        nullableString(operation.sourceProvisionId),
        nullableString(operation.targetLegalItemId),
        nullableString(operation.targetProvisionId),
        stringValue(operation.evidenceText, ""),
        stringValue(operation.confidence, "LOW"),
        stringValue(operation.reviewStatus, "AUTO_EXTRACTED"),
        timestamp,
        timestamp
      )
      .run();
  }

  for (const candidate of arrayValue(result.diffCandidates)) {
    await db
      .prepare(
        [
          "INSERT OR REPLACE INTO generated_diff_candidates",
          "(id, job_id, proposal_id, operation_id, affected_legal_item_id, title, change_type, current_version_json, proposed_version_json, explanation_plain_language, practical_impact, confidence, review_status, validation_warnings_json, created_at, updated_at)",
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ].join(" ")
      )
      .bind(
        candidate.id ?? `diff-candidate-${crypto.randomUUID()}`,
        jobId,
        nullableString(candidate.proposalId),
        nullableString(candidate.operationId),
        nullableString(candidate.affectedLegalItemId),
        stringValue(candidate.title, "Diff candidato pendiente"),
        stringValue(candidate.changeType, "MODIFIED"),
        candidate.currentVersion ? JSON.stringify(candidate.currentVersion) : null,
        candidate.proposedVersion ? JSON.stringify(candidate.proposedVersion) : null,
        nullableString(candidate.explanationPlainLanguage),
        nullableString(candidate.practicalImpact),
        stringValue(candidate.confidence, "LOW"),
        stringValue(candidate.reviewStatus, "NEEDS_REVIEW"),
        JSON.stringify(arrayValue(candidate.validationWarnings)),
        timestamp,
        timestamp
      )
      .run();
  }
}

function toProcessorDto(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    status: processorStatus(row),
    lastSeenAt: row.last_seen_at ?? undefined,
    tier: row.tier ?? undefined,
    capabilities: parseArray(row.capabilities_json),
    currentJobId: row.current_job_id ?? undefined,
    modelName: row.model_name ?? undefined,
    processorVersion: row.processor_version ?? undefined
  };
}

function processorStatus(row) {
  if (row.status !== "ONLINE" || !row.last_seen_at) {
    return row.status;
  }

  const lastSeen = Date.parse(row.last_seen_at);
  if (Number.isNaN(lastSeen)) {
    return row.status;
  }

  return Date.now() - lastSeen > 120_000 ? "OFFLINE" : row.status;
}

function toJobDto(row) {
  return {
    id: row.id,
    jobType: row.job_type,
    status: row.status,
    priority: Number(row.priority ?? 0),
    requiredCapabilities: parseArray(row.required_capabilities_json),
    sourceLabel: row.source_label ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    leaseOwnerId: row.lease_owner_id ?? undefined,
    leaseUntil: row.lease_until ?? undefined,
    attempts: Number(row.attempts ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function readJson(request) {
  const text = await request.text();
  if (!text.trim()) {
    return {};
  }

  return JSON.parse(text);
}

function bearerToken(request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomSecret() {
  const values = new Uint8Array(32);
  crypto.getRandomValues(values);
  return [...values].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function nowIso() {
  return new Date().toISOString();
}

function rows(result) {
  return result?.results ?? [];
}

function parseArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseNullableObject(value) {
  const parsed = parseObject(value);
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function stringArray(value) {
  return arrayValue(value).map((item) => String(item)).filter(Boolean);
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value, fallback) {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function nullableString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function readableError(error) {
  return error instanceof Error ? error.message : String(error);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? ""));
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}
