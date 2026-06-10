import { test } from "node:test";
import assert from "node:assert/strict";
import { formatForReading, parseReadingAnswer } from "../src/index.js";

const results = [
  { memory: "Arun works at Stripe", chunk: "user: I now work at Stripe", memory_type: "fact", document_date: "2026-03-10", event_date: null, source_role: "user", session_id: "s2" },
  { memory: "Arun works at Google", chunk: "user: I work at Google", memory_type: "fact", document_date: "2026-01-10", event_date: null, source_role: "user", session_id: "s1" },
  { memory: "Arun ran a marathon", chunk: null, memory_type: "episode", document_date: null, event_date: "2026-04-12", source_role: "user", session_id: "s3" },
];

function itemsFromPrompt(prompt) {
  const start = prompt.indexOf("--- RETRIEVED MEMORIES");
  const open  = prompt.indexOf("[", start);
  const close = prompt.indexOf("\n---", open);
  return JSON.parse(prompt.slice(open, close));
}

test("items are sorted chronologically, null dates last, relevance preserved", () => {
  const prompt = formatForReading({ question: "Where does Arun work?", questionDate: "2026-06-10", results });
  const items = itemsFromPrompt(prompt);

  assert.equal(items.length, 3);
  assert.deepEqual(items.map(i => i.document_date), ["2026-01-10", "2026-03-10", null]);
  assert.deepEqual(items.map(i => i.index), [1, 2, 3]);
  // relevance_rank preserves the pre-sort retrieval order (Stripe was rank 1)
  assert.equal(items.find(i => i.memory.includes("Stripe")).relevance_rank, 1);
});

test("no supersession plumbing remains in the prompt", () => {
  const prompt = formatForReading({ question: "q", questionDate: "2026-06-10", results });
  for (const banned of ["previous_values", "CURRENT VALUES", "version_note", "superseded", "confidence", "relation_type"]) {
    assert.ok(!prompt.includes(banned), `prompt must not mention "${banned}"`);
  }
  // and the paper-pure change rule is present
  assert.match(prompt, /latest\s+document_date is the CURRENT state/);
});

test("every item gets a numbered note line in the instructions", () => {
  const prompt = formatForReading({ question: "q", questionDate: "2026-06-10", results });
  assert.match(prompt, /For EACH item 1\.\.3/);
  assert.match(prompt, /\[3\] <tag>: <note>/);
});

test("empty results render a placeholder", () => {
  const prompt = formatForReading({ question: "q", questionDate: "2026-06-10", results: [] });
  assert.match(prompt, /\(no memories retrieved\)/);
});

test("parseReadingAnswer extracts the last Answer line, falls back to full text", () => {
  const con = `Anchors: employer

Notes:
[1] answers: "works at Google"
[2] answers: "works at Stripe"
[3] off-topic: item discusses "marathon"

Answer: Stripe`;
  assert.equal(parseReadingAnswer(con), "Stripe");

  // multiline answer after the marker
  assert.equal(parseReadingAnswer("Answer: two cities:\nBangalore and Chennai"), "two cities:\nBangalore and Chennai");

  // multiple Answer lines → last one wins
  assert.equal(parseReadingAnswer("Answer: draft\nmore notes\nAnswer: final"), "final");

  // no marker → whole trimmed text
  assert.equal(parseReadingAnswer("  just text  "), "just text");
  assert.equal(parseReadingAnswer(null), "");
});
