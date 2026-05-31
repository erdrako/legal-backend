const fixtureSource = {
  id: "fixture-reforma-laboral-mvp",
  name: "Fixture manual LexMapa",
  sourceUrl: "https://lexmapa.linqorait.com",
  retrievedAt: "2026-05-31T00:00:00.000Z",
  official: false
};

function version(id, label, legalItemTitle, provisionLabel, text, status) {
  return {
    id,
    label,
    legalItemTitle,
    provisionLabel,
    text,
    status,
    source: fixtureSource
  };
}

function diff(id, title, changeType, affectedTopicIds, affectedGroupIds, currentText, proposedText, explanationPlainLanguage, practicalImpact, impactLevel) {
  return {
    id,
    proposalId: "reforma-laboral-mvp-2026",
    title,
    changeType,
    affectedTopicIds,
    affectedGroupIds,
    currentVersion: version(
      `${id}-actual`,
      "Texto actual",
      "Regimen laboral vigente - ejemplo",
      "Articulo o regla actual de ejemplo",
      currentText,
      "VIGENTE"
    ),
    proposedVersion: version(
      `${id}-propuesto`,
      "Texto propuesto",
      "Reforma laboral - ejemplo",
      "Articulo o regla propuesta de ejemplo",
      proposedText,
      "PROPOSED"
    ),
    explanationPlainLanguage,
    practicalImpact,
    impactLevel,
    source: fixtureSource,
    dataStatus: "MANUAL_FIXTURE",
    traceability: {
      notes: "Texto ficticio/acotado para validar la experiencia de comparacion."
    }
  };
}

export const changeProposalBundle = {
  schemaVersion: "0.1.0",
  generatedAt: "2026-05-31T00:00:00.000Z",
  proposals: [
    {
      id: "reforma-laboral-mvp-2026",
      title: "Reforma laboral - ejemplo acotado para MVP",
      status: "IN_DEBATE",
      jurisdiction: {
        country: "AR",
        level: "NATIONAL"
      },
      summary: {
        headline: "Que cambia con la reforma laboral",
        short:
          "Comparacion manual y acotada para probar LexMapa como un Git diff de leyes explicado en lenguaje simple.",
        keyPoints: [
          "Extiende el periodo inicial de prueba.",
          "Permite discutir un sistema alternativo para indemnizaciones.",
          "Cambia el tratamiento de multas por registracion laboral.",
          "Agrega un esquema de banco de horas.",
          "Incorpora una figura de colaboradores independientes para casos pequenos."
        ],
        whatItMeans: [
          "La pantalla muestra texto actual y texto propuesto lado a lado.",
          "Cada cambio explica que cambia y que significa en la practica.",
          "La fuente, el estado y el alcance del dato quedan visibles."
        ],
        limitations: [
          "Fixture manual de desarrollo.",
          "No cubre una reforma real completa.",
          "Debe revisarse juridicamente antes de usarse como dato productivo."
        ],
        legalAdviceWarning:
          "LexMapa explica cambios legales en lenguaje simple, pero no brinda asesoramiento legal personalizado."
      },
      topics: [
        {
          id: "periodo-de-prueba",
          label: "Periodo de prueba",
          summaryPlainLanguage: "Tiempo inicial de una relacion laboral con reglas de salida mas flexibles."
        },
        {
          id: "indemnizaciones",
          label: "Indemnizaciones",
          summaryPlainLanguage: "Forma de calcular o reemplazar el pago ante un despido sin causa."
        },
        {
          id: "registracion-laboral",
          label: "Registracion laboral",
          summaryPlainLanguage: "Reglas y consecuencias cuando una relacion laboral no esta registrada correctamente."
        },
        {
          id: "jornada-y-horas",
          label: "Jornada y horas",
          summaryPlainLanguage: "Organizacion del tiempo de trabajo y compensacion de horas."
        },
        {
          id: "colaboradores-independientes",
          label: "Colaboradores independientes",
          summaryPlainLanguage: "Supuestos en los que una persona trabaja como independiente y no como empleado."
        }
      ],
      affectedGroups: [
        {
          id: "trabajadores",
          label: "Trabajadores",
          impactSummary: "Podrian ver cambios en estabilidad inicial, indemnizacion y organizacion de horas."
        },
        {
          id: "empleadores",
          label: "Empleadores",
          impactSummary: "Podrian tener mas opciones de contratacion, salida y organizacion del trabajo."
        },
        {
          id: "pymes",
          label: "PyMEs",
          impactSummary: "Podrian usar reglas simplificadas, aunque con alcance sujeto a regulacion."
        },
        {
          id: "trabajadores-independientes",
          label: "Trabajadores independientes",
          impactSummary:
            "Podrian quedar alcanzados por nuevas figuras contractuales si se cumplen ciertos requisitos."
        }
      ],
      diffs: [
        diff(
          "rl-mvp-periodo-prueba",
          "Periodo de prueba mas largo",
          "MODIFIED",
          ["periodo-de-prueba"],
          ["trabajadores", "empleadores", "pymes"],
          "El contrato por tiempo indeterminado se entiende celebrado a prueba durante los primeros tres meses. Durante ese plazo cualquiera de las partes puede extinguir la relacion sin expresar causa.",
          "El contrato por tiempo indeterminado se entiende celebrado a prueba durante los primeros seis meses. Por convenio colectivo podra ampliarse para ciertos empleadores dentro de los limites que fije la reglamentacion.",
          "El tiempo inicial de prueba pasaria de tres a seis meses y podria ampliarse en algunos casos definidos por convenio.",
          "Para un trabajador, significa mas tiempo antes de llegar a una estabilidad plena. Para un empleador, significa mas margen para evaluar la relacion laboral.",
          "HIGH"
        ),
        diff(
          "rl-mvp-indemnizacion",
          "Sistema alternativo para indemnizaciones",
          "MODIFIED",
          ["indemnizaciones"],
          ["trabajadores", "empleadores"],
          "Ante un despido sin causa, el empleador debe abonar una indemnizacion calculada sobre la mejor remuneracion mensual y la antiguedad del trabajador.",
          "Mediante convenio colectivo podra sustituirse el regimen indemnizatorio por un fondo o sistema de cese laboral, con aportes y condiciones definidos para la actividad.",
          "La reforma abre la puerta a reemplazar la indemnizacion tradicional por un sistema acordado por actividad.",
          "El impacto real dependeria del convenio y de como se financie el fondo. Puede cambiar cuanto se cobra, cuando se cobra y quien aporta.",
          "HIGH"
        ),
        diff(
          "rl-mvp-registracion",
          "Cambio en multas por registracion",
          "MODIFIED",
          ["registracion-laboral"],
          ["trabajadores", "empleadores", "pymes"],
          "La falta de registracion o la registracion deficiente genera multas a favor del trabajador, sin perjuicio de otros creditos laborales.",
          "La autoridad podra establecer un plazo de regularizacion. Cumplido ese plazo, las sanciones se aplicaran conforme al nuevo regimen simplificado.",
          "Se reemplaza un esquema centrado en multas por otro que prioriza regularizar primero y sancionar despues bajo reglas nuevas.",
          "Puede facilitar la regularizacion para empleadores, pero tambien modificar los incentivos y reclamos disponibles para trabajadores.",
          "MEDIUM"
        ),
        diff(
          "rl-mvp-banco-horas",
          "Banco de horas",
          "ADDED",
          ["jornada-y-horas"],
          ["trabajadores", "empleadores"],
          "No hay una regla general equivalente en este fixture para compensar horas bajo un banco de horas.",
          "Los convenios colectivos podran prever bancos de horas para compensar excesos o reducciones de jornada dentro de un periodo determinado.",
          "Se agrega una herramienta para mover horas entre dias o semanas, siempre que exista una regla colectiva que lo permita.",
          "Puede dar flexibilidad operativa, pero hace mas importante mirar el convenio aplicable y el periodo de compensacion.",
          "MEDIUM"
        ),
        diff(
          "rl-mvp-colaboradores",
          "Colaboradores independientes",
          "ADDED",
          ["colaboradores-independientes"],
          ["pymes", "trabajadores-independientes"],
          "Este fixture no contiene una figura general de colaboradores independientes para pequenos emprendimientos.",
          "Los pequenos emprendimientos podran contratar hasta un numero limitado de colaboradores independientes, siempre que no exista relacion de dependencia encubierta.",
          "Se crea una categoria nueva para ciertos trabajos independientes en emprendimientos chicos.",
          "Puede abrir una via de contratacion mas simple, pero tambien requiere controlar que no se use para ocultar una relacion laboral real.",
          "MEDIUM"
        )
      ],
      queryExamples: [
        "que cambia con la reforma laboral",
        "que cambia para los trabajadores",
        "que pasa con las indemnizaciones",
        "que cambia en el periodo de prueba",
        "que cambia para las pymes"
      ],
      source: fixtureSource,
      dataStatus: "MANUAL_FIXTURE",
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:00:00.000Z",
      scopeNote: "MVP de experiencia. Usa textos ficticios/acotados para demostrar comparacion legal y trazabilidad.",
      legalAdviceWarning:
        "LexMapa no brinda asesoramiento legal personalizado. Verifique siempre la fuente legal aplicable."
    }
  ]
};
