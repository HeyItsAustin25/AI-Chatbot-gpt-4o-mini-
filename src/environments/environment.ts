export const environment = {
  production: true,
  provider: 'openai' as const,

  // OpenAI
  openAiApiKey: '',
  openAiModel: 'gpt-4o-mini',

  // Hugging Face Inference API
  hfApiKey: '',
  hfModel: 'google/gemma-2-2b-it',

  // Common generation controls
  temperature: 0.7,
  maxTokens: 512,

  // System prompt for OpenAI
  systemPrompt: 'You are a concise, helpful assistant.',
};
