import Link from "next/link";

import { SummaryCard } from "@/components/summary-card";
import { getModuleAccess } from "@/server/auth/access";
import { getCurrentUser } from "@/server/auth";

const pillars = [
  {
    title: "Serverové dáta",
    body: "Zápisy idú cez server actions a Prisma, takže klient nepristupuje priamo na databázu."
  },
  {
    title: "PostgreSQL jadro",
    body: "Nová schéma pokrýva používateľov, rozvrhy, dovolenky, sviatky, nastavenia aj worker joby."
  },
  {
    title: "Pripravené na AI",
    body: "AI provideri sú schovaní za lokálnou vrstvou, takže sa nepretláčajú priamo do UI ani doménovej logiky."
  }
];

const nextSteps = [
  "dokončiť editáciu a mazanie v CRUD moduloch",
  "prepojiť role a oprávnenia s reálnym prihlásením",
  "doplnit worker flow pre pripomienky a synchronizáciu sviatkov",
  "rozšíriť kalendárne zobrazenia o ďalšie filtre a navigáciu"
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
              Aplikácia už beží v Dockeri, používa PostgreSQL, má server actions, worker proces a základné evidencie
              napojené na databázu.
            </p>
          </div>
          <div className="stack-tight">
            <h2>Ďalší smer</h2>
            <p className="muted">
              Ďalšia vrstva je dokončenie oprávnení, väzieb medzi evidenciami a hlbšie workflow pre plánovanie služieb.
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
