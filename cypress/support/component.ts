import type { ReactElement } from 'react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Cypress 15's bundled `cypress/react` targets React 18+ (react-dom/client
// `createRoot`). This repo is React 17, so we mount with the legacy ReactDOM
// API. `@types/react-dom` is not installed, so type only what we use.
const ReactDOM: {
  render: (element: ReactElement, container: Element | null) => void;
  unmountComponentAtNode: (container: Element) => boolean;
} = require('react-dom');

// Minimal i18n init so `useTranslation` returns keys verbatim (t('Create') === 'Create').
// The console host normally provides the i18n instance; here we only need stable labels.
if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {},
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

const ROOT_SELECTOR = '[data-cy-root]';

const unmount = () => {
  const root = document.querySelector(ROOT_SELECTOR);
  if (root) ReactDOM.unmountComponentAtNode(root);
};

beforeEach(unmount);
afterEach(unmount);

Cypress.Commands.add('mount', (jsx: ReactElement) => {
  cy.then(() => {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) {
      throw new Error(`${ROOT_SELECTOR} not found — check component-index.html`);
    }
    ReactDOM.render(jsx, root);
  });
  return cy.get(ROOT_SELECTOR);
});

declare global {
  namespace Cypress {
    interface Chainable {
      mount: (jsx: ReactElement) => Chainable<JQuery<HTMLElement>>;
    }
  }
}
