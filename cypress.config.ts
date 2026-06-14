import { defineConfig } from 'cypress';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const webpackConfig = require('./cypress/webpack-ct.cjs');

export default defineConfig({
  component: {
    devServer: {
      framework: 'react',
      bundler: 'webpack',
      webpackConfig,
    },
    specPattern: 'cypress/component/**/*.cy.{ts,tsx}',
    supportFile: 'cypress/support/component.ts',
    indexHtmlFile: 'cypress/support/component-index.html',
    video: false,
  },
});
