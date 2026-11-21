type RequestLike = { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type ResponseLike = { status: (code: number) => ResponseLike; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };
type ChatMessage = { role: 'user' | 'assistant'; content: string };
type Intent = 'BOOK' | 'PROGRESS' | 'QUEST' | 'REWARD' | 'ACCOUNT' | 'IDENTITY' | 'PROJECT' | 'GENERAL';
type CatalogBook = { id: string; title: string; author: string; genre: string; synopsis: string; availableCopies: number };
type Quest = { id: string; name: string; detail: string; points: number; status: string };
type Reading = { title: string; minutes: number; status: string };
type ReadingHistory = { title: string; genre: string };
type CatalogSummary = { totalTitles: number; availableTitles: number; availabilityPending: number };
type ChatContext = { section: string; signedIn?: boolean; userName?: string; rank?: string; points?: number; streak?: number; booksCompleted?: number; activeReading?: Reading[]; readingHistory?: ReadingHistory[]; quests?: Quest[]; availableRewards?: Quest[]; catalog?: CatalogBook[]; catalogSummary?: CatalogSummary };
type AiAudit = { request_id?: string; status?: 'ALLOWED' | 'REJECTED'; reason?: string | null };

const ALLOWED_SECTIONS = new Set(['archive', 'catalog', 'shelf', 'commissions', 'guide']);
const WINDOW_MS = 60 * 60 * 1000;
const REQUESTS_PER_WINDOW = 30;
const buckets = new Map<string, { count: number; resetAt: number }>();

function header(request: RequestLike, name: string) {
  const value = request.headers[name] ?? request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function clientId(request: RequestLike) {
  return header(request, 'x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function allowed(id: string) {
  const now = Date.now();
  const current = buckets.get(id);
  if (!current || current.resetAt <= now) {
    buckets.set(id, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (current.count >= REQUESTS_PER_WINDOW) return false;
  current.count += 1;
  return true;
}

function cleanText(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function boundedNumber(value: unknown, max = 1_000_000_000) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(max, number)) : 0;
}

function detectIntent(message: string): Intent {
  const value = message.toLowerCase();
  if (/\b(who am i|what(?:'s| is) my name|do you know me)\b/.test(value)) return 'IDENTITY';
  if (/\b(rewards?|claim|prizes?|unlocks?)\b/.test(value)) return 'REWARD';
  if (/\b(quests?|commissions?|challenges?)\b/.test(value)) return 'QUEST';
  if (/\b(progress|reading|finished|completed|minutes?|history|streak)\b/.test(value)) return 'PROGRESS';
  if (/\b(xp|points?|ranks?|levels?|achievements?)\b/.test(value)) return 'ACCOUNT';
  if (/\b(books?|mangas?|titles?|authors?|genres?|mood|read next|recommend|similar|available|catalog|funny|cozy|comfort|exciting|adventure|emotional)\b|\b(do you have|is there|in the library|in your library|something light|something dark|looking for)\b/.test(value)) return 'BOOK';
  if (/\b(app|website|feature|navigate|where|how do i|s\.o\.r\.a|sora|tankobonbon)\b/.test(value)) return 'PROJECT';
  return 'GENERAL';
}

function requestCategory(intent: Intent) {
  if (intent === 'BOOK') return 'CATALOG';
  if (intent === 'QUEST' || intent === 'REWARD') return 'QUEST_HELP';
  if (intent === 'ACCOUNT' || intent === 'PROGRESS' || intent === 'IDENTITY') return 'ACCOUNT_HELP';
  return 'GENERAL_LIBRARY';
}

function guardMessage(message: string, intent: Intent) {
  const normalized = message.toLowerCase().trim();
  if (normalized.length < 2) return 'Please enter a complete library-related question.';
  if (normalized.length > 500) return 'Requests are limited to 500 characters.';
  if (/(ignore (all |the )?(previous|system)|system prompt|developer message|jailbreak|bypass (the )?(rules|guardrails)|api[_ -]?key|service[_ -]?role|password|drop table|delete from|alter table)/.test(normalized)) return 'That request contains unsafe instructions or asks for protected information.';
  if (/(explicit sexual|porn|nude|rape|how to kill|make a bomb|self[ -]?harm|suicide instructions)/.test(normalized)) return 'That request is not appropriate for the library assistant.';
  const conversational = /^(hi|hello|hey|good morning|good afternoon|good evening|kamusta|kumusta|thanks|thank you|salamat|help|help me)( bon)?[?!.]*$/.test(normalized);
  if (intent === 'GENERAL' && !conversational) return 'Please ask BON about books, reading, your account, quests, rewards, or the S.O.R.A. library.';
  return null;
}

async function recordAiRequest(request: RequestLike, prompt: string, intent: Intent): Promise<AiAudit | null> {
  const authorization = header(request, 'authorization');
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!authorization?.startsWith('Bearer ') || !url || !key) return null;
  const result = await fetch(`${url}/rest/v1/rpc/record_ai_request`, {
    method: 'POST',
    headers: { apikey: key, Authorization: authorization, 'Content-Type': 'application/json', 'Content-Profile': 'sora_v2' },
    body: JSON.stringify({ p_prompt: prompt, p_category: requestCategory(intent) }),
  });
  if (!result.ok) {
    console.error('AI request audit failed', result.status, (await result.text()).slice(0, 200));
    return null;
  }
  return await result.json() as AiAudit;
}

async function completeAiRequest(request: RequestLike, requestId: string | undefined, responseText: string) {
  const authorization = header(request, 'authorization');
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!requestId || !authorization?.startsWith('Bearer ') || !url || !key) return;
  const result = await fetch(`${url}/rest/v1/rpc/complete_ai_request`, {
    method: 'POST',
    headers: { apikey: key, Authorization: authorization, 'Content-Type': 'application/json', 'Content-Profile': 'sora_v2' },
    body: JSON.stringify({ p_request_id: requestId, p_response_text: responseText }),
  });
  if (!result.ok) console.error('AI response audit failed', result.status, (await result.text()).slice(0, 200));
}

function parseQuest(value: unknown): Quest | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const id = cleanText(item.id, 40);
  const name = cleanText(item.name, 120);
  if (!id || !name) return null;
  return { id, name, detail: cleanText(item.detail, 240), points: boundedNumber(item.points, 1_000_000), status: cleanText(item.status, 24) || 'unknown' };
}

function parseReading(value: unknown): Reading | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const title = cleanText(item.title, 160);
  return title ? { title, minutes: boundedNumber(item.minutes, 1_000_000), status: cleanText(item.status, 24) } : null;
}

function parseReadingHistory(value: unknown): ReadingHistory | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const title = cleanText(item.title, 160);
  return title ? { title, genre: cleanText(item.genre, 100) || 'Uncategorized' } : null;
}

function parseBody(body: unknown) {
  if (!body || typeof body !== 'object') return null;
  const input = body as Record<string, unknown>;
  const message = cleanText(input.message, 2_000);
  if (!message) return null;
  let intent = detectIntent(message);
  const history = Array.isArray(input.history) ? input.history.slice(-6).flatMap((item): ChatMessage[] => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Record<string, unknown>;
    const role = candidate.role === 'user' ? 'user' : candidate.role === 'assistant' ? 'assistant' : null;
    const content = cleanText(candidate.content, 400);
    return role && content ? [{ role, content }] : [];
  }) : [];
  const raw = input.context && typeof input.context === 'object' ? input.context as Record<string, unknown> : {};
  if (intent === 'GENERAL' && Array.isArray(raw.catalog)) {
    const lowerMessage = message.toLowerCase();
    const namesSuppliedBook = raw.catalog.some((value) => {
      if (!value || typeof value !== 'object') return false;
      const title = cleanText((value as Record<string, unknown>).title, 160).toLowerCase();
      return title.length > 1 && lowerMessage.includes(title);
    });
    if (namesSuppliedBook) intent = 'BOOK';
  }
  const context: ChatContext = { section: ALLOWED_SECTIONS.has(String(raw.section)) ? String(raw.section) : 'archive' };

  if (intent === 'IDENTITY') {
    context.signedIn = raw.signedIn === true;
    context.userName = cleanText(raw.userName, 120);
  }

  if (intent === 'ACCOUNT' || intent === 'PROGRESS' || intent === 'REWARD') {
    context.rank = cleanText(raw.rank, 20) || 'F';
    context.points = boundedNumber(raw.points);
    context.streak = boundedNumber(raw.streak, 100_000);
  }
  if (intent === 'PROGRESS') {
    context.booksCompleted = boundedNumber(raw.booksCompleted, 100_000);
    context.activeReading = Array.isArray(raw.activeReading) ? raw.activeReading.slice(0, 3).map(parseReading).filter((item): item is Reading => Boolean(item)) : [];
  }
  if (intent === 'QUEST' || intent === 'PROGRESS') {
    context.quests = Array.isArray(raw.quests) ? raw.quests.slice(0, 6).map(parseQuest).filter((item): item is Quest => Boolean(item)) : [];
  }
  if (intent === 'REWARD') {
    context.availableRewards = Array.isArray(raw.availableRewards) ? raw.availableRewards.slice(0, 5).map(parseQuest).filter((item): item is Quest => Boolean(item)) : [];
  }
  if (intent === 'BOOK') {
    context.catalog = Array.isArray(raw.catalog) ? raw.catalog.slice(0, 8).flatMap((value): CatalogBook[] => {
      if (!value || typeof value !== 'object') return [];
      const book = value as Record<string, unknown>;
      const id = cleanText(book.id, 40);
      const title = cleanText(book.title, 160);
      return id && title ? [{ id, title, author: cleanText(book.author, 120) || 'Unknown author', genre: cleanText(book.genre, 100) || 'Uncategorized', synopsis: cleanText(book.synopsis, 240), availableCopies: boundedNumber(book.availableCopies, 999) }] : [];
    }) : [];
    context.activeReading = Array.isArray(raw.activeReading) ? raw.activeReading.slice(0, 3).map(parseReading).filter((item): item is Reading => Boolean(item)) : [];
    context.readingHistory = Array.isArray(raw.readingHistory) ? raw.readingHistory.slice(0, 12).map(parseReadingHistory).filter((item): item is ReadingHistory => Boolean(item)) : [];
    const summary = raw.catalogSummary && typeof raw.catalogSummary === 'object' ? raw.catalogSummary as Record<string, unknown> : {};
    context.catalogSummary = {
      totalTitles: boundedNumber(summary.totalTitles, 100_000),
      availableTitles: boundedNumber(summary.availableTitles, 100_000),
      availabilityPending: boundedNumber(summary.availabilityPending, 100_000),
    };
  }
  return { message, history, intent, context };
}

function recommendationScore(book: CatalogBook, request: string, history: ReadingHistory[], activeReading: Reading[]) {
  const haystack = `${book.title} ${book.author} ${book.genre} ${book.synopsis}`.toLowerCase();
  const words = request.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2 && !['book', 'books', 'read', 'recommend', 'suggest', 'something', 'looking', 'want'].includes(word)) ?? [];
  const preferredGenres = new Set(history.map((item) => item.genre.toLowerCase()).filter((genre) => genre !== 'uncategorized'));
  let score = words.reduce((total, word) => total + (haystack.includes(word) ? 4 : 0), 0);
  if (preferredGenres.has(book.genre.toLowerCase())) score += 2;
  if (/funny|light|happy|comfort|cozy/.test(request) && /comedy|slice of life|romance|school|family|friend/.test(haystack)) score += 3;
  if (/exciting|action|adventure|fast|thrill/.test(request) && /action|adventure|fantasy|battle|mystery|thrill/.test(haystack)) score += 3;
  if (/dark|serious|emotional|sad|deep/.test(request) && /drama|psychological|mystery|horror|tragedy|historical/.test(haystack)) score += 3;
  if (history.some((item) => item.title.toLowerCase() === book.title.toLowerCase())) score -= 5;
  if (activeReading.some((item) => item.title.toLowerCase() === book.title.toLowerCase())) score -= 8;
  return score;
}

function directReply(input: ReturnType<typeof parseBody>) {
  if (!input) return null;
  const normalized = input.message.toLowerCase().replace(/[?!.,]/g, '').trim();
  if (/^(hi|hello|hey|good morning|good afternoon|good evening|kamusta|kumusta)( bon)?$/.test(normalized)) {
    return { message: 'Hello! BON is ready and happy to help. What are we exploring today?', navigateTo: null, recommendationIds: [], suggestions: ['What should I read next?', 'How many books are there?'] };
  }
  if (/^(thanks|thank you|salamat)( bon)?$/.test(normalized)) {
    return { message: 'You are very welcome! I am always happy to help.', navigateTo: null, recommendationIds: [], suggestions: [] };
  }
  if (/^(who are you|what are you|what can you do|help|help me)( bon)?$/.test(normalized)) {
    return { message: 'I am BON, your cheerful reading guide! I can help you search the catalog, find available books, understand your progress, and check quests or rewards.', navigateTo: null, recommendationIds: [], suggestions: ['What should I read next?', 'Show my progress'] };
  }
  const math = normalized.match(/^(?:what(?:'s| is)\s+)?(-?\d+(?:\.\d+)?)\s*([+\-*/x×÷])\s*(-?\d+(?:\.\d+)?)$/);
  if (math) {
    const left = Number(math[1]);
    const right = Number(math[3]);
    const operation = math[2];
    const answer = operation === '+' ? left + right : operation === '-' ? left - right : operation === '*' || operation === 'x' || operation === '×' ? left * right : right === 0 ? null : left / right;
    return { message: answer === null ? 'Division by zero does not have a defined answer. Nice try, though!' : `${answer}. Quick and easy!`, navigateTo: null, recommendationIds: [], suggestions: [] };
  }
  if (input.intent === 'BOOK' && /(how many|total|book count|number of).*(book|title)|(book|title).*(how many|total|count)/.test(normalized)) {
    const summary = input.context.catalogSummary;
    if (summary) {
      return { message: `The catalog has ${summary.totalTitles.toLocaleString()} titles right now. ${summary.availableTitles.toLocaleString()} have a shelf copy ready, and ${summary.availabilityPending.toLocaleString()} need an availability check. Happy searching!`, navigateTo: 'catalog', recommendationIds: [], suggestions: ['What books are available?', 'Recommend a book to me'] };
    }
  }
  // Keep core reading companion features usable even when the optional model
  // provider is not configured. These replies are generated only from the
  // compact, current-session context sent by the app.
  if (input.intent === 'ACCOUNT') {
    if (/\b(xp|experience|level|achievement|streak)\b/.test(normalized)) {
      return { message: 'I can see your rank and library points, but I do not have reliable XP, level, or achievement details to share right now.', navigateTo: 'archive', recommendationIds: [], suggestions: ['How many points do I have?', 'Show my progress'] };
    }
    const { rank, points } = input.context;
    if (rank !== undefined && points !== undefined) {
      return { message: `You are Rank ${rank} with ${points.toLocaleString()} library points.`, navigateTo: null, recommendationIds: [], suggestions: ['Show my progress', 'What is my current quest?'] };
    }
  }
  if (input.intent === 'IDENTITY') {
    return input.context.signedIn && input.context.userName
      ? { message: `You are ${input.context.userName}, the reader signed in for this session.`, navigateTo: null, recommendationIds: [], suggestions: ['Show my progress', 'What is my current quest?'] }
      : { message: 'I cannot identify a signed-in reader right now. Sign in so I can connect your questions to your reading journey.', navigateTo: null, recommendationIds: [], suggestions: [] };
  }
  if (input.intent === 'PROGRESS') {
    const reading = input.context.activeReading ?? [];
    const quests = input.context.quests ?? [];
    const summary = [
      `${input.context.booksCompleted ?? 0} books completed`,
      `${input.context.streak ?? 0} day reading streak`,
      reading.length ? `currently reading ${reading.map((book) => book.title).join(', ')}` : 'no books currently marked as reading',
      quests.length ? `${quests.length} quest${quests.length === 1 ? '' : 's'} in your list` : 'no quests in your list right now',
    ];
    return { message: `Here is the progress I can see: ${summary.join('; ')}.`, navigateTo: 'archive', recommendationIds: [], suggestions: ['What is my current quest?', 'How many points do I have?'] };
  }
  if (input.intent === 'QUEST') {
    const quests = input.context.quests ?? [];
    return { message: quests.length ? `Your quests: ${quests.map((quest) => `${quest.name} (${quest.status})`).join(', ')}.` : 'I cannot see any quests on your account right now. You can browse available quests in the Quests section.', navigateTo: 'commissions', recommendationIds: [], suggestions: ['Show my progress', 'Any rewards ready?'] };
  }
  if (input.intent === 'REWARD') {
    const rewards = input.context.availableRewards ?? [];
    return { message: rewards.length ? `These quest rewards look ready to claim: ${rewards.map((reward) => `${reward.name} (${reward.points} points)`).join(', ')}. Open Quests to claim one.` : 'I cannot see any unclaimed quest rewards for you right now. Check Quests again after completing one.', navigateTo: 'commissions', recommendationIds: [], suggestions: ['Show my progress', 'What is my current quest?'] };
  }
  if (input.intent === 'BOOK') {
    const candidates = input.context.catalog ?? [];
    const summary = input.context.catalogSummary;
    if (/\b(available|availability|in stock|on shelf|shelf copy|shelf copies)\b/.test(normalized) && summary) {
      const total = summary.totalTitles.toLocaleString();
      const available = summary.availableTitles.toLocaleString();
      return {
        message: summary.availableTitles
          ? `There ${summary.availableTitles === 1 ? 'is' : 'are'} ${available} title${summary.availableTitles === 1 ? '' : 's'} available right now, out of ${total} in the catalog. Use Catalog search to find a title without loading the entire list.`
          : `There are no titles marked available right now. The catalog currently has ${total} title${summary.totalTitles === 1 ? '' : 's'}.`,
        navigateTo: 'catalog', recommendationIds: [],
        suggestions: ['What should I read next?', 'How many books are there?'],
      };
    }
    const mentioned = candidates.find((book) => {
      const title = book.title.toLowerCase();
      if (normalized.includes(title)) return true;
      // Match meaningful title words, so “is there a Naruto book?” finds
      // a catalogued volume titled “Naruto 01”.
      return title.split(/[^a-z0-9]+/).some((word) => word.length >= 3 && normalized.includes(word));
    });
    if (mentioned) {
      const availability = mentioned.availableCopies > 0 ? `${mentioned.availableCopies} ${mentioned.availableCopies === 1 ? 'copy is' : 'copies are'} available` : 'I cannot see an available shelf copy';
      return { message: `${mentioned.title} by ${mentioned.author}: ${availability}.${mentioned.synopsis ? ` ${mentioned.synopsis}` : ''}`, navigateTo: 'catalog', recommendationIds: [], suggestions: ['Show me available books', 'What should I read next?'] };
    }
    if (/recommend|read next|suggest|something|looking for|mood|funny|cozy|comfort|exciting|adventure|emotional/.test(normalized)) {
      const history = input.context.readingHistory ?? [];
      const activeReading = input.context.activeReading ?? [];
      const available = candidates.filter((book) => book.availableCopies > 0)
        .map((book, index) => ({ book, index, score: recommendationScore(book, normalized, history, activeReading) }))
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .slice(0, 3).map((item) => item.book);
      return available.length
        ? { message: `Based on what you asked for${history.length ? ' and your recent reading' : ''}, try ${available.map((book) => `${book.title} (${book.genre})`).join(', ')}. ${available.length === 1 ? 'It has' : 'They all have'} a shelf copy available now. Tell me a mood, genre, or similar title to refine these picks.`, navigateTo: 'catalog', recommendationIds: available.map((book) => book.id), suggestions: ['Something light and funny', 'Recommend an action story', 'Show me available books'] }
        : { message: 'I cannot see any available books in the catalog data right now. Try browsing the Catalog or ask library staff to check availability.', navigateTo: 'catalog', recommendationIds: [], suggestions: ['Open the Catalog'] };
    }
    return { message: 'I cannot confirm that title from the catalog information I can access right now. Try searching the Catalog or ask library staff to check.', navigateTo: 'catalog', recommendationIds: [], suggestions: ['Show me available books', 'What should I read next?'] };
  }
  return null;
}

function suggestionsFor(intent: Intent) {
  if (intent === 'BOOK') return ['Show me available books', 'What should I read next?'];
  if (intent === 'PROGRESS') return ['What is my current quest?', 'How many points do I have?'];
  if (intent === 'QUEST' || intent === 'REWARD') return ['Show my progress', 'Any rewards ready?'];
  if (intent === 'ACCOUNT') return ['Show my progress', 'What is my current quest?'];
  return [];
}

function cleanGeneratedText(value: unknown, max: number) {
  return cleanText(value, max).replace(/[\u2013\u2014]/g, ',').replace(/â€[“”]/g, ',').replace(/\s+,/g, ',');
}

function parseModelResponse(content: unknown) {
  if (typeof content !== 'string') return null;
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const value = JSON.parse(normalized) as Record<string, unknown>;
    const message = cleanGeneratedText(value.message, 900);
    if (!message) return null;
    const navigateTo = ALLOWED_SECTIONS.has(String(value.navigateTo)) ? String(value.navigateTo) : null;
    const recommendationIds = Array.isArray(value.recommendationIds) ? value.recommendationIds.slice(0, 3).map((id) => cleanText(id, 40)).filter(Boolean) : [];
    return { message, navigateTo, recommendationIds };
  } catch {
    return null;
  }
}

export default async function handler(request: RequestLike, response: ResponseLike) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  if (!allowed(clientId(request))) return response.status(429).json({ error: 'BON needs a short rest. Please try again later.' });
  const input = parseBody(request.body);
  if (!input) return response.status(400).json({ error: 'Enter a message for BON.' });
  const localRejection = guardMessage(input.message, input.intent);
  const audit = await recordAiRequest(request, input.message, input.intent);
  const rejection = localRejection || (audit?.status === 'REJECTED' ? audit.reason : null);
  if (rejection) return response.status(400).json({ error: rejection });
  const direct = directReply(input);
  if (direct) {
    await completeAiRequest(request, audit?.request_id, direct.message);
    return response.status(200).json(direct);
  }
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return response.status(503).json({ error: 'BON is not configured yet.' });
  const model = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash-0731';
  const siteUrl = process.env.OPENROUTER_SITE_URL || 'https://sora-reader.vercel.app';
  const appName = process.env.OPENROUTER_APP_NAME || 'S.O.R.A. BON';
  const system = `You are BON, S.O.R.A.'s friendly, concise reading-adventure guide. Answer the actual question first in 1 to 3 natural sentences. General questions need no forced reading reference. For any S.O.R.A. account, catalog, book, quest, reward, progress, or feature question, treat PROJECT CONTEXT as the only source of project facts. It contains only the data available for this request. If the needed data is absent or empty, say you cannot see it right now; do not infer, fill gaps, or use outside knowledge to describe a library book. Recommend at most 3 books, and only books present in PROJECT CONTEXT with availableCopies above 0. Return their exact IDs in recommendationIds, and do not mention a recommendation unless its ID is included. You cannot perform actions, so explain where the user can do them instead of claiming completion. Protect secrets and private information. Never use em dash or en dash characters. Return JSON only: {"message":"...","navigateTo":"archive|catalog|shelf|commissions|guide|null","recommendationIds":[]}.`;
  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': siteUrl, 'X-Title': appName },
      body: JSON.stringify({ model, temperature: 0.35, max_tokens: 180,
        // This model spends the shared output budget on reasoning by default,
        // sometimes leaving no JSON content for BON to display.
        ...(model.startsWith('deepseek/') ? { reasoning: { enabled: false } } : {}),
        response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: system }, ...input.history,
        { role: 'user', content: `INTENT: ${input.intent}\nPROJECT CONTEXT: ${JSON.stringify(input.context)}\nQUESTION: ${input.message}` },
      ] }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error('OpenRouter request failed', upstream.status, detail.slice(0, 300));
      return response.status(upstream.status === 429 ? 429 : 502).json({ error: 'Looks like my library connection is taking a moment. Try asking me again.' });
    }
    const result = await upstream.json() as { choices?: { message?: { content?: unknown } }[] };
    const parsed = parseModelResponse(result.choices?.[0]?.message?.content);
    if (!parsed) {
      console.error('OpenRouter returned an invalid BON response');
      return response.status(502).json({ error: 'Looks like my library connection is taking a moment. Try asking me again.' });
    }
    const suppliedIds = new Set((input.context.catalog ?? []).filter((book) => book.availableCopies > 0).map((book) => book.id));
    await completeAiRequest(request, audit?.request_id, parsed.message);
    return response.status(200).json({ ...parsed, recommendationIds: parsed.recommendationIds.filter((id) => suppliedIds.has(id)), suggestions: suggestionsFor(input.intent) });
  } catch (error) {
    console.error('BON request failed', error instanceof Error ? error.message : 'Unknown error');
    return response.status(504).json({ error: 'Looks like my library connection is taking a moment. Try asking me again.' });
  }
}
