/**
 * combobox.ts — the Daily's type-ahead: an ARIA 1.2 combobox over molecule
 * names (the input owns focus; the list is announced through
 * aria-activedescendant).
 *
 *   type        filters by name and other names, word starts first
 *   ↓ / ↑       moves through the list (wraps); opens it when closed
 *   Enter       guesses the highlighted name, else submits the form as typed
 *   Esc         closes the list, then clears the box
 *   tap/click   fills the box (a tap never spends a guess by itself)
 */
import type { DailyPoolEntry } from './secret';

export interface ComboboxOptions {
  input: HTMLInputElement;
  list: HTMLUListElement;
  entries: DailyPoolEntry[];
  /** Keys already guessed: listed, marked, not pickable. */
  isUsed(key: string): boolean;
  /** Enter on a highlighted option: guess it now. */
  onCommit(entry: DailyPoolEntry): void;
}

export interface Combobox {
  /** The entry the box names exactly (by name or another name), or the only match. */
  resolve(): DailyPoolEntry | null;
  close(): void;
  clear(): void;
  destroy(): void;
}

const MAX_OPTIONS = 8;

/** Lowercase, no accents, letters and digits only. */
export function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface Indexed {
  entry: DailyPoolEntry;
  names: Array<{ text: string; norm: string; compact: string; words: string[] }>;
}

interface Match {
  entry: DailyPoolEntry;
  /** The name that matched (an alias when it was not the display name). */
  via: string;
  rank: number;
}

function index(entries: DailyPoolEntry[]): Indexed[] {
  return entries.map((entry) => ({
    entry,
    names: [entry.n, ...(entry.a ?? [])].map((text) => {
      const norm = normalizeName(text);
      return { text, norm, compact: norm.replace(/ /g, ''), words: norm.split(' ') };
    }),
  }));
}

function search(indexed: Indexed[], query: string): Match[] {
  const q = normalizeName(query);
  if (!q) return [];
  const qc = q.replace(/ /g, '');
  const matches: Match[] = [];
  for (const item of indexed) {
    let best: Match | null = null;
    for (let i = 0; i < item.names.length; i += 1) {
      const name = item.names[i];
      let rank = -1;
      if (name.norm === q || name.compact === qc) rank = 0;
      else if (name.norm.startsWith(q) || name.compact.startsWith(qc)) rank = 1;
      else if (name.words.some((word) => word.startsWith(q))) rank = 2;
      else if (name.compact.includes(qc)) rank = 3;
      if (rank < 0) continue;
      // The display name wins a tie with an alias.
      const score = rank * 2 + (i === 0 ? 0 : 1);
      if (!best || score < best.rank) best = { entry: item.entry, via: name.text, rank: score };
    }
    if (best) matches.push(best);
  }
  matches.sort((a, b) => a.rank - b.rank || a.entry.n.length - b.entry.n.length || a.entry.n.localeCompare(b.entry.n));
  return matches;
}

let uid = 0;

export function createCombobox(opts: ComboboxOptions): Combobox {
  const { input, list } = opts;
  const indexed = index(opts.entries);
  const prefix = `dl-opt-${(uid += 1)}`;
  let matches: Match[] = [];
  let active = -1;
  let open = false;

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);
  list.setAttribute('role', 'listbox');

  function setOpen(next: boolean): void {
    open = next && matches.length > 0;
    list.hidden = !open;
    input.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) {
      active = -1;
      input.removeAttribute('aria-activedescendant');
    }
  }

  function render(): void {
    list.replaceChildren();
    matches.slice(0, MAX_OPTIONS).forEach((match, i) => {
      const used = opts.isUsed(match.entry.k);
      const li = document.createElement('li');
      li.id = `${prefix}-${i}`;
      li.setAttribute('role', 'option');
      li.className = 'dl-option';
      li.setAttribute('aria-selected', i === active ? 'true' : 'false');
      if (used) li.setAttribute('aria-disabled', 'true');
      const name = document.createElement('span');
      name.className = 'dl-option__name';
      name.textContent = match.via;
      li.appendChild(name);
      if (match.via !== match.entry.n) {
        const also = document.createElement('span');
        also.className = 'dl-option__also';
        also.textContent = match.entry.n;
        li.appendChild(also);
      }
      if (used) {
        const tag = document.createElement('span');
        tag.className = 'dl-option__used';
        tag.textContent = 'guessed';
        li.appendChild(tag);
      }
      li.addEventListener('pointerdown', (event) => event.preventDefault());
      li.addEventListener('click', () => {
        if (used) return;
        input.value = match.entry.n;
        matches = [];
        setOpen(false);
        input.focus();
      });
      list.appendChild(li);
    });
    if (active >= 0) input.setAttribute('aria-activedescendant', `${prefix}-${active}`);
    else input.removeAttribute('aria-activedescendant');
  }

  function update(): void {
    matches = search(indexed, input.value);
    active = -1;
    render();
    setOpen(document.activeElement === input);
  }

  function move(delta: number): void {
    if (!open) {
      matches = search(indexed, input.value);
      render();
      setOpen(true);
      if (!open) return;
    }
    const count = Math.min(MAX_OPTIONS, matches.length);
    active = active < 0 ? (delta > 0 ? 0 : count - 1) : (active + delta + count) % count;
    render();
    document.getElementById(`${prefix}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }

  const onInput = () => update();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      if (open && active >= 0) {
        const match = matches[active];
        event.preventDefault();
        if (opts.isUsed(match.entry.k)) return;
        input.value = match.entry.n;
        matches = [];
        setOpen(false);
        opts.onCommit(match.entry);
      } else {
        setOpen(false);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        setOpen(false);
      } else if (input.value) {
        event.preventDefault();
        input.value = '';
      }
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };
  const onFocus = () => {
    if (input.value) update();
  };
  const onBlur = () => setOpen(false);

  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('focus', onFocus);
  input.addEventListener('blur', onBlur);

  return {
    resolve() {
      const q = normalizeName(input.value);
      if (!q) return null;
      const found = search(indexed, input.value);
      // rank 0: the display name exactly; 1: another name exactly.
      const exact = found.find((match) => match.rank <= 1);
      if (exact) return exact.entry;
      const live = found.filter((match) => !opts.isUsed(match.entry.k));
      return live.length === 1 ? live[0].entry : null;
    },
    close() {
      setOpen(false);
    },
    clear() {
      input.value = '';
      matches = [];
      setOpen(false);
    },
    destroy() {
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKeyDown);
      input.removeEventListener('focus', onFocus);
      input.removeEventListener('blur', onBlur);
    },
  };
}
