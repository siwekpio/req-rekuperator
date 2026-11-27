# MQTT — additional REQNET connection

See [English README](../README.en.md) for the basic setup. The broker runs e.g. in Home Assistant; REQNET is an MQTT client. Skip configuration if data already reaches HA.

The manufacturer documents local HTTP `/API/RunFunction` with `name=ChangeAdditionalBrokerConfiguration` and `MQTT_ADDITIONAL_BROKER_ADDRESS`, `MQTT_ADDITIONAL_BROKER_PORT`, `MQTT_ADDITIONAL_BROKER_USER`, `MQTT_ADDITIONAL_BROKER_PASSWORD`. `192.168.7.1` is an example module IP, not a universal address.

## Primary method — web browser

Follow step 2 in the [English README](../README.en.md): replace the example URL values, encode special characters, send only once and verify the response and broker connectivity. Do not refresh the page after sending. Skip if the connection already works. The password may remain in browser history, clipboard and logs; private browsing does not encrypt HTTP.

## Alternative — optional Python helper

Run `python tools/configure_mqtt.py` from the extracted package on a computer with Python 3. The Polish prompts ask for module private IPv4, broker address, port, username, password and confirmation (`TAK` means yes). The tool hides password input, does not print the URL, disables proxies and redirects. **HTTP sends the password in an unencrypted URL parameter**; use only a trusted LAN and dedicated MQTT credentials. Network or device logs may still record it. This tool is not run by the integration.

**Safe practice without changing the device:** on Windows open PowerShell in the extracted package directory, check `py -3 --version`, then run `py -3 tools/configure_mqtt.py`. Enter fictional details with a private IPv4 address (e.g. `192.168.7.1`), broker `192.168.1.100`, port `1883`, username `req_test` and a fictional non-empty password (characters are hidden). Enter `NIE` (no) at the confirmation prompt. The program exits without sending a request. This checks the helper's interaction, not physical connectivity. Do not enter `TAK` on a working unit just to test the helper.

## MQTT — only with an existing connection

If MQTT already works, the manufacturer also documents topic `<MAC>/ChangeAdditionalBrokerConfiguration` with the four fields above as JSON (port numeric). Publish once, without retain. Never use a public broker. Empty values disable the additional connection. `ChangeAdditionalBrokerConfigurationResult: true` confirms the API call, not broker connectivity. Check broker logs and incoming readings; do not automatically retry an uncertain result.

Sources: [REQNET API](https://portal.inprax.pl/REQNET/OpisyAPI_REQNET?ID_TYPU=9), [HA MQTT](https://www.home-assistant.io/integrations/mqtt/). Not verified across all firmware versions.
