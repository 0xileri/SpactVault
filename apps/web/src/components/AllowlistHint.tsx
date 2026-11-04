import type { Policy } from "@spact/shared";

import { allowlistHint } from "../dashboard.js";
import { useLink } from "../network.js";
import { Notice } from "./ui.js";

/** The info hint the dashboard and Manage → Rules show while the vault may pay nobody on NEAR. */
export function AllowlistHint({ policy }: { policy: Pick<Policy, "recipients" | "cross_chain"> }) {
  const link = useLink();
  const hint = allowlistHint(policy);
  if (!hint) return null;
  return (
    <div data-testid="allowlist-hint">
      <Notice tone="info" title={hint}>
        <p>
          <a href={`${link("?page=manage")}#rules`} className="font-semibold underline decoration-sky-300 underline-offset-2 hover:decoration-sky-700">
            Add one in Manage → Rules.
          </a>
        </p>
      </Notice>
    </div>
  );
}
