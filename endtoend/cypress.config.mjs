import { defineConfig } from 'cypress'

export default defineConfig({
  defaultCommandTimeout: 16_000,
  requestTimeout: 16_000,

  e2e: {
    baseUrl: 'http://localhost:1121',
    specPattern: 'cypress/integration/*main.spec.ts',
  },
})
