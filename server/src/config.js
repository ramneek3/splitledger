const env = process.env;
const isProd = env.NODE_ENV === 'production';

function required(name, fallbackForDev) {
  const value = env[name];
  if (value) return value;
  if (!isProd && fallbackForDev !== undefined) return fallbackForDev;
  throw new Error(`Missing required environment variable ${name}`);
}

export const config = {
  isProd,
  port: Number(env.PORT || 4000),
  databaseUrl: required('DATABASE_URL', 'postgres://splitledger:splitledger@localhost:5433/splitledger'),
  databaseSsl: env.DATABASE_SSL === 'true',
  jwtSecret: required('JWT_SECRET', 'dev-only-secret-change-me'),
  sessionDays: 7,
  // Quick-add AI: 'openrouter' | 'anthropic' | 'none'. Unset = first provider that has a key.
  aiProvider: (env.AI_PROVIDER || '').toLowerCase(),
  openrouterApiKey: env.OPENROUTER_API_KEY || '',
  openrouterModel: env.OPENROUTER_MODEL || 'nvidia/nemotron-3.5-super-vl:free',
  anthropicApiKey: env.ANTHROPIC_API_KEY || '',
  anthropicModel: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  aiTimeoutMs: Number(env.AI_TIMEOUT_MS || 20000), // free models can be slow
};
