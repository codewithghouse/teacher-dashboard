import { useEffect, useMemo, useRef, useState } from "react";
import {
  HelpCircle,
  Send,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Tag,
  Flag,
  Paperclip,
  X,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../lib/AuthContext";
import {
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  ACCEPTED_IMAGE_TYPES,
  addReply,
  createTicket,
  deleteTicketAttachment,
  fmtRelative,
  reopenTicket,
  statusTone,
  subscribeUserTickets,
  uploadTicketAttachment,
  type SupportTicket,
  type TicketAttachment,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from "../lib/supportTickets";

const SUBJECT_MAX = 200;
const DESCRIPTION_MAX = 5000;
const REPLY_MAX = 5000;

type StatusFilter = "all" | TicketStatus;

interface StagedAttachment {
  localId: string;     // client-generated id for keying/removal
  file: File;
  previewUrl: string;  // local object URL for thumbnail
  uploading: boolean;
  uploaded?: TicketAttachment;
  error?: string;
}

function newBatchId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `b-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function localId(): string {
  return `l-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Help() {
  const { user, teacherData } = useAuth();

  // ── New-ticket form state ─────────────────────────────────────────
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<TicketCategory>("bug");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [attachments, setAttachments] = useState<StagedAttachment[]>([]);
  const [batchId, setBatchId] = useState<string>(() => newBatchId());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Cleanup ObjectURLs on unmount to avoid memory leaks.
  useEffect(() => {
    return () => {
      attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setSubject("");
    setDescription("");
    setCategory("bug");
    setPriority("medium");
    attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    setAttachments([]);
    setBatchId(newBatchId());
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!user?.uid) {
      toast.error("Please sign in again to attach images.");
      return;
    }
    const remainingSlots = MAX_ATTACHMENTS - attachments.length;
    if (remainingSlots <= 0) {
      toast.error(`Up to ${MAX_ATTACHMENTS} images per ticket.`);
      return;
    }
    const incoming = Array.from(files).slice(0, remainingSlots);

    const staged: StagedAttachment[] = incoming.map((file) => ({
      localId: localId(),
      file,
      previewUrl: URL.createObjectURL(file),
      uploading: true,
    }));
    setAttachments((prev) => [...prev, ...staged]);

    // Upload each staged file in parallel.
    await Promise.all(
      staged.map(async (s) => {
        // Pre-flight client-side checks (rule will also catch).
        if (s.file.size > MAX_ATTACHMENT_BYTES) {
          setAttachments((prev) =>
            prev.map((a) =>
              a.localId === s.localId
                ? { ...a, uploading: false, error: "Larger than 10 MB" }
                : a
            )
          );
          return;
        }
        if (!ACCEPTED_IMAGE_TYPES.includes(s.file.type)) {
          setAttachments((prev) =>
            prev.map((a) =>
              a.localId === s.localId
                ? { ...a, uploading: false, error: "Only image files allowed" }
                : a
            )
          );
          return;
        }
        try {
          const uploaded = await uploadTicketAttachment(user.uid!, batchId, s.file);
          setAttachments((prev) =>
            prev.map((a) =>
              a.localId === s.localId ? { ...a, uploading: false, uploaded } : a
            )
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Upload failed.";
          setAttachments((prev) =>
            prev.map((a) =>
              a.localId === s.localId ? { ...a, uploading: false, error: msg } : a
            )
          );
        }
      })
    );

    // Reset the input so the same filename can be re-selected after a remove.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function removeAttachment(localIdToRemove: string) {
    const target = attachments.find((a) => a.localId === localIdToRemove);
    setAttachments((prev) => prev.filter((a) => a.localId !== localIdToRemove));
    if (target) {
      URL.revokeObjectURL(target.previewUrl);
      if (target.uploaded?.storagePath) {
        deleteTicketAttachment(target.uploaded.storagePath);
      }
    }
  }

  // ── Tickets list state ────────────────────────────────────────────
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) {
      setTickets([]);
      setLoadingList(false);
      return;
    }
    setLoadingList(true);
    const unsub = subscribeUserTickets(
      user.uid,
      (rows) => {
        setTickets(rows);
        setLoadingList(false);
        setListError(null);
      },
      (err) => {
        setListError(err.message);
        setLoadingList(false);
      }
    );
    return unsub;
  }, [user?.uid]);

  const filtered = useMemo(() => {
    if (filter === "all") return tickets;
    return tickets.filter((t) => t.status === filter);
  }, [tickets, filter]);

  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      all: tickets.length,
      open: 0,
      in_progress: 0,
      resolved: 0,
      closed: 0,
    };
    for (const t of tickets) c[t.status] += 1;
    return c;
  }, [tickets]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!user?.uid || !user?.email) {
      toast.error("Please sign in again to raise a ticket.");
      return;
    }
    const schoolId = teacherData?.schoolId || "";
    if (!schoolId) {
      toast.error("Your school context is still loading — try again in a moment.");
      return;
    }
    // Block submission while any attachment is still uploading.
    if (attachments.some((a) => a.uploading)) {
      toast.error("Wait for images to finish uploading.");
      return;
    }
    const erroredAttachment = attachments.find((a) => a.error);
    if (erroredAttachment) {
      toast.error(`Remove the failed attachment first (${erroredAttachment.file.name}).`);
      return;
    }
    const successfulAttachments: TicketAttachment[] = attachments
      .map((a) => a.uploaded)
      .filter((x): x is TicketAttachment => Boolean(x));

    setSubmitting(true);
    try {
      await createTicket({
        schoolId,
        branchId: String(teacherData?.branchId || teacherData?.branch || ""),
        branchName: String(teacherData?.branchName || teacherData?.branch || ""),
        schoolName: String(teacherData?.schoolName || ""),
        createdBy: {
          uid: user.uid,
          email: (user.email || "").toLowerCase(),
          name: teacherData?.name || user.displayName || "Teacher",
          role: "teacher",
        },
        subject,
        description,
        category,
        priority,
        attachments: successfulAttachments,
      });
      toast.success("Ticket raised — our support team will reply soon.");
      resetForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to raise ticket.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 lg:px-6 py-6 space-y-6">
      {/* Header */}
      <header className="flex items-start gap-3">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "#0B1F3A", color: "#FFFFFF" }}
        >
          <HelpCircle className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "#0B1F3A" }}>
            Help &amp; Support
          </h1>
          <p className="text-sm mt-1 text-slate-500">
            Raise a support ticket. Our team replies within 24 hours on
            weekdays. You can track the conversation below.
          </p>
        </div>
      </header>

      {/* ── New ticket form ─────────────────────────────────────────── */}
      <section
        className="rounded-2xl p-5 lg:p-6"
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.03)",
        }}
      >
        <h2 className="text-base font-medium" style={{ color: "#0B1F3A" }}>
          Raise a new ticket
        </h2>
        <p className="text-xs mt-1 text-slate-500">
          Share enough detail so our team can help you on the first reply.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <FormField label="Subject" hint={`${subject.length}/${SUBJECT_MAX}`}>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value.slice(0, SUBJECT_MAX))}
              placeholder="Short summary of the issue"
              maxLength={SUBJECT_MAX}
              required
              className="w-full h-11 px-3 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/30"
              style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", color: "#0B1F3A" }}
            />
          </FormField>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Category" icon={<Tag className="w-3.5 h-3.5" />}>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as TicketCategory)}
                className="w-full h-11 px-3 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/30"
                style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", color: "#0B1F3A" }}
              >
                {(Object.keys(TICKET_CATEGORY_LABELS) as TicketCategory[]).map((k) => (
                  <option key={k} value={k}>
                    {TICKET_CATEGORY_LABELS[k]}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Priority" icon={<Flag className="w-3.5 h-3.5" />}>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="w-full h-11 px-3 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/30"
                style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", color: "#0B1F3A" }}
              >
                {(Object.keys(TICKET_PRIORITY_LABELS) as TicketPriority[]).map((k) => (
                  <option key={k} value={k}>
                    {TICKET_PRIORITY_LABELS[k]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField label="Description" hint={`${description.length}/${DESCRIPTION_MAX}`}>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, DESCRIPTION_MAX))}
              placeholder="What happened? What were you trying to do? Steps to reproduce, if any."
              rows={6}
              maxLength={DESCRIPTION_MAX}
              required
              className="w-full px-3 py-2.5 rounded-lg text-sm leading-relaxed outline-none focus:ring-2 focus:ring-blue-500/30 resize-y"
              style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", color: "#0B1F3A" }}
            />
          </FormField>

          <FormField
            label="Screenshots"
            icon={<Paperclip className="w-3.5 h-3.5" />}
            hint={`${attachments.length}/${MAX_ATTACHMENTS} · 10 MB each · jpg/png/webp/gif`}
          >
            <div className="space-y-3">
              {attachments.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {attachments.map((a) => (
                    <AttachmentThumb
                      key={a.localId}
                      item={a}
                      onRemove={() => removeAttachment(a.localId)}
                    />
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={attachments.length >= MAX_ATTACHMENTS}
                className="w-full h-20 rounded-lg flex flex-col items-center justify-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "#F8FAFC",
                  border: "1px dashed #CBD5E1",
                  color: "#475569",
                }}
              >
                <ImageIcon className="w-5 h-5" />
                <span className="text-xs">
                  {attachments.length >= MAX_ATTACHMENTS
                    ? `Limit reached (${MAX_ATTACHMENTS} files)`
                    : "Click to attach screenshots"}
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_IMAGE_TYPES.join(",")}
                multiple
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
              />
            </div>
          </FormField>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={resetForm}
              disabled={submitting}
              className="h-10 px-4 rounded-lg text-sm disabled:opacity-50"
              style={{ background: "#F1F5F9", color: "#475569", border: "1px solid #E2E8F0" }}
            >
              Clear
            </button>
            <button
              type="submit"
              disabled={
                submitting ||
                !subject.trim() ||
                !description.trim() ||
                attachments.some((a) => a.uploading)
              }
              className="h-10 px-5 rounded-lg text-sm text-white flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: "#0B1F3A" }}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Submit ticket
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      {/* ── Your tickets ────────────────────────────────────────────── */}
      <section
        className="rounded-2xl p-5 lg:p-6"
        style={{
          background: "#FFFFFF",
          border: "1px solid #E2E8F0",
          boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.03)",
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-base font-medium" style={{ color: "#0B1F3A" }}>
              Your tickets
            </h2>
            <p className="text-xs mt-1 text-slate-500">
              Live updates from our support team appear here.
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {(["all", "open", "in_progress", "resolved", "closed"] as StatusFilter[]).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className="px-3 py-1.5 rounded-full text-xs transition-colors"
                style={{
                  background: filter === k ? "#0B1F3A" : "#F1F5F9",
                  color: filter === k ? "#FFFFFF" : "#475569",
                  border: `1px solid ${filter === k ? "#0B1F3A" : "#E2E8F0"}`,
                }}
              >
                {k === "all" ? "All" : TICKET_STATUS_LABELS[k]} · {counts[k]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          {loadingList ? (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-10 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading your tickets…
            </div>
          ) : listError ? (
            <div
              className="flex items-start gap-3 p-3 rounded-lg text-sm"
              style={{ background: "#FEF2F2", color: "#991B1B", border: "1px solid #FECACA" }}
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">Could not load tickets</div>
                <div className="opacity-80 mt-1 font-mono text-xs break-all">{listError}</div>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyTickets filter={filter} />
          ) : (
            <ul className="space-y-2">
              {filtered.map((t) => (
                <TicketRow
                  key={t.id}
                  ticket={t}
                  expanded={expandedId === t.id}
                  onToggle={() =>
                    setExpandedId((current) => (current === t.id ? null : t.id))
                  }
                  currentUid={user?.uid || ""}
                  currentName={
                    teacherData?.name || user?.displayName || "Teacher"
                  }
                  currentEmail={(user?.email || "").toLowerCase()}
                />
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

/* ─── components ─── */

function AttachmentThumb({
  item,
  onRemove,
}: {
  item: StagedAttachment;
  onRemove: () => void;
}) {
  return (
    <div
      className="relative rounded-lg overflow-hidden"
      style={{
        background: "#FFFFFF",
        border: `1px solid ${item.error ? "#FCA5A5" : "#E2E8F0"}`,
        aspectRatio: "4 / 3",
      }}
    >
      <img
        src={item.previewUrl}
        alt={item.file.name}
        className="absolute inset-0 w-full h-full object-cover"
      />
      {item.uploading && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: "rgba(15,23,42,0.55)" }}
        >
          <Loader2 className="w-5 h-5 text-white animate-spin" />
        </div>
      )}
      {item.error && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center text-center px-2"
          style={{ background: "rgba(220,38,38,0.85)", color: "#FFFFFF" }}
        >
          <AlertCircle className="w-4 h-4 mb-1" />
          <span className="text-[10px] leading-tight">{item.error}</span>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center transition-transform hover:scale-110"
        style={{ background: "#FFFFFF", color: "#0B1F3A", boxShadow: "0 1px 4px rgba(0,0,0,0.25)" }}
        aria-label="Remove attachment"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <div
        className="absolute bottom-0 left-0 right-0 px-2 py-1 text-[10px] truncate"
        style={{ background: "rgba(15,23,42,0.7)", color: "#FFFFFF" }}
      >
        {item.file.name} · {humanSize(item.file.size)}
      </div>
    </div>
  );
}

function FormField({
  label,
  hint,
  icon,
  children,
}: {
  label: string;
  hint?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
          {icon}
          {label}
        </label>
        {hint && <span className="text-[10px] text-slate-400 tabular-nums">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function EmptyTickets({ filter }: { filter: StatusFilter }) {
  return (
    <div className="text-center py-10 rounded-lg" style={{ background: "#F8FAFC" }}>
      <div className="text-sm font-medium text-slate-700">
        {filter === "all" ? "No tickets yet" : `No ${TICKET_STATUS_LABELS[filter as TicketStatus].toLowerCase()} tickets`}
      </div>
      <div className="text-xs text-slate-500 mt-1">
        Tickets you raise will show up here with live status updates.
      </div>
    </div>
  );
}

function TicketRow({
  ticket,
  expanded,
  onToggle,
  currentUid,
  currentName,
  currentEmail,
}: {
  ticket: SupportTicket;
  expanded: boolean;
  onToggle: () => void;
  currentUid: string;
  currentName: string;
  currentEmail: string;
}) {
  const tone = statusTone(ticket.status);

  return (
    <li
      className="rounded-xl overflow-hidden"
      style={{ background: "#FFFFFF", border: "1px solid #E2E8F0" }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <span
          className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-medium shrink-0"
          style={{ background: tone.bg, color: tone.fg, border: `1px solid ${tone.border}` }}
        >
          {TICKET_STATUS_LABELS[ticket.status]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate" style={{ color: "#0B1F3A" }}>
            {ticket.subject}
          </div>
          <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span>{TICKET_PRIORITY_LABELS[ticket.priority]} · {ticket.category}</span>
            <span>· {fmtRelative(ticket.createdAt)}</span>
            {ticket.replyCount > 0 && (
              <span className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3" />
                {ticket.replyCount}
              </span>
            )}
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
        )}
      </button>

      {expanded && (
        <TicketThread
          ticket={ticket}
          currentUid={currentUid}
          currentName={currentName}
          currentEmail={currentEmail}
        />
      )}
    </li>
  );
}

function TicketThread({
  ticket,
  currentUid,
  currentName,
  currentEmail,
}: {
  ticket: SupportTicket;
  currentUid: string;
  currentName: string;
  currentEmail: string;
}) {
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [reopening, setReopening] = useState(false);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);

  async function handleSend() {
    if (sending) return;
    const msg = reply.trim();
    if (!msg) return;
    setSending(true);
    try {
      const shouldReopen = ticket.status === "resolved" || ticket.status === "closed";
      await addReply({
        ticketId: ticket.id,
        authorRole: "teacher",
        authorUid: currentUid,
        authorName: currentName,
        authorEmail: currentEmail,
        message: msg,
        reopen: shouldReopen,
      });
      setReply("");
      toast.success(shouldReopen ? "Reply sent — ticket reopened." : "Reply sent.");
    } catch (err) {
      const m = err instanceof Error ? err.message : "Failed to send reply.";
      toast.error(m);
    } finally {
      setSending(false);
    }
  }

  async function handleReopen() {
    if (reopening) return;
    setReopening(true);
    try {
      await reopenTicket(ticket.id);
      toast.success("Ticket reopened.");
      replyRef.current?.focus();
    } catch (err) {
      const m = err instanceof Error ? err.message : "Failed to reopen.";
      toast.error(m);
    } finally {
      setReopening(false);
    }
  }

  const canReopen = ticket.status === "resolved" || ticket.status === "closed";

  return (
    <div className="border-t" style={{ borderColor: "#E2E8F0", background: "#F8FAFC" }}>
      {/* Original description */}
      <div className="px-4 py-4">
        <ThreadBubble
          authorRole={ticket.createdBy.role}
          authorName={ticket.createdBy.name}
          when={fmtRelative(ticket.createdAt)}
          message={ticket.description}
          isCurrentUser={ticket.createdBy.uid === currentUid}
          attachments={ticket.attachments}
        />
      </div>

      {/* Replies */}
      {ticket.replies.length > 0 && (
        <div className="px-4 pb-3 space-y-3">
          {ticket.replies.map((r) => (
            <ThreadBubble
              key={r.id}
              authorRole={r.authorRole}
              authorName={r.authorName}
              when={fmtRelative(r.createdAt)}
              message={r.message}
              isCurrentUser={r.authorUid === currentUid}
            />
          ))}
        </div>
      )}

      {/* Reply box */}
      <div className="px-4 pb-4 pt-2 border-t" style={{ borderColor: "#E2E8F0" }}>
        <textarea
          ref={replyRef}
          value={reply}
          onChange={(e) => setReply(e.target.value.slice(0, REPLY_MAX))}
          placeholder={
            canReopen
              ? "Write a reply (sending will reopen this ticket)…"
              : "Write a reply…"
          }
          rows={3}
          maxLength={REPLY_MAX}
          className="w-full px-3 py-2.5 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/30 resize-y"
          style={{ background: "#FFFFFF", border: "1px solid #E2E8F0", color: "#0B1F3A" }}
        />
        <div className="flex items-center justify-between mt-2 gap-2">
          <div className="text-[10px] text-slate-400 tabular-nums">
            {reply.length}/{REPLY_MAX}
          </div>
          <div className="flex gap-2">
            {canReopen && (
              <button
                type="button"
                onClick={handleReopen}
                disabled={reopening || sending}
                className="h-9 px-3 rounded-lg text-xs disabled:opacity-50"
                style={{ background: "#F1F5F9", color: "#475569", border: "1px solid #E2E8F0" }}
              >
                {reopening ? "Reopening…" : "Reopen without reply"}
              </button>
            )}
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !reply.trim()}
              className="h-9 px-4 rounded-lg text-xs text-white flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: "#0B1F3A" }}
            >
              {sending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  Send reply
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThreadBubble({
  authorRole,
  authorName,
  when,
  message,
  isCurrentUser,
  attachments,
}: {
  authorRole: SupportTicket["createdBy"]["role"] | "support";
  authorName: string;
  when: string;
  message: string;
  isCurrentUser: boolean;
  attachments?: TicketAttachment[];
}) {
  const isSupport = authorRole === "support";
  return (
    <div className={`flex ${isCurrentUser ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%]">
        <div
          className={`text-[10px] uppercase tracking-wider mb-1 flex items-center gap-1.5 ${
            isCurrentUser ? "justify-end" : "justify-start"
          }`}
          style={{ color: isSupport ? "#0B1F3A" : "#64748B" }}
        >
          {isSupport && (
            <span
              className="px-1.5 py-0.5 rounded text-[9px]"
              style={{ background: "#0B1F3A", color: "#FFFFFF" }}
            >
              SUPPORT
            </span>
          )}
          <span>{authorName}</span>
          <span style={{ color: "#94A3B8" }}>· {when}</span>
        </div>
        <div
          className="rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words"
          style={{
            background: isSupport
              ? "#EFF6FF"
              : isCurrentUser
              ? "#0B1F3A"
              : "#FFFFFF",
            color: isSupport ? "#1E3A8A" : isCurrentUser ? "#FFFFFF" : "#0B1F3A",
            border: isSupport
              ? "1px solid #BFDBFE"
              : isCurrentUser
              ? "1px solid #0B1F3A"
              : "1px solid #E2E8F0",
          }}
        >
          {message}
        </div>
        {attachments && attachments.length > 0 && (
          <div
            className={`mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 ${
              isCurrentUser ? "justify-items-end" : ""
            }`}
          >
            {attachments.map((att, idx) => (
              <a
                key={`${att.storagePath}-${idx}`}
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg overflow-hidden transition-transform hover:scale-[1.02]"
                style={{
                  background: "#FFFFFF",
                  border: "1px solid #E2E8F0",
                  aspectRatio: "4 / 3",
                  maxWidth: 160,
                }}
                title={`${att.name} · ${humanSize(att.size)}`}
              >
                <img
                  src={att.url}
                  alt={att.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
