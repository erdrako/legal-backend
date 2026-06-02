const importedAt = "2026-06-02T04:40:38.086Z";
const pendingSourceText = "Fuente original pendiente de carga";

const sources = {
  senateConstitutional: {
    id: "senado-asuntos-constitucionales-agenda-2026-06",
    name: "Agenda oficial Senado - Asuntos Constitucionales",
    sourceUrl: "https://www.senado.gob.ar/parlamentario/comisiones/verAgenda/50",
    retrievedAt: importedAt,
    official: true
  },
  senateBudget: {
    id: "senado-presupuesto-agenda-2026-06",
    name: "Agenda oficial Senado - Presupuesto y Hacienda",
    sourceUrl: "https://www.senado.gob.ar/parlamentario/comisiones/verAgenda/54",
    retrievedAt: importedAt,
    official: true
  }
};

function pendingOriginalSource(label, note = pendingSourceText) {
  return {
    status: "PENDING",
    label,
    note
  };
}

function loadedOriginalSource({ label, name, sourceUrl }) {
  return {
    status: "LOADED",
    label,
    name,
    sourceUrl
  };
}

function topic(id, label, summaryPlainLanguage) {
  return { id, label, summaryPlainLanguage };
}

function group(id, label, impactSummary) {
  return { id, label, impactSummary };
}

function agendaItem({
  id,
  title,
  statusLabelForUsers,
  scheduledTreatmentDate,
  committees,
  officialDescription,
  plainLanguageSummary,
  topics,
  affectedGroups,
  source,
  sourceLinks,
  sourceStatus,
  originalSources,
  priority,
  queryExamples,
  limitations = []
}) {
  return {
    id,
    title,
    status: "IN_DEBATE",
    jurisdiction: {
      country: "AR",
      level: "NATIONAL"
    },
    chamber: "SENATE",
    statusLabelForUsers,
    scheduledTreatmentDate,
    committees,
    officialDescription,
    plainLanguageSummary,
    typeOfChange: "Proyecto en agenda oficial",
    summary: {
      headline: title,
      short: plainLanguageSummary,
      keyPoints: [
        "Figura en una agenda oficial de comisiones del Senado argentino.",
        "LexMapa muestra este item como cambio en debate con fuente trazable.",
        "La comparacion articulo por articulo todavia no esta cargada."
      ],
      whatItMeans: [
        "El tema esta proximo a tratarse o revisarse en comision.",
        "Hasta cargar y revisar los textos, no se muestran diffs legales inventados."
      ],
      limitations: [
        "Dato importado por Worker deterministico desde agenda oficial.",
        "Texto legal pendiente de extraccion y revision para construir el diff.",
        "No hay diff legal articulo por articulo cargado.",
        ...limitations
      ],
      legalAdviceWarning:
        "LexMapa explica cambios legales en lenguaje simple, pero no brinda asesoramiento legal personalizado."
    },
    topics,
    affectedGroups,
    diffs: [],
    queryExamples,
    source,
    sourceLinks,
    sourceStatus,
    priority,
    dataKind: "REAL_AGENDA_ITEM",
    importedFrom: sourceLinks.officialAgendaSourceUrl,
    importedAt,
    lastCheckedAt: importedAt,
    originalSources,
    dataStatus: "REAL_AGENDA_ITEM",
    createdAt: importedAt,
    updatedAt: importedAt,
    scopeNote: "Dato real de agenda oficial del Senado. No incluye todavia comparacion juridica validada.",
    legalAdviceWarning:
      "LexMapa no brinda asesoramiento legal personalizado. Verifique siempre la fuente legal aplicable."
  };
}

const biocombustiblesProposedTexts = [
  {
    label: "Texto propuesto original - S-1271/25",
    url: "https://www.senado.gob.ar/parlamentario/parlamentaria/489983/downloadPdf"
  },
  {
    label: "Texto propuesto original - S-1861/25",
    url: "https://www.senado.gob.ar/parlamentario/parlamentaria/492357/downloadPdf"
  },
  {
    label: "Texto propuesto original - S-3/26",
    url: "https://www.senado.gob.ar/parlamentario/parlamentaria/493972/downloadPdf"
  },
  {
    label: "Texto propuesto original - S-809/26",
    url: "https://www.senado.gob.ar/parlamentario/parlamentaria/496663/downloadPdf"
  },
  {
    label: "Texto propuesto original - S-916/26",
    url: "https://www.senado.gob.ar/parlamentario/parlamentaria/496763/downloadPdf"
  }
];

export const changeProposalBundle = {
  schemaVersion: "0.1.0",
  generatedAt: importedAt,
  proposals: [
    agendaItem({
      id: "ley-hojarasca",
      title: "Ley Hojarasca",
      statusLabelForUsers: "En tratamiento en comision",
      scheduledTreatmentDate: "2026-06-03T12:30:00-03:00",
      committees: ["Asuntos Constitucionales", "Legislacion General"],
      officialDescription: "Proyecto de ley en revision que deroga legislacion obsoleta \"Ley de Hojarasca\". Expediente CD-1/26.",
      plainLanguageSummary: "Proyecto que propone derogar leyes consideradas obsoletas o sin aplicacion actual.",
      topics: [
        topic("legislacion-obsoleta", "Legislacion obsoleta", "Normas que podrian dejar de tener utilidad practica o vigencia material."),
        topic("derogaciones", "Derogaciones", "Cambios que eliminan normas anteriores."),
        topic("administracion-publica", "Administracion publica", "Organismos estatales que aplican o dejan de aplicar reglas."),
        topic("simplificacion-normativa", "Simplificacion normativa", "Intentos de ordenar o reducir reglas legales acumuladas.")
      ],
      affectedGroups: [
        group("ciudadanos", "Ciudadanos", "Podrian verse alcanzados si alguna norma derogada regulaba tramites, derechos u obligaciones."),
        group("administracion-publica", "Administracion publica", "Podria tener menos normas formales que revisar o aplicar."),
        group("sectores-regulados", "Sectores regulados", "Sectores alcanzados por normas derogadas podrian necesitar revisar el alcance real del cambio.")
      ],
      source: sources.senateConstitutional,
      sourceLinks: {
        officialAgendaSourceUrl: "https://www.senado.gob.ar/parlamentario/comisiones/verAgenda/50",
        officialCitationUrl: "https://www.senado.gob.ar/parlamentario/comisiones/verExp/1.26/CD/PL",
        proposedTextOriginalUrl: "https://www.senado.gob.ar/parlamentario/parlamentaria/496544/downloadPdf"
      },
      sourceStatus: "NEEDS_REVIEW",
      originalSources: {
        current: pendingOriginalSource(
          "Texto vigente original",
          "El proyecto deroga multiples normas y requiere revision humana para mapear cada texto vigente."
        ),
        proposed: loadedOriginalSource({
          label: "Texto propuesto original",
          name: "PDF oficial Senado - CD-1/26",
          sourceUrl: "https://www.senado.gob.ar/parlamentario/parlamentaria/496544/downloadPdf"
        })
      },
      priority: "HIGH",
      queryExamples: ["hojarasca", "ley hojarasca", "legislacion obsoleta", "derogaciones"],
      limitations: ["El listado de normas derogadas debe revisarse antes de generar comparaciones articulo por articulo."]
    }),
    agendaItem({
      id: "biocombustibles",
      title: "Biocombustibles",
      statusLabelForUsers: "En tratamiento en comision",
      scheduledTreatmentDate: "2026-06-03T14:00:00-03:00",
      committees: ["Mineria, Energia y Combustibles", "Presupuesto y Hacienda"],
      officialDescription:
        "Proyectos S-1271/25, S-1861/25, S-3/26, S-809/26 y S-916/26 sobre modificacion o regulacion del regimen de biocombustibles.",
      plainLanguageSummary: "Distintos proyectos proponen modificar o reemplazar reglas sobre biocombustibles, porcentajes de mezcla y marco regulatorio.",
      topics: [
        topic("energia", "Energia", "Reglas vinculadas al abastecimiento y uso energetico."),
        topic("combustibles", "Combustibles", "Mezcla, produccion o comercializacion de combustibles."),
        topic("biodiesel", "Biodiesel", "Biocombustible que puede mezclarse con gasoil."),
        topic("bioetanol", "Bioetanol", "Biocombustible que puede mezclarse con nafta."),
        topic("agroindustria", "Agroindustria", "Sectores productivos vinculados a insumos y produccion de biocombustibles."),
        topic("transporte", "Transporte", "Actividad que usa combustibles y podria verse afectada por mezclas obligatorias.")
      ],
      affectedGroups: [
        group("productores", "Productores", "Podrian tener nuevas reglas de produccion, cuotas o comercializacion."),
        group("consumidores", "Consumidores", "Podrian verse afectados indirectamente en precios o disponibilidad de combustibles."),
        group("estaciones-servicio", "Estaciones de servicio", "Podrian tener cambios en reglas de venta o mezcla."),
        group("transporte", "Transporte", "Podria verse impactado por cambios en combustibles disponibles."),
        group("estado", "Estado", "Podria regular cortes, cronogramas y condiciones del mercado.")
      ],
      source: sources.senateBudget,
      sourceLinks: {
        officialAgendaSourceUrl: "https://www.senado.gob.ar/parlamentario/comisiones/verAgenda/54",
        officialCitationUrl: "https://www.senado.gob.ar/parlamentario/comisiones/verExp/1271.25/S/PL",
        currentLawOriginalUrl: "https://www.boletinoficial.gov.ar/detalleAviso/primera/247667/20210804",
        proposedTextOriginalUrl: biocombustiblesProposedTexts[0].url,
        proposedTextOriginalUrls: biocombustiblesProposedTexts
      },
      sourceStatus: "LOADED",
      originalSources: {
        current: loadedOriginalSource({
          label: "Texto vigente original",
          name: "Boletin Oficial - Ley 27.640",
          sourceUrl: "https://www.boletinoficial.gov.ar/detalleAviso/primera/247667/20210804"
        }),
        proposed: loadedOriginalSource({
          label: "Texto propuesto original",
          name: "PDF oficial Senado - S-1271/25",
          sourceUrl: biocombustiblesProposedTexts[0].url
        })
      },
      priority: "MEDIUM_HIGH",
      queryExamples: ["biocombustibles", "biodiesel", "bioetanol", "combustibles", "corte obligatorio"],
      limitations: ["Hay cinco expedientes vinculados al mismo tratamiento; el diff debe construirse expediente por expediente."]
    }),
    agendaItem({
      id: "parque-marino-monte-leon",
      title: "Parque Interjurisdiccional Marino Monte Leon",
      statusLabelForUsers: "En reunion de asesores",
      scheduledTreatmentDate: "2026-06-02T12:30:00-03:00",
      committees: ["Asuntos Constitucionales", "Ambiente y Desarrollo Sustentable"],
      officialDescription:
        "Proyecto de ley que aprueba el convenio de creacion del Parque Interjurisdiccional Marino Monte Leon entre el Estado Nacional y la Provincia de Santa Cruz. Expediente S-361/26.",
      plainLanguageSummary: "Proyecto para aprobar la creacion de un parque marino interjurisdiccional.",
      topics: [
        topic("ambiente", "Ambiente", "Proteccion ambiental y conservacion."),
        topic("areas-protegidas", "Areas protegidas", "Espacios con reglas especiales de conservacion."),
        topic("santa-cruz", "Santa Cruz", "Provincia vinculada al convenio de creacion."),
        topic("conservacion-marina", "Conservacion marina", "Proteccion de ecosistemas y biodiversidad marina.")
      ],
      affectedGroups: [
        group("ciudadanos", "Ciudadanos", "Podrian tener nuevos espacios de proteccion o uso regulado."),
        group("estado-nacional", "Estado nacional", "Podria compartir gestion o responsabilidades sobre el parque."),
        group("provincia-santa-cruz", "Provincia de Santa Cruz", "Podria intervenir en la administracion del area."),
        group("sectores-ambientales", "Sectores ambientales", "Podrian participar o monitorear la conservacion del area.")
      ],
      source: sources.senateConstitutional,
      sourceLinks: {
        officialAgendaSourceUrl: "https://www.senado.gob.ar/parlamentario/comisiones/verAgenda/50",
        officialCitationUrl: "https://www.senado.gob.ar/parlamentario/comisiones/verExp/361.26/S/PL",
        proposedTextOriginalUrl: "https://www.senado.gob.ar/parlamentario/parlamentaria/495191/downloadPdf"
      },
      sourceStatus: "NEEDS_REVIEW",
      originalSources: {
        current: pendingOriginalSource(
          "Texto vigente original",
          "El item aprueba un convenio y requiere revision humana para determinar si hay texto vigente comparable."
        ),
        proposed: loadedOriginalSource({
          label: "Texto propuesto original",
          name: "PDF oficial Senado - S-361/26",
          sourceUrl: "https://www.senado.gob.ar/parlamentario/parlamentaria/495191/downloadPdf"
        })
      },
      priority: "MEDIUM_LOW",
      queryExamples: ["Monte Leon", "parque marino", "Santa Cruz", "areas protegidas"],
      limitations: ["Puede no existir texto vigente comparable si se trata de aprobacion de convenio."]
    })
  ]
};
