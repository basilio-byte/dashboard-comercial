export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Seahub Comercial</h1>
      <p className="mt-3 text-neutral-600">
        Esqueleto no ar. As telas entram a partir da Fase 1 — ver{" "}
        <code className="rounded bg-neutral-200 px-1 py-0.5 text-sm">docs/context/roadmap.md</code>.
      </p>
      <p className="mt-6 text-sm text-neutral-500">
        Saúde do serviço:{" "}
        <a className="underline" href="/api/health">
          /api/health
        </a>
      </p>
    </main>
  );
}
