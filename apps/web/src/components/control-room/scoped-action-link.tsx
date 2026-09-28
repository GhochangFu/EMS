import { Link } from "react-router-dom";

export function ScopedActionLink({
  enabled,
  to,
  label,
  className = "",
}: {
  enabled: boolean;
  to: string;
  label: string;
  className?: string;
}) {
  const classes = `${className} inline-flex rounded px-3 py-1.5 text-xs font-semibold ${
    enabled
      ? "bg-accent text-on-accent"
      : "cursor-not-allowed bg-well-deep text-neutral-ink"
  }`;
  return enabled ? (
    <Link className={classes} to={to}>
      {label}
    </Link>
  ) : (
    <span className={classes} title="Outside your asset-group scope">
      {label}
    </span>
  );
}
