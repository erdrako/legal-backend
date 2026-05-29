# LexMapa Backend

Repositorio publico para la API de consulta de LexMapa.

## Responsabilidad

`legal-backend` expone datos legales aprobados al frontend y a consumidores autorizados.

Puede:

- Buscar items legales.
- Consultar fichas.
- Consultar disposiciones.
- Consultar relaciones.
- Consultar timeline.
- Consultar semantic diff.
- Consultar freshness.
- Exponer conceptos legales aprobados.

No puede:

- Hacer scraping en requests de usuario.
- Leer datos raw o candidate como verdad final.
- Aprobar datos.
- Reemplazar a `legal-datavalidation`.
- Ocultar estado de confianza o revision.

## Documentacion

- [Arquitectura](./docs/ARCHITECTURE.md)
- [API inicial](./docs/API.md)
- [Modelo de lectura](./docs/READ_MODELS.md)

## Principio de producto

El backend debe responder rapido con datos aprobados y estado de actualizacion. Si un dato esta desactualizado o pendiente de validacion, debe informarlo de forma explicita.

