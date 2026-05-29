# Arquitectura del backend

## Objetivo

Exponer datos aprobados mediante APIs estables.

## Componentes esperados

```text
api/
  routes/
  controllers/
application/
  use-cases/
domain/
  read-models/
infrastructure/
  repositories/
  auth/
```

## Fuente de datos

El backend debe leer:

- Approved data.
- Read models.
- Estado de freshness producido por `legal-datavalidation`.

No debe leer:

- Raw data.
- Parsed data.
- Candidate data sin aprobar.

## Regla de actualizacion

El backend puede solicitar un refresh asincronico, pero no debe bloquear la respuesta del usuario esperando scraping o validacion.

