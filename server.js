const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'community.db'));

// ---------- 스키마 ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login_id TEXT UNIQUE NOT NULL,
  pw_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  forced_anon INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL,
  member_id INTEGER,
  author_name TEXT NOT NULL,
  anon_pw TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  member_id INTEGER,
  author_name TEXT NOT NULL,
  anon_pw TEXT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS post_votes (
  post_id INTEGER NOT NULL,
  voter_key TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (post_id, voter_key)
);
`);

// ---------- 초기 데이터 ----------
const boardCount = db.prepare('SELECT COUNT(*) AS c FROM boards').get().c;
if (boardCount === 0) {
  const ins = db.prepare('INSERT INTO boards (slug, name, forced_anon) VALUES (?, ?, ?)');
  ins.run('free', '자유게시판', 0);
  ins.run('anon', '익명게시판', 1);
  ins.run('jjal', '짤방·유머', 0);
  ins.run('info', '질문·정보', 0);
  ins.run('club', '동아리·홍보', 0);
  ins.run('meal', '급식·건의', 0);
}

const adminExists = db.prepare("SELECT COUNT(*) AS c FROM users WHERE login_id = 'admin'").get().c;
if (adminExists === 0) {
  db.prepare("INSERT INTO users (login_id, pw_hash, nickname, role) VALUES (?, ?, ?, 'admin')")
    .run('admin', hashPassword('admin1234'), '관리자');
  console.log('>>> 초기 관리자 계정 생성: ID=admin / PW=admin1234 (로그인 후 변경 권장)');
}

// ---------- 유틸 ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
}
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ---------- 앱 ----------
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// 로그인 사용자 / 익명 투표자 키 미들웨어
app.use((req, res, next) => {
  const cookies = parseCookies(req);
  req.user = null;
  if (cookies.sid) {
    const row = db.prepare(`
      SELECT u.id, u.login_id, u.nickname, u.role
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`).get(cookies.sid);
    if (row) req.user = row;
  }
  req.voterKey = cookies.vk || null;
  res.cookie = (name, value, opts = {}) => {
    const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
    if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
    const prev = res.getHeader('Set-Cookie');
    const arr = prev ? (Array.isArray(prev) ? prev.concat([parts.join('; ')]) : [prev, parts.join('; ')]) : parts.join('; ');
    res.setHeader('Set-Cookie', arr);
  };
  if (!req.voterKey) {
    const vk = crypto.randomUUID();
    req.voterKey = vk;
    res.cookie('vk', vk, { maxAge: 60 * 60 * 24 * 365 * 2 });
  }
  next();
});

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: '관리자만 가능합니다.' });
  next();
}

// ---------- 업로드 ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10) || '.bin';
    cb(null, crypto.randomBytes(12).toString('hex') + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    if (/^(image|video)\//.test(file.mimetype)) return cb(null, true);
    cb(new Error('이미지/영상 파일만 업로드할 수 있습니다.'));
  },
});

// ---------- 회원 ----------
app.post('/api/join', (req, res) => {
  const { login_id, password, nickname } = req.body || {};
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(login_id || '')) return res.status(400).json({ error: '아이디는 영문/숫자/_ 3~20자입니다.' });
  if (!password || String(password).length < 4) return res.status(400).json({ error: '비밀번호는 4자 이상입니다.' });
  const nick = String(nickname || '').trim();
  if (nick.length < 2 || nick.length > 15) return res.status(400).json({ error: '닉네임은 2~15자입니다.' });
  const dup = db.prepare('SELECT id FROM users WHERE login_id = ?').get(login_id);
  if (dup) return res.status(400).json({ error: '이미 존재하는 아이디입니다.' });
  const info = db.prepare('INSERT INTO users (login_id, pw_hash, nickname) VALUES (?, ?, ?)')
    .run(login_id, hashPassword(password), nick);
  const token = randomToken();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, info.lastInsertRowid);
  res.cookie('sid', token, { maxAge: 60 * 60 * 24 * 30 });
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const { login_id, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE login_id = ?').get(login_id || '');
  if (!user || !verifyPassword(password, user.pw_hash)) {
    return res.status(400).json({ error: '아이디 또는 비밀번호가 틀립니다.' });
  }
  const token = randomToken();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
  res.cookie('sid', token, { maxAge: 60 * 60 * 24 * 30 });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(cookies.sid);
  res.cookie('sid', '', { maxAge: 0 });
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.user, voterKey: req.voterKey });
});

// ---------- 게시판 ----------
app.get('/api/boards', (req, res) => {
  res.json(db.prepare('SELECT * FROM boards ORDER BY id').all());
});

app.post('/api/boards', requireAdmin, (req, res) => {
  const { name, slug, forced_anon } = req.body || {};
  const n = String(name || '').trim();
  if (n.length < 2 || n.length > 20) return res.status(400).json({ error: '게시판 이름은 2~20자입니다.' });
  let s = String(slug || '').trim().toLowerCase();
  if (!s) s = 'board-' + Date.now().toString(36);
  if (!/^[a-z0-9_-]{1,20}$/.test(s)) return res.status(400).json({ error: '주소(ID)는 영문 소문자/숫자/-/_ 1~20자입니다.' });
  if (db.prepare('SELECT id FROM boards WHERE slug = ?').get(s)) return res.status(400).json({ error: '이미 존재하는 주소입니다.' });
  const info = db.prepare('INSERT INTO boards (slug, name, forced_anon) VALUES (?, ?, ?)').run(s, n, forced_anon ? 1 : 0);
  res.json({ ok: true, id: info.lastInsertRowid, slug: s });
});

app.delete('/api/boards/:id', requireAdmin, (req, res) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id);
  if (!board) return res.status(404).json({ error: '게시판이 없습니다.' });
  const posts = db.prepare('SELECT id FROM posts WHERE board_id = ?').all(board.id);
  const delAtt = db.prepare('SELECT * FROM attachments WHERE post_id = ?');
  for (const p of posts) {
    for (const a of delAtt.all(p.id)) { try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(a.path))); } catch {} }
  }
  db.prepare(`DELETE FROM attachments WHERE post_id IN (SELECT id FROM posts WHERE board_id = ?)`).run(board.id);
  db.prepare(`DELETE FROM post_votes WHERE post_id IN (SELECT id FROM posts WHERE board_id = ?)`).run(board.id);
  db.prepare(`DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE board_id = ?)`).run(board.id);
  db.prepare('DELETE FROM posts WHERE board_id = ?').run(board.id);
  db.prepare('DELETE FROM boards WHERE id = ?').run(board.id);
  res.json({ ok: true });
});

// ---------- 게시글 ----------
function boardBySlug(slug) {
  return db.prepare('SELECT * FROM boards WHERE slug = ?').get(slug);
}

app.get('/api/boards/:slug/posts', (req, res) => {
  const board = boardBySlug(req.params.slug);
  if (!board) return res.status(404).json({ error: '게시판이 없습니다.' });
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const q = String(req.query.q || '').trim();
  const per = 20;
  let where = 'board_id = ?';
  const args = [board.id];
  if (q) { where += ' AND (title LIKE ? OR content LIKE ?)'; const like = `%${q}%`; args.push(like, like); }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM posts WHERE ${where}`).get(...args).c;
  const posts = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
           (SELECT COALESCE(SUM(value),0) FROM post_votes v WHERE v.post_id = p.id) AS score
    FROM posts p WHERE ${where}
    ORDER BY p.id DESC LIMIT ? OFFSET ?`).all(...args, per, (page - 1) * per);
  res.json({ board, posts, total, page, per });
});

app.post('/api/boards/:slug/posts', (req, res) => {
  upload.array('files', 8)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '업로드 실패' });
    const board = boardBySlug(req.params.slug);
    if (!board) return res.status(404).json({ error: '게시판이 없습니다.' });
    const title = String(req.body.title || '').trim();
    const content = String(req.body.content || '').trim();
    if (!title || !content) return res.status(400).json({ error: '제목과 내용을 입력하세요.' });

    let memberId = null;
    let authorName = '익명';
    let anonPw = null;
    if (req.user) {
      memberId = req.user.id;
      authorName = req.user.nickname;
    } else {
      if (!board.forced_anon) {
        const nick = String(req.body.nickname || '').trim();
        if (nick.length < 2 || nick.length > 15) return res.status(400).json({ error: '닉네임은 2~15자입니다.' });
        authorName = nick;
      }
      const pw = String(req.body.password || '');
      if (pw) anonPw = hashPassword(pw);
    }

    const info = db.prepare(
      'INSERT INTO posts (board_id, member_id, author_name, anon_pw, title, content) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(board.id, memberId, authorName, anonPw, title, content);
    const postId = info.lastInsertRowid;

    const insAtt = db.prepare('INSERT INTO attachments (post_id, kind, path, name) VALUES (?, ?, ?, ?)');
    for (const f of req.files || []) {
      insAtt.run(postId, f.mimetype.startsWith('image/') ? 'image' : 'video', '/uploads/' + f.filename, f.originalname);
    }
    res.json({ ok: true, id: postId });
  });
});

app.get('/api/posts/:id', (req, res) => {
  const post = db.prepare(`
    SELECT p.*, b.slug AS board_slug, b.name AS board_name, b.forced_anon AS board_forced_anon
    FROM posts p JOIN boards b ON b.id = p.board_id WHERE p.id = ?`).get(req.params.id);
  if (!post) return res.status(404).json({ error: '글이 없습니다.' });
  db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(post.id);
  post.views += 1;
  const attachments = db.prepare('SELECT * FROM attachments WHERE post_id = ?').all(post.id);
  const votes = db.prepare('SELECT COALESCE(SUM(CASE WHEN value=1 THEN 1 ELSE 0 END),0) AS up, COALESCE(SUM(CASE WHEN value=-1 THEN 1 ELSE 0 END),0) AS down FROM post_votes WHERE post_id = ?').get(post.id);
  const my = db.prepare('SELECT value FROM post_votes WHERE post_id = ? AND voter_key = ?').get(post.id, req.voterKey);
  const mine = !!(req.user && post.member_id === req.user.id);
  res.json({ post, attachments, votes, myVote: my ? my.value : 0, mine });
});

app.put('/api/posts/:id', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '글이 없습니다.' });
  const isAdmin = req.user && req.user.role === 'admin';
  const isOwner = req.user && post.member_id === req.user.id;
  if (!isAdmin && !isOwner) {
    const pw = String((req.body || {}).password || '');
    if (!post.anon_pw || !verifyPassword(pw, post.anon_pw)) {
      return res.status(403).json({ error: '수정 권한이 없습니다. 비회원 글은 작성 시 입력한 비밀번호가 필요합니다.' });
    }
  }
  const title = String((req.body || {}).title || '').trim();
  const content = String((req.body || {}).content || '').trim();
  if (!title || !content) return res.status(400).json({ error: '제목과 내용을 입력하세요.' });
  db.prepare('UPDATE posts SET title = ?, content = ? WHERE id = ?').run(title, content, post.id);
  res.json({ ok: true });
});

app.delete('/api/posts/:id', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '글이 없습니다.' });
  const isAdmin = req.user && req.user.role === 'admin';
  const isOwner = req.user && post.member_id === req.user.id;
  if (!isAdmin && !isOwner) {
    const pw = String((req.body || {}).password || '');
    if (!post.anon_pw || !verifyPassword(pw, post.anon_pw)) {
      return res.status(403).json({ error: '삭제 권한이 없습니다. 비회원 글은 작성 시 입력한 비밀번호가 필요합니다.' });
    }
  }
  for (const a of db.prepare('SELECT * FROM attachments WHERE post_id = ?').all(post.id)) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(a.path))); } catch {}
  }
  db.prepare('DELETE FROM attachments WHERE post_id = ?').run(post.id);
  db.prepare('DELETE FROM post_votes WHERE post_id = ?').run(post.id);
  db.prepare('DELETE FROM comments WHERE post_id = ?').run(post.id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  res.json({ ok: true });
});

app.post('/api/posts/:id/vote', (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '글이 없습니다.' });
  const value = parseInt((req.body || {}).value) === -1 ? -1 : 1;
  const existing = db.prepare('SELECT value FROM post_votes WHERE post_id = ? AND voter_key = ?').get(post.id, req.voterKey);
  if (existing) {
    if (existing.value === value) {
      db.prepare('DELETE FROM post_votes WHERE post_id = ? AND voter_key = ?').run(post.id, req.voterKey);
    } else {
      db.prepare('UPDATE post_votes SET value = ? WHERE post_id = ? AND voter_key = ?').run(value, post.id, req.voterKey);
    }
  } else {
    db.prepare('INSERT INTO post_votes (post_id, voter_key, value) VALUES (?, ?, ?)').run(post.id, req.voterKey, value);
  }
  const votes = db.prepare("SELECT COALESCE(SUM(CASE WHEN value=1 THEN 1 ELSE 0 END),0) AS up, COALESCE(SUM(CASE WHEN value=-1 THEN 1 ELSE 0 END),0) AS down FROM post_votes WHERE post_id = ?").get(post.id);
  res.json({ ok: true, votes });
});

// ---------- 댓글 ----------
app.get('/api/posts/:id/comments', (req, res) => {
  const rows = db.prepare('SELECT * FROM comments WHERE post_id = ? ORDER BY id').all(req.params.id);
  res.json({ comments: rows });
});

app.post('/api/posts/:id/comments', (req, res) => {
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '글이 없습니다.' });
  const content = String((req.body || {}).content || '').trim();
  if (!content) return res.status(400).json({ error: '댓글 내용을 입력하세요.' });
  let memberId = null;
  let authorName = '익명';
  let anonPw = null;
  if (req.user) {
    memberId = req.user.id;
    authorName = req.user.nickname;
  } else {
    const nick = String((req.body || {}).nickname || '').trim();
    if (nick.length < 2 || nick.length > 15) return res.status(400).json({ error: '닉네임은 2~15자입니다.' });
    authorName = nick;
    const pw = String((req.body || {}).password || '');
    if (pw) anonPw = hashPassword(pw);
  }
  const info = db.prepare(
    'INSERT INTO comments (post_id, member_id, author_name, anon_pw, content) VALUES (?, ?, ?, ?, ?)'
  ).run(post.id, memberId, authorName, anonPw, content);
  res.json({ ok: true, id: info.lastInsertRowid });
});

app.delete('/api/comments/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: '댓글이 없습니다.' });
  const isAdmin = req.user && req.user.role === 'admin';
  const isOwner = req.user && c.member_id === req.user.id;
  if (!isAdmin && !isOwner) {
    const pw = String((req.body || {}).password || '');
    if (!c.anon_pw || !verifyPassword(pw, c.anon_pw)) {
      return res.status(403).json({ error: '삭제 권한이 없습니다.' });
    }
  }
  db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

// ---------- 에러 처리 ----------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`부산기계공고 소통망 실행 중: http://localhost:${PORT}`);
});
