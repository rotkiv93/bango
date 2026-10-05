import type { EngineApi, Range0 } from '@bango/engine';
import { ModelRenderer } from './model-renderer.js';
import type { ViewKind } from './types.js';

/**
 * Defines `<bango-instance metamodel="datamodel" view="form">`. Give it an engine with `el.engine = bango`;
 * change `view` or `metamodel` at any time. A view asking to show a source position fires a bubbling
 * `bango-reveal` event (detail: `{ metamodel, range }`); cancel it to handle the request yourself.
 */
export function defineBangoElements(registry: CustomElementRegistry = customElements): void {
  if (registry.get('bango-instance')) return;

  class BangoInstance extends HTMLElement {
    static observedAttributes = ['metamodel', 'view'];
    private _engine?: EngineApi;
    private renderer?: ModelRenderer;

    get engine(): EngineApi | undefined { return this._engine; }
    set engine(value: EngineApi | undefined) {
      this._engine = value;
      void this.connect();
    }

    connectedCallback() {
      if (!this.style.display) this.style.display = 'block';
      void this.connect();
    }

    disconnectedCallback() {
      this.renderer?.dispose();
      this.renderer = undefined;
    }

    attributeChangedCallback(name: string) {
      if (!this.renderer) return;
      if (name === 'view') void this.renderer.setView(this.view);
      else void this.renderer.setMetamodel(this.getAttribute('metamodel') ?? '');
    }

    private get view(): ViewKind { return this.getAttribute('view') || 'text'; }

    private async connect() {
      const metamodel = this.getAttribute('metamodel');
      if (this.renderer || !this._engine || !metamodel || !this.isConnected) return;
      const renderer = (this.renderer = new ModelRenderer(this._engine, {
        onReveal: (m: string, range: Range0) => {
          const proceed = this.dispatchEvent(new CustomEvent('bango-reveal', { detail: { metamodel: m, range }, bubbles: true, cancelable: true }));
          if (proceed && m === this.getAttribute('metamodel')) void renderer.reveal(range);
        }
      }));
      await renderer.mount(this, metamodel, this.view);
    }
  }

  registry.define('bango-instance', BangoInstance);
}
