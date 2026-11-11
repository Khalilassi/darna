"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="container section stack gap-md center" role="alert">
      <h1>Something went wrong · حدث خطأ ما</h1>
      <p className="muted">Please try again in a moment. · يرجى المحاولة بعد قليل.</p>
      <p>
        <button type="button" className="btn btn-primary" onClick={reset}>
          Try again · حاول مرة أخرى
        </button>
      </p>
    </div>
  );
}
