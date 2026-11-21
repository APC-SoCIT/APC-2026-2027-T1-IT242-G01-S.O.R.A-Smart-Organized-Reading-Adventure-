"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpenCheck,
  ImagePlus,
  LoaderCircle,
  Plus,
  ScanLine,
  Search,
  X,
} from "lucide-react";
import { database, usesReplacementSchema } from "../../lib/supabase";
import type { Shelf } from "./dashboard-data";

type Props = {
  data: { shelves: Shelf[] };
  close: () => void;
  run: (
    action: () => PromiseLike<{ error: unknown }>,
    success: string,
  ) => Promise<boolean>;
};
const initial = {
  title: "",
  original_title: "",
  romanized_title: "",
  author: "",
  contributors: "",
  series_name: "",
  volume_number: "",
  isbn: "",
  publisher: "",
  imprint: "",
  format: "Physical",
  book_type: "Manga",
  demographic: "",
  age_rating: "",
  themes: "",
  description: "",
  cover_image_url: "",
  genres: "",
  barcode: "",
  shelf: "",
  condition_notes: "",
};
type FormKey = keyof typeof initial;
type LookupResponse = {
  source: "catalog" | "isbn";
  existingBookId: number | null;
  warnings: string[];
  metadata: Partial<typeof initial>;
  coverCandidates?: string[];
  error?: string;
};
type TitleCandidate = {
  id: string;
  source: string;
  title: string;
  subtitle: string;
  coverUrl: string;
  metadata: Partial<typeof initial>;
  coverCandidates: string[];
};

export function CompleteAddVolume({ data, close, run }: Props) {
  const [form, setForm] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [coverFailed, setCoverFailed] = useState(false);
  const [coverCandidates, setCoverCandidates] = useState<string[]>([]);
  const [coverIndex, setCoverIndex] = useState(0);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [localPreview, setLocalPreview] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupMessage, setLookupMessage] = useState("");
  const [lookupWarnings, setLookupWarnings] = useState<string[]>([]);
  const [lookupSource, setLookupSource] = useState<"catalog" | "isbn" | null>(
    null,
  );
  const [existingBookId, setExistingBookId] = useState<number | null>(null);
  const [titleQuery, setTitleQuery] = useState("");
  const [titleCandidates, setTitleCandidates] = useState<TitleCandidate[]>([]);
  const [searchingTitles, setSearchingTitles] = useState(false);
  const [titleSearchMessage, setTitleSearchMessage] = useState("");
  const lookupVersion = useRef(0);
  const lookupAbort = useRef<AbortController | null>(null);
  const manuallyEdited = useRef(new Set<FormKey>());
  const autoFilled = useRef(new Set<FormKey>());

  useEffect(() => {
    if (!coverFile) {
      setLocalPreview("");
      return;
    }
    const url = URL.createObjectURL(coverFile);
    setLocalPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  useEffect(() => () => lookupAbort.current?.abort(), []);

  const update = (key: FormKey, value: string) => {
    manuallyEdited.current.add(key);
    autoFilled.current.delete(key);
    setForm((current) => ({ ...current, [key]: value }));
  };
  const updateIsbn = (value: string) => {
    lookupVersion.current++;
    lookupAbort.current?.abort();
    setLookingUp(false);
    setForm((current) => {
      const next = { ...current, isbn: value };
      for (const key of autoFilled.current) next[key] = initial[key];
      autoFilled.current.clear();
      return next;
    });
    setCoverCandidates([]);
    setCoverIndex(0);
    setCoverFailed(false);
    setTitleQuery("");
    setTitleCandidates([]);
    setTitleSearchMessage("");
    setExistingBookId(null);
    setLookupSource(null);
    setLookupMessage("");
    setLookupWarnings([]);
  };
  const clean = (value: string) => value.trim() || null;
  const input =
    "mt-2 w-full rounded-xl border border-[#dfcfbe] bg-[#fffbf5] px-3.5 py-3 text-sm font-normal normal-case text-[#4b301f] outline-none transition placeholder:text-[#b5a18e] focus:border-[#b86a18] focus:ring-4 focus:ring-[#d99b2b]/10 disabled:cursor-not-allowed disabled:opacity-50";
  const label =
    "block text-[10px] font-bold uppercase tracking-[.13em] text-[#795a42]";
  const fields: { key: FormKey; label: string; placeholder: string }[] = [
    {
      key: "original_title",
      label: "Original title",
      placeholder: "Native-language title",
    },
    {
      key: "romanized_title",
      label: "Romanized title",
      placeholder: "Romanized title",
    },
    { key: "publisher", label: "Publisher", placeholder: "Publisher" },
    { key: "imprint", label: "Imprint", placeholder: "Imprint" },
    {
      key: "contributors",
      label: "Contributors",
      placeholder: "Illustrator, translator, editor",
    },
    {
      key: "genres",
      label: "Genres",
      placeholder: "Adventure, Fantasy, Comedy",
    },
    { key: "themes", label: "Themes", placeholder: "Friendship, found family" },
    { key: "demographic", label: "Demographic", placeholder: "e.g. Shonen" },
    { key: "age_rating", label: "Age rating", placeholder: "e.g. Teen / 13+" },
  ];

  const lookupIsbn = async () => {
    if (lookingUp) return;
    const version = ++lookupVersion.current;
    lookupAbort.current?.abort();
    const controller = new AbortController();
    lookupAbort.current = controller;
    setLookingUp(true);
    setLookupMessage("");
    setLookupSource(null);
    setExistingBookId(null);
    try {
      const {
        data: { session },
      } = await database().auth.getSession();
      if (!session)
        throw new Error("Your staff session has expired. Sign in again.");
      const response = await fetch("/api/catalog/lookup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ isbn: form.isbn }),
        signal: controller.signal,
      });
      const result = (await response.json()) as LookupResponse;
      if (!response.ok)
        throw new Error(result.error || "The ISBN lookup failed.");
      if (version !== lookupVersion.current) return;
      setForm((current) => {
        const next = { ...current };
        for (const key of Object.keys(initial) as FormKey[]) {
          const value = result.metadata[key];
          if (
            !manuallyEdited.current.has(key) &&
            typeof value === "string" &&
            value.trim()
          ) {
            next[key] = value;
            autoFilled.current.add(key);
          }
        }
        return next;
      });
      if (!manuallyEdited.current.has("cover_image_url") && !coverFile) {
        const candidates = [
          ...new Set((result.coverCandidates || []).filter(Boolean)),
        ];
        setCoverCandidates(candidates);
        setCoverIndex(0);
        setCoverFailed(false);
      }
      setExistingBookId(result.existingBookId);
      setLookupSource(result.source);
      setLookupWarnings(result.warnings || []);
      setTitleQuery(
        String(result.metadata.series_name || result.metadata.title || ""),
      );
      setLookupMessage(
        result.source === "catalog"
          ? "Existing title found. Add the barcode for this new physical copy."
          : "Metadata loaded. Review all suggested fields before saving.",
      );
    } catch (error) {
      if (
        version === lookupVersion.current &&
        !(error instanceof DOMException && error.name === "AbortError")
      )
        setLookupMessage(
          error instanceof Error ? error.message : "The ISBN lookup failed.",
        );
    } finally {
      if (version === lookupVersion.current) {
        setLookingUp(false);
        lookupAbort.current = null;
      }
    }
  };

  const searchTitles = async () => {
    if (searchingTitles || titleQuery.trim().length < 2) return;
    setSearchingTitles(true);
    setTitleCandidates([]);
    setTitleSearchMessage("");
    try {
      const {
        data: { session },
      } = await database().auth.getSession();
      if (!session)
        throw new Error("Your staff session has expired. Sign in again.");
      const response = await fetch("/api/catalog/lookup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: "title-search",
          isbn: form.isbn,
          query: titleQuery,
        }),
      });
      const result = (await response.json()) as {
        candidates?: TitleCandidate[];
        normalizedQuery?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error || "The title search failed.");
      setTitleCandidates(result.candidates || []);
      if (result.normalizedQuery) setTitleQuery(result.normalizedQuery);
      if (!result.candidates?.length)
        setTitleSearchMessage(
          "No manga or light novel matches were found. Try a shorter series title.",
        );
      else if (result.normalizedQuery)
        setTitleSearchMessage(
          `Matches found for the normalized series title “${result.normalizedQuery}”. Review the correct edition before saving.`,
        );
    } catch (error) {
      setTitleSearchMessage(
        error instanceof Error ? error.message : "The title search failed.",
      );
    } finally {
      setSearchingTitles(false);
    }
  };

  const applyTitleCandidate = (candidate: TitleCandidate) => {
    const editionFields = new Set<FormKey>([
      "title",
      "isbn",
      "publisher",
      "imprint",
      "format",
      "volume_number",
    ]);
    setForm((current) => {
      const next = { ...current };
      for (const key of Object.keys(initial) as FormKey[]) {
        const value = candidate.metadata[key];
        const canFill = !current[key].trim() || key === "book_type";
        if (
          !editionFields.has(key) &&
          !manuallyEdited.current.has(key) &&
          canFill &&
          typeof value === "string" &&
          value.trim()
        ) {
          next[key] = value;
          autoFilled.current.add(key);
        }
      }
      return next;
    });
    if (
      !manuallyEdited.current.has("cover_image_url") &&
      !coverFile &&
      !form.cover_image_url
    ) {
      const candidates = [
        ...new Set(candidate.coverCandidates.filter(Boolean)),
      ];
      setCoverCandidates(candidates);
      setCoverIndex(0);
      setCoverFailed(false);
      if (candidates[0])
        setForm((current) => ({ ...current, cover_image_url: candidates[0] }));
    }
    setTitleCandidates([]);
    setTitleSearchMessage(
      `Applied missing series details from ${candidate.source}. Review them before saving.`,
    );
  };

  const tryNextCover = () => {
    const nextIndex = coverIndex + 1;
    if (nextIndex < coverCandidates.length) {
      const nextUrl = coverCandidates[nextIndex];
      setCoverIndex(nextIndex);
      setCoverFailed(false);
      setForm((current) => ({ ...current, cover_image_url: nextUrl }));
    } else setCoverFailed(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitError("");
    setSubmitting(true);
    try {
    const ok = await run(
      async () => {
        const result = await saveVolume();
        if (result.error) {
          const error = result.error as { message?: string };
          setSubmitError(error.message || "Could not save this volume. Please try again.");
        }
        return result;
      },
      existingBookId
        ? "Physical copy added to the catalogue"
        : "Volume added to the catalogue",
    );
    if (ok) close();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not save this volume. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const saveVolume = async () => {
        if (!usesReplacementSchema && existingBookId && !form.barcode.trim())
          return {
            error: new Error(
              "Scan or enter the physical-copy barcode before adding this existing title.",
            ),
          };
        let uploadedPath = "";
        let coverUrl = clean(form.cover_image_url);
        if (coverFile && (!existingBookId || usesReplacementSchema)) {
          const extension = (coverFile.name.split(".").pop() || "jpg")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
          uploadedPath = `${crypto.randomUUID()}.${extension}`;
          const uploaded = await database()
            .storage.from("book-covers")
            .upload(uploadedPath, coverFile, {
              contentType: coverFile.type,
              cacheControl: "3600",
              upsert: false,
            });
          if (uploaded.error) return { error: uploaded.error };
          coverUrl = database()
            .storage.from("book-covers")
            .getPublicUrl(uploaded.data.path).data.publicUrl;
        }
        const genres = [
          ...new Set(
            form.genres
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          ),
        ];
        if (usesReplacementSchema) {
          const authorParts = form.author.trim().split(/\s+/).filter(Boolean);
          const authorFirst = authorParts.shift() ?? "";
          const authorLast = authorParts.join(" ");
          const ageRating = Number.parseInt(form.age_rating, 10);
          if (!authorFirst || !authorLast)
            return {
              error: new Error("Enter the author's first and last name."),
            };
          if (!Number.isInteger(ageRating) || ageRating < 0)
            return {
              error: new Error(
                "Age rating must be a number, such as 13 or 18.",
              ),
            };
          if (!["Manga", "Light Novel", "Adult Manga"].includes(form.book_type))
            return {
              error: new Error(
                "Book type must be Manga, Light Novel, or Adult Manga.",
              ),
            };
          const created = await database().schema("sora_v2").rpc("admin_create_located_book", {
            p_title: form.title, p_author_firstname: authorFirst, p_author_lastname: authorLast,
            p_book_type: form.book_type, p_age_rating: ageRating,
            p_genre: (genres.join(", ") || "General").slice(0,100), p_isbn: clean(form.isbn),
            p_shelf_location: form.shelf ? `Shelf A${form.shelf}` : null,
            p_barcode: clean(form.barcode), p_condition_notes: clean(form.condition_notes),
            p_cover_image_url: coverUrl,
          });
          if (created.error) return { error: created.error };
          return { error: null };
        }
        const result = await database().rpc("admin_create_catalog_entry", {
          p_book: {
            title: form.title,
            original_title: form.original_title,
            romanized_title: form.romanized_title,
            author: form.author,
            contributors: form.contributors,
            isbn: form.isbn,
            series_name: form.series_name,
            volume_number: form.volume_number,
            format: form.format,
            publisher: form.publisher,
            imprint: form.imprint,
            book_type: form.book_type,
            demographic: form.demographic,
            themes: form.themes,
            age_rating: form.age_rating,
            description: form.description,
            cover_image_url: coverUrl,
          },
          p_genres: genres,
          p_barcode: clean(form.barcode),
          p_shelf_id: form.shelf ? Number(form.shelf) : null,
          p_condition_notes: clean(form.condition_notes),
        });
        const createdNew = Boolean(
          (result.data as { created_new?: boolean } | null)?.created_new,
        );
        if (uploadedPath && (result.error || !createdNew))
          await database().storage.from("book-covers").remove([uploadedPath]);
        return { error: result.error };
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-[#2d190c]/40 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) close();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-volume-title"
        className="absolute right-0 top-0 flex h-full w-full max-w-[680px] flex-col overflow-hidden border-l border-[#d89b39] bg-[#fffdf9] shadow-[-20px_0_60px_rgba(67,37,18,.2)]"
      >
        <header className="flex items-center justify-between border-b border-[#eadbc9] bg-[linear-gradient(135deg,#fffaf1,#f8ead4)] px-7 py-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[#b66a3c]">
              Catalogue · New record
            </p>
            <h2
              id="add-volume-title"
              className="mt-1 font-serif text-3xl text-[#54341f]"
            >
              Add a volume
            </h2>
            <p className="mt-1 text-xs text-[#927864]">
              Scan an ISBN to reduce manual cataloging.
            </p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={close}
            aria-label="Close add volume panel"
            className="rounded-xl p-2.5 hover:bg-[#efe0cd] disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </header>
        <form onSubmit={submit} onInvalidCapture={(event) => {
          const field = event.target as HTMLInputElement;
          setSubmitError(field.validationMessage || "Please review the required fields.");
          field.scrollIntoView({ block: "center", behavior: "smooth" });
        }} className="min-h-0 flex-1 overflow-y-auto">
          <section className="border-b border-[#eee2d6] bg-[#fffaf1] px-7 py-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#f4dfb7] text-[#a83d12]">
                <BookOpenCheck size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-serif text-lg text-[#5b3924]">
                  ISBN metadata lookup
                </h3>
                <p className="mt-1 text-[11px] leading-5 text-[#927864]">
                  Retrieve edition data from public book sources, then enrich
                  matching manga metadata.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <label className="relative flex-1">
                <span className="sr-only">ISBN-10 or ISBN-13</span>
                <ScanLine
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#a17954]"
                  size={18}
                />
                <input
                  autoFocus
                  value={form.isbn}
                  onChange={(event) => updateIsbn(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void lookupIsbn();
                    }
                  }}
                  placeholder="Scan or enter ISBN-10 / ISBN-13"
                  className={`${input} mt-0 pl-11`}
                />
              </label>
              <button
                type="button"
                disabled={lookingUp || !form.isbn.trim()}
                onClick={() => void lookupIsbn()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#5b3924] px-5 text-xs font-bold text-white transition hover:bg-[#432617] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {lookingUp ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : (
                  <Search size={16} />
                )}{" "}
                {lookingUp ? "Looking up…" : "Find book"}
              </button>
            </div>
            {lookupMessage && !lookupSource && (
              <p
                role="alert"
                className="mt-3 rounded-xl border border-[#d89a82] bg-[#fff4ee] px-3.5 py-3 text-xs leading-5 text-[#9a3515]"
              >
                {lookupMessage}
              </p>
            )}
            {lookupSource && (
              <div className="mt-3 rounded-xl border border-[#dfcfbe] bg-[#fffaf1] px-3.5 py-3 text-[10px] leading-4 text-[#795a42]">
                <p className="font-bold uppercase tracking-[.12em] text-[#8a481d]">Lookup completed · English metadata</p>
                <p className="mt-1">{lookupMessage}</p>
                {lookupWarnings.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4">{lookupWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
              </div>
            )}
            {lookupSource === "isbn" && (
              <div className="mt-4 rounded-xl border border-[#e3d1bc] bg-white p-3.5">
                <p className="text-[10px] font-bold uppercase tracking-[.13em] text-[#795a42]">
                  Missing manga or light novel details?
                </p>
                <p className="mt-1 text-[10px] leading-4 text-[#927864]">
                  Search by series title, then choose the correct match. Only
                  blank fields will be filled.
                </p>
                <div className="mt-3 flex gap-2">
                  <input
                    value={titleQuery}
                    onChange={(event) => setTitleQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void searchTitles();
                      }
                    }}
                    placeholder="Series or alternate title"
                    className={`${input} mt-0 min-w-0`}
                  />
                  <button
                    type="button"
                    disabled={searchingTitles || titleQuery.trim().length < 2}
                    onClick={() => void searchTitles()}
                    className="shrink-0 rounded-xl border border-[#c98a45] px-3 text-xs font-bold text-[#8a481d] disabled:opacity-50"
                  >
                    {searchingTitles ? "Searching…" : "Find matches"}
                  </button>
                </div>
                {titleSearchMessage && (
                  <p className="mt-2 text-[10px] leading-4 text-[#795a42]">
                    {titleSearchMessage}
                  </p>
                )}
                {titleCandidates.length > 0 && (
                  <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
                    {titleCandidates.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => applyTitleCandidate(candidate)}
                        className="flex w-full items-center gap-3 rounded-lg border border-[#eadbc9] p-2 text-left transition hover:border-[#c98a45] hover:bg-[#fff8ed]"
                      >
                        {candidate.coverUrl ? (
                          <img
                            src={candidate.coverUrl}
                            alt=""
                            className="h-16 w-11 shrink-0 rounded object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <span className="h-16 w-11 shrink-0 rounded bg-[#f2e5d7]" />
                        )}
                        <span className="min-w-0">
                          <strong className="block text-xs text-[#54341f]">
                            {candidate.title}
                          </strong>
                          {candidate.subtitle && (
                            <span className="mt-0.5 block truncate text-[10px] text-[#927864]">
                              {candidate.subtitle}
                            </span>
                          )}
                          <span className="mt-1 block text-[9px] font-bold uppercase tracking-wider text-[#b66a3c]">
                            {candidate.source} ·{" "}
                            {candidate.metadata.book_type || "Book"}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
          <section className="grid gap-7 p-7 sm:grid-cols-[150px_1fr]">
            <div>
              <p className={`${label} mb-2`}>Cover art</p>
              <div
                className="grid shrink-0 place-items-center overflow-hidden rounded-xl border border-[#dfc69f] bg-[#fffaf1] p-2 shadow-lg"
                style={{ width: 150, height: 225 }}
              >
                {localPreview || (form.cover_image_url && !coverFailed) ? (
                  <img
                    src={localPreview || form.cover_image_url}
                    alt="Full cover preview"
                    className="block min-h-0 min-w-0"
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                    }}
                    referrerPolicy="no-referrer"
                    onError={tryNextCover}
                  />
                ) : (
                  <div className="text-center text-[#a17954]">
                    <ImagePlus className="mx-auto mb-2" size={30} />
                    <span className="text-[10px] font-bold uppercase tracking-wider">
                      {coverFailed ? "Image could not load" : "Cover preview"}
                    </span>
                  </div>
                )}
              </div>
              <p className="mt-2 text-[10px] leading-4 text-[#9d8877]">
                Full image preview · portrait artwork fits best.
              </p>
            </div>
            <div className="space-y-4">
              <label className={label}>
                Title *
                <input
                  required
                  value={form.title}
                  onChange={(event) => update("title", event.target.value)}
                  placeholder="e.g. One Piece"
                  className={input}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className={label}>
                  Series
                  <input
                    value={form.series_name}
                    onChange={(event) =>
                      update("series_name", event.target.value)
                    }
                    placeholder="Series name"
                    className={input}
                  />
                </label>
                <label className={label}>
                  Volume
                  <input
                    value={form.volume_number}
                    onChange={(event) =>
                      update("volume_number", event.target.value)
                    }
                    placeholder="e.g. 104"
                    className={input}
                  />
                </label>
              </div>
              <label className={label}>
                Author
                <input
                  value={form.author}
                  onChange={(event) => update("author", event.target.value)}
                  placeholder="Author or creator"
                  className={input}
                />
              </label>
              <label className={label}>
                Cover image URL
                <input
                  type="url"
                  value={form.cover_image_url}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCoverFailed(false);
                    setCoverCandidates(value ? [value] : []);
                    setCoverIndex(0);
                    update("cover_image_url", value);
                  }}
                  placeholder="https://…/cover.jpg"
                  className={input}
                />
              </label>
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-[#e5d7c8]" />
                <span className="text-[9px] font-bold uppercase tracking-widest text-[#a58a74]">
                  or upload
                </span>
                <span className="h-px flex-1 bg-[#e5d7c8]" />
              </div>
              <label
                className={`${label} cursor-pointer rounded-xl border border-dashed border-[#d4a45f] bg-[#fff7e9] p-3 text-center transition hover:bg-[#ffefd3]`}
              >
                <span>
                  {coverFile ? coverFile.name : "Choose JPG, PNG or WebP"}
                </span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    if (file && file.size > 5 * 1024 * 1024) {
                      setFileError("Cover image must be 5 MB or smaller.");
                      setCoverFile(null);
                      return;
                    }
                    setFileError("");
                    setCoverFailed(false);
                    setCoverFile(file);
                  }}
                />
              </label>
              {fileError && (
                <p
                  role="alert"
                  className="text-xs font-semibold text-[#a83d12]"
                >
                  {fileError}
                </p>
              )}
              {coverFile && form.cover_image_url && (
                <p className="text-[10px] text-[#927864]">
                  The uploaded image will be used instead of the link.
                </p>
              )}
            </div>
          </section>
          <section className="border-y border-[#eee2d6] bg-[#fcf7ef] px-7 py-6">
            <h3 className="mb-4 font-serif text-lg text-[#5b3924]">
              Reader details
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {fields.map((item) => (
                <label key={item.key} className={label}>
                  {item.label}
                  <input
                    value={form[item.key]}
                    onChange={(event) => update(item.key, event.target.value)}
                    placeholder={item.placeholder}
                    className={input}
                  />
                  {item.key === "genres" && (
                    <span className="mt-1.5 block text-[10px] normal-case tracking-normal text-[#9d8877]">
                      Separate genres with commas.
                    </span>
                  )}
                </label>
              ))}
              <label className={label}>
                Book type
                <select
                  value={form.book_type}
                  onChange={(event) => update("book_type", event.target.value)}
                  className={input}
                >
                  <option>Manga</option>
                  <option>Light Novel</option>
                  <option>Novel</option>
                  <option>Comic</option>
                  <option>Art Book</option>
                  <option>Guidebook</option>
                  <option>Magazine</option>
                  <option>Other</option>
                </select>
              </label>
              <label className={label}>
                Format
                <select
                  value={form.format}
                  onChange={(event) => update("format", event.target.value)}
                  className={input}
                >
                  <option>Physical</option>
                  <option>Hardcover</option>
                  <option>Paperback</option>
                  <option>Digital</option>
                </select>
              </label>
            </div>
            <label className={`${label} mt-4`}>
              Synopsis
              <textarea
                rows={4}
                value={form.description}
                onChange={(event) => update("description", event.target.value)}
                placeholder="Description shown on the book detail screen…"
                className={`${input} resize-y leading-6`}
              />
            </label>
          </section>
          <section className="px-7 py-6">
            <h3 className="mb-4 font-serif text-lg text-[#5b3924]">
              Physical copy{" "}
              <span className="font-sans text-[10px] font-bold uppercase tracking-wider text-[#a58a74]">
                Required
              </span>
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>
                Barcode
                <input
                  value={form.barcode}
                  onChange={(event) => update("barcode", event.target.value)}
                  placeholder="Scan barcode or leave blank to generate ISBN-copy number"
                  className={input}
                />
              </label>
              <label className={label}>
                Shelf
                <select
                  value={form.shelf}
                  onChange={(event) => update("shelf", event.target.value)}
                  required={usesReplacementSchema}
                  className={input}
                >
                  <option value="">Select a Main Reading Hall shelf</option>
                  {data.shelves.map((item) => (
                    <option key={item.shelf_id} value={item.shelf_id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className={`${label} mt-4`}>
              Condition notes
              <input
                value={form.condition_notes}
                onChange={(event) =>
                  update("condition_notes", event.target.value)
                }
                disabled={!usesReplacementSchema && !form.barcode.trim()}
                placeholder="e.g. New, minor shelf wear"
                className={input}
              />
            </label>
          </section>
          <footer className="sticky bottom-0 flex items-center border-t border-[#e7d7c5] bg-[#fffdf9]/95 px-7 py-5 backdrop-blur">
            {submitError && <p role="alert" className="mr-4 text-xs text-red-700">{submitError}</p>}
            <p className="hidden text-[10px] text-[#98816e] sm:block">
              * Review imported metadata before saving.
            </p>
            <button
              type="submit"
              disabled={
                submitting ||
                !form.title.trim() ||
                (!usesReplacementSchema && Boolean(existingBookId) && !form.barcode.trim())
              }
              className="ml-auto inline-flex min-w-44 items-center justify-center gap-2 rounded-xl bg-[#a83d12] px-5 py-3 text-xs font-bold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-[#8f320d] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <LoaderCircle size={16} className="animate-spin" />
                  Creating…
                </>
              ) : (
                <>
                  <Plus size={16} />
                  {existingBookId ? "Add physical copy" : "Create volume"}
                </>
              )}
            </button>
          </footer>
        </form>
      </aside>
    </div>
  );
}
