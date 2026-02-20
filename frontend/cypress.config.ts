import { defineConfig } from 'cypress';

export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_baseUrl || 'http://localhost:3000',
    supportFile: false,
    specPattern: 'cypress/e2e/**/*.cy.ts'
  },
  video: false
});
