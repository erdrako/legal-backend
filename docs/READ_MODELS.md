# Read models

Los read models son vistas optimizadas para consulta.

## Modelos iniciales

- `LegalItemOverview`
- `LegalItemDetail`
- `LegalProvisionList`
- `LegalRelationshipGraph`
- `LegalTimelineView`
- `SemanticDiffView`
- `ConceptDetailView`

## Regla

Los read models se construyen desde approved data, nunca desde candidate data.

## Ejemplo

```text
Approved legal data
-> read model builder
-> LegalItemOverview
-> backend API
-> frontend
```

