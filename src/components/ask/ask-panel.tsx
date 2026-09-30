"use client";

import { useRef, useState } from "react";

import type { AskStreamEvent, ConfirmResult } from "@/app/(app)/ask/actions";
import { Button } from "@/components/ui/button";
import type { CreateTaskProposal } from "@/lib/validation/ask";

// Assistant text is rendered as plain text with line breaks (D-15, trust
// boundary 6): React escapes it and nothing parses markdown or HTML.

type Proposal = {
  id: string;
  proposal: CreateTaskProposal;
  state: "open" | "saving" | "created" | "dismissed" | "failed";
  error?: string;
};

type Turn =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      text: string;
      tools: string[];
      proposals: Proposal[];
      error?: string;
    };

export function AskPanel({
  askStream,
  confirmCreateTask,
}: {
  askStream: (input: {
    history: { role: "user" | "assistant"; text: string }[];
    question: string;
  }) => Promise<AsyncGenerator<AskStreamEvent>>;
  confirmCreateTask: (p: CreateTaskProposal) => Promise<ConfirmResult>;
}) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function updateLast(
    fn: (
      t: Extract<Turn, { role: "assistant" }>,
    ) => Extract<Turn, { role: "assistant" }>,
  ) {
    setTurns((all) => {
      const last = all.at(-1);
      if (!last || last.role !== "assistant") return all;
      return [...all.slice(0, -1), fn(last)];
    });
  }

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    // Only text goes back as history; tools re-run on the server.
    const history = turns
      .filter((t) => t.text.trim() !== "")
      .map((t) => ({ role: t.role, text: t.text }))
      .slice(-20);
    setTurns((all) => [
      ...all,
      { role: "user", text: q },
      { role: "assistant", text: "", tools: [], proposals: [] },
    ]);
    setQuestion("");
    setBusy(true);
    try {
      const events = await askStream({ history, question: q });
      for await (const ev of events) {
        if (ev.type === "text")
          updateLast((t) => ({ ...t, text: t.text + ev.text }));
        else if (ev.type === "tool_call")
          updateLast((t) => ({ ...t, tools: [...t.tools, ev.summary] }));
        else if (ev.type === "proposal")
          updateLast((t) => ({
            ...t,
            proposals: [
              ...t.proposals,
              { id: ev.id, proposal: ev.proposal, state: "open" },
            ],
          }));
        else if (ev.type === "error")
          updateLast((t) => ({ ...t, error: ev.message }));
      }
    } catch {
      updateLast((t) => ({ ...t, error: "Something went wrong. Try again." }));
    }
    setBusy(false);
    inputRef.current?.focus();
  }

  function setProposal(id: string, patch: Partial<Proposal>) {
    setTurns((all) =>
      all.map((t) =>
        t.role === "assistant"
          ? {
              ...t,
              proposals: t.proposals.map((p) =>
                p.id === id ? { ...p, ...patch } : p,
              ),
            }
          : t,
      ),
    );
  }

  async function onConfirm(p: Proposal) {
    setProposal(p.id, { state: "saving", error: undefined });
    const result = await confirmCreateTask(p.proposal);
    setProposal(
      p.id,
      result.ok
        ? { state: "created" }
        : { state: "failed", error: result.error },
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls="ask-panel"
        onClick={() => {
          setOpen((o) => !o);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        Ask
      </Button>
      {open ? (
        <aside
          id="ask-panel"
          aria-label="Ask ActionDesk"
          className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l bg-background shadow-lg"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-semibold">Ask ActionDesk</h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
          </div>

          <ol
            aria-label="Conversation"
            aria-live="polite"
            className="flex-1 space-y-4 overflow-y-auto p-4"
          >
            {turns.length === 0 ? (
              <li className="text-sm text-muted-foreground">
                Ask about your tasks: what&apos;s overdue, what&apos;s in a
                project, or ask me to draft a task for you to confirm.
              </li>
            ) : null}
            {turns.map((t, i) =>
              t.role === "user" ? (
                <li
                  key={i}
                  className="ml-8 rounded-md bg-muted p-3 text-sm whitespace-pre-wrap"
                >
                  {t.text}
                </li>
              ) : (
                <li
                  key={i}
                  className="flex flex-col gap-2 text-sm"
                  aria-label="Answer"
                >
                  {t.tools.length ? (
                    <ul
                      aria-label="Tools used"
                      className="flex flex-wrap gap-1"
                    >
                      {t.tools.map((tool, j) => (
                        <li
                          key={j}
                          className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          {tool}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {t.text ? (
                    <p className="whitespace-pre-wrap">{t.text}</p>
                  ) : null}
                  {t.proposals.map((p) => (
                    <ProposalCard
                      key={p.id}
                      p={p}
                      onConfirm={() => onConfirm(p)}
                      onDismiss={() =>
                        setProposal(p.id, { state: "dismissed" })
                      }
                    />
                  ))}
                  {t.error ? (
                    <p role="alert" className="text-destructive">
                      {t.error}
                    </p>
                  ) : null}
                  {busy && i === turns.length - 1 && !t.text && !t.error ? (
                    <p className="text-muted-foreground">Thinking…</p>
                  ) : null}
                </li>
              ),
            )}
          </ol>

          <form onSubmit={onAsk} className="flex gap-2 border-t p-3">
            <label htmlFor="ask-input" className="sr-only">
              Question
            </label>
            <textarea
              id="ask-input"
              ref={inputRef}
              value={question}
              maxLength={4000}
              rows={2}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="What's overdue?"
              className="flex-1 resize-none rounded-md border bg-background p-2 text-sm"
            />
            <Button type="submit" disabled={busy || question.trim() === ""}>
              Send
            </Button>
          </form>
        </aside>
      ) : null}
    </>
  );
}

function ProposalCard({
  p,
  onConfirm,
  onDismiss,
}: {
  p: Proposal;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const { proposal } = p;
  const due = proposal.dueDate
    ? `${proposal.dueDate}${proposal.dueTime ? ` ${proposal.dueTime}` : ""}`
    : "No due date";
  return (
    <div
      className="rounded-md border p-3"
      role="group"
      aria-label={`Proposed task: ${proposal.title}`}
    >
      <p className="font-medium">{proposal.title}</p>
      <p className="text-xs text-muted-foreground">
        {due} · {proposal.projectName ?? "No project"} · {proposal.priority}{" "}
        priority
      </p>
      {p.state === "created" ? (
        <p role="status" className="mt-2 text-xs">
          Created.
        </p>
      ) : p.state === "dismissed" ? (
        <p className="mt-2 text-xs text-muted-foreground">Dismissed.</p>
      ) : (
        <div className="mt-2 flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={onConfirm}
            disabled={p.state === "saving"}
          >
            {p.state === "saving" ? "Creating…" : "Confirm"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      )}
      {p.error ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {p.error}
        </p>
      ) : null}
    </div>
  );
}
