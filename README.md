# Notelight

PocketBase-app voor registraties met bijlagen.

## Vereisten

- Docker (of Docker Compose)
- PocketBase **≥ 0.23** (de UI gebruikt `bijlage+` / `bijlage-` bij het bijwerken van bestanden)

## Lokaal met Docker Compose

```bash
docker compose up --build
```

App: http://localhost:8080  
Admin: http://localhost:8080/_/

Data en bijlagen blijven bewaard in het Docker-volume `notelight_data` (`/pb/pb_data`).

## Belangrijk bij deploy

Mount altijd een persistent volume op `/pb/pb_data`. Zonder volume verdwijnen database én bijlagen bij elke container-herstart of image-update.
