import {useEffect, useId, useMemo, useRef, useState} from 'react';
import {Icon} from './Visuals';

export interface CommandAction {
  id: string;
  label: string;
  description?: string;
  keywords?: string;
  shortcut?: string;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  actions: readonly CommandAction[];
  open: boolean;
  onClose: () => void;
}

/** A keyboard-first launcher. The host owns the Cmd/Ctrl+K shortcut. */
export function CommandPalette({actions, open, onClose}: CommandPaletteProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  closeRef.current = onClose;

  const matches = useMemo(() => {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return actions.filter(action => {
      const text = `${action.label} ${action.description ?? ''} ${action.keywords ?? ''}`.toLocaleLowerCase();
      return terms.every(term => text.includes(term));
    });
  }, [actions, query]);
  const selected = Math.min(highlight, Math.max(0, matches.length - 1));

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const backdrop = dialog?.closest('.command-backdrop');
    const background = Array.from(backdrop?.parentElement?.children ?? [])
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop)
      .map(element => ({element, inert: element.inert}));
    background.forEach(({element}) => {element.inert = true;});
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setQuery('');
    setHighlight(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());

    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('input, button:not([disabled]):not([tabindex="-1"])'));
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', keydown, true);
      document.body.style.overflow = previousOverflow;
      background.forEach(({element, inert}) => {element.inert = inert;});
      // Respect actions that deliberately move focus to another view.
      const active = document.activeElement;
      if (previous?.isConnected && (!active || active === document.body || dialog?.contains(active))) {
        previous.focus({preventScroll: true});
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.querySelector<HTMLElement>('[data-selected="true"]')?.scrollIntoView?.({block: 'nearest'});
  }, [open, selected, query]);

  if (!open) return null;

  function choose(action: CommandAction) {
    onClose();
    // Run after the dialog closes and restores focus, so destination actions
    // can intentionally focus their own input without cleanup stealing it.
    requestAnimationFrame(() => action.onSelect());
  }

  return <div className="command-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div ref={dialogRef} className="command-dialog" role="dialog" aria-modal="true" aria-label="Quick actions" aria-describedby={`${id}-help`} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (matches.length) setHighlight((selected + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
      } else if (event.key === 'Enter' && event.target === inputRef.current && matches[selected]) {
        event.preventDefault();
        choose(matches[selected]);
      }
    }}>
      <div className="command-input-wrap">
        <Icon name="search" size={21} />
        <input ref={inputRef} type="text" role="combobox" aria-label="Search quick actions" aria-autocomplete="list" aria-expanded="true" aria-controls={`${id}-results`} aria-activedescendant={matches[selected] ? `${id}-action-${selected}` : undefined} autoComplete="off" spellCheck={false} value={query} placeholder="Find your next move…" onChange={event => {
          setQuery(event.target.value);
          setHighlight(0);
        }} />
        <button type="button" aria-label="Close quick actions" onClick={onClose}><Icon name="close" size={18} /></button>
      </div>
      <div className="command-results" id={`${id}-results`} role="listbox" aria-label="Available actions">
        {matches.map((action, index) => <button key={action.id} id={`${id}-action-${index}`} className="command-item" type="button" role="option" aria-selected={selected === index} data-selected={selected === index} tabIndex={-1} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setHighlight(index)} onClick={() => choose(action)}>
          <Icon name="arrow" size={18} />
          <span><strong>{action.label}</strong>{action.description && <small>{action.description}</small>}</span>
          {action.shortcut && <kbd>{action.shortcut}</kbd>}
        </button>)}
      </div>
      {matches.length === 0 && <div className="command-empty" role="status"><Icon name="search" size={24} /><strong>No matching actions</strong><span>Try “revenue”, “theme”, or “export”.</span></div>}
      <div className="command-footer" id={`${id}-help`}>
        <span><Icon name="command" size={14} /> Quick actions</span>
        <span><kbd>↑</kbd><kbd>↓</kbd> Navigate <kbd>↵</kbd> Select <kbd>esc</kbd> Close</span>
      </div>
    </div>
  </div>;
}
