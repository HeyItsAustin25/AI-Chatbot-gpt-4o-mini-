export const environment = {
  production: false,
  provider: 'openai' as const, // switch to 'huggingface' or 'mock'
  openAiApiKey: '',
  openAiModel: 'gpt-4o-mini',
  hfApiKey: '',
  hfModel: 'google/gemma-2-2b-it',
  temperature: 0.7,
  maxTokens: 256,
  systemPrompt: 'You are a concise, helpful assistant.',
};
