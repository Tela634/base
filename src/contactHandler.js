// src/contactHandler.js
// Handles WhatsApp contacts caching, database persistence, and profile resolution

import chalk from 'chalk'
import { upsertContact, getContact } from './database.js'
import { normalizeJid } from './utils.js'

/**
 * Saves or updates contact information in local SQLite database
 */
export function trackContact(jid, pushName) {
  if (!jid || jid.endsWith('@g.us') || jid.endsWith('@newsletter')) return

  const cleanJid = normalizeJid(jid)
  const phoneNumber = cleanJid.split('@')[0]

  try {
    upsertContact(cleanJid, pushName, phoneNumber)
  } catch (err) {
    console.error(chalk.red('[CONTACT] Gagal simpan kontak:'), err?.message)
  }
}

/**
 * Resolves contact name with fallback
 */
export function resolveContactName(jid, fallback = 'Unknown') {
  if (!jid) return fallback
  const cached = getContact(normalizeJid(jid))
  return cached?.push_name || fallback
}

/**
 * Sets up contact listeners on socket
 */
export function setupContactHandler(sock) {
  sock.on('contact', (event) => {
    if (event?.jid && event?.pushName) {
      trackContact(event.jid, event.pushName)
    }
  })
}

export default {
  trackContact,
  resolveContactName,
  setupContactHandler
}
