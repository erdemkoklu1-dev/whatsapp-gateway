/**
 * Köklü ERP — WhatsApp Gateway
 * whatsapp-web.js kullanarak QR tabanlı WhatsApp mesaj gönderimi
 *
 * Kurulum:
 *   cd whatsapp-gateway && npm install && node index.js
 *
 * Varsayılan port: 3001 (PORT env ile değiştirilebilir)
 *
 * Endpoint'ler:
 *   GET  /status  → { status, qrImage }
 *   POST /send    → { to, message }
 */

const { Client, LocalAuth } = require('whatsapp-web.js')
const express = require('express')
const qrcode  = require('qrcode')

const app    = express()
const PORT   = process.env.PORT || 3001

app.use(express.json())

// CORS — Next.js'den gelen isteklere izin ver
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.NEXT_ORIGIN || 'http://localhost:3000')
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})

// ─── Durum yönetimi ───────────────────────────────────────
let status   = 'disconnected'  // 'disconnected' | 'qr_ready' | 'connecting' | 'connected'
let qrImage  = null            // base64 PNG
let waClient = null

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString('tr-TR')}] ${msg}`)
}

function formatTurkish(phone) {
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('90') && digits.length === 12) return digits
  if (digits.startsWith('0')  && digits.length === 11) return '9' + digits
  if (digits.length === 10) return '90' + digits
  return digits
}

async function initClient() {
  log('WhatsApp istemcisi başlatılıyor...')
  status = 'connecting'

  waClient = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: {
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
      ],
    },
  })

  waClient.on('qr', async (qr) => {
    status = 'qr_ready'
    qrImage = await qrcode.toDataURL(qr, { errorCorrectionLevel: 'H', margin: 2 })
    log('QR kodu hazır — tarayıcıdan /ayarlar sayfasını açın')
  })

  waClient.on('loading_screen', (percent) => {
    status = 'connecting'
    log(`Yükleniyor: %${percent}`)
  })

  waClient.on('authenticated', () => {
    log('Kimlik doğrulandı')
  })

  waClient.on('ready', () => {
    status = 'connected'
    qrImage = null
    log('✓ WhatsApp bağlantısı hazır')
  })

  waClient.on('auth_failure', (msg) => {
    status = 'disconnected'
    qrImage = null
    log('Kimlik doğrulama başarısız: ' + msg)
  })

  waClient.on('disconnected', (reason) => {
    status = 'disconnected'
    qrImage = null
    log('Bağlantı kesildi: ' + reason + ' — 10 saniye sonra yeniden denenecek')
    setTimeout(initClient, 10_000)
  })

  try {
    await waClient.initialize()
  } catch (err) {
    log('Başlatma hatası: ' + err.message)
    status = 'disconnected'
    setTimeout(initClient, 15_000)
  }
}

// ─── Endpoint'ler ─────────────────────────────────────────

app.get('/status', (req, res) => {
  res.json({ status, qrImage })
})

app.post('/send', async (req, res) => {
  if (status !== 'connected') {
    return res.status(503).json({
      error: `WhatsApp bağlı değil (durum: ${status}). Lütfen QR kodu taratın.`,
    })
  }

  const { to, message } = req.body

  if (!to || !message) {
    return res.status(400).json({ error: '"to" ve "message" alanları zorunludur.' })
  }

  try {
    const number = formatTurkish(String(to))
    const chatId = number + '@c.us'

    // Numaranın WhatsApp'ta kayıtlı olup olmadığını kontrol et
    const isRegistered = await waClient.isRegisteredUser(chatId)
    if (!isRegistered) {
      return res.status(422).json({ error: `${number} numarası WhatsApp'a kayıtlı değil.` })
    }

    await waClient.sendMessage(chatId, String(message))
    log(`→ Mesaj gönderildi: ${number}`)
    res.json({ success: true, number })
  } catch (err) {
    log('Gönderim hatası: ' + err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── Sunucu başlat ────────────────────────────────────────

app.listen(PORT, () => {
  log(`WhatsApp Gateway çalışıyor → http://localhost:${PORT}`)
  log('Başlatılıyor...')
})

initClient()
