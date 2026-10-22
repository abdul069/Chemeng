import { test } from "node:test";
import assert from "node:assert/strict";
import { Tuya, sign, toStates, commandsFor, entityId, type TuyaDevice, type Fetcher } from "./tuya.ts";

const lamp: TuyaDevice = { id: "bf1234abcd", name: "Lamp woonkamer", category: "dj", online: true, status: [{ code: "switch_led", value: true }, { code: "bright_value_v2", value: 500 }, { code: "temp_value_v2", value: 250 }] };
const plug: TuyaDevice = { id: "bf5678", name: "Stekker tv", category: "cz", online: true, status: [{ code: "switch_1", value: false }, { code: "cur_power", value: 123 }] };
const thermo: TuyaDevice = { id: "bf9999", name: "Thermostaat", category: "wk", online: true, status: [{ code: "switch", value: true }, { code: "temp_set", value: 205 }, { code: "temp_current", value: 198 }, { code: "mode", value: "manual" }] };
const door: TuyaDevice = { id: "bfdoor", name: "Voordeur", category: "mcs", online: true, status: [{ code: "doorcontact_state", value: true }, { code: "battery_percentage", value: 80 }] };
const offline: TuyaDevice = { id: "bfoff", name: "Tuinlamp", category: "dj", online: false, status: [] };
const sensor: TuyaDevice = { id: "bfsens", name: "Kinderkamer", category: "wsdcg", online: true, status: [{ code: "va_temperature", value: 213 }, { code: "va_humidity", value: 55 }] };

test("tuya: handtekening, apparaten worden entiteiten zoals in Home Assistant, commando's terugvertaald", async () => {
  const cfg = { accessId: "id123", accessSecret: "secret", region: "eu" as const };
  const s1 = sign(cfg, "GET", "/v1.0/token?grant_type=1", "", "1700000000000", "nonce");
  assert.match(s1, /^[0-9A-F]{64}$/); assert.equal(s1, sign(cfg, "GET", "/v1.0/token?grant_type=1", "", "1700000000000", "nonce"), "deterministisch");
  assert.notEqual(s1, sign(cfg, "GET", "/v1.0/token?grant_type=1", "", "1700000000000", "nonce", "tok"), "token verandert de handtekening");

  const st = toStates([lamp, plug, thermo, door, offline, sensor]);
  const by = Object.fromEntries(st.map((x) => [x.entity_id, x]));
  assert.equal(entityId(lamp), "light.tuya_bf1234abcd");
  assert.equal(by["light.tuya_bf1234abcd"].state, "on"); assert.equal(by["light.tuya_bf1234abcd"].attributes.brightness_pct, 50); assert.equal(by["light.tuya_bf1234abcd"].attributes.friendly_name, "Lamp woonkamer");
  assert.equal(by["switch.tuya_bf5678"].state, "off"); assert.equal(by["switch.tuya_bf5678"].attributes.power_w, 12.3);
  assert.equal(by["climate.tuya_bf9999"].state, "heat"); assert.equal(by["climate.tuya_bf9999"].attributes.temperature, 20.5); assert.equal(by["climate.tuya_bf9999"].attributes.current_temperature, 19.8);
  assert.equal(by["binary_sensor.tuya_bfdoor"].state, "on"); assert.equal(by["binary_sensor.tuya_bfdoor"].attributes.device_class, "door");
  assert.equal(by["light.tuya_bfoff"].state, "unavailable");
  assert.equal(by["sensor.tuya_bfsens"].state, "21.3"); assert.equal(by["sensor.tuya_bfsens"].attributes.humidity, 55);

  assert.deepEqual(commandsFor(lamp, "turn_off", {}), [{ code: "switch_led", value: false }]);
  assert.deepEqual(commandsFor(lamp, "turn_on", { brightness_pct: 30 }), [{ code: "switch_led", value: true }, { code: "bright_value_v2", value: 300 }]);
  assert.deepEqual(commandsFor(plug, "toggle", {}), [{ code: "switch_1", value: true }]);
  assert.deepEqual(commandsFor(thermo, "set_temperature", { temperature: 21 }), [{ code: "temp_set", value: 210 }], "schaal ×10 herkend");
  assert.deepEqual(commandsFor(thermo, "set_hvac_mode", { hvac_mode: "off" }), [{ code: "switch", value: false }]);

  // client met nep-fetch: token wordt gehaald en meegestuurd, fouten worden leesbaar
  const calls: { url: string; headers: Record<string, string>; body?: string }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    if (url.includes("/v1.0/token")) return { ok: true, status: 200, json: async () => ({ success: true, result: { access_token: "tok1", expire_time: 7200 } }) };
    if (url.includes("associated-users/devices")) return { ok: true, status: 200, json: async () => ({ success: true, result: { devices: [lamp, plug] } }) };
    if (url.includes("/commands")) return { ok: true, status: 200, json: async () => ({ success: true, result: true }) };
    return { ok: true, status: 200, json: async () => ({ success: false, code: 1004, msg: "sign invalid" }) };
  };
  const client = new Tuya({ ...cfg, accessId: "id-test-" + Date.now() }, fetcher);
  assert.equal((await client.devices()).length, 2);
  assert.equal(calls[0].headers.sign_method, "HMAC-SHA256"); assert.equal(calls[1].headers.access_token, "tok1"); assert.ok(calls[0].url.startsWith("https://openapi.tuyaeu.com/"));
  await client.command("bf1234abcd", [{ code: "switch_led", value: false }]);
  assert.equal(JSON.parse(calls[2].body!).commands[0].code, "switch_led");
  assert.equal(calls.length, 3, "token uit de cache bij het tweede verzoek");
});
