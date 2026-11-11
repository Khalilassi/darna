import Link from "next/link";

export default function NotFound() {
  return (
    <main className="login">
      <div className="card stack gap-sm">
        <h1>Page not found</h1>
        <Link href="/">Back to dashboard</Link>
      </div>
    </main>
  );
}
