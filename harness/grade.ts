import { Task } from './dataset.js';

export function extractAnswer(body: any): string {
  // Extract text from chat completion format (OpenAI or Anthropic)
  if (!body) return '';

  if (body.choices && body.choices[0] && body.choices[0].message) {
    // OpenAI style
    return body.choices[0].message.content || '';
  }

  if (body.content && Array.isArray(body.content)) {
    // Anthropic style
    const textBlock = body.content.find((c: any) => c.type === 'text');
    return textBlock ? textBlock.text : '';
  }

  return '';
}

export function gradeAnswer(task: Task, answerRaw: string): boolean {
  if (!answerRaw) return false;

  const answerStr = answerRaw.trim();
  const answerLower = answerStr.toLowerCase().replace(/[.,;!?]+$/, '');

  if (task.expectedText) {
    const expected = task.expectedText.toLowerCase();
    if (answerLower !== expected && !answerLower.includes(expected)) {
      return false;
    }
  }

  if (task.regex) {
    const re = new RegExp(task.regex, 'i');
    if (!re.test(answerStr)) {
      return false;
    }
  }

  if (task.isJson) {
    try {
      // Strip markdown code blocks if any
      let jsonStr = answerStr;
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json/, '').replace(/```$/, '').trim();
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```/, '').replace(/```$/, '').trim();
      }
      JSON.parse(jsonStr);
    } catch (e) {
      return false;
    }
  }

  return true;
}
