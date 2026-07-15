// Canned story-page graph dataset: UPDATES taxonomy.
// Source: greymemory-viz/scenarios/.greymemory-scenarios/01-updates-greymemory.db
// (Alex's career arc: Google → Stripe → Anthropic).
// The factory builds fresh node/link literals on every call — callers may
// mutate the returned objects freely (timeline patches flip is_latest, etc.).
// Facts that get superseded during the timeline start is_latest: true and are
// flipped by the step patch, so the animation shows the supersession happen.

export function makeUpdatesGraph() {
  const nodes = [
    {
      id: 'chunk_1', type: 'chunk', chunkId: 1, label: 'chunk #1',
      value: 'user: I started a new job at Google as a software engineer',
      created_at: '2024-01-15T00:00:00Z',
    },
    {
      id: 'fact_1', type: 'memory', memoryId: 1, label: 'employer',
      value: 'Started a new job at Google as a software engineer',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2024-01-15', event_date: null, expires_at: null,
      relation_type: null, created_at: '2026-05-06T10:12:31Z',
    },
    {
      id: 'fact_2', type: 'memory', memoryId: 2, label: 'role',
      value: 'Works as a software engineer',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2024-01-15', event_date: null, expires_at: null,
      relation_type: 'EXTENDS', created_at: '2026-05-06T10:12:33Z',
    },
    {
      id: 'chunk_3', type: 'chunk', chunkId: 3, label: 'chunk #3',
      value: 'user: I left Google. I’m at Stripe now, joined as a PM',
      created_at: '2024-04-20T00:00:00Z',
    },
    {
      id: 'fact_3', type: 'memory', memoryId: 3, label: 'employer',
      value: 'Works at Stripe as a PM',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2024-04-20', event_date: null, expires_at: null,
      relation_type: null, created_at: '2026-05-06T10:12:38Z',
    },
    {
      id: 'fact_4', type: 'memory', memoryId: 4, label: 'role',
      value: 'Works as a product manager (PM)',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2024-04-20', event_date: null, expires_at: null,
      relation_type: null, created_at: '2026-05-06T10:12:40Z',
    },
    {
      id: 'fact_5', type: 'memory', memoryId: 5, label: 'team_focus',
      value: 'Works on payments at Stripe',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2024-04-20', event_date: null, expires_at: null,
      relation_type: 'EXTENDS', created_at: '2026-05-06T10:12:41Z',
    },
    {
      id: 'chunk_5', type: 'chunk', chunkId: 5, label: 'chunk #5',
      value: 'user: I’m at Anthropic now, PM on the API team',
      created_at: '2024-10-12T00:00:00Z',
    },
    {
      id: 'fact_6', type: 'memory', memoryId: 6, label: 'current_employer',
      value: 'Works at Anthropic as a PM on the API team',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2024-10-12', event_date: null, expires_at: null,
      relation_type: null, created_at: '2026-05-06T10:12:48Z',
    },
    {
      id: 'fact_7', type: 'memory', memoryId: 7, label: 'start_date_anthropic',
      value: 'Started at Anthropic last week',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2024-10-12', event_date: null, expires_at: null,
      relation_type: null, created_at: '2026-05-06T10:12:50Z',
    },
  ];

  const links = [
    { source: 'chunk_1', target: 'fact_1', relation: 'SOURCE' },
    { source: 'chunk_1', target: 'fact_2', relation: 'SOURCE' },
    { source: 'fact_1', target: 'fact_2', relation: 'EXTENDS' },
    { source: 'chunk_3', target: 'fact_3', relation: 'SOURCE' },
    { source: 'chunk_3', target: 'fact_4', relation: 'SOURCE' },
    { source: 'chunk_3', target: 'fact_5', relation: 'SOURCE' },
    { source: 'fact_3', target: 'fact_5', relation: 'EXTENDS' },
    { source: 'fact_1', target: 'fact_3', relation: 'UPDATES' },
    { source: 'fact_2', target: 'fact_4', relation: 'UPDATES' },
    { source: 'chunk_5', target: 'fact_6', relation: 'SOURCE' },
    { source: 'chunk_5', target: 'fact_7', relation: 'SOURCE' },
    { source: 'fact_3', target: 'fact_6', relation: 'UPDATES' },
    { source: 'fact_6', target: 'fact_7', relation: 'UPDATES' },
  ];

  // Cumulative reveal: the career arc in created_at order. Chunks appear,
  // then their facts + SOURCE links; UPDATES edges land together with the
  // patch dimming the superseded fact.
  const timeline = [
    { nodes: ['chunk_1'], links: [] },
    {
      nodes: ['fact_1', 'fact_2'],
      links: ['chunk_1->fact_1', 'chunk_1->fact_2', 'fact_1->fact_2'],
    },
    { nodes: ['chunk_3'], links: [] },
    {
      nodes: ['fact_3', 'fact_4', 'fact_5'],
      links: ['chunk_3->fact_3', 'chunk_3->fact_4', 'chunk_3->fact_5', 'fact_3->fact_5'],
    },
    {
      nodes: [],
      links: ['fact_1->fact_3', 'fact_2->fact_4'],
      patch: { fact_1: { is_latest: false }, fact_2: { is_latest: false } },
    },
    { nodes: ['chunk_5'], links: [] },
    {
      nodes: ['fact_6', 'fact_7'],
      links: ['chunk_5->fact_6', 'chunk_5->fact_7'],
    },
    {
      nodes: [],
      links: ['fact_3->fact_6', 'fact_6->fact_7'],
      patch: { fact_3: { is_latest: false }, fact_6: { is_latest: false } },
    },
  ];

  return { nodes, links, timeline };
}
