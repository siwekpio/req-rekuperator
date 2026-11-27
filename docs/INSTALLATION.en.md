# Installation, update and rollback

First installation: [README](../README.en.md). Make a full Home Assistant backup and keep the previous component directory and dashboard configuration before changing anything.

1. Extract the new manual installation archive. Replace the entire `/config/custom_components/req_rekuperator` directory with `custom_components/req_rekuperator` from the archive; do not mix versions.
2. Restart HA. Update the existing Lovelace JavaScript module resource to `/req-rekuperator/rekuperator-js.js?v=0112`; do not create a duplicate. Refresh the browser/app.
3. Check readings, comfort temperature, settings, charts, history and logs. Do not delete integration entries or Recorder data or change working broker settings.

To roll back, restore the entire saved previous component directory and matching resource URL (e.g. `?v=0111` for 0.1.11), restart HA and verify readings. Restore the full HA backup if inconsistent. The 0.1.12 GPL → 0.1.11 MIT → 0.1.12 GPL cycle was verified in a Home Assistant test environment: configuration, entities and history were preserved. The test was read-only, without physical control commands. This does not guarantee compatibility with every configuration or model. Do not automatically repeat uncertain commands.
