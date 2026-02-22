import Link from 'next/link';

export default function HomePage(): React.ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <h1 className="mb-4 text-5xl font-bold font-serif tracking-tight">
        Flow
      </h1>
      <p className="mb-8 max-w-xl text-lg text-fd-muted-foreground">
        AI workforce management system — route requests, spawn workers, self-improve over time.
      </p>
      <Link
        href="/docs"
        className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
      >
        Read the Docs
        <span aria-hidden="true">&rarr;</span>
      </Link>
    </main>
  );
}
