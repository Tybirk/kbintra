/**
 * Which deployment the app is running in.
 *
 * Production is kb-intra.dk. kbintra.top is the test site, and it runs on a
 * *copy* of production's data: deploy-test.sh rsyncs prod's SQLite file and
 * media into its own ./data on every test deploy, one-way, with prod as the
 * source only. So writes on the test site never reach production, and anything
 * created there is discarded by the next test deploy.
 *
 * Used to keep a feature that is still being trialled out of the way of the ~90
 * residents on the real site while the few of us testing it can reach it. Note
 * what this is not: hiding a nav entry is discovery-hiding, not access control.
 * The routes and the API stay open, so anyone with a URL can still get in.
 */

// Hostnames that are not the real production site.
const TEST_HOSTNAMES = ["kbintra.top"]
const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1"]

/**
 * True only on the test site itself — not on local dev.
 *
 * Distinct from isTestEnvironment on purpose: the "you are on the test site"
 * warning banner should not shout at developers on localhost.
 */
export function isTestDomain(): boolean {
  if (typeof window === "undefined") return false
  return TEST_HOSTNAMES.includes(window.location.hostname)
}

/** True on local dev and on the test site; false on kb-intra.dk. */
export function isTestEnvironment(): boolean {
  // Guarded for any non-browser render path, where there is no location to read.
  if (typeof window === "undefined") return false
  const host = window.location.hostname
  return (
    LOCAL_HOSTNAMES.includes(host) ||
    TEST_HOSTNAMES.includes(host) ||
    TEST_HOSTNAMES.some((name) => host.endsWith(`.${name}`))
  )
}
