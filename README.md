# Flux Rec Room 2022 compatibility project

This repository contains the **Flux-owned compatibility server, client adapter tooling, tests, and deployment glue** for a user-supplied Rec Room PC client.

## Target build

- Date: **2022-05-19**
- Steam build ID: **8751857**
- Steam manifest: **6337851004861751095**
- Client family: Unity / IL2CPP PC build

The proprietary Rec Room binaries are intentionally **not stored in this repository**. Put a legally obtained copy on the Windows game host and point `FLUX_RECROOM_CLIENT_DIR` at it.

## Architecture

```text
Flux website (Firebase Auth)
        |
        | Firebase ID token / session request
        v
Flux Rec Room gateway (this repo)
        |
        +--> Firebase Admin / Firestore (identity + save data)
        +--> Photon configuration bridge (multiplayer)
        +--> Rec Room 2022 compatibility routes
        +--> request tracing for unimplemented 2022 endpoints
        |
        v
Windows game host
  Rec Room May 19 2022 client
  Sunshine/WebRTC-compatible streaming host
        |
        v
Flux /games browser player
```

## First milestone

1. Verify a user-supplied May 19 2022 client layout.
2. Redirect the client to this compatibility service.
3. Firebase-backed login/account bootstrap.
4. Dorm/orientation bootstrap.
5. Photon room join.
6. Save profile/inventory state.
7. Stream the Windows client into Flux.

## Secrets

Do **not** commit Firebase Admin service-account JSON, Photon App IDs, admin tokens, or tunnel credentials. Configure them as environment variables / deployment secrets. The Firebase web configuration used by Flux is client configuration and remains in the Flux frontend.

See `.env.example` for required server-side settings.
