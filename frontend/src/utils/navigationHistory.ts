let previousPathname: string | null = null
let currentPathname: string | null = null

export function trackNavigation(pathname: string) {
  if (currentPathname !== pathname) {
    previousPathname = currentPathname
    currentPathname = pathname
  }
}

export function getPreviousPathname(): string | null {
  return previousPathname
}
