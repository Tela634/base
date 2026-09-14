// src/connection.js
// WhatsApp Client connection manager with SQLite session & media wrappers

import fs from 'fs'
import path from 'path'
import readline from 'node:readline'
import chalk from 'chalk'
import qrcode from 'qrcode-terminal'
import sharp from 'sharp'
import { createStore, WaClient, WaMediaTransferClient } from 'zapo-js'
import { createSqliteStore } from '@zapo-js/store-sqlite'
import { createMediaProcessor } from '@zapo-js/media-utils'
import config from '../config.js'
import {
  resolveToBuffer,
  detectMimetype,
  toBase64,
  toBuffer,
  normalizeJid
} from './utils.js'

let isPairingRequested = false

/**
 * Resolves width and height for image thumbnails
 */
async function resolveDimensions(buffer) {
  try {
    const meta = await sharp(buffer).metadata()
    return { width: meta.width || 300, height: meta.height || 300 }
  } catch {
    return { width: 300, height: 300 }
  }
}

/**
 * Attaches helper methods to the socket client
 */
export function attachSocketHelpers(sock) {
  /**
   * Send reaction to a message
   */
  sock.sendReact = async (jid, emoji, target) => {
    if (!target) return

    const reactionTarget = typeof target === 'string'
      ? { remoteJid: jid, id: target, fromMe: false }
      : target

    return sock.message.send(jid, {
      type: 'reaction',
      emoji,
      target: reactionTarget
    })
  }

  /**
   * Send audio as Voice Note (PTT)
   */
  sock.sendVoiceNote = async (jid, input, options = {}) => {
    const { quote, mentions, ...rest } = options
    const quoteKey = quote?.raw ?? quote
    const buffer = await resolveToBuffer(input)

    return sock.message.send(jid, {
      type: 'audio',
      media: buffer,
      ptt: true,
      ...rest
    }, {
      ...(quoteKey ? { quote: quoteKey } : {}),
      ...(mentions ? { mentions } : {})
    })
  }

  /**
   * Upload thumbnail for link previews
   */
  sock.uploadThumbnail = async (image, options = {}) => {
    const { favicon = false, mimetype: mimetypeOverride } = options
    const buffer = await resolveToBuffer(image)
    const mimetype = mimetypeOverride || await detectMimetype(buffer)

    const [uploaded, dims] = await Promise.all([
      sock.message.upload(buffer, { type: 'thumbnail-link', mimetype }),
      resolveDimensions(buffer)
    ])

    const result = {
      thumbnailDirectPath: uploaded.directPath,
      thumbnailSha256: toBase64(uploaded.fileSha256),
      thumbnailEncSha256: toBase64(uploaded.fileEncSha256),
      mediaKey: toBase64(uploaded.mediaKey),
      mediaKeyTimestamp: uploaded.mediaKeyTimestamp,
      thumbnailWidth: dims.width,
      thumbnailHeight: dims.height,
      mimetype
    }

    if (uploaded.url) result.url = uploaded.url

    if (!favicon) {
      try {
        const jpeg = await sharp(buffer)
          .resize({ width: 120, withoutEnlargement: true })
          .jpeg({ quality: 40 })
          .toBuffer()
        result.jpegThumbnail = toBase64(jpeg)
      } catch (e) {
        console.warn('[THUMBNAIL] Gagal membuat jpegThumbnail kecil:', e.message)
      }
    }

    return result
  }

  /**
   * Send link preview message with custom thumbnail
   */
  sock.sendThumbnail = async (jid, options = {}) => {
    const { thumbnail, title, body, url, text, quote, ...rest } = options

    const cleanUrl = String(url || '').trim()
    if (!cleanUrl) throw new Error('sendThumbnail: URL parameter diperlukan.')

    let thumbMeta = {}
    if (thumbnail) {
      thumbMeta = await sock.uploadThumbnail(thumbnail)
    }

    const payload = {
      extendedTextMessage: {
        title: String(title || '').trim() || undefined,
        description: String(body || '').trim() || undefined,
        text: `${cleanUrl}${text ? `\n${String(text).trim()}` : ''}`,
        matchedText: cleanUrl,
        previewType: 0,
        ...thumbMeta
      }
    }

    const quoteKey = quote?.raw ?? quote
    return sock.message.send(jid, payload, {
      ...(quoteKey ? { quote: quoteKey } : {}),
      ...rest
    })
  }

  /**
   * Send image
   */
  sock.sendImage = async (jid, input, caption = '', options = {}) => {
    const buffer = await resolveToBuffer(input)
    const mimetype = await detectMimetype(buffer)
    const { quote, mentions, ...rest } = options
    const quoteKey = quote?.raw ?? quote

    return sock.message.send(jid, {
      type: 'image',
      media: buffer,
      mimetype,
      caption,
      ...rest
    }, {
      ...(quoteKey ? { quote: quoteKey } : {}),
      ...(mentions ? { mentions } : {})
    })
  }

  /**
   * Send video
   */
  sock.sendVideo = async (jid, input, caption = '', options = {}) => {
    const buffer = await resolveToBuffer(input)
    const mimetype = await detectMimetype(buffer)
    const { quote, mentions, ...rest } = options
    const quoteKey = quote?.raw ?? quote

    return sock.message.send(jid, {
      type: 'video',
      media: buffer,
      mimetype,
      caption,
      ...rest
    }, {
      ...(quoteKey ? { quote: quoteKey } : {}),
      ...(mentions ? { mentions } : {})
    })
  }

  /**
   * Send document
   */
  sock.sendDocument = async (jid, input, fileName = 'file', mimetypeOverride = null, options = {}) => {
    const buffer = await resolveToBuffer(input)
    const mimetype = mimetypeOverride || await detectMimetype(buffer)
    const { quote, mentions, caption, ...rest } = options
    const quoteKey = quote?.raw ?? quote

    return sock.message.send(jid, {
      type: 'document',
      media: buffer,
      fileName,
      mimetype,
      caption,
      ...rest
    }, {
      ...(quoteKey ? { quote: quoteKey } : {}),
      ...(mentions ? { mentions } : {})
    })
  }

  return sock
}

/**
 * Handles pairing code interactive request
 */
async function requestPairing(sock) {
  try {
    let phoneNumber = config.pairingNumber ? String(config.pairingNumber).replace(/\D/g, '') : ''

    if (!phoneNumber) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
      phoneNumber = (await new Promise(res =>
        rl.question(chalk.cyan.bold('\n[PAIRING] Masukkan nomor WhatsApp bot (contoh 628xxx): '), res)
      )).replace(/\D/g, '')
      rl.close()
    }

    if (!phoneNumber) {
      console.log(chalk.yellow('[PAIRING] Nomor kosong, beralih menunggu scan QR...'))
      return
    }

    let customCode = config.customPairing ? String(config.customPairing).trim().toUpperCase() : null
    if (customCode && (customCode.length !== 8 || !/^[1-9A-HJ-NP-TV-Z]{8}$/.test(customCode))) {
      console.log(chalk.red.bold(`[PAIRING] Custom code "${customCode}" tidak valid, menggunakan kode acak.`))
      customCode = null
    }

    const code = customCode
      ? await sock.auth.requestPairingCode(phoneNumber, true, customCode)
      : await sock.auth.requestPairingCode(phoneNumber)

    const formatted = code?.match(/.{1,4}/g)?.join('-') ?? code

    console.log(chalk.bgMagenta.white.bold('\n  ┌─────────────────────────────────┐  '))
    console.log(chalk.bgMagenta.white.bold('  │         KODE PAIRING ANDA       │  '))
    console.log(chalk.bgBlack.greenBright.bold(`  │            ${formatted}         │  `))
    console.log(chalk.bgMagenta.white.bold('  └─────────────────────────────────┘  \n'))
    console.log(chalk.yellow('Buka WhatsApp di HP > Perangkat Tertaut > Tautkan dengan nomor telepon.\n'))
  } catch (err) {
    console.error(chalk.red('[PAIRING] Gagal meminta kode pairing:'), err?.message || err)
  }
}

/**
 * Creates connection socket and initializes SQLite storage
 */
export function createConnection() {
  const sessionDir = path.dirname(config.sessionPath)
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true })
    console.log(chalk.gray(`[SESSION] Direktori "${sessionDir}" dibuat.`))
  }

  // Configure SQLite store for all providers
  const store = createStore({
    backends: {
      sqlite: createSqliteStore({ path: config.sessionPath })
    },
    providers: {
      auth: 'sqlite',
      signal: 'sqlite',
      preKey: 'sqlite',
      session: 'sqlite',
      identity: 'sqlite',
      senderKey: 'sqlite',
      appState: 'sqlite',
      privacyToken: 'sqlite',
      messages: 'none',
      threads: 'none',
      contacts: 'none'
    }
  })

  const silentLogger = {
    level: 'error',
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() { return silentLogger }
  }

  const sock = new WaClient(
    {
      store,
      sessionId: config.sessionId || 'default',
      recoverFromClientTooOld: true,
      media: {
        processor: createMediaProcessor(),
        generateThumbnail: true,
        generateWaveform: true,
        normalizeVoiceNote: true
      }
    },
    silentLogger
  )

  attachSocketHelpers(sock)

  return sock
}

/**
 * Sets up connection event listeners and reconnector
 */
export function setupConnectionHandler(sock) {
  let reconnectAttempts = 0
  const maxReconnect = 10

  sock.on('connection', async (event) => {
    if (event.status === 'open') {
      reconnectAttempts = 0
      console.log(chalk.bgGreen.black.bold('\n  🚀 [SLOWLYBASE] BOT BERHASIL TERHUBUNG KE WHATSAPP!  \n'))
      return
    }

    if (event.isLogout) {
      console.log(chalk.bgRed.white.bold('\n  ⚠️ [SLOWLYBASE] Sesi dikeluarkan dari WhatsApp! Perlu pairing ulang.  \n'))
      return
    }

    console.log(chalk.yellow(`[WA] Koneksi terputus: ${event.reason || 'Network timeout'}`))

    if (reconnectAttempts < maxReconnect) {
      reconnectAttempts++
      const delay = Math.min(30000, 2000 * 2 ** reconnectAttempts)
      console.log(chalk.yellow(`[WA] Mencoba menyambung kembali dalam ${delay / 1000} detik (percobaan ${reconnectAttempts}/${maxReconnect})...`))
      await new Promise(r => setTimeout(r, delay))
      try {
        await sock.connect()
      } catch (err) {
        console.error(chalk.red('[WA] Reconnect error:'), err.message)
      }
    } else {
      console.log(chalk.red.bold('[WA] Gagal reconnect setelah batas percobaan maksimal.'))
    }
  })

  sock.on('auth_qr', ({ qr, ttlMs }) => {
    if (!config.usePairingCode) {
      console.log(chalk.cyan.bold('\n── SCAN QR CODE DI BAWAH INI ──'))
      qrcode.generate(qr, { small: true })
      console.log(chalk.gray(`(Berlaku ${Math.round(ttlMs / 1000)} detik)\n`))
    } else if (!isPairingRequested) {
      isPairingRequested = true
      void requestPairing(sock)
    }
  })

  sock.on('auth_pairing_required', () => {
    if (config.usePairingCode && !isPairingRequested) {
      isPairingRequested = true
      void requestPairing(sock)
    }
  })

  sock.on('auth_paired', ({ credentials }) => {
    console.log(chalk.green.bold(`\n✅ [AUTH] Berhasil terotentikasi sebagai ${chalk.yellow(credentials.meJid)}\n`))
  })

  sock.on('debug_client_error', ({ error }) => {
    console.error(chalk.red('[WA ERROR]:'), error?.message || error)
  })

  return sock
}

export default {
  createConnection,
  setupConnectionHandler,
  attachSocketHelpers
}
