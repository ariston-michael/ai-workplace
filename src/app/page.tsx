import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">AI Workplace</h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        Hire specialized AI workers and manage them in a virtual office. Sign in to open your offices.
      </p>
      <div className="flex flex-wrap gap-3">
        {/* Plain <a> for /auth/* so the Auth0 proxy handles the request. */}
        <a href="/auth/login?returnTo=/office" className="rounded-full bg-foreground px-5 py-2 font-medium text-background">
          Log in
        </a>
        <Link href="/office" className="rounded-full border border-zinc-300 px-5 py-2 font-medium dark:border-zinc-700">
          Open your office
        </Link>
        <Link href="/procurement" className="rounded-full border border-zinc-300 px-5 py-2 font-medium dark:border-zinc-700">
          Supplier lookup test page
        </Link>
        <Link href="/simulator/camera" className="rounded-full border border-zinc-300 px-5 py-2 font-medium dark:border-zinc-700">
          Camera incident simulator
        </Link>
        <a href="/auth/logout" className="rounded-full border border-zinc-300 px-5 py-2 font-medium dark:border-zinc-700">
          Log out
        </a>
      </div>
    </main>
  );
}
