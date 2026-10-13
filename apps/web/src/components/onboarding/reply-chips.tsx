type ReplyChipsProps = {
  /** The replies to offer, already filtered (`offeredReplies`): never "undo". */
  replies: readonly string[];
  /** Sends one reply's text as a turn, as if typed. */
  onPick: (reply: string) => void;
  disabled: boolean;
};

/**
 * `F4.199` — the latest onboarding turn's suggested replies as buttons. A
 * click sends the reply's text through the same path as the input. Extracted
 * from the onboarding page in `F3.86` PR 6 so the copilot dock's onboarding
 * skill renders the same chips; the markup is the page's, unchanged.
 */
export function ReplyChips({ replies, onPick, disabled }: ReplyChipsProps) {
  return (
    <div
      role="group"
      aria-label="Suggested replies"
      className="flex flex-wrap gap-2 border-t border-line px-4 pt-3"
    >
      {replies.map((reply, i) => (
        <button
          key={`${i}-${reply}`}
          type="button"
          onClick={() => onPick(reply)}
          disabled={disabled}
          className="surface-button px-3 py-1 text-xs disabled:opacity-50"
        >
          {reply}
        </button>
      ))}
    </div>
  );
}
