// index.js
// Entry point for SlowlyBase WhatsApp Bot

import path from 'path'
import { fileURLToPath } from 'url'
import chalk from 'chalk'
import config from './config.js'
import { createConnection, setupConnectionHandler } from './src/connection.js'
import { setupMessageHandler } from './src/handler.js'
import { setupGroupHandler } from './src/groupHandler.js'
import { setupContactHandler } from './src/contactHandler.js'
import { loadPlugins, initPluginWatcher } from './src/pluginManager.js'
import { initDatabase } from './src/database.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PLUGINS_DIR = path.join(__dirname, 'plugins')

console.log(chalk.cyan(`
┌─────────────────────────────────────────────────────────┐
│                   ⚡ SLOWLYBASE BOT ⚡                   │
│   Modular WhatsApp Bot with zapo-js & SQLite Storage    │
└─────────────────────────────────────────────────────────┘
`))

// Global Process Error Trapping
process.on('uncaughtException', (err) => {
  console.error(chalk.red('[UNCAUGHT EXCEPTION]:'), err?.stack || err?.message || err)
})

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('[UNHANDLED REJECTION]:'), reason)
})

let sock = null

async function startBot() {
  try {
    // 1. Initialize Local SQLite Database
    initDatabase()
    console.log(chalk.green('✓ [DATABASE] SQLite database initialized.'))

    // 2. Load Plugins
    await loadPlugins(PLUGINS_DIR)

    // 3. Initialize Hot-reload Plugin Watcher
    initPluginWatcher(PLUGINS_DIR)

    // 4. Create WhatsApp Client with SQLite Session
    sock = createConnection()

    // 5. Attach Handlers
    setupConnectionHandler(sock)
    setupGroupHandler(sock)
    setupContactHandler(sock)
    setupMessageHandler(sock)

    // 6. Connect to WhatsApp
    console.log(chalk.yellow('[WA] Menghubungkan ke WhatsApp Web protocol...'))
    await sock.connect()

  } catch (err) {
    console.error(chalk.red('[FATAL] Gagal memulai bot:'), err?.stack || err?.message || err)
    process.exit(1)
  }
}

// Graceful Shutdown
let isShuttingDown = false
async function handleShutdown(signal) {
  if (isShuttingDown) return
  isShuttingDown = true

  console.log(chalk.yellow(`\n[SHUTDOWN] Menerima sinyal ${signal}, menutup koneksi...`))
  try {
    if (sock) {
      await sock.disconnect?.()
    }
  } catch (e) {
    // ignore
  }
  console.log(chalk.green('[SHUTDOWN] Selesai. Sampai jumpa!'))
  process.exit(0)
}

process.on('SIGINT', () => handleShutdown('SIGINT'))
process.on('SIGTERM', () => handleShutdown('SIGTERM'))

startBot()
