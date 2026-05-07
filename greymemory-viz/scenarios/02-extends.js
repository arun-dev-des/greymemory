// 02-extends.js
//
// Tests EXTENDS — refinement chains where the original fact stays true.
//
// Story: Sarah mentions where she lives at three increasing levels of
// specificity over three sessions. Each new fact ADDS detail — the older
// fact is still correct, just less specific.
//
// "Sarah lives in Bangalore" stays true even after we learn "Sarah lives
// in Koramangala", because Koramangala IS in Bangalore. So the right
// classification is EXTENDS, not UPDATES.
//
// Expected graph:
//
//   "Sarah lives in Bangalore" ──EXTENDS→ "Sarah lives in Koramangala, Bangalore" ──EXTENDS→ "Sarah lives on 5th Block, Koramangala, Bangalore"
//                            (all three are latest=1, all should be retrievable)
//
// What you should see in the viz:
//   • Three bright (latest) nodes — none are dimmed because none are superseded
//   • Two GREEN EXTENDS edges
//   • Clicking the most general fact shows two entries in "extended by"
//
// What would indicate a bug:
//   • Old versions dimmed (UPDATES fired when EXTENDS was correct)
//   • No edges between facts (relationship classifier returned NEW for everything)
//   • Only one fact (deduper treated similar values as duplicates)
//
// This is a harder test than UPDATES because the LLM has to recognize that
// adding specificity isn't the same as contradicting the previous statement.

import { runScenario } from './runner.js'

await runScenario({
  id: '02-extends',
  title: 'EXTENDS — refinement chains where prior facts remain true',
  intent: 'Sarah\'s location is mentioned three times with increasing specificity. Verify EXTENDS edges form and original facts stay latest.',

  run: async (memory, h) => {
    h.note('Session 1 — Sarah mentions her city')
    await h.add(
      [
        { role: 'user',      content: "I just moved to Bangalore last month. Still settling in." },
        { role: 'assistant', content: "Welcome to Bangalore! What part of the city are you in?" },
      ],
      { date: '2024-02-05' }
    )

    h.note('Session 2 — Sarah names her neighborhood')
    await h.add(
      [
        { role: 'user',      content: "I'm in Koramangala — found a place I really like." },
        { role: 'assistant', content: "Koramangala is a great choice, lots happening there." },
      ],
      { date: '2024-02-18' }
    )

    h.note('Session 3 — Sarah names her exact block')
    await h.add(
      [
        { role: 'user',      content: "I'm specifically on 5th Block in Koramangala — close to all the cafes." },
        { role: 'assistant', content: "Nice, 5th Block is one of the most walkable parts of the area." },
      ],
      { date: '2024-03-02' }
    )

    h.note('Verification — search for where Sarah lives')
    await h.search('where does Sarah live', { topN: 5 })
    // All three should appear; the most specific should be the seed. The other
    // two should appear in EXTENDS expansion (since they are connected via
    // EXTENDS edges in the graph).
  },
})
