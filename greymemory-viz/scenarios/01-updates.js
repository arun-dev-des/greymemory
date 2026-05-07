// 01-updates.js
//
// Tests UPDATES — the supersession mechanic for singular attributes.
//
// Story: Alex's employer changes twice over four months. After all three
// sessions are ingested, the graph should contain THREE versions of the
// "employer" fact, connected by two purple UPDATES edges:
//
//   "Alex works at Google" ──UPDATES→ "Alex works at Stripe" ──UPDATES→ "Alex works at Anthropic"
//                                            (latest)
//
// What you should see in the viz:
//   • One latest fact (bright), two older facts (dimmed)
//   • Two purple dashed UPDATES edges with arrows pointing to newer versions
//   • Clicking the latest fact shows two entries in "version history"
//
// What would indicate a bug:
//   • All three versions marked as latest (UPDATES never fired)
//   • Only one fact in the graph (LLM treated as duplicates and skipped)
//   • EXTENDS edges instead of UPDATES (relationship classifier confused
//     "different employer" for "same employer with more detail")

import { runScenario } from './runner.js'

await runScenario({
  id: '01-updates',
  title: 'UPDATES — singular attribute changes over time',
  intent: 'Alex changes employer twice. Verify the system detects supersession and chains versions correctly.',

  run: async (memory, h) => {
    h.note('Session 1 — Alex starts at Google')
    await h.add(
      [
        { role: 'user',      content: "Hey, just wanted to share — I started a new job at Google as a software engineer this month." },
        { role: 'assistant', content: "Congrats on the new role at Google! How's it going so far?" },
      ],
      { date: '2024-01-15' }
    )

    h.note('Session 2 — three months later, Alex moves to Stripe')
    await h.add(
      [
        { role: 'user',      content: "Update — I left Google. I'm at Stripe now, joined as a PM working on payments." },
        { role: 'assistant', content: "That's a big shift, software engineer to PM. What drew you to product?" },
      ],
      { date: '2024-04-20' }
    )

    h.note('Session 3 — six months later, Alex moves to Anthropic')
    await h.add(
      [
        { role: 'user',      content: "Career update: I'm at Anthropic now. Started last week as a product manager on the API team." },
        { role: 'assistant', content: "Welcome to the AI world! How's the transition?" },
      ],
      { date: '2024-10-12' }
    )

    h.note('Verification — search for current employer')
    await h.search('where does Alex work', { topN: 5 })
    // The seed should be the Anthropic fact. Earlier versions appear in
    // the version history section of the retrieval report.
  },
})
