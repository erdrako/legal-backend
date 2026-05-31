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
  const normalizedQuery = normalize(query);

  return bundle.proposals
    .filter((proposal) => searchableProposalText(proposal).includes(normalizedQuery))
    .map(toProposalOverview);
}

export function toProposalOverview(proposal) {
  return {
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    summaryPlainLanguage: proposal.summary.short,
    affectedTopics: proposal.topics.map((topic) => topic.label),
    affectedGroups: proposal.affectedGroups.map((group) => group.label),
    diffCount: proposal.diffs.length,
    dataStatus: proposal.dataStatus,
    source: proposal.source
  };
}

function searchableProposalText(proposal) {
  return normalize(
    [
      proposal.title,
      proposal.status,
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

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
