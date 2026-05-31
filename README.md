# LexMapa Backend

Repositorio publico para la API de consulta de LexMapa.

## Responsabilidad

`legal-backend` expone propuestas de cambio legal en debate, diffs explicables cuando estan cargados y datos legales aprobados al frontend.

Puede:

- Buscar propuestas o reformas en lenguaje simple.
- Indicar que diffs, temas o grupos coinciden con una pregunta simple.
- Consultar una propuesta de cambio legal.
- Consultar diffs texto actual vs texto propuesto cuando existen.
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
- [Integracion con contratos](./docs/CONTRACT_INTEGRATION.md)

## Principio de producto

El backend debe responder rapido con comparaciones comprensibles y trazables. Si un dato esta desactualizado, es fixture o esta pendiente de validacion, debe informarlo de forma explicita.

## MVP actual

Endpoints disponibles para la primera experiencia de comparacion legal:

```http
GET /change-proposals
GET /change-proposals/:id
GET /change-proposals/:id/diffs
GET /search?q=
```

El fixture actual importa manualmente 8 items reales de agendas oficiales de
Senado y Diputados con `dataKind = REAL_AGENDA_ITEM`.

Los items se muestran como `Cambios en debate` y no inventan comparaciones
articulo por articulo: `/change-proposals/:id/diffs` devuelve una lista vacia
hasta que se carguen los textos originales.

La busqueda devuelve metadatos de coincidencia para que el frontend pueda
orientar preguntas como `hojarasca`, `super rigi`, `transparencia`,
`biocombustibles`, `pesca ilegal`, `seguridad social` o `doble imposicion`.
