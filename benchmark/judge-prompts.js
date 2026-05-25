// Vendored from xiaowu0162/LongMemEval (MIT) — src/evaluation/evaluate_qa.py
// Source: https://github.com/xiaowu0162/LongMemEval
// Paper:  Wu et al., ICLR 2025, arXiv:2410.10813
//
// Five judge prompts keyed by question_type, plus a dedicated abstention prompt
// for question_ids ending in "_abs". Using the official prompts makes our
// accuracy numbers directly comparable to the paper's published baselines.

const STANDARD = `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.

Question: {question}

Correct Answer: {answer}

Model Response: {response}

Is the model response correct? Answer yes or no only.`

const TEMPORAL = `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct.

Question: {question}

Correct Answer: {answer}

Model Response: {response}

Is the model response correct? Answer yes or no only.`

const KNOWLEDGE_UPDATE = `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.

Question: {question}

Correct Answer: {answer}

Model Response: {response}

Is the model response correct? Answer yes or no only.`

const PREFERENCE = `I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.

Question: {question}

Rubric: {answer}

Model Response: {response}

Is the model response correct? Answer yes or no only.`

const ABSTENTION = `I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.

Question: {question}

Explanation: {answer}

Model Response: {response}

Does the model correctly identify the question as unanswerable? Answer yes or no only.`

// Sequential, indexed substitution — safe even if {answer} or {response} text
// itself contains literal "{question}" / "{answer}" / "{response}" substrings.
function fill(template, fields) {
  const parts = template.split(/(\{question\}|\{answer\}|\{response\})/g)
  return parts.map(p =>
    p === '{question}' ? fields.question :
    p === '{answer}'   ? fields.answer   :
    p === '{response}' ? fields.response :
    p
  ).join('')
}

export function buildJudgePrompt({ questionType, isAbstention, question, answer, response }) {
  let template
  if (isAbstention)                                      template = ABSTENTION
  else if (questionType === 'temporal-reasoning')        template = TEMPORAL
  else if (questionType === 'knowledge-update')          template = KNOWLEDGE_UPDATE
  else if (questionType === 'single-session-preference') template = PREFERENCE
  else                                                   template = STANDARD  // SSU, SSA, MS
  return fill(template, { question, answer, response })
}

// Verdict parser — official methodology: case-insensitive substring match on "yes".
export function parseJudgeVerdict(judgeResponse) {
  return /yes/i.test(judgeResponse ?? '')
}
