/**
 * Standard prefixes used by various tools and plugins to indicate
 * that the following text is the result of an automated action, 
 * rather than a human user's prompt.
 */
export const TOOL_RESULT_PREFIXES = [
  'Tool result:',
  'Tool output:',
  '<tool_response>',
  '<function_results>',
  'Command output:',
  '```output'
];

/**
 * Cursor-specific markers often injected into user messages
 * to represent intermediate tool calls or steps.
 */
export const CURSOR_TOOL_MARKERS = [
  '<tool_call>',
  '<tool_response>',
  'Step:'
];
