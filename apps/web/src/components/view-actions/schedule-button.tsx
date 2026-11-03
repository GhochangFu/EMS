import { useState } from "react";

import { isMasterDataAdmin } from "../../lib/admin-access";
import type { SchedulePrefill } from "../../lib/schedule-from-view";
import type { AuthUser } from "../../stores/auth-store";
import { ReportScheduleWizard } from "../report-schedule-wizard";

type ScheduleButtonProps = {
  /** The signed-in user; the button shows only for a role that may schedule (`isMasterDataAdmin`). */
  user: AuthUser | null | undefined;
  /** What the view hands the wizard; `null` while the view has nothing to schedule. */
  prefill: SchedulePrefill | null;
};

/**
 * `F4.303` U16 (ADR 0108 Amendment 6 item 6, owner Q-C) — "Schedule" on an Energy view or a point
 * view. It opens the existing report-schedule wizard inline under the control row, prefilled with
 * the template, the sites and the compare or the points; no modal. The server still checks every
 * point and site against the author's scope, so the button only decides who sees the control.
 */
export function ScheduleButton({ user, prefill }: ScheduleButtonProps) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState(false);
  if (user === null || user === undefined || !isMasterDataAdmin(user.role) || prefill === null) {
    return null;
  }
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        className="rounded border border-line-strong px-2 py-1 text-xs"
        onClick={() => {
          setCreated(false);
          setOpen((was) => !was);
        }}
      >
        Schedule
      </button>
      {created ? (
        <span role="status" className="text-xs text-ink">
          Schedule created
        </span>
      ) : null}
      {open ? (
        <div className="mt-2 w-full basis-full">
          <ReportScheduleWizard
            user={user}
            schedule={null}
            prefill={prefill}
            inline
            onCancel={() => setOpen(false)}
            onDone={() => {
              setOpen(false);
              setCreated(true);
            }}
          />
        </div>
      ) : null}
    </>
  );
}
