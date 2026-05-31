const importedAt = "2026-05-31T13:00:00.000Z";
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
  },
  deputiesAgenda: {
    id: "diputados-agenda-2026-06-03",
    name: "Agenda oficial Diputados",
    sourceUrl: "https://www.diputados.gob.ar/comisiones/agenda/",
    retrievedAt: importedAt,
    official: true
  }
};

function pendingOriginalSource(label) {
  return {
    status: "PENDING",
    label,
    note: pendingSourceText
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
  chamber,
  statusLabelForUsers,
  scheduledTreatmentDate,
  committees,
  officialDescription,
  plainLanguageSummary,
  topics,
  affectedGroups,
  source,
  sourceLinks,
  priority,
  queryExamples
}) {
  return {
    id,
    title,
    status: "IN_DEBATE",
    jurisdiction: {
      country: "AR",
      level: "NATIONAL"
    },
    chamber,
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
        "Figura en una agenda oficial de comisiones del Congreso argentino.",
        "LexMapa muestra este item como cambio en debate con fuente trazable.",
        "La comparacion articulo por articulo todavia no esta cargada."
      ],
      whatItMeans: [
        "El tema esta proximo a tratarse o revisarse en comision.",
        "Hasta cargar los textos originales, no se muestran diffs legales inventados."
      ],
      limitations: [
        "Dato importado manualmente desde agenda oficial.",
        "Texto propuesto original pendiente de carga.",
        "No hay diff legal articulo por articulo cargado."
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
    sourceStatus: "LOADED",
    priority,
    dataKind: "REAL_AGENDA_ITEM",
    importedFrom: sourceLinks.officialAgendaSourceUrl,
    importedAt,
    lastCheckedAt: importedAt,
    originalSources: {
      current: pendingOriginalSource("Texto vigente original"),
      proposed: pendingOriginalSource("Texto propuesto original")
    },
    dataStatus: "REAL_AGENDA_ITEM",
    createdAt: importedAt,
    updatedAt: importedAt,
    scopeNote: "Dato real de agenda oficial. No incluye todavia texto del proyecto ni comparacion juridica.",
    legalAdviceWarning:
      "LexMapa no brinda asesoramiento legal personalizado. Verifique siempre la fuente legal aplicable."
  };
}

export const changeProposalBundle = {
  schemaVersion: "0.1.0",
  generatedAt: importedAt,
  proposals: [
    agendaItem({
      id: "ley-hojarasca",
      title: "Ley Hojarasca",
      chamber: "SENATE",
      statusLabelForUsers: "En tratamiento en comision",
      scheduledTreatmentDate: "2026-06-03T12:30:00-03:00",
      committees: ["Asuntos Constitucionales", "Legislacion General"],
      officialDescription: "Proyecto de ley en revision que deroga legislacion obsoleta \"Ley de Hojarasca\".",
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
        officialAgendaSourceUrl: "https://www.senado.gob.ar/parlamentario/comisiones/verAgenda/50"
      },
      priority: "HIGH",
      queryExamples: ["hojarasca", "ley hojarasca", "legislacion obsoleta", "derogaciones"]
    }),
    agendaItem({
      id: "super-rigi",
      title: "Super RIGI",
      chamber: "DEPUTIES",
      statusLabelForUsers: "En tratamiento en comision",
      scheduledTreatmentDate: "2026-06-03T15:00:00-03:00",
      committees: ["Presupuesto y Hacienda", "Industria", "Ciencia, Tecnologia e Innovacion Productiva"],
      officialDescription: "Mensaje nro. 181/2026 y proyecto de ley por el cual se establece un regimen de incentivo para grandes inversiones en nuevas industrias (\"SUPER RIGI\").",
      plainLanguageSummary: "Proyecto que propone beneficios e incentivos para grandes inversiones en nuevas industrias.",
      topics: [
        topic("inversiones", "Inversiones", "Reglas que buscan atraer o regular inversiones de gran escala."),
        topic("industria", "Industria", "Actividades productivas y nuevas industrias."),
        topic("tecnologia", "Tecnologia", "Sectores tecnologicos o de innovacion productiva."),
        topic("beneficios-fiscales", "Beneficios fiscales", "Posibles ventajas tributarias o economicas previstas por el regimen."),
        topic("estabilidad-normativa", "Estabilidad normativa", "Reglas que podrian mantener condiciones legales durante cierto plazo.")
      ],
      affectedGroups: [
        group("empresas", "Empresas", "Podrian evaluar nuevos incentivos para proyectos de inversion."),
        group("inversores", "Inversores", "Podrian recibir condiciones especiales si el proyecto avanza."),
        group("estado", "Estado", "Podria asumir compromisos fiscales o regulatorios vinculados a inversiones."),
        group("trabajadores", "Trabajadores", "Podrian verse afectados indirectamente por proyectos industriales o tecnologicos."),
        group("provincias", "Provincias", "Podrian intervenir segun la localizacion de proyectos.")
      ],
      source: sources.deputiesAgenda,
      sourceLinks: {
        officialAgendaSourceUrl: "https://www.diputados.gob.ar/comisiones/agenda/",
        officialCitationUrl: "https://parlamentaria.hcdn.gob.ar/comisiones/reuniones/1219/archivo/SXDQ9KZANPP5QTHY.pdf"
      },
      priority: "HIGH",
      queryExamples: ["super rigi", "rigi", "grandes inversiones", "incentivos industriales"]
    }),
    agendaItem({
      id: "transparencia-gestion-intereses",
      title: "Regimen de transparencia y publicidad de la gestion de intereses",
      chamber: "DEPUTIES",
      statusLabelForUsers: "En tratamiento en comision / reunion informativa",
      scheduledTreatmentDate: "2026-06-03T14:00:00-03:00",
      committees: ["Asuntos Constitucionales", "Legislacion General"],
      officialDescription: "Regimen de transparencia y publicidad de la gestion de intereses.",
      plainLanguageSummary: "Proyecto para regular y transparentar la gestion de intereses ante funcionarios o autoridades publicas.",
      topics: [
        topic("transparencia", "Transparencia", "Reglas para hacer visible informacion de interes publico."),
        topic("lobby", "Lobby", "Gestiones de intereses ante funcionarios o autoridades."),
        topic("etica-publica", "Etica publica", "Estandares de conducta y publicidad en la funcion publica."),
        topic("acceso-informacion", "Acceso a informacion", "Disponibilidad de datos sobre gestiones o decisiones publicas.")
      ],
      affectedGroups: [
        group("ciudadanos", "Ciudadanos", "Podrian acceder a mas informacion sobre gestiones ante autoridades."),
        group("funcionarios", "Funcionarios", "Podrian tener nuevas obligaciones de registro o publicidad."),
        group("empresas", "Empresas", "Podrian tener reglas mas claras para gestiones de interes."),
        group("organizaciones-civiles", "Organizaciones civiles", "Podrian quedar comprendidas si realizan gestiones ante autoridades.")
      ],
      source: sources.deputiesAgenda,
      sourceLinks: {
        officialAgendaSourceUrl: "https://www.diputados.gob.ar/comisiones/agenda/",
        officialCitationUrl: "https://parlamentaria.hcdn.gob.ar/comisiones/reuniones/1218/archivo/NXJK7ZVD9M8CC6PJ.pdf"
      },
      priority: "HIGH",
      queryExamples: ["lobby", "transparencia", "gestion de intereses", "etica publica"]
    }),
    agendaItem({
      id: "biocombustibles",
      title: "Biocombustibles",
      chamber: "SENATE",
      statusLabelForUsers: "En tratamiento en comision",
      scheduledTreatmentDate: "2026-06-03T14:00:00-03:00",
      committees: ["Mineria, Energia y Combustibles", "Presupuesto y Hacienda"],
      officialDescription: "Proyectos S-1271/25, S-1861/25, S-3/26, S-809/26 y S-916/26 sobre modificacion o regulacion del regimen de biocombustibles.",
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
        officialAgendaSourceUrl: "https://www.senado.gob.ar/parlamentario/comisiones/verAgenda/54"
      },
      priority: "MEDIUM_HIGH",
      queryExamples: ["biocombustibles", "biodiesel", "bioetanol", "combustibles", "corte obligatorio"]
    }),
    agendaItem({
      id: "convenios-seguridad-social-suiza-san-marino",
      title: "Convenios de Seguridad Social con Suiza y San Marino",
      chamber: "DEPUTIES",
      statusLabelForUsers: "En tratamiento en comision",
      scheduledTreatmentDate: "2026-06-03T12:00:00-03:00",
      committees: ["Relaciones Exteriores y Culto", "Prevision y Seguridad Social"],
      officialDescription: "Proyectos que aprueban convenios de Seguridad Social entre Argentina y Suiza, y entre Argentina y San Marino, junto con sus acuerdos administrativos.",
      plainLanguageSummary: "Proyectos para coordinar reglas de seguridad social, aportes y beneficios entre Argentina y esos paises.",
      topics: [
        topic("jubilaciones", "Jubilaciones", "Beneficios previsionales y reglas para acceder a ellos."),
        topic("aportes", "Aportes", "Contribuciones o periodos que pueden computarse para seguridad social."),
        topic("seguridad-social", "Seguridad social", "Sistema de beneficios, aportes y cobertura social."),
        topic("trabajadores-migrantes", "Trabajadores migrantes", "Personas que trabajan o trabajaron en mas de un pais.")
      ],
      affectedGroups: [
        group("trabajadores-argentinos-exterior", "Trabajadores argentinos en el exterior", "Podrian necesitar coordinar aportes o beneficios con Argentina."),
        group("extranjeros-en-argentina", "Extranjeros en Argentina", "Podrian quedar alcanzados por reglas de coordinacion previsional."),
        group("jubilados", "Jubilados", "Podrian verse afectados por reconocimiento o coordinacion de beneficios."),
        group("aportantes", "Aportantes", "Podrian requerir informacion sobre periodos aportados en distintos paises.")
      ],
      source: sources.deputiesAgenda,
      sourceLinks: {
        officialAgendaSourceUrl: "https://www.diputados.gob.ar/comisiones/agenda/",
        officialCitationUrl: "https://parlamentaria.hcdn.gob.ar/comisiones/reuniones/1216/archivo/VXHSC47J9SJQDPRF.pdf"
      },
      priority: "MEDIUM",
      queryExamples: ["seguridad social", "Suiza", "San Marino", "jubilaciones", "aportes"]
    }),
    agendaItem({
      id: "convenio-argentina-francia-doble-imposicion",
      title: "Convenio Argentina-Francia sobre doble imposicion",
      chamber: "DEPUTIES",
      statusLabelForUsers: "En tratamiento en comision",
      scheduledTreatmentDate: "2026-06-03T10:00:00-03:00",
      committees: ["Relaciones Exteriores y Culto", "Presupuesto y Hacienda"],
      officialDescription: "Proyecto de ley por el cual se aprueba el Protocolo de enmienda al Convenio entre Argentina y Francia para evitar la doble imposicion y prevenir la evasion fiscal en materia de impuestos sobre la renta y el patrimonio.",
      plainLanguageSummary: "Proyecto para actualizar reglas tributarias entre Argentina y Francia y evitar que ciertos ingresos o patrimonios tributen dos veces.",
      topics: [
        topic("impuestos", "Impuestos", "Reglas sobre tributos aplicables a renta o patrimonio."),
        topic("inversiones", "Inversiones", "Operaciones economicas entre Argentina y Francia."),
        topic("tratados-internacionales", "Tratados internacionales", "Acuerdos entre Estados que requieren aprobacion legislativa."),
        topic("evasion-fiscal", "Evasion fiscal", "Reglas para prevenir incumplimientos tributarios.")
      ],
      affectedGroups: [
        group("empresas", "Empresas", "Podrian revisar reglas fiscales para operaciones entre ambos paises."),
        group("inversores", "Inversores", "Podrian verse alcanzados por reglas para evitar doble tributacion."),
        group("personas-actividad-argentina-francia", "Personas con actividad economica entre Argentina y Francia", "Podrian necesitar revisar si el convenio modifica su situacion fiscal.")
      ],
      source: sources.deputiesAgenda,
      sourceLinks: {
        officialAgendaSourceUrl: "https://www.diputados.gob.ar/comisiones/agenda/",
        officialCitationUrl: "https://parlamentaria.hcdn.gob.ar/comisiones/reuniones/1215/archivo/PVN7M7QAVY7MX067.pdf"
      },
      priority: "MEDIUM",
      queryExamples: ["doble imposicion", "Francia", "impuestos", "tratado tributario"]
    }),
    agendaItem({
      id: "acuerdo-pesca-ilegal",
      title: "Acuerdo contra pesca ilegal",
      chamber: "DEPUTIES",
      statusLabelForUsers: "En tratamiento en comision",
      scheduledTreatmentDate: "2026-06-03T11:00:00-03:00",
      committees: ["Relaciones Exteriores y Culto", "Intereses Maritimos, Fluviales, Pesqueros y Portuarios"],
      officialDescription: "Proyecto de ley por el cual se aprueba el Acuerdo sobre medidas del Estado Rector del Puerto destinadas a prevenir, desalentar y eliminar la pesca ilegal, no declarada y no reglamentada, celebrado en Roma el 22 de noviembre de 2009 en el marco de la FAO.",
      plainLanguageSummary: "Proyecto para aprobar un acuerdo internacional orientado a combatir la pesca ilegal.",
      topics: [
        topic("pesca", "Pesca", "Actividad pesquera y control de recursos maritimos."),
        topic("ambiente", "Ambiente", "Proteccion de recursos naturales y ecosistemas."),
        topic("comercio-exterior", "Comercio exterior", "Reglas sobre ingreso, salida o control de productos."),
        topic("puertos", "Puertos", "Controles y medidas vinculadas al Estado rector del puerto.")
      ],
      affectedGroups: [
        group("sector-pesquero", "Sector pesquero", "Podria quedar alcanzado por controles o medidas portuarias."),
        group("puertos", "Puertos", "Podrian tener nuevas responsabilidades de control."),
        group("estado", "Estado", "Podria asumir obligaciones de control internacional."),
        group("ambiente", "Ambiente", "Podria verse protegido frente a practicas ilegales de pesca.")
      ],
      source: sources.deputiesAgenda,
      sourceLinks: {
        officialAgendaSourceUrl: "https://www.diputados.gob.ar/comisiones/agenda/",
        officialCitationUrl: "https://parlamentaria.hcdn.gob.ar/comisiones/reuniones/1214/archivo/MQEWR88X1SV5XNWQ.pdf"
      },
      priority: "MEDIUM_LOW",
      queryExamples: ["pesca ilegal", "pesca", "FAO", "puertos"]
    }),
    agendaItem({
      id: "parque-marino-monte-leon",
      title: "Parque Interjurisdiccional Marino Monte Leon",
      chamber: "SENATE",
      statusLabelForUsers: "En reunion de asesores",
      scheduledTreatmentDate: "2026-06-02T12:30:00-03:00",
      committees: ["Asuntos Constitucionales", "Ambiente y Desarrollo Sustentable"],
      officialDescription: "Proyecto de ley que aprueba el convenio de creacion del Parque Interjurisdiccional Marino Monte Leon entre el Estado Nacional y la Provincia de Santa Cruz.",
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
        officialAgendaSourceUrl: "https://www.senado.gob.ar/parlamentario/comisiones/verAgenda/50"
      },
      priority: "MEDIUM_LOW",
      queryExamples: ["Monte Leon", "parque marino", "Santa Cruz", "areas protegidas"]
    })
  ]
};
