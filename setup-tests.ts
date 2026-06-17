// jsdom does not expose TextEncoder/TextDecoder, which react-router v7 (and other
// libs) reference at module load. Polyfill them before any test module imports run.
import { TextEncoder, TextDecoder } from 'util';

Object.assign(global, { TextEncoder, TextDecoder });

import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

configure({ testIdAttribute: 'data-test' });
