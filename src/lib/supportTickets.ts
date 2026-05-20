/**
 * supportTickets.ts — shared types + helpers for the support ticket system.
 *
 * Wire contract: tickets written here are read by support-edullent-dashboard.
 * If you change the schema, also update:
 *   - parent-dashboard/firestore.rules (support_tickets block) + indexes
 *   - support-edullent-dashboard/src/contexts/TicketsContext.tsx
 *   - the same lib in teacher/principal/owner dashboards
 *
 * See cross-dashboard linking rule: every reader-filtered field MUST be
 * required on EVERY writer.
 */
import {
  Timestamp,
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  doc,
  where,
  arrayUnion,
  increment,
} from "firebase/firestore";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { db } from "./firebase";

export type TicketCategory = "bug" | "feature" | "billing" | "account" | "other";
export type TicketPriority = "low" | "medium" | "high" | "urgent";
export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";
export type AuthorRole = "parent" | "teacher" | "principal" | "owner" | "support";

export interface TicketReply {
  id: string;          // stable client-generated uuid
  authorRole: AuthorRole;
  authorUid: string;
  authorName: string;
  authorEmail: string;
  message: string;
  createdAt: number;   // client ms epoch (Firestore doesn't allow
                       // serverTimestamp inside arrays)
}

export interface TicketAttachment {
  name: string;
  url: string;          // tokenised download URL from getDownloadURL
  storagePath: string;  // for delete capability
  contentType: string;
  size: number;
}

export interface SupportTicket {
  id: string;
  schoolId: string;
  branchId: string;
  branchName: string;
  schoolName: string;
  createdBy: {
    uid: string;
    email: string;
    name: string;
    role: Exclude<AuthorRole, "support">;
  };
  subject: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
  resolvedAt: Timestamp | null;
  lastReplyAt: Timestamp | null;
  replyCount: number;
  replies: TicketReply[];
  attachments: TicketAttachment[];
}

const COLLECTION = "support_tickets";

const SUBJECT_MAX = 200;
const DESCRIPTION_MAX = 5000;
const MESSAGE_MAX = 5000;

const truncate = (s: string, max: number) => s.slice(0, max);
const trimNonEmpty = (s: string) => s.replace(/\s+/g, " ").trim();

export interface CreateTicketInput {
  schoolId: string;
  branchId: string;
  branchName: string;
  schoolName: string;
  createdBy: SupportTicket["createdBy"];
  subject: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  attachments?: TicketAttachment[];
}

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

/**
 * Upload one image to `support_uploads/{uid}/{batchId}/{filename}` and return
 * the persisted attachment metadata.  Caller MUST pass a stable `batchId` so
 * all files for a single ticket land under the same folder (enables cascade
 * delete + traces back to the ticket).
 */
export async function uploadTicketAttachment(
  uid: string,
  batchId: string,
  file: File
): Promise<TicketAttachment> {
  if (!uid) throw new Error("Missing authenticated user.");
  if (!batchId) throw new Error("Missing upload batch id.");
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than 10 MB.`);
  }
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(`${file.name}: only image files allowed.`);
  }
  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
  const fileName = `${Date.now()}_${safeName}`;
  const path = `support_uploads/${uid}/${batchId}/${fileName}`;
  const ref = storageRef(getStorage(), path);
  await uploadBytes(ref, file, { contentType: file.type });
  const url = await getDownloadURL(ref);
  return {
    name: safeName,
    url,
    storagePath: path,
    contentType: file.type,
    size: file.size,
  };
}

/** Best-effort cleanup if user removes a staged attachment before submit. */
export async function deleteTicketAttachment(storagePath: string): Promise<void> {
  try {
    await deleteObject(storageRef(getStorage(), storagePath));
  } catch (err) {
    console.warn("[supportTickets] deleteTicketAttachment:", err);
  }
}

/** Persists a new ticket. Throws on validation failure or Firestore error. */
export async function createTicket(input: CreateTicketInput): Promise<string> {
  const subject = trimNonEmpty(input.subject);
  const description = input.description.trim();
  if (!subject) throw new Error("Subject is required.");
  if (subject.length > SUBJECT_MAX) {
    throw new Error(`Subject must be ${SUBJECT_MAX} characters or fewer.`);
  }
  if (!description) throw new Error("Description is required.");
  if (description.length > DESCRIPTION_MAX) {
    throw new Error(`Description must be ${DESCRIPTION_MAX} characters or fewer.`);
  }
  if (!input.schoolId) throw new Error("Missing school context.");
  if (!input.createdBy.uid) throw new Error("Missing authenticated user.");
  const attachments = (input.attachments || []).slice(0, MAX_ATTACHMENTS);

  const payload = {
    schoolId: input.schoolId,
    branchId: input.branchId,
    branchName: input.branchName,
    schoolName: input.schoolName,
    createdBy: {
      uid: input.createdBy.uid,
      email: input.createdBy.email.toLowerCase(),
      name: input.createdBy.name,
      role: input.createdBy.role,
    },
    subject,
    description: truncate(description, DESCRIPTION_MAX),
    category: input.category,
    priority: input.priority,
    status: "open" as const,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    resolvedAt: null,
    lastReplyAt: null,
    replyCount: 0,
    replies: [] as TicketReply[],
    attachments,
  };

  const ref = await addDoc(collection(db, COLLECTION), payload);
  return ref.id;
}

export interface AddReplyInput {
  ticketId: string;
  authorRole: AuthorRole;
  authorUid: string;
  authorName: string;
  authorEmail: string;
  message: string;
}

/**
 * Appends a reply to a ticket. Validates length + identity.
 *
 * Once support marks a ticket resolved/closed it becomes read-only for the
 * creator — Firestore rules reject any creator update on a resolved/closed
 * ticket. The Help UI hides the reply composer in those states; this guard
 * is a defensive client-side mirror so callers fail fast.
 */
export async function addReply(input: AddReplyInput): Promise<void> {
  const message = input.message.trim();
  if (!message) throw new Error("Reply cannot be empty.");
  if (message.length > MESSAGE_MAX) {
    throw new Error(`Reply must be ${MESSAGE_MAX} characters or fewer.`);
  }
  if (!input.ticketId) throw new Error("Missing ticket id.");
  if (!input.authorUid) throw new Error("Missing authenticated user.");

  const reply: TicketReply = {
    id: cryptoUuid(),
    authorRole: input.authorRole,
    authorUid: input.authorUid,
    authorName: input.authorName,
    authorEmail: input.authorEmail.toLowerCase(),
    message: truncate(message, MESSAGE_MAX),
    createdAt: Date.now(),
  };

  await updateDoc(doc(db, COLLECTION, input.ticketId), {
    replies: arrayUnion(reply),
    replyCount: increment(1),
    lastReplyAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Live listener for tickets owned by a single user (their /help dashboard). */
export function subscribeUserTickets(
  uid: string,
  onChange: (tickets: SupportTicket[]) => void,
  onError?: (err: Error) => void
): () => void {
  if (!uid) {
    onChange([]);
    return () => {};
  }
  const q = query(
    collection(db, COLLECTION),
    where("createdBy.uid", "==", uid),
    orderBy("createdAt", "desc")
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows: SupportTicket[] = snap.docs.map((d) => {
        const data = d.data() as Omit<SupportTicket, "id">;
        return {
          id: d.id,
          ...data,
          replies: Array.isArray(data.replies) ? data.replies : [],
        };
      });
      onChange(rows);
    },
    (err) => {
      console.warn("[supportTickets] subscribeUserTickets:", err.message);
      onError?.(err);
    }
  );
}

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  bug: "Bug / Something broken",
  feature: "Feature request",
  billing: "Billing & payment",
  account: "Account access",
  other: "Other",
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export function statusTone(status: TicketStatus): {
  bg: string;
  fg: string;
  border: string;
} {
  switch (status) {
    case "open":
      return { bg: "#DBEAFE", fg: "#1E40AF", border: "#93C5FD" };
    case "in_progress":
      return { bg: "#FEF3C7", fg: "#92400E", border: "#FCD34D" };
    case "resolved":
      return { bg: "#DCFCE7", fg: "#166534", border: "#86EFAC" };
    case "closed":
      return { bg: "#F1F5F9", fg: "#475569", border: "#CBD5E1" };
  }
}

/** Minimal RFC4122-ish v4 uuid. Sufficient for client-side reply ids. */
function cryptoUuid(): string {
  const c =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random()
          .toString(36)
          .slice(2, 10)}`;
  return c;
}

/** Format a Firestore Timestamp / ms epoch / null into a short relative label. */
export function fmtRelative(value: Timestamp | number | null | undefined): string {
  if (value == null) return "—";
  const ms =
    typeof value === "number"
      ? value
      : typeof (value as Timestamp).toMillis === "function"
      ? (value as Timestamp).toMillis()
      : 0;
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(ms).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
