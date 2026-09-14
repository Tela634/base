// src/groupHandler.js
// Handles WhatsApp group events, participants caching, and admin verification

import chalk from 'chalk'
import { normalizeJid, stripDeviceId } from './utils.js'
import { upsertGroup, getGroup } from './database.js'

const groupCache = new Map()
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Retrieves group metadata from cache or fetches from WhatsApp
 */
export async function getGroupMetadata(jid, sock, force = false) {
  if (!jid || !jid.endsWith('@g.us')) return null

  const cached = groupCache.get(jid)
  const now = Date.now()

  if (!force && cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data
  }

  try {
    const metadata = await sock.group.getMetadata(jid)
    if (metadata) {
      groupCache.set(jid, {
        timestamp: now,
        data: metadata
      })

      // Persist to local SQLite
      upsertGroup(jid, metadata.subject)
      return metadata
    }
  } catch (err) {
    // If rate-limited or error, return cached if exists
    if (cached) return cached.data
  }

  return null
}

export function getCachedGroupMetadata(jid) {
  return groupCache.get(jid)?.data || null
}

/**
 * Checks if a participant is admin in group
 */
export function isAdminInGroup(chatJid, senderJid) {
  const meta = getCachedGroupMetadata(chatJid)
  if (!meta || !meta.participants) return false

  const normalizedSender = normalizeJid(senderJid)
  const participant = meta.participants.find(
    (p) => normalizeJid(p.jid) === normalizedSender || normalizeJid(p.phoneJid) === normalizedSender
  )

  return Boolean(participant?.isAdmin || participant?.isSuperAdmin || participant?.type === 'admin' || participant?.type === 'superadmin')
}

/**
 * Checks if bot itself is admin in group
 */
export function isBotAdminInGroup(chatJid, sock) {
  const meta = getCachedGroupMetadata(chatJid)
  if (!meta || !meta.participants) return false

  const creds = sock.getCredentials?.()
  const botPn = normalizeJid(stripDeviceId(creds?.meJid))
  const botLid = normalizeJid(stripDeviceId(creds?.meLid))

  return isAdminInGroup(chatJid, botPn) || isAdminInGroup(chatJid, botLid)
}

/**
 * Sets up group event listeners
 */
export function setupGroupHandler(sock) {
  sock.on('group', async (event) => {
    const jid = event?.groupJid || event?.chatJid
    if (!jid) return

    const action = String(event?.action || '').toLowerCase()
    const participants = event?.participants || []

    console.log(
      chalk.blue(`[GROUP EVENT] JID: ${jid} | Action: ${action} | Participants: ${participants.length}`)
    )

    // Invalidate and refresh cache
    await getGroupMetadata(jid, sock, true)
  })
}

export default {
  getGroupMetadata,
  getCachedGroupMetadata,
  isAdminInGroup,
  isBotAdminInGroup,
  setupGroupHandler
}
