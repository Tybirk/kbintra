// Draft persistence with AES-256-GCM encryption.
// The encryption key is generated once per browser and stored in localStorage.
// This prevents other browser tabs/apps from casually reading draft content,
// without requiring any server-side secrets.

const CRYPTO_KEY_ITEM = "_kbi_ck"
const DRAFT_PREFIX = "_kbi_d_"

let cachedKey: CryptoKey | null = null

async function getCryptoKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey

  const stored = localStorage.getItem(CRYPTO_KEY_ITEM)
  if (stored) {
    try {
      const raw = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0))
      cachedKey = await crypto.subtle.importKey(
        "raw",
        raw,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"],
      )
      return cachedKey
    } catch {
      // Corrupted key — generate a fresh one below
    }
  }

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  )
  const raw = await crypto.subtle.exportKey("raw", key)
  localStorage.setItem(
    CRYPTO_KEY_ITEM,
    btoa(String.fromCharCode(...new Uint8Array(raw))),
  )
  cachedKey = key
  return key
}

async function encryptText(text: string): Promise<string> {
  const key = await getCryptoKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(text)
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  )
  const combined = new Uint8Array(12 + encrypted.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(encrypted), 12)
  return btoa(String.fromCharCode(...combined))
}

async function decryptText(stored: string): Promise<string> {
  const key = await getCryptoKey()
  const combined = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0))
  const iv = combined.slice(0, 12)
  const data = combined.slice(12)
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  )
  return new TextDecoder().decode(decrypted)
}

function isDraftEmpty(content: string): boolean {
  return !content || content === "<p></p>" || content === "<p><br></p>"
}

export async function saveDraft(key: string, content: string): Promise<void> {
  if (isDraftEmpty(content)) {
    clearDraft(key)
    return
  }
  try {
    const encrypted = await encryptText(content)
    localStorage.setItem(DRAFT_PREFIX + key, encrypted)
  } catch {
    // Non-critical — silently skip if encryption fails
  }
}

export async function loadDraft(key: string): Promise<string | null> {
  const stored = localStorage.getItem(DRAFT_PREFIX + key)
  if (!stored) return null
  try {
    const text = await decryptText(stored)
    return isDraftEmpty(text) ? null : text
  } catch {
    clearDraft(key)
    return null
  }
}

export function clearDraft(key: string): void {
  localStorage.removeItem(DRAFT_PREFIX + key)
}
