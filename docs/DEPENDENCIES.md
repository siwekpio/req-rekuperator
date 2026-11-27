# External dependencies / Zależności zewnętrzne

The component declares no extra pip requirements. It uses Home Assistant's MQTT and HTTP components, Python standard library, aiohttp and voluptuous supplied by HA. No external JS libraries, fonts or browser binaries are bundled. The following projects retain their own licenses:

| Project | License information | Source |
|---|---|---|
| Home Assistant Core | Apache-2.0 | https://github.com/home-assistant/core |
| Python | PSF-2.0 and associated notices | https://docs.python.org/3/license.html |
| aiohttp | Apache-2.0 / MIT notices | https://github.com/aio-libs/aiohttp |
| voluptuous | BSD-3-Clause | https://github.com/alecthomas/voluptuous |
| Playwright (tests) | Apache-2.0 | https://github.com/microsoft/playwright-python |

Node, Chromium and GitHub Actions are external test/build tools, not shipped with the integration. See the pinned action revisions in `.github/workflows/`. This is a direct dependency inventory, not a full transitive SBOM. REQNET API and Home Assistant documentation are referenced, not relicensed. The code does not include the manufacturer firmware.
