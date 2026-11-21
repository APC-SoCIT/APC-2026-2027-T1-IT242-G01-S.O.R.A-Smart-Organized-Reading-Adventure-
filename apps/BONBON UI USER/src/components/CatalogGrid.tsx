import { motion } from 'framer-motion';
import { BookOpenIcon, StarIcon } from 'lucide-react';
import type { Volume } from '../types/library';
import { useGame } from '../contexts/GameContext';

interface CatalogGridProps {
  items: Volume[];
  layout: 'grid' | 'list';
  onSelect: (volume: Volume) => void;
}

export function CatalogGrid({ items, layout, onSelect }: CatalogGridProps) {
  const { isBorrowed, borrow, session, busy } = useGame();
  const startReading = (id: string) => {
    if (!session) {
      window.dispatchEvent(new Event('tankobonbon:open-auth'));
      return;
    }
    void borrow(id);
  };
  const actionLabel = (volume: Volume) => !session ? 'Sign in to read' : isBorrowed(volume.id) ? 'On your shelf' : volume.copies > 0 ? 'Start reading' : 'Ask staff';

  if (items.length === 0) {
    return <div className="tb-state tb-cut-sm"><BookOpenIcon aria-hidden="true" className="mx-auto h-8 w-8 text-gold" /><h3 className="mt-3 font-display text-lg font-800 text-umber">No matching books</h3><p className="mx-auto mt-2 max-w-md text-sm font-600 leading-6 text-umber/60">Try a different title, author, genre, or clear your filters.</p></div>;
  }

  if (layout === 'list') {
    return (
      <ul className="tb-list-panel overflow-hidden rounded-xl border border-gold/30 bg-cream/85 shadow-sm">
        {items.map((volume) => (
          <li key={volume.id} className="tb-list-row grid grid-cols-1 items-center gap-3 border-b border-gold/20 px-3 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4 sm:px-4">
            <button type="button" onClick={() => onSelect(volume)} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3 text-left sm:gap-4">
              <Cover volume={volume} compact />
              <span className="min-w-0 text-left"><span className="block truncate font-display text-sm font-800 text-umber sm:text-base">{volume.title}</span><span className="mt-0.5 block truncate text-xs font-600 text-umber/55">{volume.author} · {volume.genre}</span><span className="mt-1 flex items-center gap-1 text-[11px] font-800 text-gold"><StarIcon aria-hidden="true" className="h-3 w-3 fill-sun text-sun" />{volume.rating || 'New'}</span></span>
            </button>
            {!(session && volume.copies <= 0) && <button type="button" disabled={busy || isBorrowed(volume.id)} onClick={() => startReading(volume.id)} className="tb-button-secondary tb-cut-sm min-h-11 w-full px-3 text-[10px] uppercase tracking-[.08em] sm:w-auto sm:px-4 sm:text-xs">{actionLabel(volume)}</button>}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-5 xl:grid-cols-4">
      {items.map((volume, index) => (
        <motion.li key={volume.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, delay: Math.min(index * 0.035, 0.2), ease: [0.23, 1, 0.32, 1] }} className="tb-book-card group flex min-w-0 flex-col">
          <button type="button" onClick={() => onSelect(volume)} className="min-w-0 text-left">
            <Cover volume={volume} />
            <span className="mt-3 block truncate font-display text-sm font-800 text-umber sm:text-[15px]">{volume.title}</span>
            <span className="mt-0.5 block truncate text-[11px] font-600 text-umber/55 sm:text-xs">{volume.author}</span>
            <span className="mt-2 flex items-center justify-between gap-2"><span className="truncate text-[10px] font-800 uppercase tracking-[.1em] text-gold">{volume.genre}</span><span className="flex shrink-0 items-center gap-1 text-[11px] font-800 text-gold"><StarIcon aria-hidden="true" className="h-3 w-3 fill-sun text-sun" />{volume.rating || 'New'}</span></span>
          </button>
          {!(session && volume.copies <= 0) && <button type="button" disabled={busy || isBorrowed(volume.id)} onClick={() => startReading(volume.id)} className="tb-button-secondary tb-cut-sm mt-3 min-h-10 w-full px-2 text-[10px] uppercase tracking-[.08em] sm:text-[11px]"><BookOpenIcon aria-hidden="true" className="h-3.5 w-3.5 text-gold" />{actionLabel(volume)}</button>}
        </motion.li>
      ))}
    </ul>
  );
}

function Cover({ volume, compact = false }: { volume: Volume; compact?: boolean }) {
  const { isBorrowed } = useGame();
  const plate = Array.isArray(volume.plate) && volume.plate.length ? volume.plate : [volume.title || 'Untitled book'];
  return (
    <span className={`tb-book-cover relative block shrink-0 overflow-visible border-2 border-gold bg-cream p-[3px] shadow-[0_8px_20px_rgba(84,56,34,.11)] transition duration-300 group-hover:-translate-y-1.5 group-hover:shadow-[0_18px_34px_rgba(84,56,34,.2)] ${compact ? 'h-16 w-11' : 'w-full'}`}>
      <span className={`relative flex overflow-hidden ${compact ? 'h-full' : 'aspect-[3/4]'}`} style={{ backgroundColor: volume.plateColor }}>
        {volume.coverImage ? <img src={volume.coverImage} alt={`${volume.title} book cover`} className="h-full w-full bg-cream object-contain" onError={(event) => { event.currentTarget.src = '/book-placeholder.svg'; }} /> : <span className={`relative mt-auto block p-3 font-display font-900 uppercase leading-[1.05] ${compact ? 'text-[7px]' : 'text-base sm:text-lg'}`} style={{ color: volume.plateInk }}>{plate.map((line, index) => <span key={`${line}-${index}`} className="block">{line}</span>)}</span>}
        {!compact && <span aria-hidden="true" className="pointer-events-none absolute inset-2 border border-current opacity-25" style={{ color: volume.plateInk }} />}
        {!compact && (isBorrowed(volume.id) || volume.catalogStatus) && <span className={`absolute left-0 top-3 border-y border-r border-umber px-2 py-1 text-[8px] font-800 uppercase tracking-[.12em] ${isBorrowed(volume.id) ? 'bg-sun text-umber' : 'bg-cream text-rust'}`}>{isBorrowed(volume.id) ? 'On shelf' : volume.catalogStatus}</span>}
      </span>
      {!compact && <span className="absolute -right-1.5 -top-1.5 flex h-7 w-7 rotate-45 items-center justify-center border border-umber bg-sun"><span className="-rotate-45 font-display text-[9px] font-900 text-umber">{volume.volume}</span></span>}
    </span>
  );
}
