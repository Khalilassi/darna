import Link from "next/link";

// Rendered inside the [locale] layout; the locale isn't available here, so offer both.
export default function NotFound() {
  return (
    <div className="container section stack gap-md center">
      <h1>Page not found · الصفحة غير موجودة</h1>
      <p className="muted">The page you&apos;re looking for doesn&apos;t exist, or this listing is no longer available.</p>
      <p className="row-center">
        <Link className="btn btn-primary" href="/en/listings">
          Browse homes
        </Link>
        <Link className="btn btn-outline" href="/ar/listings" lang="ar">
          تصفح البيوت
        </Link>
      </p>
    </div>
  );
}
