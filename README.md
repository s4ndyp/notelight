# Notelight

PocketBase-app voor registraties met bijlagen.

## Vereisten

- Docker (of Docker Compose)
- PocketBase **≥ 0.23** (de UI gebruikt `bijlage+` / `bijlage-` bij het bijwerken van bestanden)

## Docker Compose / Dockhand

`docker-compose.yml` mapte hostpoort **8084** naar containerpoort **8080**.

```bash
docker compose up -d --build
```

App: http://localhost:8084  
Admin: http://localhost:8084/_/

In Dockhand: stack aanmaken met deze compose-file (uit Git of geplakt). Poortbadge **8084** opent de app.

Data en bijlagen blijven bewaard in het volume `notelight_data` (`/pb/pb_data`).

## Belangrijk bij deploy

Mount altijd een persistent volume op `/pb/pb_data`. Zonder volume verdwijnen database én bijlagen bij elke container-herstart of image-update.

## Collecties in PocketBase Admin

Na de eerste start maak je (minimaal) deze collecties aan. Zet API-rules tijdelijk op open (`""` / leeg) als de app nog zonder login draait — of beperk ze later.

### 1. `registraties` (bestaand)

Velden die de UI verwacht:

| Veld | Type | Opmerkingen |
|------|------|-------------|
| `titel` | text | verplicht |
| `omschrijving` | editor/text | verplicht |
| `soort` | text | verplicht |
| `status` | text | |
| `prio` | text | Low / Medium / High |
| `kenmerk` | text | |
| `dataset` | text | |
| `betrokkene` | text | |
| `bijlage` | file | multi, Max files ≥ 2 |

### 2. `keuzelijsten` (nieuw — optie 7)

Centrale waarden voor dropdowns. De app vult bekende statussen en bestaande recordwaarden automatisch aan bij eerste load.

| Veld | Type | Opmerkingen |
|------|------|-------------|
| `categorie` | select of text | `status`, `soort`, `kenmerk`, `dataset`, `betrokkene` |
| `waarde` | text | de zichtbare keuze |

Aanbevolen: unieke index of zorgvuldig beheer zodat dezelfde `categorie`+`waarde` niet dubbel voorkomt.

In de UI:

- velden zijn **alleen keuzelijsten** (geen vrije tekst meer);
- via **+** voeg je met een extra handeling een nieuwe centrale keuze toe;
- via **Keuzelijsten** beheer je alles centraal (toevoegen/verwijderen).

Zonder deze collectie blijft de app werken met ingebouwde statussen; andere dropdowns blijven dan leeg tot de collectie bestaat.

### 3. `voorkeuren` (nieuw — optie 9)

Deelt filters, pins, kolommen, breedtes en sortering over browsers/apparaten (team-breed, sleutel `team`).

| Veld | Type | Opmerkingen |
|------|------|-------------|
| `sleutel` | text | gebruik `team` (uniek) |
| `data` | json | object met filters/pins/kolommen/sort |

Zonder deze collectie blijven voorkeuren in `localStorage` van de browser.

## Nieuwe app-features

- **Meer laden**: tabel laadt batches van 50 records; onderaan “Meer laden”.
- **Exporteren**: CSV (Excel-vriendelijk, UTF-8 BOM) van de huidige zoek-/filterset.
- **Deep links**: `index.html?id=<recordId>` opent een record; galerij linkt door naar bewerken.
- **Keuzelijsten**: zie hierboven.
- **Voorkeuren sync**: zie hierboven.
