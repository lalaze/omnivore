import { env } from '../env'

export const corsConfig = {
  credentials: true,
  // allow https://studio.apollographql.com for local env
  origin: [
    'https://omnivore.app',
    'https://dev.omnivore.app',
    'https://demo.omnivore.app',
    'https://web-prod.omnivore.app',
    'https://web-dev.omnivore.app',
    'https://web-demo.omnivore.app',
    'http://localhost:3000',
    'http://192.168.0.155:3000',
    'http://omnivore.home.com',
    'lsp://logseq.io',
    env.dev.isLocal && 'https://studio.apollographql.com',
    'app://obsidian.md',
  ],
}