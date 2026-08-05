/**
 * Strip the short-lived `?exp=&sig=` token from a `/media/...` URL.
 *
 * Media URLs handed to the app are signed so that `<img>` tags keep working
 * when the session cookie is dropped. A link a person copies and passes on is
 * the opposite case: the signature expires within a couple of hours, and until
 * it does it lets anyone outside the community fetch the file. Share the plain
 * URL instead and let the recipient's own session authorize it.
 */
export function unsignedMediaUrl(url: string): string {
  return url.split("?")[0]
}
