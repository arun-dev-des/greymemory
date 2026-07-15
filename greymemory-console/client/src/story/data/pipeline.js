// Canned story-page graph dataset: ingestion pipeline stepper.
// Source: HAND-WRITTEN (same "engineers" mini-story as retrieval.js).
// Every node and link carries an extra `step` field (0-4) mapping it to the
// pipeline stepper stage that reveals it: step 0 = chunks persisted,
// step 1 = facts extracted + SOURCE links, step 2 = embed, step 3 = classify
// (UPDATES/EXTENDS links land; PIPELINE_PATCHES dims the stale fact).
// The 4-fact starts is_latest: true — the step-3 patch flips it.
// The factory builds fresh node/link literals on every call — callers may
// mutate the returned objects freely.

export function makePipelineGraph() {
  const nodes = [
    {
      id: 'chunk_1', type: 'chunk', chunkId: 1, label: 'chunk #1',
      value: 'user: I lead a team of 4 engineers.',
      created_at: '2023-05-10T00:00:00Z',
      step: 0,
    },
    {
      id: 'chunk_2', type: 'chunk', chunkId: 2, label: 'chunk #2',
      value: 'user: We hired a backend engineer — team of 5 now!',
      created_at: '2023-07-15T00:00:00Z',
      step: 0,
    },
    {
      id: 'fact_1', type: 'memory', memoryId: 1, label: 'team_size',
      value: 'Leads a team of 4 engineers',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2023-05-10', event_date: null, expires_at: null,
      relation_type: null, created_at: '2023-05-10T10:00:00Z',
      step: 1,
    },
    {
      id: 'fact_2', type: 'memory', memoryId: 2, label: 'team_size',
      value: 'Leads a team of 5 engineers',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2023-07-15', event_date: null, expires_at: null,
      relation_type: null, created_at: '2023-07-15T10:00:00Z',
      step: 1,
    },
    {
      id: 'fact_3', type: 'memory', memoryId: 3, label: 'team_hiring',
      value: 'Team hired a backend engineer',
      memory_type: 'episode', is_latest: true, is_expired: false,
      document_date: '2023-07-15', event_date: null, expires_at: null,
      relation_type: 'EXTENDS', created_at: '2023-07-15T10:00:05Z',
      step: 1,
    },
  ];

  const links = [
    { source: 'chunk_1', target: 'fact_1', relation: 'SOURCE', step: 1 },
    { source: 'chunk_2', target: 'fact_2', relation: 'SOURCE', step: 1 },
    { source: 'chunk_2', target: 'fact_3', relation: 'SOURCE', step: 1 },
    { source: 'fact_1', target: 'fact_2', relation: 'UPDATES', step: 3 },
    { source: 'fact_2', target: 'fact_3', relation: 'EXTENDS', step: 3 },
  ];

  return { nodes, links, timeline: [] };
}

// Node patches applied when the stepper reaches a given step: at the
// classify step (3) the superseded team-of-4 fact dims.
export const PIPELINE_PATCHES = {
  3: { fact_1: { is_latest: false } },
};
