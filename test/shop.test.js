import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { authenticator } from 'otplib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function freePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

async function createSmtpSink() {
  const messages = [];
  const smtp = net.createServer(socket => {
    let pending = '';
    let collectingMessage = false;
    let messageLines = [];
    socket.write('220 family-soft-test ESMTP\r\n');
    socket.on('data', chunk => {
      pending += chunk.toString();
      let lineEnd = pending.indexOf('\r\n');
      while (lineEnd >= 0) {
        const line = pending.slice(0, lineEnd);
        pending = pending.slice(lineEnd + 2);
        if (collectingMessage) {
          if (line === '.') {
            collectingMessage = false;
            messages.push(messageLines.join('\n'));
            messageLines = [];
            socket.write('250 2.0.0 queued\r\n');
          } else messageLines.push(line.startsWith('..') ? line.slice(1) : line);
        } else {
          const command = line.split(' ', 1)[0].toUpperCase();
          if (command === 'EHLO' || command === 'HELO') socket.write('250-family-soft-test\r\n250 SIZE 1000000\r\n');
          else if (command === 'DATA') {
            collectingMessage = true;
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
          } else if (command === 'QUIT') socket.write('221 2.0.0 Bye\r\n');
          else socket.write('250 2.0.0 OK\r\n');
        }
        lineEnd = pending.indexOf('\r\n');
      }
    });
  });
  smtp.listen(0, '127.0.0.1');
  await once(smtp, 'listening');
  return { server: smtp, port: smtp.address().port, messages };
}

function decodeTestEmail(message) {
  return message.replace(/Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/g, (_, content) =>
    Buffer.from(content.replace(/\r?\n/g, ''), 'base64').toString('utf8'));
}

async function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        const type = response.headers['content-type'] || '';
        resolve({
          response: {
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            headers: { get: name => {
              const value = response.headers[name.toLowerCase()];
              return Array.isArray(value) ? value[0] : value;
            } }
          },
          body: type.includes('application/json') ? JSON.parse(text) : text
        });
      });
    });
    req.setTimeout(5000, () => req.destroy(new Error('Request timed out.')));
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test('storefront seeds data and validates the manual SBP order flow', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'family-soft-test-'));
  const port = await freePort();
  const smtp = await createSmtpSink();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      SITE_URL: baseUrl,
      DATABASE_PATH: path.join(directory, 'test.sqlite'),
      PAYMENT_MODE: 'manual',
      SBP_PHONE: '+79990000000',
      SBP_BANK: 'Тестовый банк',
      SBP_RECEIVER_NAME: 'Тестовый магазин',
      SESSION_SECRET: 'test-session-secret-with-at-least-32-characters',
      ADMIN_PASSWORD: 'test-admin-password-123',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtp.port),
      SMTP_FROM: 'Family Soft <shop@example.test>'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverOutput = '';
  server.stdout.setEncoding('utf8').on('data', chunk => { serverOutput += chunk; });
  server.stderr.setEncoding('utf8').on('data', chunk => { serverOutput += chunk; });
  t.after(async () => {
    if (server.exitCode === null) {
      server.kill();
      await Promise.race([once(server, 'exit'), wait(3000)]);
    }
    smtp.server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) break;
    try {
      const result = await request(`${baseUrl}/healthz`);
      if (result.response.ok) { ready = true; break; }
    } catch { await wait(100); }
    await wait(50);
  }
  assert.equal(ready, true, `server did not become ready:\n${serverOutput}`);

  const [categoriesResult, productsResult, faqResult] = await Promise.all([
    request(`${baseUrl}/api/categories`), request(`${baseUrl}/api/products`), request(`${baseUrl}/api/faq`)
  ]);
  assert.equal(categoriesResult.body.length, 11);
  assert.ok(productsResult.body.products.length >= 8);
  assert.ok(faqResult.body.length >= 6);
  assert.equal((await request(`${baseUrl}/api/config`)).body.accountLoginAvailable, true);
  assert.equal((await request(`${baseUrl}/api/account/session`)).body.authenticated, false);
  assert.equal((await request(`${baseUrl}/`)).response.status, 200);
  const miniApp = await request(`${baseUrl}/miniapp`);
  assert.equal(miniApp.response.status, 200);
  assert.match(miniApp.body, /\/max-app\.js/);
  assert.equal((await request(`${baseUrl}/miniapp/product/1`)).response.status, 200);
  assert.equal((await request(`${baseUrl}/api/products?min=5000&max=1000`)).response.status, 400);
  assert.ok((await request(`${baseUrl}/api/products?min=&max=`)).body.products.length > 0);
  assert.match((await request(`${baseUrl}/api/pages/privacy`)).body.content, /личный кабинет одноразовым кодом/);

  const product = productsResult.body.products.find(item => item.stock_qty > 0);
  assert.ok(product, 'seed should include an in-stock product');
  const idempotencyKey = '123e4567-e89b-42d3-a456-426614174000';
  const orderBody = {
    name: 'Тестовый покупатель', phone: '+7 900 000-00-01', email: 'buyer@example.test',
    deliveryType: 'delivery', address: 'Москва, улица Тестовая, дом 1',
    comment: 'Тест оформления',
    items: [{ productId: product.id, quantity: product.stock_qty, variant: 'Тест', price: 1 }],
    giftWrap: true, giftCardText: 'Тёплые пожелания', consentData: true, consentOffer: true
  };
  const createOrder = () => request(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(orderBody)
  });
  const created = await createOrder();
  assert.equal(created.response.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.total, product.price * product.stock_qty + 450 + 350);
  assert.ok(created.body.payAmount > created.body.total * 100);
  assert.equal((await request(`${baseUrl}/api/products/${product.id}`)).body.stock_qty, 0);
  const repeated = await createOrder();
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.body.id, created.body.id);
  assert.equal(repeated.body.payAmount, created.body.payAmount);

  const statusUrl = `${baseUrl}/api/orders/${created.body.id}/status?t=${encodeURIComponent(created.body.publicToken)}`;
  const status = await request(statusUrl);
  assert.equal(status.body.payment_status, 'pending');
  assert.equal(status.body.manualPayment.phone, '+79990000000');
  assert.equal(Object.hasOwn(status.body, 'email'), false);
  assert.equal((await request(`${baseUrl}/api/orders/${created.body.id}/status?t=invalid`)).response.status, 404);

  const paidNotice = await request(`${baseUrl}/api/orders/${created.body.id}/paid-notice`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicToken: created.body.publicToken })
  });
  assert.equal(paidNotice.response.status, 200);
  assert.equal((await request(`${baseUrl}/api/admin/orders`)).response.status, 401);

  const customRequest = await request(`${baseUrl}/api/custom-requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Тестовый покупатель', contact: '+7 900 000-00-01', itemType: 'Плед',
      details: 'Размер 150 на 200 см, синий цвет', deadline: 'В течение месяца'
    })
  });
  assert.equal(customRequest.response.status, 201);
  const statusLink = new URL(customRequest.body.statusUrl, baseUrl);
  const customStatusUrl = `${baseUrl}/api/custom-requests/${customRequest.body.id}/status?t=${encodeURIComponent(statusLink.searchParams.get('t'))}`;
  const customStatus = await request(customStatusUrl);
  assert.equal(customStatus.body.status, 'new');
  assert.equal(Object.hasOwn(customStatus.body, 'public_token'), false);
  assert.equal((await request(`${baseUrl}/api/custom-requests/${customRequest.body.id}/status?t=invalid`)).response.status, 404);
  const contactMessage = await request(`${baseUrl}/api/contact`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Тестовый покупатель', contact: 'buyer@example.test', message: 'Вопрос о доставке' })
  });
  assert.equal(contactMessage.response.status, 201);

  const setup = await request(`${baseUrl}/api/admin/setup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-admin-password-123' })
  });
  assert.equal(setup.response.status, 201);
  const login = await request(`${baseUrl}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-admin-password-123', code: authenticator.generate(setup.body.secret) })
  });
  assert.equal(login.response.status, 200);
  const cookie = login.response.headers.get('set-cookie').split(';', 1)[0];
  const adminHeaders = { Cookie: cookie, 'X-CSRF-Token': login.body.csrf, 'Content-Type': 'application/json' };
  const customRequests = await request(`${baseUrl}/api/admin/custom-requests`, { headers: adminHeaders });
  assert.equal(customRequests.body.length, 1);
  assert.equal(customRequests.body[0].id, customRequest.body.id);
  const updateCustomStatus = await request(`${baseUrl}/api/admin/custom-requests/${customRequest.body.id}/status`, {
    method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'in_progress' })
  });
  assert.equal(updateCustomStatus.response.status, 200);
  assert.equal((await request(customStatusUrl)).body.status, 'in_progress');
  const contactMessages = await request(`${baseUrl}/api/admin/contact-messages`, { headers: adminHeaders });
  assert.equal(contactMessages.body.length, 1);
  const updateContactStatus = await request(`${baseUrl}/api/admin/contact-messages/${contactMessage.body.id}/status`, {
    method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'read' })
  });
  assert.equal(updateContactStatus.response.status, 200);
  const unverified = await request(`${baseUrl}/api/admin/orders/${created.body.id}/confirm-payment`, {
    method: 'POST', headers: adminHeaders, body: JSON.stringify({ bankChecked: false })
  });
  assert.equal(unverified.response.status, 400);
  const confirmed = await request(`${baseUrl}/api/admin/orders/${created.body.id}/confirm-payment`, {
    method: 'POST', headers: adminHeaders, body: JSON.stringify({ bankChecked: true })
  });
  assert.equal(confirmed.response.status, 200);
  assert.equal((await request(statusUrl)).body.payment_status, 'paid');

  const requestedCode = await request(`${baseUrl}/api/account/request-code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'BUYER@example.test' })
  });
  assert.equal(requestedCode.response.status, 202);
  const otpDeadline = Date.now() + 10_000;
  while (!smtp.messages.some(message => /Код для входа в личный кабинет Family Soft/.test(decodeTestEmail(message))) && Date.now() < otpDeadline) await wait(100);
  const otpEmail = smtp.messages.map(decodeTestEmail).find(message => /Код для входа в личный кабинет Family Soft/.test(message));
  assert.ok(otpEmail, `account login code should be delivered; message count ${smtp.messages.length}; server output:\n${serverOutput}`);
  const loginCode = otpEmail.match(/Family Soft:\s*(\d{6})/i)?.[1] || otpEmail.match(/\b\d{6}\b/)?.[0];
  assert.ok(loginCode, 'login email should contain the six-digit code');
  const wrongCode = loginCode === '000000' ? '111111' : '000000';
  const invalidCode = await request(`${baseUrl}/api/account/verify-code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'buyer@example.test', code: wrongCode })
  });
  assert.equal(invalidCode.response.status, 401);
  const accountLogin = await request(`${baseUrl}/api/account/verify-code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'buyer@example.test', code: loginCode })
  });
  assert.equal(accountLogin.response.status, 200, JSON.stringify(accountLogin.body));
  const customerCookie = accountLogin.response.headers.get('set-cookie').split(';', 1)[0];
  const customerHeaders = { Cookie: customerCookie, 'X-CSRF-Token': accountLogin.body.csrf, 'Content-Type': 'application/json' };
  const account = await request(`${baseUrl}/api/account`, { headers: customerHeaders });
  assert.equal(account.response.status, 200);
  assert.equal(account.body.profile.email, 'buyer@example.test');
  assert.equal(account.body.orders.length, 1);
  assert.equal(account.body.orders[0].payment_status, 'paid');
  assert.equal((await request(`${baseUrl}/api/account`)).response.status, 401);

  const reviewBody = { orderId: created.body.id, productId: product.id, rating: 5, body: 'Очень мягкий и приятный плед.' };
  const missingCsrf = await request(`${baseUrl}/api/account/reviews`, {
    method: 'POST', headers: { Cookie: customerCookie, 'Content-Type': 'application/json' }, body: JSON.stringify(reviewBody)
  });
  assert.equal(missingCsrf.response.status, 403);
  const submittedReview = await request(`${baseUrl}/api/account/reviews`, {
    method: 'POST', headers: customerHeaders, body: JSON.stringify(reviewBody)
  });
  assert.equal(submittedReview.response.status, 201);
  assert.equal((await request(`${baseUrl}/api/products/${product.id}/reviews`)).body.length, 0);
  const duplicateReview = await request(`${baseUrl}/api/account/reviews`, {
    method: 'POST', headers: customerHeaders, body: JSON.stringify(reviewBody)
  });
  assert.equal(duplicateReview.response.status, 409);
  const unauthorizedReview = await request(`${baseUrl}/api/account/reviews`, {
    method: 'POST', headers: customerHeaders,
    body: JSON.stringify({ ...reviewBody, productId: product.id + 1 })
  });
  assert.equal(unauthorizedReview.response.status, 403);
  const refundBody = { orderId: created.body.id, reason: 'Товар пришёл с повреждённой упаковкой.' };
  const missingRefundCsrf = await request(`${baseUrl}/api/account/refunds`, {
    method: 'POST', headers: { Cookie: customerCookie, 'Content-Type': 'application/json' }, body: JSON.stringify(refundBody)
  });
  assert.equal(missingRefundCsrf.response.status, 403);
  const refundRequest = await request(`${baseUrl}/api/account/refunds`, {
    method: 'POST', headers: customerHeaders, body: JSON.stringify(refundBody)
  });
  assert.equal(refundRequest.response.status, 201);
  const duplicateRefund = await request(`${baseUrl}/api/account/refunds`, {
    method: 'POST', headers: customerHeaders, body: JSON.stringify(refundBody)
  });
  assert.equal(duplicateRefund.response.status, 409);
  const refundAccount = await request(`${baseUrl}/api/account`, { headers: customerHeaders });
  assert.equal(refundAccount.body.refunds[0].status, 'requested');

  const otherCodeRequest = await request(`${baseUrl}/api/account/request-code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'other@example.test' })
  });
  assert.equal(otherCodeRequest.response.status, 202);
  const otherOtpDeadline = Date.now() + 10_000;
  while (!smtp.messages.some(message => /To: other@example\.test/i.test(message) && /Код для входа в личный кабинет Family Soft/.test(decodeTestEmail(message)))
    && Date.now() < otherOtpDeadline) await wait(100);
  const otherOtpEmail = smtp.messages.find(message => /To: other@example\.test/i.test(message)
    && /Код для входа в личный кабинет Family Soft/.test(decodeTestEmail(message)));
  const decodedOtherEmail = otherOtpEmail ? decodeTestEmail(otherOtpEmail) : '';
  const otherCode = decodedOtherEmail.match(/Family Soft:\s*(\d{6})/i)?.[1] || decodedOtherEmail.match(/\b\d{6}\b/)?.[0];
  assert.ok(otherCode, 'a different address should receive an independent one-time code');
  const otherLogin = await request(`${baseUrl}/api/account/verify-code`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'other@example.test', code: otherCode })
  });
  assert.equal(otherLogin.response.status, 200);
  const otherCookie = otherLogin.response.headers.get('set-cookie').split(';', 1)[0];
  const otherAccount = await request(`${baseUrl}/api/account`, { headers: { Cookie: otherCookie } });
  assert.equal(otherAccount.body.orders.length, 0);

  const adminReviews = await request(`${baseUrl}/api/admin/reviews`, { headers: adminHeaders });
  assert.equal(adminReviews.body.length, 1);
  const publishReview = await request(`${baseUrl}/api/admin/reviews/${submittedReview.body.id}/status`, {
    method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'published' })
  });
  assert.equal(publishReview.response.status, 200);
  const publicReviews = await request(`${baseUrl}/api/products/${product.id}/reviews`);
  assert.equal(publicReviews.body.length, 1);
  assert.equal(publicReviews.body[0].rating, 5);
  const adminRefunds = await request(`${baseUrl}/api/admin/refunds`, { headers: adminHeaders });
  assert.equal(adminRefunds.body.length, 1);
  const processingRefund = await request(`${baseUrl}/api/admin/refunds/${refundRequest.body.id}/status`, {
    method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'processing' })
  });
  assert.equal(processingRefund.response.status, 200);
  assert.equal((await request(`${baseUrl}/api/account`, { headers: customerHeaders })).body.refunds[0].status, 'processing');
  const completeRefund = await request(`${baseUrl}/api/admin/refunds/${refundRequest.body.id}/status`, {
    method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'completed' })
  });
  assert.equal(completeRefund.response.status, 200);
  const invalidRefundTransition = await request(`${baseUrl}/api/admin/refunds/${refundRequest.body.id}/status`, {
    method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ status: 'processing' })
  });
  assert.equal(invalidRefundTransition.response.status, 409);
  const refundedAccount = await request(`${baseUrl}/api/account`, { headers: customerHeaders });
  assert.equal(refundedAccount.body.refunds[0].status, 'completed');
  assert.equal(refundedAccount.body.orders[0].payment_status, 'refunded');
  assert.equal((await request(statusUrl)).body.payment_status, 'refunded');
});
