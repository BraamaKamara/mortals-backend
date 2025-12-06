const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'entitlements.json');

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return { byEmail: {}, byCustomer: {} };
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const data = JSON.parse(raw || '{}');
    if (!data.byEmail) data.byEmail = {};
    if (!data.byCustomer) data.byCustomer = {};
    return data;
  } catch {
    return { byEmail: {}, byCustomer: {} };
  }
}

function writeStore(data) {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[Entitlements] Failed to persist store:', e.message);
  }
}

function getByEmail(email) {
  if (!email) return null;
  const data = readStore();
  return data.byEmail[email.toLowerCase()] || null;
}

function getByCustomerId(customerId) {
  if (!customerId) return null;
  const data = readStore();
  const email = data.byCustomer[customerId];
  if (!email) return null;
  return data.byEmail[email] || null;
}

function setFromCheckout({ email, customerId, subscriptionId, status = 'active' }) {
  if (!email && !customerId) return;
  const data = readStore();
  const keyEmail = email ? email.toLowerCase() : (data.byCustomer[customerId] || null);
  if (!keyEmail) return; // can't persist without an email key
  if (!data.byEmail[keyEmail]) data.byEmail[keyEmail] = { plan: 'free' };
  data.byEmail[keyEmail] = {
    ...data.byEmail[keyEmail],
    plan: 'pro',
    status,
    customerId: customerId || data.byEmail[keyEmail].customerId || null,
    subscriptionId: subscriptionId || data.byEmail[keyEmail].subscriptionId || null,
    updatedAt: new Date().toISOString(),
  };
  if (customerId) data.byCustomer[customerId] = keyEmail;
  writeStore(data);
}

function cancelByCustomer(customerId) {
  const data = readStore();
  const email = data.byCustomer[customerId];
  if (!email) return;
  if (!data.byEmail[email]) data.byEmail[email] = {};
  data.byEmail[email] = {
    ...data.byEmail[email],
    plan: 'free',
    status: 'canceled',
    updatedAt: new Date().toISOString(),
  };
  writeStore(data);
}

module.exports = {
  getByEmail,
  getByCustomerId,
  setFromCheckout,
  cancelByCustomer,
  _readStore: readStore,
  _writeStore: writeStore,
};
