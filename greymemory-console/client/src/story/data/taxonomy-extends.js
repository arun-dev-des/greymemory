// Canned story-page graph dataset: EXTENDS taxonomy.
// Source: greymemory-viz/scenarios/.greymemory-scenarios/02-extends-greymemory.db
// (Sarah's location refinements: Bangalore → Koramangala → 5th Block, plus
// preferences).
// The factory builds fresh node/link literals on every call — callers may
// mutate the returned objects freely.

export function makeExtendsGraph() {
  const nodes = [
    {
      id: 'chunk_1', type: 'chunk', chunkId: 1, label: 'chunk #1',
      value: 'user: I just moved to Bangalore last month. Still settling in.',
      created_at: '2024-02-05T00:00:00Z',
    },
    {
      id: 'fact_1', type: 'memory', memoryId: 1, label: 'location',
      value: 'Moved to Bangalore last month',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2024-02-05', event_date: null, expires_at: null,
      relation_type: null, created_at: '2026-05-06T10:12:55Z',
    },
    {
      id: 'fact_2', type: 'memory', memoryId: 2, label: 'settlement_status',
      value: 'Still settling in to their new location in Bangalore',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2024-02-05', event_date: null, expires_at: null,
      relation_type: 'EXTENDS', created_at: '2026-05-06T10:12:56Z',
    },
    {
      id: 'chunk_3', type: 'chunk', chunkId: 3, label: 'chunk #3',
      value: 'user: I’m in Koramangala — found a place I really like.',
      created_at: '2024-02-18T00:00:00Z',
    },
    {
      id: 'fact_3', type: 'memory', memoryId: 3, label: 'current_neighborhood',
      value: 'Is in Koramangala, a neighborhood in Bangalore',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2024-02-18', event_date: null, expires_at: null,
      relation_type: 'EXTENDS', created_at: '2026-05-06T10:13:02Z',
    },
    {
      id: 'fact_4', type: 'memory', memoryId: 4, label: 'residential_satisfaction',
      value: 'Found a place in Koramangala that they really like',
      memory_type: 'preference', is_latest: true, is_expired: false,
      document_date: '2024-02-18', event_date: null, expires_at: null,
      relation_type: null, created_at: '2026-05-06T10:13:02Z',
    },
    {
      id: 'chunk_5', type: 'chunk', chunkId: 5, label: 'chunk #5',
      value: 'user: I’m on 5th Block in Koramangala — close to the cafes.',
      created_at: '2024-03-02T00:00:00Z',
    },
    {
      id: 'fact_5', type: 'memory', memoryId: 5, label: 'residence_address_specific',
      value: 'Lives in 5th Block in Koramangala, Bangalore',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2024-03-02', event_date: null, expires_at: null,
      relation_type: 'EXTENDS', created_at: '2026-05-06T10:13:09Z',
    },
    {
      id: 'fact_6', type: 'memory', memoryId: 6, label: 'location_preference',
      value: 'Prefers living near cafes and walkable areas',
      memory_type: 'preference', is_latest: true, is_expired: false,
      document_date: '2024-03-02', event_date: null, expires_at: null,
      relation_type: null, created_at: '2026-05-06T10:13:09Z',
    },
  ];

  const links = [
    { source: 'chunk_1', target: 'fact_1', relation: 'SOURCE' },
    { source: 'chunk_1', target: 'fact_2', relation: 'SOURCE' },
    { source: 'fact_1', target: 'fact_2', relation: 'EXTENDS' },
    { source: 'chunk_3', target: 'fact_3', relation: 'SOURCE' },
    { source: 'chunk_3', target: 'fact_4', relation: 'SOURCE' },
    { source: 'fact_1', target: 'fact_3', relation: 'EXTENDS' },
    { source: 'chunk_5', target: 'fact_5', relation: 'SOURCE' },
    { source: 'chunk_5', target: 'fact_6', relation: 'SOURCE' },
    { source: 'fact_3', target: 'fact_5', relation: 'EXTENDS' },
  ];

  // Cumulative reveal: refinements sprout one at a time.
  const timeline = [
    { nodes: ['chunk_1'], links: [] },
    { nodes: ['fact_1'], links: ['chunk_1->fact_1'] },
    { nodes: ['fact_2'], links: ['chunk_1->fact_2', 'fact_1->fact_2'] },
    { nodes: ['chunk_3'], links: [] },
    { nodes: ['fact_3'], links: ['chunk_3->fact_3', 'fact_1->fact_3'] },
    { nodes: ['fact_4'], links: ['chunk_3->fact_4'] },
    { nodes: ['chunk_5'], links: [] },
    { nodes: ['fact_5'], links: ['chunk_5->fact_5', 'fact_3->fact_5'] },
    { nodes: ['fact_6'], links: ['chunk_5->fact_6'] },
  ];

  return { nodes, links, timeline };
}
