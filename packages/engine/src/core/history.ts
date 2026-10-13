const LIMIT = 100;
/** Typing in quick succession is one change: going back lands before the burst, not in the middle of a word. */
const COALESCE_MS = 1000;

interface Track {
  undo: string[];
  redo: string[];
  /** when the last change was recorded, and whether it was typing */
  lastAt: number;
  lastTyping: boolean;
}

/** The earlier and later texts of each instance, so form and diagram edits (which have no editor of their own) can be undone. */
export class History {
  private tracks = new Map<string, Track>();

  private track(metamodel: string): Track {
    let t = this.tracks.get(metamodel);
    if (!t) this.tracks.set(metamodel, (t = { undo: [], redo: [], lastAt: 0, lastTyping: false }));
    return t;
  }

  /** The text of `metamodel` is about to change from `before`. `typing` changes made close together are one step. */
  record(metamodel: string, before: string, typing: boolean, now = Date.now()) {
    const t = this.track(metamodel);
    const continues = typing && t.lastTyping && now - t.lastAt < COALESCE_MS && t.undo.length > 0;
    if (!continues) {
      t.undo.push(before);
      if (t.undo.length > LIMIT) t.undo.shift();
    }
    t.redo = [];
    t.lastAt = now;
    t.lastTyping = typing;
  }

  /** The text to go back to (and remembers `current` for `redo`), or undefined when there is none. */
  undo(metamodel: string, current: string): string | undefined {
    const t = this.tracks.get(metamodel);
    const text = t?.undo.pop();
    if (text === undefined) return undefined;
    t!.redo.push(current);
    t!.lastTyping = false;
    return text;
  }

  redo(metamodel: string, current: string): string | undefined {
    const t = this.tracks.get(metamodel);
    const text = t?.redo.pop();
    if (text === undefined) return undefined;
    t!.undo.push(current);
    t!.lastTyping = false;
    return text;
  }

  canUndo(metamodel: string) { return (this.tracks.get(metamodel)?.undo.length ?? 0) > 0; }
  canRedo(metamodel: string) { return (this.tracks.get(metamodel)?.redo.length ?? 0) > 0; }

  /** Forget one instance, or all of them. */
  clear(metamodel?: string) {
    if (metamodel === undefined) this.tracks.clear();
    else this.tracks.delete(metamodel);
  }
}
