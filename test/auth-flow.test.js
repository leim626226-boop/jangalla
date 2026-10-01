const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  return port;
}

function sessionCookie(response) {
  const cookies = response.headers.getSetCookie
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || ''];
  const relevantCookies = cookies.filter((value) => value.startsWith('sid=') || value.startsWith('vk='));
  assert.ok(relevantCookies.some((value) => value.startsWith('sid=')), 'response should include a session cookie');
  return relevantCookies.map((cookie) => cookie.split(';')[0]).join('; ');
}

function idPhoto() {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l0sAAAAASUVORK5CYII=', 'base64');
  return new Blob([png], { type: 'image/png' });
}

test('school identity verification gates login and community access', { timeout: 30000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmhs-auth-'));
  const port = await unusedPort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, ADMIN_PASSWORD: 'TestAdminPass-2026' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const base = `http://127.0.0.1:${port}`;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const login = (login_id, password) => fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login_id, password }),
  });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error('server exited before becoming ready');
      try {
        const response = await fetch(`${base}/api/me`);
        if (response.ok) { ready = true; break; }
      } catch {}
      await delay(100);
    }
    assert.ok(ready, 'server should start');

    let response = await fetch(`${base}/api/boards`);
    assert.equal(response.status, 403, 'anonymous board access should be denied');
    response = await fetch(`${base}/uploads/not-public.png`);
    assert.equal(response.status, 403, 'community uploads should not be public');

    const form = new FormData();
    form.append('member_type', 'student');
    form.append('login_id', 'test_student');
    form.append('password', 'StudentPass-123');
    form.append('nickname', '테스트학생');
    form.append('member_attestation', 'on');
    form.append('school_id_photo', idPhoto(), 'school-id.png');
    response = await fetch(`${base}/api/join`, { method: 'POST', body: form });
    assert.equal(response.status, 200, 'valid verification application should be accepted');

    response = await login('test_student', 'StudentPass-123');
    assert.equal(response.status, 403, 'pending account should not log in');
    assert.match((await response.json()).error, /5초/);

    const adminResponse = await login('admin', 'TestAdminPass-2026');
    assert.equal(adminResponse.status, 200, 'administrator should be able to log in');
    const adminCookie = sessionCookie(adminResponse);
    response = await fetch(`${base}/api/admin/verifications`, { headers: { Cookie: adminCookie } });
    let requests = (await response.json()).requests;
    assert.equal(requests.length, 1);
    const requestId = requests[0].id;

    response = await fetch(`${base}/api/admin/verifications/${requestId}/photo`);
    assert.equal(response.status, 403, 'verification photo should not be public');
    response = await fetch(`${base}/api/admin/verifications/${requestId}/photo`, { headers: { Cookie: adminCookie } });
    assert.equal(response.status, 200, 'only the admin review route should provide the photo');
    response = await fetch(`${base}/api/admin/verifications/${requestId}/review`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'rejected' }),
    });
    assert.equal(response.status, 200);
    response = await fetch(`${base}/api/admin/verifications/${requestId}/photo`, { headers: { Cookie: adminCookie } });
    assert.equal(response.status, 404, 'reviewed verification photo should be deleted');

    response = await login('test_student', 'StudentPass-123');
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /반려/);

    const retryForm = new FormData();
    retryForm.append('login_id', 'test_student');
    retryForm.append('password', 'StudentPass-123');
    retryForm.append('member_type', 'student');
    retryForm.append('member_attestation', 'on');
    retryForm.append('school_id_photo', idPhoto(), 'school-id.png');
    response = await fetch(`${base}/api/verification/resubmit`, { method: 'POST', body: retryForm });
    assert.equal(response.status, 200, 'rejected application should be resubmittable');

    await delay(5200);
    const userResponse = await login('test_student', 'StudentPass-123');
    assert.equal(userResponse.status, 200, 'application should be automatically approved for login after five seconds');
    response = await fetch(`${base}/api/admin/verifications`, { headers: { Cookie: adminCookie } });
    requests = (await response.json()).requests;
    assert.equal(requests[0].status, 'approved');
    response = await fetch(`${base}/api/admin/verifications/${requestId}/photo`, { headers: { Cookie: adminCookie } });
    assert.equal(response.status, 404, 'automatically approved photo should be deleted');
    const userCookie = sessionCookie(userResponse);
    response = await fetch(`${base}/api/boards`, { headers: { Cookie: userCookie } });
    assert.equal(response.status, 200, 'approved account should access community APIs');

    response = await fetch(`${base}/api/boards/free/posts`, {
      method: 'POST',
      headers: { Cookie: userCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '인증 사용자 글쓰기', content: '글을 쓰고 다시 읽을 수 있습니다.' }),
    });
    assert.equal(response.status, 200, 'logged-in member should be able to write a post');
    const postId = (await response.json()).id;

    response = await fetch(`${base}/api/boards/free/posts`, { headers: { Cookie: userCookie } });
    assert.equal(response.status, 200);
    const listedPost = (await response.json()).posts.find((post) => post.id === postId);
    assert.ok(listedPost, 'members should be able to read the post list');
    assert.equal(listedPost.author_name, '익명');
    assert.equal('member_id' in listedPost, false, 'post list should not expose account IDs');
    response = await fetch(`${base}/api/posts/${postId}`, { headers: { Cookie: userCookie } });
    assert.equal(response.status, 200);
    const postDetails = await response.json();
    assert.equal(postDetails.post.content, '글을 쓰고 다시 읽을 수 있습니다.');
    assert.equal(postDetails.post.author_name, '익명');
    assert.equal('member_id' in postDetails.post, false, 'post details should not expose account IDs');
    assert.equal('anon_pw' in postDetails.post, false, 'post details should not expose password hashes');

    response = await fetch(`${base}/api/posts/${postId}/vote`, {
      method: 'POST',
      headers: { Cookie: userCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 1 }),
    });
    assert.deepEqual((await response.json()).votes, { up: 1, down: 0 }, 'recommend button should register a vote');

    response = await fetch(`${base}/api/posts/${postId}/comments`, {
      method: 'POST',
      headers: { Cookie: userCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '댓글도 작성할 수 있습니다.' }),
    });
    assert.equal(response.status, 200, 'logged-in member should be able to comment');
    response = await fetch(`${base}/api/posts/${postId}/comments`, { headers: { Cookie: userCookie } });
    const comments = (await response.json()).comments;
    assert.equal(comments[0].author_name, '익명');
    assert.equal(comments[0].mine, true);
    assert.equal('member_id' in comments[0], false, 'comments should not expose account IDs');
    assert.equal('anon_pw' in comments[0], false, 'comments should not expose password hashes');

    response = await fetch(`${base}/api/posts/${postId}/vote`, {
      method: 'POST',
      headers: { Cookie: userCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: -1 }),
    });
    assert.deepEqual((await response.json()).votes, { up: 0, down: 1 }, 'vote buttons should switch between recommend and downvote');
    response = await fetch(`${base}/api/posts/${postId}`, { headers: { Cookie: userCookie } });
    assert.equal((await response.json()).myVote, -1);
  } finally {
    child.kill();
    await Promise.race([once(child, 'exit'), delay(3000)]);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
