import { serveBango } from '@bango/engine/worker';

// Langium runs here, off the UI thread; the page talks to it through connectBango()
serveBango();
