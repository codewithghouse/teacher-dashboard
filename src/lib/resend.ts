/**
 * resend.ts — client-side wrapper for /api/send-email.
 *
 * The teacher endpoint only accepts type: "parent_notification" with structured
 * fields. Raw HTML is NOT accepted — the server renders the template.
 */
import { auth } from "./firebase";

export interface ParentNotificationPayload {
  to: string;
  parentName: string;
  studentName: string;
  subject?: string;
  message: string;
  teacherName?: string;
}

export const sendParentNotificationEmail = async (p: ParentNotificationPayload) => {
  const token = await auth.currentUser?.getIdToken();
  const response = await fetch("/api/send-email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ type: "parent_notification", ...p }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as any)?.error || `Failed to send email (${response.status})`);
  }
  return data;
};