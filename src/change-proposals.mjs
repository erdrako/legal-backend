import { changeProposalBundle } from "./change-proposal-fixtures.mjs";

export function listProposalOverviews(bundle = changeProposalBundle) {
  return bundle.proposals.map(toProposalOverview);
}

export function getProposal(id, bundle = changeProposalBundle) {
  return bundle.proposals.find((proposal) => proposal.id === id);
}

export function getProposalDiffs(id, bundle = changeProposalBundle) {
  const proposal = getProposal(id, bundle);
  return proposal ? proposal.diffs : undefined;
}

export function searchProposalOverviews(query, bundle = changeProposalBundle) {
  const terms = queryTerms(query);
  const normalizedQuery = normalize(query);

  return bundle.proposals
    .map((proposal) => buildProposalSearchResult(proposal, normalizedQuery, terms))
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)
    .map(({ score, ...result }) => result);
}

export function toProposalOverview(proposal) {
  return {
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    chamber: proposal.chamber,
    statusLabelForUsers: proposal.statusLabelForUsers,
    scheduledTreatmentDate: proposal.scheduledTreatmentDate,
    committees: proposal.committees,
    summaryPlainLanguage: proposal.plainLanguageSummary ?? proposal.summary.short,
    affectedTopics: proposal.topics.map((topic) => topic.label),
    affectedGroups: proposal.affectedGroups.map((group) => group.label),
    diffCount: proposal.diffs.length,
    dataStatus: proposal.dataStatus,
    dataKind: proposal.dataKind,
    priority: proposal.priority,
    sourceStatus: proposal.sourceStatus,
    sourceLinks: proposal.sourceLinks,
    source: proposal.source
  };
}

function searchableProposalText(proposal) {
  return normalize(
    [
      proposal.title,
      proposal.status,
      proposal.chamber,
      proposal.statusLabelForUsers,
      proposal.officialDescription,
      proposal.plainLanguageSummary,
      proposal.committees.join(" "),
      proposal.summary.headline,
      proposal.summary.short,
      ...proposal.summary.keyPoints,
      ...proposal.summary.whatItMeans,
      ...proposal.queryExamples,
      ...proposal.topics.flatMap((topic) => [topic.label, topic.summaryPlainLanguage]),
      ...proposal.affectedGroups.flatMap((group) => [group.label, group.impactSummary]),
      ...proposal.diffs.flatMap((diff) => [
        diff.title,
        diff.changeType,
        diff.explanationPlainLanguage,
        diff.practicalImpact,
        diff.currentVersion.text,
        diff.proposedVersion.text
      ])
    ].join(" ")
  );
}

function buildProposalSearchResult(proposal, normalizedQuery, terms) {
  const proposalText = searchableProposalText(proposal);
  const matchesProposal =
    (normalizedQuery && proposalText.includes(normalizedQuery)) ||
    terms.some((term) => textIncludesTerm(proposalText, term));

  if (!matchesProposal) {
    return undefined;
  }

  const focusedTerms = terms.filter((term) => !GENERIC_PROPOSAL_TERMS.has(term));
  const topicMatches = proposal.topics.filter((topic) =>
    textMatchesTerms([topic.label, topic.summaryPlainLanguage].join(" "), focusedTerms)
  );
  const groupMatches = proposal.affectedGroups.filter((group) => textMatchesTerms(group.label, focusedTerms));
  const matchedTopicIds = topicMatches.map((topic) => topic.id);
  const matchedGroupIds = groupMatches.map((group) => group.id);
  const directDiffMatches = proposal.diffs.filter((diff) =>
    textMatchesTerms(diffSearchText(diff), focusedTerms)
  );
  const matchedDiffIds = unique([
    ...directDiffMatches.map((diff) => diff.id),
    ...proposal.diffs
      .filter((diff) => diff.affectedTopicIds.some((id) => matchedTopicIds.includes(id)))
      .map((diff) => diff.id),
    ...proposal.diffs
      .filter((diff) => diff.affectedGroupIds.some((id) => matchedGroupIds.includes(id)))
      .map((diff) => diff.id)
  ]);

  const score =
    (normalizedQuery && proposalText.includes(normalizedQuery) ? 4 : 0) +
    terms.filter((term) => textIncludesTerm(proposalText, term)).length +
    matchedDiffIds.length * 3 +
    matchedTopicIds.length * 2 +
    matchedGroupIds.length * 2;

  return {
    ...toProposalOverview(proposal),
    matchedDiffIds,
    matchedTopicIds,
    matchedGroupIds,
    matchSummary: searchMatchSummary({
      matchedDiffCount: matchedDiffIds.length,
      topicLabels: topicMatches.map((topic) => topic.label),
      groupLabels: groupMatches.map((group) => group.label)
    }),
    score
  };
}

function diffSearchText(diff) {
  return [
    diff.title,
    diff.changeType,
    diff.explanationPlainLanguage,
    diff.practicalImpact,
    diff.currentVersion.text,
    diff.proposedVersion.text
  ].join(" ");
}

function searchMatchSummary({ matchedDiffCount, topicLabels, groupLabels }) {
  if (matchedDiffCount === 0 && topicLabels.length > 0 && groupLabels.length > 0) {
    return `Encontramos un proyecto en debate sobre ${joinLabels(topicLabels)} que puede impactar a ${joinLabels(groupLabels)}.`;
  }

  if (matchedDiffCount === 0 && topicLabels.length > 0) {
    return `Encontramos un proyecto en debate sobre ${joinLabels(topicLabels)}.`;
  }

  if (matchedDiffCount === 0 && groupLabels.length > 0) {
    return `Encontramos un proyecto en debate que puede impactar a ${joinLabels(groupLabels)}.`;
  }

  if (topicLabels.length > 0 && groupLabels.length > 0) {
    return `Encontramos ${formatCount(matchedDiffCount, "cambio")} ${matchedDiffCount === 1 ? "relacionado" : "relacionados"} con ${joinLabels(topicLabels)} y con ${joinLabels(groupLabels)}.`;
  }

  if (topicLabels.length > 0) {
    return `Encontramos ${formatCount(matchedDiffCount, "cambio")} sobre ${joinLabels(topicLabels)}.`;
  }

  if (groupLabels.length > 0) {
    return `Encontramos ${formatCount(matchedDiffCount, "cambio")} que ${matchedDiffCount === 1 ? "impacta" : "impactan"} a ${joinLabels(groupLabels)}.`;
  }

  if (matchedDiffCount > 0) {
    return `Encontramos ${formatCount(matchedDiffCount, "cambio")} directamente relacionado con tu busqueda.`;
  }

  return "Encontramos una propuesta relacionada con tu busqueda. Revisa el resumen y las fuentes originales.";
}

function formatCount(count, singular) {
  if (count === 1) {
    return `1 ${singular}`;
  }

  return `${count} ${singular}s`;
}

function joinLabels(labels) {
  if (labels.length <= 1) {
    return labels[0] ?? "";
  }

  return `${labels.slice(0, -1).join(", ")} y ${labels.at(-1)}`;
}

function textMatchesTerms(text, terms) {
  const normalizedText = normalize(text);
  return terms.some((term) => textIncludesTerm(normalizedText, term));
}

function textIncludesTerm(normalizedText, term) {
  return termVariants(term).some((variant) => normalizedText.includes(variant));
}

function queryTerms(query) {
  return unique(
    normalize(query)
      .split(/[^a-z0-9]+/g)
      .map((term) => term.trim())
      .filter((term) => term.length > 2 && !STOP_WORDS.has(term))
  );
}

function termVariants(term) {
  const variants = [term];

  if (term.endsWith("ciones") && term.length > 8) {
    variants.push(`${term.slice(0, -6)}cion`);
  }

  if (term.endsWith("es") && term.length > 5) {
    variants.push(term.slice(0, -2));
  }

  if (term.endsWith("s") && term.length > 4) {
    variants.push(term.slice(0, -1));
  }

  return unique(variants);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const STOP_WORDS = new Set([
  "con",
  "del",
  "las",
  "los",
  "pasa",
  "para",
  "por",
  "que",
  "una",
  "uno"
]);

const GENERIC_PROPOSAL_TERMS = new Set(["cambia", "cambio", "cambios", "legal", "laboral", "ley", "reforma"]);
