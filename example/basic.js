// example/basic.js
import "dotenv/config";
import GreyMemory from "../src/index.js";

const memory = new GreyMemory();

const messages = [
  { role: "user", content: "Hi, my name is Arun and I train powerlifting" },
  { role: "assistant", content: "Great to meet you Arun!" },
  { role: "user", content: "I'm thinking about an annual membership" },
  { role: "assistant", content: "Annual is our best value option!" },
];

console.log("Adding conversation...");
const facts = await memory.add(messages);
console.log("Extracted facts:", facts);

console.log("\nSearching for relevant facts...");
const results = await memory.search("what should I eat before training?");
console.log("Relevant facts:", results);

console.log("\nAll stored facts:");
console.log(memory.getFacts());

console.log("\nClearing memory...");
memory.clear();
console.log("Facts after clear:", memory.getFacts());