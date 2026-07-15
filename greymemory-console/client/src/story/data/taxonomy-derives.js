// Canned story-page graph dataset: DERIVES taxonomy.
// Source: HAND-WRITTEN (no scenario DB contains DERIVES relations).
// Two clusters: running facts ⇒ 'Is a serious runner'; cooking facts ⇒
// 'Is invested in learning to cook'. DERIVES links go from BOTH parents
// to each derived node.
// The factory builds fresh node/link literals on every call — callers may
// mutate the returned objects freely.

export function makeDerivesGraph() {
  const nodes = [
    {
      id: 'chunk_1', type: 'chunk', chunkId: 1, label: 'chunk #1',
      value: 'user: Ran my 5k this morning — marathon training is on!',
      created_at: '2024-03-10T00:00:00Z',
    },
    {
      id: 'chunk_2', type: 'chunk', chunkId: 2, label: 'chunk #2',
      value: 'user: Bought a carbon-steel wok for my Thai cooking class.',
      created_at: '2024-03-24T00:00:00Z',
    },
    {
      id: 'fact_1', type: 'memory', memoryId: 1, label: 'running_habit',
      value: 'Runs 5k every morning',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2024-03-10', event_date: null, expires_at: null,
      relation_type: null, created_at: '2024-03-10T09:01:00Z',
    },
    {
      id: 'fact_2', type: 'memory', memoryId: 2, label: 'marathon_training',
      value: 'Training for a spring marathon',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2024-03-10', event_date: null, expires_at: null,
      relation_type: null, created_at: '2024-03-10T09:01:05Z',
    },
    {
      id: 'fact_3', type: 'memory', memoryId: 3, label: 'runner_identity',
      value: 'Is a serious runner',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: null, event_date: null, expires_at: null,
      relation_type: 'DERIVES', created_at: '2024-03-25T12:00:00Z',
    },
    {
      id: 'fact_4', type: 'memory', memoryId: 4, label: 'cookware_purchase',
      value: 'Bought a carbon-steel wok',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2024-03-24', event_date: null, expires_at: null,
      relation_type: null, created_at: '2024-03-24T18:30:00Z',
    },
    {
      id: 'fact_5', type: 'memory', memoryId: 5, label: 'cooking_class',
      value: 'Takes a Thai cooking class',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: '2024-03-24', event_date: null, expires_at: null,
      relation_type: null, created_at: '2024-03-24T18:30:05Z',
    },
    {
      id: 'fact_6', type: 'memory', memoryId: 6, label: 'cooking_interest',
      value: 'Is invested in learning to cook',
      memory_type: 'fact', is_latest: true, is_expired: false,
      document_date: null, event_date: null, expires_at: null,
      relation_type: 'DERIVES', created_at: '2024-03-25T12:00:05Z',
    },
  ];

  const links = [
    { source: 'chunk_1', target: 'fact_1', relation: 'SOURCE' },
    { source: 'chunk_1', target: 'fact_2', relation: 'SOURCE' },
    { source: 'chunk_2', target: 'fact_4', relation: 'SOURCE' },
    { source: 'chunk_2', target: 'fact_5', relation: 'SOURCE' },
    { source: 'fact_1', target: 'fact_3', relation: 'DERIVES' },
    { source: 'fact_2', target: 'fact_3', relation: 'DERIVES' },
    { source: 'fact_4', target: 'fact_6', relation: 'DERIVES' },
    { source: 'fact_5', target: 'fact_6', relation: 'DERIVES' },
  ];

  // Cumulative reveal: parents first, a pause step, then each derived node
  // pops in with both of its DERIVES edges.
  const timeline = [
    { nodes: ['chunk_1', 'chunk_2'], links: [] },
    {
      nodes: ['fact_1', 'fact_2', 'fact_4', 'fact_5'],
      links: ['chunk_1->fact_1', 'chunk_1->fact_2', 'chunk_2->fact_4', 'chunk_2->fact_5'],
    },
    { nodes: [], links: [] }, // pause — runDerivations() "thinking"
    { nodes: ['fact_3'], links: ['fact_1->fact_3', 'fact_2->fact_3'] },
    { nodes: ['fact_6'], links: ['fact_4->fact_6', 'fact_5->fact_6'] },
  ];

  return { nodes, links, timeline };
}
