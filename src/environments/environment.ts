export const environment = {
  production: true,
  provider: 'openai' as const,

  // OpenAI (demo only; do not ship your key to browsers!)
  openAiApiKey: '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',
  openAiModel: 'gpt-4o-mini',

  // Hugging Face Inference API (demo only)
  hfApiKey: '',
  hfModel: 'google/gemma-2-2b-it',

  // common generation controls
  temperature: 0.7,
  maxTokens: 512,

  // optional system prompt for OpenAI
  systemPrompt: 'You are a concise, helpful assistant.',
};