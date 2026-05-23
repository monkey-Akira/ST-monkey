# STC-MOD Cloud Installer

This folder is a Linux-friendly cloud installer for SillyTavern + STC-MOD.

It installs SillyTavern into a release-based layout so official updates can be
applied through the MOD tool and rolled back if the new version fails.

## Linux Requirements

```bash
sudo apt update
sudo apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

## First Install

Upload this folder to the server, then run:

```bash
cd STC-MOD-Standalone
bash install.sh
```

Default app root:

```text
~/stc-app
```

Start:

```bash
cd ~/stc-app
./start.sh
```

Open:

```text
http://YOUR_SERVER_IP:8000/
```

Use a custom app root or port:

```bash
PORT=9000 bash install.sh /opt/stc
```

## Update

Do not manually run `git pull` inside the release folder. Use:

```bash
cd STC-MOD-Standalone
bash update.sh ~/stc-app
```

The update script:

- creates a new release folder
- pulls the latest SillyTavern code
- reapplies STC-MOD
- runs `npm install`
- checks `src/server-main.js` syntax
- switches `current` only if the update succeeds

If the update fails, the old release remains active.

## Rollback

Roll back to the previous active release:

```bash
cd STC-MOD-Standalone
bash rollback.sh ~/stc-app
```

Roll back to a specific release name:

```bash
bash rollback.sh ~/stc-app 20260523-153000
```

Rollback only changes the `current` release link. It does not overwrite shared
user data.

## Status

```bash
cd STC-MOD-Standalone
bash status.sh ~/stc-app
```

## Directory Layout

```text
~/stc-app/
  current -> releases/20260523-153000
  releases/
    20260523-153000/
    20260524-101500/
  shared/
    config/config.yaml
    data/
    plugins/
    extensions/
  start.sh
```

Shared data survives updates and rollback:

- `shared/config/config.yaml`
- `shared/data/`
- `shared/plugins/`
- `shared/extensions/`

## What STC-MOD Installs

- `src/stc-mod/`
- `public/scripts/extensions/third-party/stc-admin-panel/`
- STC-MOD-compatible core files:
  - `src/server-main.js`
  - `src/endpoints/secrets.js`
  - `src/endpoints/avatars.js`
  - `public/scripts/secrets.js`
  - `public/scripts/personas.js`
  - `default/config.yaml`
- `nodemailer` and `yaml` dependencies when missing

Core files are backed up inside each release under `stc-mod-backups/`.

## Compatibility Note

This package was extracted from the STC-MOD project based on SillyTavern 1.18.0.
The update flow can pull newer SillyTavern versions, but some STC-MOD patches
replace core files. If upstream changes those files heavily, update may fail or
the new release may need manual adaptation. In that case, rollback keeps the
previous release available.
