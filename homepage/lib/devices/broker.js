// One shared MQTT connection for every MQTT-based device (Zigbee2MQTT,
// Tasmota, plain MQTT). Adapters subscribe to exact topics.

import mqtt from 'mqtt';

let client = null;
let url = null;
let handlers = new Map(); // topic -> Set<fn(text)>
let connectHooks = new Set();
let subscribed = new Set(); // topics subscribed on the broker

function connect(cfg) {
  if (!cfg?.url) throw new Error('Set mqtt.url in homepage.yaml to use MQTT devices');
  if (client && url === cfg.url) return;
  client?.end(true);
  url = cfg.url;
  subscribed = new Set();
  client = mqtt.connect(cfg.url, {
    username: cfg.username,
    password: cfg.password,
    clientId: `family-homepage-${Math.random().toString(16).slice(2, 8)}`,
    reconnectPeriod: 5_000,
    connectTimeout: 10_000,
  });
  client.on('connect', () => {
    subscribed = new Set(handlers.keys());
    if (subscribed.size) client.subscribe([...subscribed]);
    connectHooks.forEach((fn) => fn());
  });
  client.on('message', (topic, buf) => {
    const text = buf.toString();
    handlers.get(topic)?.forEach((fn) => {
      try { fn(text); } catch (err) { console.error(`MQTT ${topic}: ${err.message}`); }
    });
  });
  let lastError = '';
  client.on('error', (err) => {
    if (err.message !== lastError) console.error(`MQTT: ${err.message}`);
    lastError = err.message;
  });
}

export const broker = {
  // Forget every handler (the device list is being rebuilt). Broker
  // subscriptions stay until prune(), so re-subscribing to the same topic
  // can't race with an unsubscribe.
  reset() {
    handlers = new Map();
    connectHooks = new Set();
  },
  // Unsubscribe from topics no device listens to any more.
  prune() {
    const stale = [...subscribed].filter((t) => !handlers.has(t));
    stale.forEach((t) => subscribed.delete(t));
    if (stale.length && client?.connected) client.unsubscribe(stale);
  },
  use(cfg) {
    connect(cfg);
    return {
      subscribe(topic, fn) {
        if (!handlers.has(topic)) handlers.set(topic, new Set());
        handlers.get(topic).add(fn);
        if (!subscribed.has(topic)) {
          subscribed.add(topic);
          if (client.connected) client.subscribe(topic);
        }
      },
      publish(topic, payload) {
        const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
        return new Promise((resolve, reject) => {
          if (!client.connected) return reject(new Error('MQTT broker not connected'));
          client.publish(topic, body, (err) => (err ? reject(err) : resolve()));
        });
      },
      // Runs now if connected, and again after every reconnect.
      onConnect(fn) {
        connectHooks.add(fn);
        if (client.connected) fn();
      },
      get connected() { return !!client?.connected; },
    };
  },
  close() {
    client?.end(true);
    client = null;
    url = null;
    subscribed = new Set();
  },
};
