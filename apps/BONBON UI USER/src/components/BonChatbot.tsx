import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MessageCircleIcon, SendIcon, XIcon } from 'lucide-react';
import type { BonMessage, SectionId } from '../types/library';
import { useGame } from '../contexts/GameContext';


// Pixel-art BON cutout with a transparent background.
const BON_ART = "/bon-pixel.png";
const BON_BLINK = "/bon-blink.png";
const BON_EXCITED_FRAMES = ["/bon-excited-1.png", "/bon-excited-2.png"];
// Use the same BON artwork for the chat profile so the pet and chat identity
// always stay visually consistent.
const BON_AVATAR = BON_ART;

const EASE = [0.23, 1, 0.32, 1] as const;

interface Suggestion {
  label: string;
}

const DEFAULT_SUGGESTIONS: Suggestion[] = [
  { label: 'What should I read next?' },
  { label: 'Show my progress' },
  { label: 'Any rewards ready?' },
];


interface BonChatbotProps {
  /** When true BON leans out on her own; otherwise she stays tucked behind the edge. */
  autoPeek?: boolean;
}

export function BonChatbot({ autoPeek = true }: BonChatbotProps) {
  const { section, setSection, session, profile, borrowed, rank, coins, streak, volumeById, volumes, commissions, logs, claimed, enrolled } = useGame();
  const [peeking, setPeeking] = useState(autoPeek);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [blinking, setBlinking] = useState(false);
  const [excitedFrame, setExcitedFrame] = useState(0);
  const showBonSparkles = false;
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(DEFAULT_SUGGESTIONS);
  const [messages, setMessages] = useState<BonMessage[]>([
  {
    id: 'bon-hello',
    from: 'bon',
    text: 'Hi! I am BON, your Tankobonbon reading guide. Ask me about books, your account, progress, quests, or rewards.'
  }]
  );
  const logRef = useRef<HTMLDivElement>(null);
  const hoverIntentTimer = useRef<number | null>(null);

  // Lock body scroll while the mobile sheet is open
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!autoPeek) {
      setPeeking(false);
      return;
    }
    const timer = window.setTimeout(() => setPeeking(true), 900);
    return () => window.clearTimeout(timer);
  }, [autoPeek]);

  useEffect(() => {
    const openChat = () => { setPeeking(true); setOpen(true); };
    window.addEventListener('tankobonbon:open-chat', openChat);
    return () => window.removeEventListener('tankobonbon:open-chat', openChat);
  }, []);

  // BON blinks occasionally while idle, then switches to a two-frame excited
  // loop while hovered or keyboard-focused.
  useEffect(() => {
    if (hovered) {
      setBlinking(false);
      return;
    }

    let blinkTimer: number;
    let closeTimer: number;

    const scheduleBlink = () => {
      blinkTimer = window.setTimeout(() => {
        setBlinking(true);
        closeTimer = window.setTimeout(() => {
          setBlinking(false);
          scheduleBlink();
        }, 180);
      }, 3800);
    };

    scheduleBlink();
    return () => {
      window.clearTimeout(blinkTimer);
      window.clearTimeout(closeTimer);
    };
  }, [hovered]);

  useEffect(() => {
    if (!hovered) {
      setExcitedFrame(0);
      return;
    }

    const timer = window.setInterval(() => {
      setExcitedFrame((frame) => (frame + 1) % BON_EXCITED_FRAMES.length);
    }, 420);

    return () => window.clearInterval(timer);
  }, [hovered]);

  function beginHover() {
    if (hoverIntentTimer.current !== null) {
      window.clearTimeout(hoverIntentTimer.current);
    }
    hoverIntentTimer.current = window.setTimeout(() => setHovered(true), 180);
  }

  function endHover() {
    if (hoverIntentTimer.current !== null) {
      window.clearTimeout(hoverIntentTimer.current);
      hoverIntentTimer.current = null;
    }
    setHovered(false);
  }

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages, open]);

  function addBonReply(response: string, go?: SectionId) {
    setMessages((current) => [
      ...current,
      { id: `b-${crypto.randomUUID()}`, from: 'bon', text: response },
    ]);
    if (go) {
      window.setTimeout(() => setSection(go), 320);
    }
  }

  function fallbackAnswer(reason?: string) {
    addBonReply(reason === 'BON is not configured yet.'
      ? 'BON’s AI service is not configured yet. I can still answer catalog, progress, quest, and reward questions from the data available to me.'
      : reason && !reason.includes('connection') && !reason.includes('request failed')
        ? reason
        : 'Looks like my library connection is taking a moment. Try asking me again.');
  }

  async function askBon(text: string) {
    const trimmed = text.trim().slice(0, 500);
    if (!trimmed || thinking) return;
    const recentHistory = messages.slice(-6).map((message) => ({
      role: message.from === 'bon' ? 'assistant' : 'user',
      content: message.text.slice(0, 300),
    }));
    const queryWords = trimmed.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2 && !['book', 'books', 'what', 'which', 'there', 'about', 'should', 'read'].includes(word)) ?? [];
    const matchingBooks = queryWords.length ? volumes.filter((volume) => {
      const searchable = `${volume.title} ${volume.author} ${volume.genre} ${volume.synopsis}`.toLowerCase();
      return queryWords.some((word) => searchable.includes(word));
    }) : [];
    const availableBooks = volumes.filter((volume) => volume.copies > 0);
    const catalogForBon = (matchingBooks.length ? matchingBooks : availableBooks.length ? availableBooks : volumes).slice(0, 8);
    setMessages((current) => [...current, { id: `u-${crypto.randomUUID()}`, from: 'user', text: trimmed }]);
    setDraft('');
    setThinking(true);
    try {
      const response = await fetch('/api/bon-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          message: trimmed,
          history: recentHistory,
          context: {
            section,
            signedIn: Boolean(session),
            userName: profile ? `${profile.first_name} ${profile.last_name}`.trim() : undefined,
            rank,
            points: coins,
            streak,
            booksCompleted: logs.filter((log) => Boolean(log.returned_at)).length,
            activeReading: borrowed.flatMap((item) => {
              const volume = volumeById(item.volumeId);
              const log = logs.find((entry) => String(entry.book_id) === item.volumeId && !entry.returned_at);
              return volume ? [{ title: volume.title, minutes: log?.total_reading_minutes ?? 0, status: 'reading' }] : [];
            }),
            readingHistory: logs.filter((log) => Boolean(log.returned_at)).slice(-12).flatMap((log) => {
              const volume = volumeById(String(log.book_id));
              return volume ? [{ title: volume.title, genre: volume.genre }] : [];
            }),
            quests: commissions.filter((quest) => enrolled.includes(quest.id)).map((quest) => ({
              id: quest.id,
              name: quest.name,
              detail: quest.detail,
              points: quest.coins,
              status: quest.progress === 100 ? 'completed' : 'active',
            })),
            availableRewards: commissions.filter((quest) => quest.progress === 100 && !claimed.includes(quest.id)).map((quest) => ({
              id: quest.id,
              name: quest.name,
              detail: quest.detail,
              points: quest.coins,
              status: 'ready to claim',
            })),
            catalogSummary: {
              totalTitles: volumes.length,
              availableTitles: volumes.filter((volume) => volume.copies > 0).length,
              availabilityPending: volumes.filter((volume) => volume.copies <= 0).length,
            },
            catalog: catalogForBon.map((volume) => ({
              id: volume.id,
              title: volume.title,
              author: volume.author,
              genre: volume.genre,
              synopsis: volume.synopsis,
              availableCopies: volume.copies,
            })),
          },
        }),
      });
      const payload = await response.json() as { message?: unknown; navigateTo?: unknown; suggestions?: unknown; error?: unknown };
      if (!response.ok || typeof payload.message !== 'string' || !payload.message.trim()) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'BON request failed');
      }
      const destination = typeof payload.navigateTo === 'string' && ['archive', 'catalog', 'shelf', 'commissions', 'guide'].includes(payload.navigateTo)
        ? payload.navigateTo as SectionId
        : undefined;
      addBonReply(payload.message, destination);
      if (Array.isArray(payload.suggestions)) {
        const next = payload.suggestions
          .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
          .slice(0, 3)
          .map((label) => ({ label }));
        if (next.length) setSuggestions(next);
      }
    } catch (error) {
      fallbackAnswer(error instanceof Error ? error.message : undefined);
    } finally {
      setThinking(false);
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] right-0 z-50 flex items-end justify-end lg:bottom-4 lg:z-40">
      <AnimatePresence>
        {open ?
        <motion.div
          key="panel"
          initial={{ opacity: 0, x: 60, y: 24 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, x: 60, y: 24 }}
          transition={{ duration: 0.32, ease: EASE }}
          className="bon-chat-panel pointer-events-auto flex origin-bottom-right flex-col overflow-hidden border border-gold"
          role="dialog"
          aria-label="Chat with BON">
          
            <div className="bon-chat-header flex items-center gap-3 border-b border-gold/40 bg-umber px-4 py-3">
              <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[14px] border-2 border-sun bg-sand p-0.5 shadow-[0_2px_0_rgba(84,56,34,0.2)]">
                <img
                src={BON_AVATAR}
                alt="BON profile"
                className="h-full w-full scale-[3.2] object-cover object-[50%_17%]" />
              
                <span
                aria-hidden="true"
                className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-umber bg-emerald-400 shadow-[0_0_0_1px_rgba(255,221,116,0.6)]" />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-[13px] font-700 uppercase tracking-[0.16em] text-sand">
                  BON
                </span>
                <span className="block font-body text-[11px] font-600 text-sand/70">
                  Archive guide · online
                </span>
              </span>
              <button
              type="button"
              onClick={() => setOpen(false)}
              className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sand/70 transition-all duration-150 ease-out hover:bg-sand/10 hover:text-sun"
              aria-label="Close chat with BON">
              
                <XIcon aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>

            <div
            ref={logRef}
            className="bon-chat-log tb-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
            
              <div className="flex shrink-0 items-center gap-2 pb-1">
                <span className="font-body text-[9px] font-800 uppercase tracking-[0.2em] text-rust/65">
                  Live archive
                </span>
                <span aria-hidden="true" className="h-px flex-1 bg-gold/30" />
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]" />
              </div>

              {messages.map((message) =>
            <p
              key={message.id}
              className={`w-fit max-w-[86%] shrink-0 px-3.5 py-2.5 font-body text-[13px] font-600 leading-relaxed shadow-sm sm:text-sm ${
              message.from === 'bon' ?
              'tb-cut-sm rounded-2xl rounded-tl-sm border border-gold/45 bg-parch/40 text-umber' :
              'ml-auto rounded-2xl rounded-br-sm border border-gold bg-rust text-sand'}`
              }>
              
                  {message.text}
                </p>
            )}

              {thinking ?
              <p role="status" aria-live="polite" className="tb-cut-sm w-fit rounded-2xl rounded-tl-sm border border-gold/45 bg-parch/40 px-3.5 py-2.5 font-body text-[13px] font-600 text-umber/65 shadow-sm sm:text-sm">
                BON is searching the stacks...
              </p> : null}

              {/* Empty-state hint lives inside the scrollable log so it can
                  never push the composer out of the panel. */}
              {messages.length <= 1 ?
              <div className="bon-chat-empty mt-auto flex flex-col items-center gap-2 pt-4 text-center" aria-hidden="true">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-gold/35 bg-parch/25 text-rust/65">
                  <MessageCircleIcon className="h-[18px] w-[18px]" />
                </span>
                <span className="font-display text-[10px] font-700 uppercase tracking-[0.16em] text-umber/45">
                  Ask about books, quests, or your shelf
                </span>
              </div> : null}
            </div>

            <div className="bon-chat-footer shrink-0 border-t border-gold/25 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:pb-3">
              <div className="bon-chat-suggestions flex gap-2 overflow-x-auto px-4 pb-1 pt-3 lg:flex-wrap">
                {suggestions.map((suggestion) =>
              <button
                key={suggestion.label}
                type="button"
                disabled={thinking}
                onClick={() => void askBon(suggestion.label)}
                className="min-h-10 shrink-0 whitespace-nowrap rounded-full border border-gold/50 bg-parch/20 px-3.5 py-2 font-body text-[12px] font-700 leading-tight text-umber/80 transition-all duration-150 ease-out hover:-translate-y-px hover:border-gold hover:bg-parch/60 hover:text-umber disabled:cursor-wait disabled:opacity-50 lg:min-h-9 lg:py-1.5">

                    {suggestion.label}
                  </button>
              )}
              </div>

              <form
              className="bon-chat-composer flex items-center gap-2 px-4 pb-0 pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                void askBon(draft);
              }}>
            
              <label className="sr-only" htmlFor="bon-input">
                Message BON
              </label>
              <input
              id="bon-input"
              value={draft}
              disabled={thinking}
              maxLength={500}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask BON…"
              className="tb-cut-sm h-11 min-w-0 flex-1 border border-gold/50 bg-parch/20 px-4 font-body text-[16px] font-600 text-umber outline-none transition-colors duration-150 placeholder:text-umber/45 focus:border-gold focus:bg-parch/40" />
            
              <button
              type="submit"
              disabled={thinking || !draft.trim()}
              className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-gold bg-rust text-sand shadow-[0_3px_0_rgba(84,56,34,0.2)] transition-all duration-150 ease-out hover:-translate-y-0.5 hover:bg-umber active:translate-y-0 active:scale-95 disabled:cursor-wait disabled:opacity-50"
              aria-label="Send message">
              
                <SendIcon aria-hidden="true" className="h-4 w-4 transition-transform duration-150 ease-out group-hover:-rotate-12" />
              </button>
              </form>
            </div>
          </motion.div> :
        null}
        </AnimatePresence>

        <div className="bon-launcher-group pointer-events-none relative mr-3 flex items-end lg:mr-4">
          <AnimatePresence>
            {showBonSparkles && hovered && peeking && !open ?
            <motion.div
              aria-hidden="true"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.22, ease: EASE }}
              className="absolute bottom-[129px] right-[75px] h-[138px] w-[138px]">
              <motion.span
                animate={{ y: [4, -6, 4], rotate: [0, 12, 0], opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute left-1 top-3 text-[18px] text-rust">
                ✦
              </motion.span>
              <motion.span
                animate={{ y: [-3, 5, -3], rotate: [0, -14, 0], opacity: [0.25, 0.85, 0.25] }}
                transition={{ duration: 1.9, repeat: Infinity, ease: 'easeInOut', delay: 0.2 }}
                className="absolute right-1 top-9 text-[13px] text-gold">
                ✦
              </motion.span>
              <motion.span
                animate={{ scale: [0.75, 1.05, 0.75], opacity: [0.2, 0.8, 0.2] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: 0.45 }}
                className="absolute bottom-2 left-7 text-[11px] text-rust/80">
                ✧
              </motion.span>
            </motion.div> :
            null}
          </AnimatePresence>

          <AnimatePresence>
            {peeking && !open ?
            <motion.button
              key="bubble"
              type="button"
              onClick={() => setOpen(true)}
              initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={hovered ?
            { opacity: 1, y: [0, -2, 0], scale: [1, 1.015, 1] } :
            { opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.9 }}
            transition={hovered ?
            { y: { duration: 1.45, repeat: Infinity, ease: 'easeInOut' }, scale: { duration: 1.45, repeat: Infinity, ease: 'easeInOut' }, opacity: { duration: 0.2, ease: EASE, delay: 0.18 } } :
            { duration: 0.2, ease: EASE, delay: 0.18 }}
            className="bon-dialogue-trigger pointer-events-auto absolute flex items-center justify-center gap-1.5 whitespace-nowrap border border-gold/90 bg-cream/95 px-3 py-2 shadow-[0_8px_18px_rgba(84,56,34,0.16)]">
            
              <MessageCircleIcon aria-hidden="true" className="h-4 w-4 text-rust" />
              <span className="font-display text-[13px] font-700 uppercase tracking-[0.11em] text-umber">Ask BON</span>
              <span
              aria-hidden="true"
              className="absolute -bottom-[5px] left-1/2 h-[9px] w-[9px] rotate-45 border-b border-r border-gold bg-cream" />
            
            </motion.button> :
          null}
        </AnimatePresence>

        <motion.button
          type="button"
          onClick={() => peeking ? setOpen((value) => !value) : setPeeking(true)}
          onHoverStart={beginHover}
          onHoverEnd={endHover}
          onFocus={beginHover}
          onBlur={endHover}
          aria-label={peeking ? 'Chat with BON' : 'Call BON out'}
          initial={{ x: 200 }}
          animate={
          peeking ?
          hovered ?
          { x: 0, y: [0, -2, -6, -2, 0], rotate: [0, -1, 1, -0.5, 0], scale: [1, 1.01, 1.02, 1.01, 1], filter: ['brightness(1)', 'brightness(1.025)', 'brightness(1)'] } :
          { x: 0, y: [0, -5, 0], rotate: [0, -1.2, 0], scale: 1 } :
          { x: 200, y: 0, rotate: 0 }
          }
          transition={{
            x: { duration: 0.3, ease: EASE },
            y: { duration: hovered ? 1.45 : 3.2, repeat: Infinity, ease: 'easeInOut' },
            rotate: { duration: hovered ? 1.45 : 3.2, repeat: Infinity, ease: 'easeInOut' },
            scale: { duration: hovered ? 1.45 : 0.3, repeat: hovered ? Infinity : 0, ease: 'easeInOut' },
            filter: { duration: hovered ? 1.45 : 0.3, repeat: hovered ? Infinity : 0, ease: 'easeInOut' }
          }}
          whileTap={{ scale: 0.96 }}
          className={`bon-launcher pointer-events-auto relative rounded-full drop-shadow-[0_3px_6px_rgba(84,56,34,0.14)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-rust ${open ? 'hidden lg:block' : 'block'}`}>
          
          <img
            src={hovered ? BON_EXCITED_FRAMES[excitedFrame] : blinking ? BON_BLINK : BON_ART}
            alt="BON, the Tankobonbon archive guide, waving hello"
            draggable={false}
            className="bon-launcher-image absolute bottom-0 left-1/2 w-auto max-w-none -translate-x-1/2 select-none" />
          
        </motion.button>
      </div>
    </div>);

}
