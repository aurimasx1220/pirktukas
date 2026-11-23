import { Suspense } from "react";
import { connection } from "next/server";
import { loadCatalog } from "@/lib/catalog";
import { isSupabaseConfigured } from "@/lib/supabase";
import { CatalogView } from "./catalog-view";

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-5 py-8 sm:px-8">
        <Suspense fallback={<LoadingPrices />}>
          <HomeContent />
        </Suspense>
      </main>
    </>
  );
}

async function HomeContent() {
  await connection();

  if (!isSupabaseConfigured()) {
    return <MissingKeys />;
  }

  const result = await loadCatalog();
  if (!result.ok) {
    return <DataError message={result.message} />;
  }

  return <CatalogView catalog={result.catalog} />;
}

function LoadingPrices() {
  return (
    <p className="rounded-3xl border border-line bg-card px-6 py-10 text-base text-ink-soft">Kraunamos kainos…</p>
  );
}

function SiteHeader() {
  return (
    <header className="border-b border-line bg-card">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-7 sm:px-8 sm:py-9">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-5xl tracking-tight text-forest sm:text-6xl">Pirktukas</h1>
          </div>
          <span className="mt-2 rounded-full border border-line px-3 py-1 text-xs font-semibold tracking-wide text-ink-soft uppercase">
            MVP
          </span>
        </div>
        <p className="max-w-2xl text-lg leading-7 text-ink-soft sm:text-xl">
          Išmanus kainų palyginimo asistentas
        </p>
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-soft">
          <div className="flex items-center gap-2">
            <PriceSwatch className="bg-foreground" />
            <dt className="sr-only">Įprasta kaina</dt>
            <dd>Įprasta kaina</dd>
          </div>
          <div className="flex items-center gap-2">
            <PriceSwatch className="bg-sale" />
            <dt className="sr-only">Akcijos kaina</dt>
            <dd>Akcijos kaina</dd>
          </div>
        </dl>
      </div>
    </header>
  );
}

function PriceSwatch({ className }: { className: string }) {
  return <span className={`inline-block size-2.5 rounded-full ${className}`} />;
}

function MissingKeys() {
  return (
    <section className="w-full max-w-2xl rounded-3xl border border-line bg-card p-6 shadow-[0_16px_40px_rgba(28,25,21,0.04)] sm:p-8">
      <p className="text-xs font-semibold tracking-[0.16em] text-sale uppercase">Reikia Supabase raktų</p>
      <h2 className="mt-3 font-display text-3xl tracking-tight">Įrašyk prisijungimo duomenis</h2>
      <p className="mt-3 max-w-xl text-base leading-7 text-ink-soft">
        Kad Pirktukas galėtų parodyti kategorijas, produktus ir kainas, atidaryk failą{" "}
        <code className="rounded-md bg-background px-1.5 py-0.5 text-sm text-foreground">.env.local</code> ir
        įrašyk abu raktus. Po to paleisk programą iš naujo.
      </p>
      <ul className="mt-6 space-y-2 font-mono text-sm text-foreground">
        <li className="rounded-xl bg-background px-4 py-3">NEXT_PUBLIC_SUPABASE_URL=</li>
        <li className="rounded-xl bg-background px-4 py-3">NEXT_PUBLIC_SUPABASE_ANON_KEY=</li>
      </ul>
    </section>
  );
}

function DataError({ message }: { message: string }) {
  return (
    <section className="rounded-3xl border border-line bg-card p-6 sm:p-8">
      <h2 className="font-display text-3xl tracking-tight">Duomenų nuskaityti nepavyko</h2>
      <p className="mt-3 max-w-2xl text-base leading-7 text-ink-soft">
        Patikrink, ar lentelės <span className="text-foreground">categories</span>,{" "}
        <span className="text-foreground">products</span>, <span className="text-foreground">store_products</span>,{" "}
        <span className="text-foreground">stores</span> ir <span className="text-foreground">prices</span> yra
        pasiekiamos anon raktu.
      </p>
      <p className="mt-4 rounded-2xl bg-background px-4 py-3 text-sm leading-6 text-foreground">{message}</p>
    </section>
  );
}
