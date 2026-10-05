import type { Provider } from './types';

export const PROVIDERS: { id: Provider; label: string; available: boolean }[] = [
  { id: 'claude', label: 'Claude', available: true },
  { id: 'gpt', label: 'GPT', available: false },
  { id: 'gemini', label: 'Gemini', available: false },
];

// Model ids are passed to the provider's CLI as-is (`claude --model <id>`).
export const MODELS: Record<Provider, { id: string; label: string }[]> = {
  claude: [
    { id: 'claude-opus-5-5', label: 'Opus 5.5' },
    { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
    { id: 'claude-fable-5-1', label: 'Fable 5.1' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  ],
  gpt: [],
  gemini: [],
};

export function modelLabel(provider: Provider, model: string): string {
  const p = PROVIDERS.find((x) => x.id === provider)?.label ?? provider;
  const m = MODELS[provider].find((x) => x.id === model)?.label ?? model;
  return `${p} ${m}`;
}

// Avatar background tints from the design (README "직접 정한 값").
export const TINTS = ['#dfe6f1', '#e8e2d6', '#dde9e1', '#eadfe6', '#e3e3ea'];
