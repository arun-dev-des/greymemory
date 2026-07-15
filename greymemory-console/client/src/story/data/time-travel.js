// Canned story-page graph dataset: time-travel (asOf slider demo).
// Source: HAND-WRITTEN. No timeline — the slider drives visibility; the
// client derives is_latest / is_expired flags from document_date /
// expires_at at runtime. Dates matter: DataCorp (Feb) is superseded by
// Stripe (Jun); the FitHub membership expires end of July.
// The factory builds fresh node/link literals on every call — callers may
// mutate the returned objects freely.

export function makeTimeTravelGraph() {
  const nodes = [
    {
      id: 'chunk_1', type: 'chunk', chunkId: 1, label: 'chunk #1',
      value: 'user: Started at DataCorp; also joined FitHub gym nearby.',
      created_at: '2023-03-01T00:00:00Z',
    },
    {
      id: 'chunk_2', type: 'chunk', chunkId: 2, label: 'chunk #2',
      value: 'user: Big news — I left DataCorp and joined Stripe!',
      created_at: '2023-06-01T00:00:00Z',
    },
    {
      id: 'fact_1', type: 'memory', memoryId: 1, label: 'employer',
      value: 'Works at DataCorp',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2023-02-01', event_date: null, expires_at: null,
      relation_type: null, created_at: '2023-02-01T10:00:00Z',
    },
    {
      id: 'fact_2', type: 'memory', memoryId: 2, label: 'employer',
      value: 'Works at Stripe',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2023-06-01', event_date: null, expires_at: null,
      relation_type: null, created_at: '2023-06-01T10:00:00Z',
    },
    {
      id: 'fact_3', type: 'memory', memoryId: 3, label: 'gym_membership',
      value: 'Gym membership at FitHub',
      memory_type: 'episode', is_latest: true, is_expired: false,
      document_date: '2023-03-01', event_date: null, expires_at: '2023-07-31',
      relation_type: null, created_at: '2023-03-01T10:00:00Z',
    },
    {
      id: 'fact_4', type: 'memory', memoryId: 4, label: 'meeting_preference',
      value: 'Prefers morning meetings',
      memory_type: 'preference', is_latest: true, is_expired: false,
      document_date: '2023-03-15', event_date: null, expires_at: null,
      relation_type: null, created_at: '2023-03-15T10:00:00Z',
    },
    {
      id: 'fact_5', type: 'memory', memoryId: 5, label: 'pet',
      value: 'Adopted a cat named Miso',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2023-04-20', event_date: null, expires_at: null,
      relation_type: null, created_at: '2023-04-20T10:00:00Z',
    },
    {
      id: 'fact_6', type: 'memory', memoryId: 6, label: 'language_learning',
      value: 'Learning Spanish on Duolingo',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2023-08-05', event_date: null, expires_at: null,
      relation_type: null, created_at: '2023-08-05T10:00:00Z',
    },
    {
      id: 'fact_7', type: 'memory', memoryId: 7, label: 'residence',
      value: 'Moved to a bigger apartment',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2023-09-10', event_date: null, expires_at: null,
      relation_type: null, created_at: '2023-09-10T10:00:00Z',
    },
  ];

  const links = [
    { source: 'chunk_1', target: 'fact_1', relation: 'SOURCE' },
    { source: 'chunk_1', target: 'fact_3', relation: 'SOURCE' },
    { source: 'chunk_2', target: 'fact_2', relation: 'SOURCE' },
    { source: 'fact_1', target: 'fact_2', relation: 'UPDATES' },
  ];

  return { nodes, links, timeline: [] };
}
