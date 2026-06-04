# API inicial

## Propuestas de cambio legal

La experiencia principal del MVP consulta propuestas o reformas en debate y sus
diffs cuando ya fueron cargados:

```http
GET /change-proposals
GET /change-proposals/:id
GET /change-proposals/:id/diffs
```

`GET /change-proposals` devuelve overviews para busqueda y seleccion.

`GET /change-proposals/:id` devuelve:

- resumen en lenguaje simple;
- temas afectados;
- grupos impactados;
- diffs texto actual vs texto propuesto, si existen;
- fuente, estado del dato, alcance y advertencia.

`GET /change-proposals/:id/diffs` devuelve solo los cambios de esa propuesta.
Para items importados desde agenda oficial sin textos originales cargados,
devuelve `diffs: []`.

Fixture actual:

```text
change-proposals.congress-agenda / REAL_AGENDA_ITEM
```

El fixture es trazable y acotado al vertical slice de Senado. Se deriva de la
importacion manual/deterministica del Worker de ingestion y no debe inventar
diffs legales ni reemplazar la fuente original del proyecto.

## Items legales

```http
GET /legal-items
GET /legal-items/:id
GET /legal-items/:id/overview
GET /legal-items/:id/provisions
GET /legal-items/:id/relationships
GET /legal-items/:id/timeline
GET /legal-items/:id/semantic-diff?from=&to=
GET /legal-items/:id/freshness
GET /dataset/status
```

## Conceptos

```http
GET /legal-concepts/:id
```

## Busqueda

```http
GET /search?q=
```

La busqueda devuelve:

- `proposals`: propuestas o reformas que coinciden con la pregunta. Para cada
  resultado incluye `matchedDiffIds`, `matchedTopicIds`, `matchedGroupIds` y
  `matchSummary` cuando la pregunta permite orientar el resultado.
- `items`: items legales aprobados disponibles, si el dataset permite lectura.

Consultas esperadas para esta etapa:

- `hojarasca`
- `biocombustibles`
- `biodiesel`
- `bioetanol`
- `parque marino`
- `Monte Leon`
- `Santa Cruz`

En Worker, si D1 contiene un dataset bloqueado para lectura publica, la busqueda
mantiene `proposals` disponible y devuelve `items = []` con `itemsUnavailable`.

## Procesadores remotos

La coordinacion de procesadores remotos usa endpoints privados por pull. El
procesador corre fuera de Cloudflare, se conecta por HTTPS saliente, toma jobs
con lease y devuelve resultados estructurados.

Estado de lectura:

```http
GET /processors/status
GET /processing-queue?limit=25
GET /detected-projects?limit=50
GET /processing-review?limit=50
```

`GET /processors/status` devuelve procesadores registrados, estado derivado del
ultimo heartbeat, tier, modelo, capacidades y job actual.

`GET /processing-queue` devuelve procesadores, conteo por estado y jobs
recientes. La UI operativa de frontend consume estos endpoints desde
`ops.html`.

`GET /detected-projects` devuelve items Senado accionables detectados en D1
ingestion, fuentes asociadas, estado de texto propuesto/vigente, job de
procesamiento si existe y advertencias de dedupe/parser. Excluye items
`rejected` para no mezclar descartes operativos con proyectos navegables. No
publica esos items como reformas aprobadas.

`GET /processing-review` agrega cola, proyectos detectados, jobs pendientes,
fallidos, `NEEDS_REVIEW`, candidatos de diff, normas afectadas sin texto
vigente, duplicados y descartes operativos. Es una vista de trabajo para
`/ops`, no un read model publico.

Las normas afectadas pueden incluir:

- `canonicalReferenceText`;
- `detectionEvidence`;
- `reviewReason`;
- `currentSource`;
- `sourceResolvedAt`.

Enrolamiento y ejecucion:

```http
POST /processors/enroll
POST /processors/heartbeat
POST /processors/jobs/claim
POST /processors/jobs/:id/progress
POST /processors/jobs/:id/result
POST /processors/jobs/:id/fail
POST /processors/jobs/:id/release
```

`POST /processors/enroll` requiere `Authorization: Bearer
PROCESSOR_ENROLLMENT_TOKEN` o `PROCESSOR_ADMIN_TOKEN`. Devuelve `processor.id`
y `processorSecret`; ese secreto vive solo en la maquina del procesador remoto.

Los endpoints de heartbeat/jobs requieren:

```http
Authorization: Bearer <processorSecret>
x-processor-id: <processorId>
```

Creacion administrativa de jobs:

```http
POST /processing-queue/jobs
POST /processing-queue/senate-diff-jobs
POST /processing-queue/jobs/:id/retry
POST /processing-review/affected-items/resolve-current-sources
POST /processing-review/diffs/resolve
```

Estos endpoints requieren `PROCESSOR_ADMIN_TOKEN` o
`PROCESSOR_ENROLLMENT_TOKEN`. El endpoint `senate-diff-jobs` crea jobs
`GENERATE_DIFF_CANDIDATES` desde items Senado de `lexmapa-ingestion` en estado
`needs_review` o `ready_for_validation`, deduplicados por agenda item.

`POST /processing-queue/jobs/:id/retry` limpia salidas parciales del job,
resetea lease/error/progreso y lo devuelve a `PENDING`. Debe usarse desde la UI
operativa solo con token admin cargado localmente por el operador.

`POST /processing-review/affected-items/resolve-current-sources` resuelve de
forma on-demand fuentes vigentes oficiales para `affected_legal_items` pendientes.
Usa InfoLEG por tipo/nro de norma, guarda `current_source_json`, `source_status`
y, cuando encuentra texto HTML usable, `document_sources`/`document_texts` en
D1 ingestion. No publica diffs ni aprueba candidatos. El batch esta limitado a
8 items por invocacion para respetar limites de subrequests de Cloudflare.

`POST /processing-review/diffs/resolve` ejecuta el resolver deterministico de
candidatos de diff. Toma `generated_diff_candidates`, cruza texto propuesto,
texto vigente, operacion detectada y fuentes, y persiste `resolved_legal_diffs`
con estado publico:

- `DIFF_VALIDATED`;
- `DIFF_PARTIAL`;
- `DIFF_AI_ASSISTED`;
- `DIFF_UNRESOLVED`.

Si un candidato no queda `DIFF_VALIDATED`, el endpoint crea un job
`RESOLVE_DIFF_FALLBACK` para procesador remoto con capacidad
`LEGAL_DIFF_FALLBACK`. Cuando el procesador devuelve hints, el backend corre una
segunda pasada deterministica antes de actualizar el diff visible.

La API puede exponer diffs parciales, asistidos o no resueltos, pero siempre con
warnings, fuentes y estado. Eso no equivale a aprobacion legal ni asesoramiento
personalizado.

## Respuesta esperada

Toda respuesta interpretada debe incluir o permitir navegar hacia:

- Fuente.
- Citas.
- Estado de revision.
- Nivel de confianza.
- Freshness.

## Errores esperados

- `404`: item no encontrado.
- `409`: dato pendiente de validacion cuando el consumidor exige dato aprobado.
- `422`: parametros invalidos.
- `503`: read model no disponible temporalmente.

## API local inicial

El repositorio incluye una API minima sin dependencias externas:

```bash
npm start
```

Por defecto lee:

```text
examples/approved-bundle.example.json
```

Tambien puede leer otro approved bundle usando:

```bash
APPROVED_BUNDLE_PATH=path/to/approved-bundle.json npm start
```

Checks locales:

```bash
npm run check
```

## Worker Cloudflare

El entrypoint para Cloudflare Workers es:

```text
src/worker.mjs
```

En produccion espera un binding D1 llamado:

```text
DB
```

Si el binding no existe, responde `503 D1_BINDING_MISSING`.

Para procesadores remotos puede recibir un binding D1 adicional:

```text
PROCESSING_DB
```

En el despliegue Cloudflare actual, `PROCESSING_DB` apunta a
`lexmapa-ingestion`. El Worker publico solo lo usa para coordinacion operativa
de procesadores y cola; no lo usa como read model legal aprobado.

### Politica de dataset

Los endpoints de lectura publica de items legales (`/legal-items`,
`/legal-items/:id/overview` y `/legal-items/:id/freshness`) solo sirven datasets
con:

```text
dataset.mode = HUMAN_REVIEWED
dataset.mode = PRODUCTION_APPROVED
```

Si D1 contiene un dataset `DEV_STRUCTURAL` o `disposable = true`, responden:

```http
409 DATASET_NOT_APPROVED
```

Para una preview tecnica puede declararse explicitamente:

```text
ALLOW_DEV_STRUCTURAL_DATASET=true
```

Ese override permite validar infraestructura, pero no debe usarse como estado
productivo legal aprobado.

Las rutas `/change-proposals` y la porcion `proposals` de `/search` pueden
servirse desde fixture manual para no bloquear el MVP de UX por falta de pipeline
definitivo.
