// 03-expires.js
//
// Tests episode expiry — facts with a finite lifespan that should disappear
// from active retrieval once the event has passed.
//
// Story: On Jan 10, the user mentions a meeting "tomorrow at 3pm" and an
// "exam next week". Two episodes get created with expires_at set in the
// future. We then ingest a session on Jan 20 — the meeting episode should
// have expired by then but the exam (Jan 17) should also have expired.
// We add a fresh fact-style memory in that session to confirm the system
// is still working.
//
// What you should see in the viz:
//   • Two amber (episode) nodes from session 1, both crossed out (expired)
//   • A clean fact node from session 2
//   • In scrubber mode, drag the slider to Jan 11 — the meeting episode
//     should be expired, the exam episode should still be live
//
// What you should see in the retrieval report:
//   • Searching "do I have anything tomorrow" on Jan 11 → finds the meeting
//   • Same query on Jan 20 → no results (everything expired)
//
// What would indicate a bug:
//   • Episodes still appear as active (not crossed-out) in the latest view
//     after their expires_at date — expiry filter not firing
//   • expires_at is null on the episode nodes — extractor didn't infer expiry
//   • Episodes classified as 'fact' instead of 'episode' — type miscategorized

import { runScenario } from './runner.js'

await runScenario({
  id: '03-expires',
  title: 'EXPIRES — episodes with finite lifespans',
  intent: 'Time-bound events should auto-expire. Verify expires_at is set correctly and expired episodes are filtered from search.',

  run: async (memory, h) => {
    h.note('Session 1 — user mentions two upcoming events')
    await h.add(
      [
        { role: 'user',      content: "Quick reminder for myself: I have a project review meeting with David tomorrow at 3pm. Also my driving test exam is next Wednesday." },
        { role: 'assistant', content: "Got it. Good luck with the review tomorrow, and let me know how the driving test goes!" },
      ],
      { date: '2024-01-10' }
    )

    h.note('Session 2 — ten days later, both events have passed')
    await h.add(
      [
        { role: 'user',      content: "I passed the driving test last week! And the project review went fine. Now I need to start planning the next quarter." },
        { role: 'assistant', content: "Congratulations on the driving test! What's the focus for next quarter?" },
      ],
      { date: '2024-01-20' }
    )

    h.note('Verification — both episodes should have expired by the second session')
    await h.search('what events does the user have coming up', { topN: 5 })
    // Expected: no episode results, because they all expired before today.

    h.note('Time travel — search as of Jan 11 (one day after session 1)')
    await h.search('what events does the user have coming up', {
      topN: 5,
      asOf: '2024-01-11',
    })
    // Expected: the driving test should still appear (Jan 17 hasn't happened
    // yet at this asOf), but the meeting tomorrow already happened.
  },
})
