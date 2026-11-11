import type { Dict } from "@/lib/i18n";

export function ApiUnavailable({ t, retryHref }: { t: Dict; retryHref: string }) {
  return (
    <div className="notice notice-warning unavailable" role="alert">
      <strong>{t.listings.unavailableTitle}</strong>
      <p>{t.listings.unavailableBody}</p>
      <a className="btn btn-outline btn-sm" href={retryHref}>
        {t.listings.retry}
      </a>
    </div>
  );
}
