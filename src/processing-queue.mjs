const PROCESSING_ROUTES = [
  "/processors/status",
  "/processors/enroll",
  "/processors/heartbeat",
  "/processors/jobs/claim",
  "/processing-queue",
  "/processing-review",
  "/processing-review/affected-items/resolve-current-sources",
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

  const candidate = await db
    .prepare(
      [
        "SELECT * FROM processing_jobs",
        "WHERE status = 'PENDING'",
        "OR (status IN ('LEASED', 'PROCESSING') AND lease_until IS NOT NULL AND lease_until < ?)",
        "ORDER BY priority DESC, created_at ASC",
        "LIMIT 1"
      ].join(" ")
    )
    .bind(timestamp)
    .first();

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
    await persistStructuredResult(db, jobId, body.result ?? {});
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

async function processingReview(db, limit) {
  const [queue, projects, candidateRows, affectedRows] = await Promise.all([
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
      affectedLegalItems
    }
  };
}

async function retryProcessingJob(db, jobId, json) {
  const existing = await getJob(db, jobId);
  if (!existing) {
    return json(404, { error: "PROCESSING_JOB_NOT_FOUND" });
  }

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

async function persistStructuredResult(db, jobId, result) {
  const timestamp = nowIso();

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
