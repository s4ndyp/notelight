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
