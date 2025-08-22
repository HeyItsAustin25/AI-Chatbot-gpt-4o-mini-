export const environment = {
  production: false,
  provider: 'openai' as const, // switch to 'huggingface' or 'mock'
  openAiApiKey: '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',
  openAiModel: 'gpt-4o-mini',
  hfApiKey: '',
  hfModel: 'google/gemma-2-2b-it',
  temperature: 0.7,
  maxTokens: 256,
  systemPrompt: 'You are a concise, helpful assistant.',
};