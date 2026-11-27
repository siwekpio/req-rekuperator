# Installation, update and rollback

First installation: [README](../README.en.md). Make a full Home Assistant backup and keep the previous component directory and dashboard configuration before changing anything.

## Marketplace update (recommended for Marketplace-managed installations)

1. Make a full HA backup including configuration, history and component files. Custom repositories added from a link need a working GitHub connection to receive updates.
2. Under **Settings → Updates**, select the available stable Rekuperator reQ release and confirm. Restart HA.
3. Change the existing Lovelace JavaScript module resource to `/req-rekuperator/rekuperator-js.js?v=0113` without creating a duplicate. Refresh the browser/app.
4. Check version, device/entity counts, readings, comfort setpoint, dashboard, charts, history and logs. Keep MQTT settings and integration entries.

To move a manual installation to Marketplace management, back up HA, add the repository as described in the README and install the appropriate release without deleting existing integration entries. Do not re-add devices. Stop if there is a conflict. Taking over a manual 0.1.12 installation was verified in a test environment.

## Manual update

1. Extract the new manual installation archive. Replace the entire `/config/custom_components/req_rekuperator` directory with `custom_components/req_rekuperator` from the archive; do not mix versions.
2. Restart HA. Update the existing Lovelace JavaScript module resource to `/req-rekuperator/rekuperator-js.js?v=0113`; do not create a duplicate. Refresh the browser/app.
3. Check readings, comfort temperature, settings, charts, history and logs. Do not delete integration entries or Recorder data or change working broker settings.

## Rollback

For Marketplace-managed installations, restore the full HA backup from before the update, including Marketplace state. Do not uninstall a configured integration, as this can remove devices and entities. Do not use Install another version as a substitute for restoring a backup.

For manual installations, restore the entire saved previous component directory and matching resource URL (e.g. `?v=0112` for 0.1.12), restart HA and verify readings. Restore the full HA backup if inconsistent. The 0.1.12 GPL → 0.1.11 MIT → 0.1.12 GPL cycle was verified in a Home Assistant test environment: configuration, entities and history were preserved. The test was read-only, without physical control commands. This does not guarantee compatibility with every configuration or model. Do not automatically repeat uncertain commands.

[Official Marketplace documentation](https://www.home-assistant.io/integrations/marketplace/).
