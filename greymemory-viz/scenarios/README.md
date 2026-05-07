# scenarios

Small handcrafted GreyMemory test cases. Each scenario is a short story (a few `memory.add()` calls with explicit dates), seeded with the **real** extractor and embedder so it tests the actual system end-to-end.

The point: real benchmark data is too dense to debug from. These scenarios are small enough to read at a glance, so when something looks wrong in the graph you immediately know it is wrong.

## Setup

```bash
cd greymemory-viz/scenarios
npm install
cp .env.example .env
# edit .env — set ANTHROPIC_API_KEY and OPENAI_API_KEY
```

## Run

```bash
npm run all          # all three scenarios
npm run updates      # just 01
npm run extends      # just 02
npm run expires      # just 03
```

Each scenario writes a fresh DB to `.greymemory-scenarios/<id>-greymemory.db`. Re-running a scenario wipes its prior DB.

## View in the graph

Point your viz server at the scenarios directory:

```bash
# in greymemory-viz/server/.env
GREYMEMORY_ROOT=../scenarios/.greymemory-scenarios
```

Restart the server. The dataset dropdown will now show `01-updates`, `02-extends`, `03-expires`.

When you want to switch back to your real benchmarks, change `GREYMEMORY_ROOT` back and restart.

## What each scenario tests

### 01-updates
**The story:** Alex changes employer twice — Google → Stripe → Anthropic.

**What you should see in the graph:** three "employer" facts, one bright (latest = Anthropic) and two dimmed. Two purple dashed UPDATES edges with arrows pointing toward the newer version.

**What it would mean if it looked wrong:**
- All three bright = UPDATES classifier never fired. Check the relationship-detection prompt; it's not recognizing employer as a singular attribute.
- Only one fact in the graph = the deduper at the embedding-similarity stage swallowed the other two. The threshold (0.92) might be too aggressive.
- Green EXTENDS edges instead of purple UPDATES = the LLM thinks "different employer" is a refinement. The prompt's UPDATES rules need work.

### 02-extends
**The story:** Sarah's location is mentioned at three increasing levels of specificity — Bangalore → Koramangala → 5th Block.

**What you should see in the graph:** three location facts, all bright (none dimmed, because none was contradicted). Two green EXTENDS edges chaining them.

**What it would mean if it looked wrong:**
- Old facts dimmed = UPDATES fired when EXTENDS was correct. The classifier doesn't recognize that "Koramangala" doesn't contradict "Bangalore."
- No edges between the three = classifier returned NEW for everything. Could be that vector similarity isn't picking up on the location hierarchy.

### 03-expires
**The story:** On Jan 10, two upcoming events are mentioned (meeting tomorrow, exam next week). On Jan 20, both have passed.

**What you should see in the graph:** two amber (episode) nodes from session 1, both with strike-through markers indicating expiry. A clean fact node from session 2.

**The time scrubber test:** Drag the slider to Jan 11. The meeting episode should be expired (struck through). The exam episode should still be live (bright amber). Continue scrubbing forward to Jan 18 — exam is now expired too.

**What it would mean if it looked wrong:**
- No expiry markers anywhere = `expires_at` not being set during extraction. Check that the LLM is emitting `expires_at` in the JSON.
- Episodes classified as `fact` instead of `episode` = type miscategorization in the extractor prompt.
- Expired episodes still appear in retrieval = the expiry filter in `bm25Search`/`vectorSearch` isn't firing. Check the SQL `expires_at > date(...)` clause.

## Adding more scenarios

Each scenario is just a Node script that calls `runScenario({ id, title, intent, run })`. The runner handles DB setup, real extractor + embedder wiring, cleanup, and pretty logging. Use `01-updates.js` as a template.

If you build new ones worth keeping, name them `04-<concept>.js`, `05-...` and add a script to `package.json`.

## Note on non-determinism

The real extractor is an LLM, so two runs of the same scenario can produce slightly different graphs. Same number of facts, same edge types, but different exact phrasings. That's a feature: it tests whether your downstream logic is robust to extractor variance, not just to one specific extraction.

If you want bit-exact reproducibility, that's the case for a deterministic-mock seeder — different tool, different purpose.
