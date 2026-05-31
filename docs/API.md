# API inicial

## Propuestas de cambio legal

La experiencia principal del MVP consulta propuestas o reformas y sus diffs:

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
- diffs texto actual vs texto propuesto;
- fuente, estado del dato, alcance y advertencia.

`GET /change-proposals/:id/diffs` devuelve solo los cambios de esa propuesta.

Fixture actual:

```text
reforma-laboral-mvp-2026
```

El fixture es manual y acotado. No debe presentarse como dato legal productivo.

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

En Worker, si D1 contiene un dataset bloqueado para lectura publica, la busqueda
mantiene `proposals` disponible y devuelve `items = []` con `itemsUnavailable`.

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
