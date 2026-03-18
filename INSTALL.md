# Inštalačná príručka – Pracovné pohotovosti

Návod na nasadenie aplikácie z GitHub repozitára na čistý Linux server s nainštalovaným Docker-om.

---

## Predpoklady

| Požiadavka | Minimum |
|---|---|
| OS | Ubuntu 22.04+ / Debian 12+ (alebo iný Linux s `systemd`) |
| Docker Engine | 24+ |
| Docker Compose | v2 (súčasť Docker Engine) |
| RAM | 2 GB |
| Disk | 10 GB voľného miesta |
| Porty | 80, 443 (HTTP/S cez Caddy) |
| Git | nainštalovaný (`apt install git`) |

---

## 1. Klonuj repozitár

```bash
cd /opt
git clone https://github.com/<TVOJ-UCET>/pracovne-pohotovosti.git
cd pracovne-pohotovosti
```

> Nahraď `<TVOJ-UCET>` skutočným názvom GitHub účtu/organizácie.
> Pre privátny repozitár použi SSH kľúč alebo personal access token.

---

## 2. Vytvor `.env` súbor

```bash
cp .env.example .env   # ak existuje, inak vytvor manuálne
nano .env
```

Minimálny obsah `.env`:

```env
# ── Základ ──────────────────────────────────────────────
NODE_ENV=production
APP_URL=https://pohotovosti.example.com   # URL na ktorej bude appka dostupná
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/pohotovosti
AUTH_SECRET=<nahodny-retazec-min-32-znakov>

# ── AI provider (voliteľné) ─────────────────────────────
AI_PROVIDER=openai
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=

# ── SMTP – e-mailové notifikácie (voliteľné) ────────────
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=

# ── S3 / MinIO – úložisko súborov ───────────────────────
S3_ENDPOINT=http://minio:9000
S3_REGION=eu-central-1
S3_BUCKET=pohotovosti
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
```

### Generovanie `AUTH_SECRET`

```bash
openssl rand -base64 48
```

> **Dôležité:** `DATABASE_URL` musí smerovať na hostname `postgres` (názov služby v Docker Compose).
> `S3_ENDPOINT` musí smerovať na `http://minio:9000` (interná Docker sieť).

---

## 3. Nastav HTTPS doménu (Caddy)

Otvor `ops/Caddyfile` a nahraď `:80` svojou doménou:

```caddyfile
pohotovosti.example.com {
  encode gzip zstd

  @health path /api/health
  handle @health {
    reverse_proxy web:3000
  }

  handle {
    reverse_proxy web:3000
  }
}
```

Caddy automaticky zaobstará Let's Encrypt TLS certifikát.

> Ak chceš len HTTP (napr. za iným reverse proxy), ponechaj `:80`.

---

## 4. Spusti aplikáciu

```bash
docker compose up --build -d
```

Tento príkaz:

1. **postgres** – spustí PostgreSQL 17 databázu
2. **minio** – spustí MinIO S3-kompatibilné úložisko
3. **init-db** – vytvorí databázové tabuľky (`prisma db push`) a synchronizuje oprávnenia
4. **init-storage** – vytvorí S3 bucket
5. **web** – spustí Next.js aplikáciu na porte 3000
6. **worker** – spustí pozaďový worker (cron úlohy, notifikácie)
7. **proxy** – spustí Caddy reverse proxy na portoch 80/443

### Sleduj priebeh buildu

```bash
docker compose logs -f
```

### Over, že všetko beží

```bash
docker compose ps
```

Očakávaný výstup – služby `web`, `worker`, `postgres`, `minio`, `proxy` v stave `Up`:

```
NAME                          STATUS
pracovne-pohotovosti-proxy-1     Up
pracovne-pohotovosti-web-1       Up
pracovne-pohotovosti-worker-1    Up
pracovne-pohotovosti-postgres-1  Up (healthy)
pracovne-pohotovosti-minio-1     Up
```

### Over zdravie aplikácie

```bash
curl -s http://localhost/api/health
```

---

## 5. Prvé prihlásenie

Otvor v prehliadači adresu nastavenú v `APP_URL`.
Predvolený admin účet vytvoríš cez init skript alebo priamo v databáze.

---

## Aktualizácia na novú verziu

```bash
cd /opt/pracovne-pohotovosti
git pull origin main
docker compose up --build -d
```

Kontajner `init-db` pri každom štarte automaticky spustí migrácie a synchronizáciu oprávnení.

---

## Zálohovanie

### Databáza (PostgreSQL)

```bash
docker compose exec postgres pg_dump -U postgres pohotovosti > backup_$(date +%Y%m%d).sql
```

### Obnovenie zo zálohy

```bash
cat backup_20260318.sql | docker compose exec -T postgres psql -U postgres pohotovosti
```

### MinIO dáta

MinIO dáta sú v Docker volume `minio_data`. Zálohovať ich možno cez:

```bash
docker run --rm -v pracovne-pohotovosti_minio_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/minio_backup_$(date +%Y%m%d).tar.gz /data
```

---

## Užitočné príkazy

| Akcia | Príkaz |
|---|---|
| Zastaviť všetko | `docker compose down` |
| Zastaviť + vymazať volumes (⚠️ dáta) | `docker compose down -v` |
| Reštart jednej služby | `docker compose restart web` |
| Logy konkrétnej služby | `docker compose logs -f web` |
| Vstup do databázy | `docker compose exec postgres psql -U postgres pohotovosti` |
| Prisma Studio (debug) | `docker compose exec web npx prisma studio` |
| Rebuild bez cache | `docker compose build --no-cache` |

---

## Riešenie problémov

### Port 80/443 je obsadený

Zastav existujúci web server (nginx, apache) alebo zmeň porty v `docker-compose.yml`:

```yaml
proxy:
  ports:
    - "8080:80"
    - "8443:443"
```

### init-db zlyhá na pripojení k databáze

Over, že `DATABASE_URL` v `.env` obsahuje hostname `postgres` (nie `localhost`):

```
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/pohotovosti
```

### Caddy nedostane certifikát

- Over, že doména smeruje (DNS A záznam) na IP servera
- Over, že porty 80 a 443 sú otvorené vo firewalle:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

### Nedostatok pamäte pri builde

Next.js build môže vyžadovať viac RAM. Ak build padá, pridaj swap:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```
