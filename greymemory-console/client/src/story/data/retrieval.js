// Canned story-page graph dataset: retrieval / graph-expansion demo.
// Source: HAND-WRITTEN. The "engineers" story: team of 4 → team of 5
// (UPDATES), with two episodes EXTENDing the 5-fact, plus distractors.
// HIGHLIGHT_STAGES drives the search animation: seeds land first, then
// graph expansion pulls in the outing (EXTENDS) and the superseded 4-fact
// flips to history. Stage maps use static node-id strings.
// The factory builds fresh node/link literals on every call — callers may
// mutate the returned objects freely.

export function makeRetrievalGraph() {
  const nodes = [
    {
      id: 'chunk_1', type: 'chunk', chunkId: 1, label: 'chunk #1',
      value: 'user: I lead a team of 4 engineers. Manager is Rachel.',
      created_at: '2023-05-10T00:00:00Z',
    },
    {
      id: 'chunk_2', type: 'chunk', chunkId: 2, label: 'chunk #2',
      value: 'user: We hired a backend engineer — team of 5 now!',
      created_at: '2023-07-15T00:00:00Z',
    },
    {
      id: 'fact_1', type: 'memory', memoryId: 1, label: 'team_size',
      value: 'Leads a team of 4 engineers',
      memory_type: 'fact', is_latest: false, is_expired: false,
      document_date: '2023-05-10', event_date: null, expires_at: null,
      relation_type: null, created_at: '2023-05-10T10:00:00Z',
    },
    {
      id: 'fact_2', type: 'memory', memoryId: 2, label: 'team_size',
      value: 'Leads a team of 5 engineers',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2023-07-15', event_date: null, expires_at: null,
      relation_type: null, created_at: '2023-07-15T10:00:00Z',
    },
    {
      id: 'fact_3', type: 'memory', memoryId: 3, label: 'team_hiring',
      value: 'Team hired a backend engineer',
      memory_type: 'episode', is_latest: true, is_expired: false,
      document_date: '2023-07-15', event_date: null, expires_at: null,
      relation_type: 'EXTENDS', created_at: '2023-07-15T10:00:05Z',
    },
    {
      id: 'fact_4', type: 'memory', memoryId: 4, label: 'team_outing',
      value: 'Team outing at City View Rooftop',
      memory_type: 'episode', is_latest: true, is_expired: false,
      document_date: '2023-07-15', event_date: null, expires_at: null,
      relation_type: 'EXTENDS', created_at: '2023-07-15T10:00:10Z',
    },
    {
      id: 'fact_5', type: 'memory', memoryId: 5, label: 'manager_news',
      value: 'Manager Rachel got promoted',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2023-05-10', event_date: null, expires_at: null,
      relation_type: null, created_at: '2023-05-10T10:00:05Z',
    },
    {
      id: 'fact_6', type: 'memory', memoryId: 6, label: 'language_preference',
      value: 'Prefers TypeScript',
      memory_type: 'preference', is_latest: true, is_expired: false,
      document_date: '2023-05-10', event_date: null, expires_at: null,
      relation_type: null, created_at: '2023-05-10T10:00:10Z',
    },
    {
      id: 'fact_7', type: 'memory', memoryId: 7, label: 'team_tooling',
      value: 'Team uses Linear for sprints',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2023-07-15', event_date: null, expires_at: null,
      relation_type: null, created_at: '2023-07-15T10:00:15Z',
    },
  ];

  const links = [
    { source: 'chunk_1', target: 'fact_1', relation: 'SOURCE' },
    { source: 'chunk_1', target: 'fact_5', relation: 'SOURCE' },
    { source: 'chunk_1', target: 'fact_6', relation: 'SOURCE' },
    { source: 'chunk_2', target: 'fact_2', relation: 'SOURCE' },
    { source: 'chunk_2', target: 'fact_3', relation: 'SOURCE' },
    { source: 'chunk_2', target: 'fact_4', relation: 'SOURCE' },
    { source: 'chunk_2', target: 'fact_7', relation: 'SOURCE' },
    { source: 'fact_1', target: 'fact_2', relation: 'UPDATES' },
    { source: 'fact_2', target: 'fact_3', relation: 'EXTENDS' },
    { source: 'fact_2', target: 'fact_4', relation: 'EXTENDS' },
  ];

  return { nodes, links, timeline: [] };
}

// Indexed by animation stage (0-4). Stages 0-2 show no highlights; stage 3
// lights the hybrid-search seeds; stage 4 adds graph expansion (EXTENDS pull
// of the outing) and flips the superseded 4-fact to temporal history.
export const HIGHLIGHT_STAGES = [
  null,
  null,
  null,
  new Map([
    ['fact_2', { kind: 'seed' }],
    ['fact_1', { kind: 'seed' }],
    ['fact_3', { kind: 'seed' }],
  ]),
  new Map([
    ['fact_2', { kind: 'seed' }],
    ['fact_1', { kind: 'history' }],
    ['fact_3', { kind: 'seed' }],
    ['fact_4', { kind: 'expanded' }],
  ]),
];
