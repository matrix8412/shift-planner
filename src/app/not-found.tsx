import Link from "next/link";

export default function NotFound() {
  return (
    <section className="card stack" style={{ textAlign: "center", marginTop: "3rem" }}>
      <h1>404</h1>
      <p className="muted">Stránka nebola nájdená.</p>
      <Link href="/">Späť na úvodnú stránku</Link>
    </section>
  );
}
