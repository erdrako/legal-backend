# API inicial

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
```

## Conceptos

```http
GET /legal-concepts/:id
```

## Busqueda

```http
GET /search?q=
```

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

