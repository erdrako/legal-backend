# Integracion con legal-contracts

## Rol de este repositorio

`legal-backend` consume approved bundles y expone APIs compatibles con OpenAPI.

Contratos de referencia:

```text
legal-contracts/schemas/approved-bundle.schema.json
legal-contracts/fixtures/approved-bundle.example.json
legal-contracts/openapi/backend.v1.yaml
```

## Entrada

El backend debe leer:

- Approved data.
- Read models derivados de approved data.
- Freshness generado por `legal-datavalidation`.

## Prohibido

El backend no debe leer candidate bundles como dato final.

Si necesita mostrar que hay informacion pendiente, debe hacerlo como estado de freshness o pending validation, no como afirmacion aprobada.

## API

Las respuestas publicas deben alinearse con los DTOs definidos en `legal-contracts`.

La primera superficie estable es:

```text
GET /legal-items
GET /legal-items/:id/overview
GET /legal-items/:id/freshness
GET /search?q=
```

## Regla de trazabilidad

Toda respuesta interpretada debe permitir navegar hacia:

- Cita.
- Fuente.
- Estado de revision.
- Confianza.
- Fecha de validacion.

