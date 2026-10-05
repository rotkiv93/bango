// The worker script of the self-contained build (dist/bundle/bango.worker.js): load it with
// `new Worker(url, { type: 'module' })` and talk to it with `connectBango(worker)`.
import { serveBango } from '../worker/index.js';

serveBango();
