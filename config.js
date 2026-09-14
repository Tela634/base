// config.js
// Central configuration for SlowlyBase WhatsApp Bot

import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)

export const config = {
  // Bot & Owner Identity
  botName: 'SlowlyBase',
  ownerName: 'Hyuu',
  ownerNumber: '6281234567890', // Nomor owner (dengan kode negara tanpa +)
  
  // Command & Prefix Settings
  prefixes: ['.', '#', '!', '/'],
  noPrefix: false, // Set true jika ingin bot merespon perintah tanpa prefix
  selfMode: false, // Set true jika hanya owner yang boleh menggunakan bot
  
  // Authentication & Pairing
  usePairingCode: true, // true = Pairing Code, false = QR Code Terminal
  pairingNumber: '',    // Masukkan nomor bot di sini jika tidak ingin ketik saat start
  customPairing: '',    // Custom 8-karakter pairing code (opsional, dilarang huruf O, I, U, 0)
  
  // Storage & Session Paths (SQLite)
  sessionPath: 'session/session.sqlite',
  sessionId: 'default',
  databasePath: 'session/database.sqlite',

  // Logging & Debug
  logMessages: true,
  logAllEvents: false,

  // Default Template Messages
  pesan: {
    wait: '⏳ Sedang diproses, mohon tunggu...',
    done: '✅ Berhasil dilakukan!',
    error: '❌ Terjadi kesalahan! Silakan coba beberapa saat lagi.',
    ownerOnly: '⚠️ Fitur ini khusus untuk Owner bot!',
    groupOnly: '⚠️ Fitur ini hanya dapat digunakan di dalam Grup!',
    privateOnly: '⚠️ Fitur ini hanya dapat digunakan di Private Chat!',
    adminOnly: '⚠️ Fitur ini hanya dapat digunakan oleh Admin grup!',
    botAdmin: '⚠️ Bot harus menjadi Admin untuk menjalankan perintah ini!'
  }
}

/**
 * Dynamic configuration updater (persists changes to config.js)
 */
export function updateConfig(key, value) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    console.error(`[CONFIG] Gagal update key "${key}": object value tidak didukung secara otomatis.`)
    return false
  }

  try {
    const lines = fs.readFileSync(__filename, 'utf8').split('\n')
    let depth = 0
    let targetIdx = -1
    let indent = '  '

    for (let i = 0; i < lines.length; i++) {
      const bare = lines[i].replace(/(['"])(?:\\.|(?!\1).)*\1/g, '')
      depth += (bare.match(/[{[]/g) || []).length - (bare.match(/[}\]]/g) || []).length

      const match = bare.match(/^(\s*)([A-Za-z_$][\w$]*)\s*:/)
      if (depth === 1 && match && match[2] === key) {
        targetIdx = i
        indent = match[1]
        break
      }
    }

    if (targetIdx === -1) {
      console.error(`[CONFIG] Key "${key}" tidak ditemukan di config.js`)
      return false
    }

    const hadComma = /,\s*$/.test(lines[targetIdx])
    lines[targetIdx] = `${indent}${key}: ${JSON.stringify(value)}${hadComma ? ',' : ''}`

    fs.writeFileSync(__filename, lines.join('\n'), 'utf8')
    config[key] = value
    return true
  } catch (err) {
    console.error('[CONFIG] Error update config.js:', err?.message || err)
    return false
  }
}

export default config
