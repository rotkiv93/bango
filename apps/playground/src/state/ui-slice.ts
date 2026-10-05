import type { StateCreator } from 'zustand';
import type { ViewKind } from '@bango/renderer';
import { monaco } from '../monaco.js';
import { loadTheme, saveTheme } from './persistence.js';
import type { State, Theme, UiSlice } from './types.js';

const applyTheme = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
  monaco.editor.setTheme(theme === 'light' ? 'vs' : 'vs-dark');
};

export const createUiSlice: StateCreator<State, [], [], UiSlice> = (set, get) => {
  let toastId = 0;

  return {
    theme: loadTheme(),
    toasts: [],
    page: 'projects',
    activeTab: 'overview',
    instanceView: 'text',
    split: false,
    overviewView: 'diagram',
    metamodelView: 'grammar',

    go: page => set({ page }),

    toast(kind, text) {
      const id = ++toastId;
      set({ toasts: [...get().toasts, { id, kind, text }] });
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
    },
    dismissToast: id => set({ toasts: get().toasts.filter(t => t.id !== id) }),

    initTheme: () => applyTheme(get().theme),
    toggleTheme() {
      const theme: Theme = get().theme === 'dark' ? 'light' : 'dark';
      saveTheme(theme);
      applyTheme(theme);
      set({ theme });
    },

    selectTab: tab => set({ activeTab: tab }),
    setInstanceView: view => set({ instanceView: view }),
    setSplit: split => set({ split, ...(split && get().instanceView === 'text' ? { instanceView: 'form' as ViewKind } : {}) }),
    setOverviewView: view => set({ overviewView: view }),

    revealInText(metamodel, range) {
      // in split mode the text is already beside the view, so keep the view as it is
      set({
        activeTab: metamodel,
        ...(get().split ? {} : { instanceView: 'text' as ViewKind }),
        reveal: { metamodel, range, nonce: Date.now() }
      });
    },

    selectGrammar: name => set({ activeGrammar: name }),

    setMetamodelView(view) {
      const { activeGrammar } = get();
      if (activeGrammar && (view === 'constraints' || view === 'spec' || view === 'import')) get().ensureScript(view, activeGrammar);
      set({ metamodelView: view });
    }
  };
};
