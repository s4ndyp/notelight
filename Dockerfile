FROM alpine:latest

# Geef eventueel de gewenste PocketBase versie op
ARG PB_VERSION=0.22.20

# Benodigde pakketten installeren
RUN apk add --no-cache \
    ca-certificates \
    unzip \
    wget \
    zip

# Download en uitpakken van PocketBase
ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip /tmp/pb.zip
RUN unzip /tmp/pb.zip -d /pb/
RUN rm /tmp/pb.zip

# Kopieer je statische HTML/CSS/JS bestanden naar de web-map van PocketBase
COPY ./pb_public /pb/pb_public

# Optioneel: kopieer migraties of JS hooks als je die gebruikt
# COPY ./pb_migrations /pb/pb_migrations
# COPY ./pb_hooks /pb/pb_hooks

# Expose poort 8080
EXPOSE 8080

# Start PocketBase server
CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8080"]
