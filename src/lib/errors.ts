// Turns the short machine codes raised by our database functions (and the
// common Supabase failures) into something a reader can act on.

const MESSAGES: Record<string, string> = {
  // access
  not_authenticated: "Please sign in to continue.",
  alpha_access_required: "Your account doesn't have alpha access yet.",
  invalid_alpha_code: "That alpha code isn't valid. Check it and try again.",
  access_disabled: "This account's access has been turned off. Contact the person running the alpha.",
  admin_required: "Only an alpha admin can do that.",
  not_allowed: "You don't have permission to do that in this room.",
  cannot_change_self: "You can't remove your own admin access.",
  // books
  book_not_found: "That book couldn't be found.",
  book_unavailable: "This book isn't ready to be read yet.",
  book_in_use: "Other people are still reading this book in a room, so it can't be deleted yet.",
  book_status_locked: "This book was disabled by an admin.",
  upload_missing: "The upload didn't reach storage. Please try uploading again.",
  file_too_large: "That file is larger than the limit for its type.",
  // rooms
  room_not_found: "This room doesn't exist, or you don't have access to it.",
  room_not_open: "This room isn't open to join.",
  room_full: "This room is full.",
  room_closed: "This room isn't accepting new members right now.",
  room_archived: "This room has been archived.",
  removed_from_room: "You were removed from this room. Ask the owner for a new invitation.",
  invalid_room_settings: "Those room settings aren't valid.",
  invalid_recipient: "That reader is no longer in the room. Choose who can see your note again.",
  invalid_attention: "Choose an attention level for your note.",
  invalid_kind: "That kind of note isn't supported.",
  feature_off: "This room has switched that feature off.",
  invalid_features: "Those feature settings aren't valid.",
  invalid_capacity: "Choose between 1 and 75 seats.",
  invalid_prediction: "Write your prediction first (up to 2,000 characters).",
  invalid_unlock: "Choose a point further ahead than where you are now.",
  too_many_predictions: "You've sealed a lot of predictions in this room already.",
  prediction_sealed: "This prediction is still sealed. It opens when you reach its point.",
  prediction_unavailable: "This prediction isn't available any more.",
  invalid_verdict: "Choose how close it came.",
  invalid_poll: "A poll needs a question and between two and six answers.",
  poll_ahead: "This poll opens when you reach it.",
  poll_unavailable: "This poll isn't available any more.",
  invalid_option: "Choose one of the answers.",
  already_voted: "Your vote is already sealed.",
  invalid_ritual: "That ritual needs a title and a point in the book (and a date, for a pause).",
  too_many_rituals: "This room already has twenty rituals running. End one first.",
  vault_locked: "The vault opens when you reach the end of the book.",
  finish_first: "Reach the end of the book before rating it.",
  invalid_rating: "Choose between one and five stars.",
  invalid_outline: "This book's contents couldn't be read.",
  too_many_members_for_duo: "A Private Duo can only have two readers. Remove members first.",
  limit_below_member_count: "The member limit can't be lower than the number of people already here.",
  owner_must_transfer: "Hand the room to someone else before leaving — or remove the other members first.",
  not_a_member: "You're not a member of this room.",
  // invites
  invite_not_found: "This invitation link isn't valid.",
  invite_revoked: "This invitation was revoked.",
  invite_expired: "This invitation has expired.",
  invite_used_up: "This invitation has already been used.",
  invite_not_for_you: "This invitation was made for someone else.",
  invalid_invite_settings: "Those invitation settings aren't valid.",
  user_not_found: "That tester couldn't be found.",
  already_member: "They're already in this room.",
  // notes
  note_unavailable: "This note isn't available — it may be ahead of you, or it was removed.",
  empty_note: "Write something, pick a reaction, or attach a file first.",
  note_too_long: "That note is too long.",
  invalid_link: "Links need to start with http:// or https://.",
  invalid_location: "Couldn't work out where in the book to put that.",
  invalid_reply: "Replies can't be empty.",
  invalid_reaction: "That reaction isn't valid.",
};

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: "That email and password don't match.",
  email_not_confirmed: "Please confirm your email first — check your inbox for the link.",
  user_already_exists: "An account with this email already exists. Try signing in instead.",
  weak_password: "Choose a longer password (at least 8 characters).",
  over_email_send_rate_limit: "Too many emails were requested. Wait a minute and try again.",
  over_request_rate_limit: "Too many attempts. Wait a moment and try again.",
  otp_expired: "That link has expired or was already used. Request a new one.",
  same_password: "Choose a password you haven't used here before.",
  signup_disabled: "Sign-ups are currently turned off.",
  email_address_invalid: "That email address doesn't look right.",
  validation_failed: "Please check the details you entered.",
};

interface ErrorLike {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
}

/** The machine code of an error raised by one of our database functions, if any. */
export function errorCode(error: unknown): string | null {
  const message = (error as ErrorLike | null)?.message;
  return message && /^[a-z_]+$/.test(message) ? message : null;
}

export function friendlyError(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!error) return fallback;
  if (typeof error === "string") return MESSAGES[error] ?? error;
  const e = error as ErrorLike;
  const message = e.message ?? "";

  if (MESSAGES[message]) return MESSAGES[message];
  if (e.code && AUTH_MESSAGES[e.code]) return AUTH_MESSAGES[e.code];

  if (e.name === "UploadError") return message || fallback;
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return "Can't reach the server. Check your connection and try again.";
  }
  if (/row-level security|permission denied/i.test(message)) return "You don't have permission to do that.";
  if (/jwt expired|invalid jwt|refresh token/i.test(message)) return "Your session has expired. Please sign in again.";
  if (/duplicate key/i.test(message)) return "That already exists.";
  // Supabase Auth messages are written for end users; pass them through.
  if (e.name?.startsWith("Auth") && message) return message;
  return fallback;
}
