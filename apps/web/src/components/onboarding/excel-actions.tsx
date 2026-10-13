import { useRef, useState } from "react";
import type { OnboardingChatResponseDto } from "@bms/shared";

import { downloadOnboardingTemplate, uploadOnboardingExcel } from "../../api/admin/onboarding";
import { apiErrorMessage } from "../../lib/api-error-message";

type ExcelActionsProps = {
  /** The session an upload merges into; `null` while none is open (Upload is disabled). */
  sessionId: string | null;
  /** The upload's answer: the session, validation, replies and the preview hint. */
  onUploaded: (data: OnboardingChatResponseDto) => void;
  /** A refused download or upload, as one sentence for the caller's banner. */
  onError: (message: string) => void;
};

/**
 * The onboarding draft's Excel template download and workbook upload: two
 * buttons and the hidden file input. Extracted from the onboarding page's
 * header in `F3.86` PR 6 so the copilot dock's onboarding skill offers the
 * same pair; the markup is the page's, unchanged.
 */
export function ExcelActions({ sessionId, onUploaded, onError }: ExcelActionsProps) {
  const [uploadBusy, setUploadBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          // `void download…()` swallowed every refusal as an unhandled
          // rejection: a 401 cleared the session while the operator saw
          // nothing at all.
          downloadOnboardingTemplate().catch((err: Error) => onError(apiErrorMessage(err)));
        }}
        className="surface-button px-3 py-1"
      >
        Excel template
      </button>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={sessionId === null || uploadBusy}
        aria-busy={uploadBusy}
        className="surface-button px-3 py-1 disabled:opacity-50"
      >
        {uploadBusy ? "Uploading…" : "Upload Excel"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file || sessionId === null) {
            return;
          }
          setUploadBusy(true);
          uploadOnboardingExcel(sessionId, file)
            .then(onUploaded)
            .catch((err: Error) => onError(apiErrorMessage(err)))
            .finally(() => setUploadBusy(false));
        }}
      />
    </>
  );
}
