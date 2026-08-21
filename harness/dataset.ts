export interface Task {
  id: string;
  category: string;
  prompt: string;
  expectedText?: string;
  regex?: string;
  isJson?: boolean;
}

export function loadTasks(): Task[] {
  // A set of hardcoded synthetic tasks covering a range of difficulties.
  // Must have a deterministic check.
  const tasks: Task[] = [];
  
  // Easy tasks: extraction, boolean, short factual
  for (let i = 0; i < 40; i++) {
    tasks.push({
      id: `easy_factual_${i}`,
      category: 'short_factual',
      prompt: `Respond exactly with the word "APPLE". Do not include any other text. Iteration ${i}`,
      expectedText: 'apple'
    });
  }

  for (let i = 0; i < 40; i++) {
    tasks.push({
      id: `easy_json_${i}`,
      category: 'format',
      prompt: `Output a JSON object with a single key "count" and value ${i}. Only output valid JSON, no markdown blocks.`,
      isJson: true,
      regex: `"count"\\s*:\\s*${i}`
    });
  }

  // Hard tasks: multi-step reasoning, where SLM is likely to fail
  for (let i = 0; i < 40; i++) {
    tasks.push({
      id: `hard_math_${i}`,
      category: 'reasoning',
      prompt: `If I have ${i} apples and Alice gives me 13, and then I eat half, how many do I have left? State your final answer in the format: FINAL_ANSWER=X. Do not add punctuation after the number.`,
      expectedText: `FINAL_ANSWER=${(i + 13) / 2}`
    });
  }

  return tasks;
}
