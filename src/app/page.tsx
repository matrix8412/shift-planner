import Link from "next/link";

import { SummaryCard } from "@/components/summary-card";
import { getModuleAccess } from "@/server/auth/access";
import { getCurrentUser } from "@/server/auth";

const pillars = [
  {
    title: "Serverové dáta",
    body: "Zápisy idú cez server actions a Prisma; klient nepristupuje priamo na databázu. CRUD moduly majú validáciu, audit log a CSV import/export."
  },
  {
    title: "PostgreSQL + Prisma",
    body: "Schéma pokrýva používateľov, rozvrhy, dovolenky, sviatky, role, oprávnenia, audit aj worker joby vrátane JobRun sledovania."
  },
  {
    title: "AI, worker a notifikácie",
    body: "Worker cron odosiela pripomienky zmien (email + push) a automaticky synchronizuje sviatky z Nager.Date API pre aktuálny a nasledujúci rok."
  }
];

const nextSteps = [
  "Dokončiť editáciu a mazanie v CRUD moduloch tam, kde chýba",
  "Prepojiť UI rolí a oprávnení s reálnym prihlasovaním a testovať prístupové cesty",
  "Vylepšiť generovanie rozvrhov (lepší UI, auditovanie výsledkov, retry/queue)",
  "Rozšíriť kalendárne zobrazenia o filtre, stránkovanie a exporty",
  "Pridať testy (jednotkové/integračné) a nastaviť CI pipeline"
];

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const currentUser = await getCurrentUser();
  const scheduleAccess = getModuleAccess(currentUser, "schedule");
  const usersAccess = getModuleAccess(currentUser, "users");

  return (
    <div className="stack">
      <section className="card stack">
        <span className="kicker">prehľad systému</span>
        <div className="split">
          <div className="stack-tight">
            <h2>Čo je už pripravené</h2>
            <p className="muted">
              Aplikácia beží v Dockeri, používa PostgreSQL + Prisma, má plné CRUD moduly s auditom, role a oprávnenia,
              AI generovanie rozvrhu, worker cron s reálnymi pripomienkami a synchronizáciou sviatkov.
            </p>
          </div>
          <div className="stack-tight">
            <h2>Ďalší smer</h2>
            <p className="muted">
              Zostáva doplniť testy, rozšíriť kalendárne zobrazenia, vylepšiť UI generovania rozvrhov a nastaviť CI pipeline.
            </p>
          </div>
        </div>
        <div className="cta-row">
          <Link href="/schedule" className="button">
            Otvoriť rozvrh
          </Link>
          <Link href="/users" className="button secondary">
            Otvoriť používateľov
          </Link>
        </div>
      </section>

      <section className="grid grid-3">
        {pillars.map((pillar) => (
          <SummaryCard key={pillar.title} title={pillar.title} body={pillar.body} />
        ))}
      </section>

      <section className="card stack-tight">
        <h2>Najbližšie kroky</h2>
        <ul className="plain-list">
          {nextSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
