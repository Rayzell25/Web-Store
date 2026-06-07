# Panduan Premium / Custom Emoji di Bot Telegram (TERBUKTI WORK)

Rangkuman cara pasang **custom/premium emoji** di bot Telegram (node-telegram-bot-api),
sudah diuji langsung & berfungsi di bot ini. Ada **2 tempat berbeda** dengan **2 cara berbeda**:

| Tempat | Cara | Field/Tag |
|---|---|---|
| **Label TOMBOL** inline | `icon_custom_emoji_id` (Bot API 9.4+) | properti tombol, teks polos |
| **TEKS pesan / caption** | tag `<tg-emoji>` (parse_mode HTML) | di dalam string teks |

> ⚠️ JANGAN ketuker. `<tg-emoji>` TIDAK jalan di label tombol, dan `icon_custom_emoji_id` TIDAK ada di teks pesan.

---

## ✅ Syarat WAJIB (kalau tidak, emoji tidak muncul)

1. **Local Bot API server versi 9.4+.**
   Bot ini pakai self-hosted Local Bot API (`BOT_API_ROOT`). Server versi lama akan
   **mengabaikan** `icon_custom_emoji_id` diam-diam (tombol jadi teks polos, tanpa error).
   Update image-nya:
   ```bash
   docker compose pull telegram-bot-api
   docker compose up -d telegram-bot-api
   ```
   (Sudah otomatis di `install.sh` lewat `docker compose pull`.)

2. **Bot eligible pakai custom emoji.**
   Bot punya username yang dibeli dari **Fragment**, ATAU (sejak 9.4) owner bot punya
   **Telegram Premium** untuk pesan yang dikirim langsung oleh bot. Kalau tidak eligible,
   emoji custom tidak tampil → otomatis fallback ke unicode (lihat bagian B).

3. **Pakai ID emoji yang VALID** (angka panjang ~19 digit), bukan placeholder.
   Cara dapat ID: forward sticker/emoji premium ke bot seperti @idstickerbot, atau ambil dari
   `message.entities[].custom_emoji_id` saat user mengirim premium emoji ke bot.

---

## BAGIAN A — Emoji di TOMBOL (`icon_custom_emoji_id`)

**Format inti** — pakai `icon_custom_emoji_id` + teks polos (TANPA `<tg-emoji>`):
```js
{ text: 'Beli Paket', callback_data: 'menu:order', icon_custom_emoji_id: '5864095106096698177' }
```

**Contoh keyboard lengkap (`mainMenu()` di `src/keyboards/menus.js`):**
```js
function mainMenu() {
  const rows = [];
  rows.push([{ text: 'Beli Paket', callback_data: 'menu:order', icon_custom_emoji_id: '5864095106096698177' }]);
  rows.push([{ text: 'Top Up Saldo', callback_data: 'menu:deposit', icon_custom_emoji_id: '5445353829304387411' }]);
  rows.push([
    { text: 'Riwayat', callback_data: 'menu:riwayat', icon_custom_emoji_id: '5215209935188534658' },
    { text: 'Cek Harga', callback_data: 'menu:stok', icon_custom_emoji_id: '5231012545799666522' },
  ]);
  rows.push([
    { text: 'Tools', callback_data: 'menu:tools', icon_custom_emoji_id: '4920401966946845302' },
    { text: 'Bantuan', callback_data: 'menu:bantuan', icon_custom_emoji_id: '5215538577496090960' },
  ]);
  if (config.webUrl) {
    const base = config.webUrl.replace(/\/+$/, '');
    rows.push([{ text: 'Buka Web', web_app: { url: `${base}/app.html` }, icon_custom_emoji_id: '5375346433610235523' }]);
  }
  return { inline_keyboard: rows };
}
```

**Tabel ID tombol (yang dipakai sekarang):**

| Tombol | callback_data | icon_custom_emoji_id |
|---|---|---|
| Beli Paket | `menu:order` | `5864095106096698177` |
| Top Up Saldo | `menu:deposit` | `5445353829304387411` |
| Riwayat | `menu:riwayat` | `5215209935188534658` |
| Cek Harga | `menu:stok` | `5231012545799666522` |
| Tools | `menu:tools` | `4920401966946845302` |
| Bantuan | `menu:bantuan` | `5215538577496090960` |
| Buka Web | `web_app` | `5375346433610235523` |

> Catatan: `node-telegram-bot-api` **tidak perlu** diubah/di-upgrade — dia cuma serialize
> `reply_markup` jadi JSON, jadi field baru `icon_custom_emoji_id` langsung diteruskan ke server.

---

## BAGIAN B — Emoji di TEKS pesan / caption (`<tg-emoji>`)

Format: `<tg-emoji emoji-id="ID">FALLBACK_UNICODE</tg-emoji>` dengan `parse_mode: 'HTML'`.
Kalau bot belum eligible, Telegram menolak entity-nya → kita **strip tag** dan tampilkan
fallback unicode-nya (lihat helper di bawah), jadi pesan tetap tampil tanpa error.

**Helper `src/utils/premoji.js`:**
```js
const EMOJI = {
  halo:       ['5816508088227730739', '👋'],
  saldo:      ['5971895400792067820', '💳'],
  role:       ['5971895400792067820', '👤'],
  statistik:  ['5884161133174067365', '📊'],
  transaksi:  ['5972124077735807885', '🧾'],
  hariini:    ['5972124077735807885', '📅'],
  pengguna:   ['5972124077735807885', '👥'],
  maintenance:['5933544413740403607', '🛠️'],
  beli:    ['5864095106096698177', '🛒'],
  topup:   ['5282843764451195532', '💰'],
  riwayat: ['5215209935188534658', '🧾'],
  harga:   ['5231012545799666522', '🏷️'],
  tools:   ['4920401966946845302', '🛠️'],
  bantuan: ['5215538577496090960', '💬'],
  web:     ['5375346433610235523', '🌐'],
};

// Render satu premium emoji jadi tag HTML <tg-emoji>.
function pe(key) {
  const item = EMOJI[key];
  if (!item) return '';
  const [id, fallback] = item;
  return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
}

// Hapus semua tag <tg-emoji> -> sisakan fallback unicode-nya.
function stripPremium(html) {
  return String(html).replace(/<tg-emoji[^>]*>([\s\S]*?)<\/tg-emoji>/gi, '$1');
}

// Apakah teks mengandung premium emoji?
function hasPremium(html) {
  return /<tg-emoji[\s>]/i.test(String(html));
}

module.exports = { EMOJI, pe, stripPremium, hasPremium };
```

**Cara pakai di teks (contoh dari `src/handlers/start.js`):**
```js
const { pe } = require('../utils/premoji');

const text =
  `${pe('halo')} Halo, <b>${escapeHtml(user.name)}</b>\n\n` +
  `${pe('saldo')} Saldo : ${rupiah(user.balance)}\n` +
  `${pe('role')} Role : ${escapeHtml(user.role)}\n` +
  `${pe('statistik')} <b>Statistik</b>\n` +
  `${pe('transaksi')} Transaksi : ${totalTrx}\n` +
  `${pe('hariini')} Hari ini : ${rupiah(today)}\n` +
  `${pe('pengguna')} Pengguna : ${totalUsers}`;

// kirim dengan fallback aman (lihat safeSend di bawah)
await safeSend(bot, chatId, text, { parse_mode: 'HTML' });
```

**Fallback aman (`src/utils/ui.js`)** — kalau custom emoji ditolak, kirim ulang tanpa tag:
```js
async function safeSend(bot, chatId, text, opts) {
  try {
    return await bot.sendMessage(chatId, text, opts);
  } catch (e) {
    if (hasPremium(text) && isEmojiError(e)) {
      return bot.sendMessage(chatId, stripPremium(text), opts); // jadi unicode biasa
    }
    throw e;
  }
}
// safeSendPhoto sama, tapi untuk opts.caption.
```

---

## ❌ Larangan (penyebab error / "bocor")

1. **JANGAN** taruh `<tg-emoji>` di label tombol:
   ```js
   // SALAH -> tag-nya tampil mentah sebagai teks di tombol
   { text: '<tg-emoji emoji-id="5864...">🛒</tg-emoji> BELI PAKET' }
   ```
2. **JANGAN** taruh ID emoji sebagai teks polos di pesan (tanpa tag):
   ```js
   // SALAH -> yang muncul angka "5816508088227730739", bukan emoji
   `5816508088227730739 Halo`
   // BENAR
   `${pe('halo')} Halo`   // -> <tg-emoji emoji-id="5816508088227730739">👋</tg-emoji>
   ```
3. **JANGAN** bungkus `<tg-emoji>` di dalam `<code>` / `<pre>`. Premium emoji tidak render
   di blok code. Pakai teks biasa.

---

## 🔧 Troubleshooting cepat

| Gejala | Penyebab | Solusi |
|---|---|---|
| Tombol jadi teks polos tanpa emoji (tanpa error) | Local Bot API server < 9.4, ATAU bot belum eligible | `docker compose pull telegram-bot-api` + restart; pastikan username Fragment / owner Premium |
| Di teks muncul **angka mentah** (mis. `5816...`) | ID ditaruh sebagai teks polos, bukan dibungkus `<tg-emoji>` | Bungkus pakai `pe(key)` |
| Di teks emoji jadi unicode biasa (📅, 👋) bukan animasi | Bot belum eligible -> fallback `stripPremium` jalan | Pastikan eligibility; ini sudah perilaku aman |
| Error `CUSTOM_EMOJI...` / `can't parse entities` | Tag salah / di dalam `<code>` | Perbaiki tag; keluarkan dari blok code |

---

## Cara dapat emoji-id
- Kirim premium emoji ke bot, lalu baca `message.entities[].custom_emoji_id` di update.
- Atau pakai bot bantu seperti yang bisa menampilkan ID custom emoji.
- ID berupa string angka ~19 digit. Pakai sebagai string (di-quote).
